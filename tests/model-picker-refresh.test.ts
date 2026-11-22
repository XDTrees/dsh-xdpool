/**
 * 「卡片上取消了勾选，模型选择器里还在」的回归测试。
 *
 * 链路有三段，断任何一段都会让用户看到同一个现象：
 *
 *   卡片勾选 → settings（modelSelectionCn）→ catalog.applySelection
 *            → 我们自己 provider 的 models 数组（catalog.visible()）
 *            → 宿主的模型选择器
 *
 * 前三段 3.0.0 是对的：`visible()` 会按 `enabledModelIds` 过滤，测试里也验了。
 * 断的是最后一段 —— 宿主的选择器读的不是我们每次 `buildModels()` 的实时返回值，
 * 而是它自己按 `profiles` map 的 identity 缓存的一份 provider 快照
 * （`dsh-llm-pi-ai/ PiAiAdapter.current()`）。`applyConfigFromSource` 只更新了
 * catalog，没有请宿主重建，于是取消勾选的模型一直留在选择器里，直到重启 DSH
 * 或按一次「重新获取模型」（那条路径里有 invalidation）。
 *
 * 所以这里既有行为断言（过滤本身），也有结构断言（apply 之后必须发起
 * invalidation）。结构断言看着粗糙，但它守的正是「最后一公里有没有接上」，
 * 而那一段在这个仓库里没法用运行时断言表达：host 的缓存藏在 dsh-llm-pi-ai 内部。
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createWorkBuddyAdapter } from '../src/adapter.ts'
import { WorkBuddyCatalog } from '../src/catalog.ts'

/**
 * 一个只在类型上像 shim 的替身。
 *
 * 这条用例不碰网络、不发请求，只关心 `buildModels()` 的 id 集合，所以不需要
 * 真的监听端口：adapter 只用到 `baseUrl()` 和 `token()` 两个读数。
 */
const fakeShim = {
  baseUrl: () => 'http://127.0.0.1:9',
  token: () => 'loopback-secret',
}

const hostSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

/** 取一个函数的函数体（按花括号配平），找不到返回 undefined。 */
function functionBody(source: string, declaration: string, fromLast = false): string | undefined {
  const at = fromLast ? source.lastIndexOf(declaration) : source.indexOf(declaration)
  if (at < 0) return undefined
  const open = source.indexOf('{', at)
  if (open < 0) return undefined
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return undefined
}

describe('勾选的模型才会被 provider 列出', () => {
  it('取消勾选之后 buildModels 就不再包含它', () => {
    const catalog = new WorkBuddyCatalog()
    const adapter = createWorkBuddyAdapter({ shim: fakeShim, catalog } as never)

    // 全部模型都在（新装的默认状态）。
    const before = adapter.buildModels().map(model => model.id)
    expect(before.length).toBeGreaterThan(1)

    const kept = before[0] as string
    const dropped = before[1] as string
    expect(dropped).not.toBe(kept)
    catalog.applySelection({ enabledModelIds: [kept] })

    const after = adapter.buildModels().map(model => model.id)
    expect(after).toContain(kept)
    expect(after).not.toContain(dropped)
  })
})

describe('保存之后必须请宿主重建模型列表', () => {
  it('applyConfigFromSource 在应用选择之后调用 invalidateCatalog', () => {
    const body = functionBody(hostSource, 'const applyConfigFromSource = ')
    expect(body).toBeDefined()
    const applied = body?.indexOf('applySelection(') ?? -1
    const invalidated = body?.indexOf('invalidateCatalog()') ?? -1
    expect(applied, 'applyConfigFromSource 里应当应用模型选择').toBeGreaterThan(-1)
    expect(invalidated, 'applyConfigFromSource 里应当 invalidate 宿主的模型列表').toBeGreaterThan(-1)
    // 顺序也要对：先换掉我们这边的选择，再请宿主重建，否则重建出来的还是旧列表。
    expect(invalidated).toBeGreaterThan(applied)
  })

  it('两个网关的 catalog 变动也会通知宿主（不只是靠设置事件）', () => {
    // 启动时的那次上游拉取、以及换账号后的重新 seed，都不经过 settings，
    // 只经过 catalog.onChange。没有这条订阅，这些路径同样会留下旧列表。
    expect(hostSource).toMatch(/for \(const catalog of \[core\.catalogs\.cn, core\.catalogs\.global\]\)/)
    expect(hostSource).toMatch(/catalog\.onChange\(\(\) => \{\s*invalidateCatalog\(\)/)
  })

  it('invalidate 真的是「新 map / 新 profile」，不是原地改字段', () => {
    // 宿主按 profiles map 的 identity 缓存快照；原地改同一个 map 是无效的，
    // 这条断言守住 adapter 里那个唯一有效的杠杆。
    const adapter = readFileSync(new URL('../src/adapter.ts', import.meta.url), 'utf8')
    // 接口里也有一行 `invalidate: () => void`，所以取最后一处 —— 实现那一个。
    const body = functionBody(adapter, 'invalidate: () => {', true)
    expect(body).toBeDefined()
    expect(body).toContain('new Map<string, ResolvedPiAiProviderProfile>')
    expect(body).toContain('makeProfile(makeProvider())')
  })
})
