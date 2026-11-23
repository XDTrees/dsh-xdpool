/**
 * 豆包渠道的勾选状态要进模型选择器 —— issue #196。
 *
 * 现象：卡片显示「模型 4/16」，选择器却列出 16 个。根因是这一家的
 * `listModels` 把账号的**整个**实时目录发了出去，勾选状态只活在卡片的
 * localStorage 里，而选择器是在 host 进程里拼的。
 *
 * 这里守三件事：
 *   1. 收缩规则本身（纯函数，不需要 session 也不需要网络）；
 *   2. **极性**：存的是「关掉的 id」而不是「留下的 id」；
 *   3. 链路的三个接点都在（Config 字段、路由的 POST、adapter 注入）。
 *
 * 第 2 条是这套改动里最容易做反、也最容易在半年后被「整理」掉的一点：
 * 存 allow-list 的话，`asVolatile(z.array(z.string()).default([]))` 在没人写过
 * 的时候读出来是 `[]`，意思是「一个都不许」——新装用户的豆包分组会直接消失。
 * 这正是 #122 在账号池目录上踩过的坑（那边靠「空数组当全部」绕开），
 * 而豆包用 disable-list 把同样的空值读成「什么都没关」，不需要绕。
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { visibleDoubaoModels } from '../src/doubao-host-adapter.ts'

const indexSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
const routesSource = readFileSync(new URL('../src/doubao-routes.ts', import.meta.url), 'utf8')
const adapterSource = readFileSync(new URL('../src/doubao-host-adapter.ts', import.meta.url), 'utf8')
const cardSource = readFileSync(new URL('../src/client/ChannelPoolSection.tsx', import.meta.url), 'utf8')

/** A roster shaped like the live one: static rows plus discovered `person-*` rows. */
const ROSTER = [
  { id: '0', name: '豆包 快速' },
  { id: '3', name: '豆包 2.1 Turbo' },
  { id: 'seed-lite-7b', name: '豆包 2.1 Lite' },
  { id: 'person-deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
  { id: 'person-kimi-k3-261111', name: 'Kimi K3.1 Pro' },
] as const

describe('勾选收缩', () => {
  it('没动过勾选 → 全部显示', () => {
    // 新装、或用户从没碰过豆包这张卡。必须是「全显示」，否则选择器里会
    // 出现一个空分组，而那看起来像插件坏了。
    expect(visibleDoubaoModels(ROSTER, undefined).map(row => row.id)).toEqual(ROSTER.map(row => row.id))
    expect(visibleDoubaoModels(ROSTER, []).map(row => row.id)).toEqual(ROSTER.map(row => row.id))
  })

  it('关掉一个 → 只少这一个', () => {
    const shown = visibleDoubaoModels(ROSTER, ['3'])
    expect(shown.map(row => row.id)).toEqual(['0', 'seed-lite-7b', 'person-deepseek-v4.1-flash', 'person-kimi-k3-261111'])
  })

  it('issue 现场：16 个里只留 4 个', () => {
    const off = ROSTER.filter(row => row.id !== 'person-deepseek-v4.1-flash').map(row => row.id)
    expect(visibleDoubaoModels(ROSTER, off).map(row => row.id)).toEqual(['person-deepseek-v4.1-flash'])
  })

  it('全关 → 一个都不发（这是一种真实状态，不是「没配」）', () => {
    const all = ROSTER.map(row => row.id)
    expect(visibleDoubaoModels(ROSTER, all)).toEqual([])
  })

  it('关掉的 id 里有上游已经删掉的，不影响其它行', () => {
    // 卡片存的是历史 id；上游某天不再列它时，这一条不该把整张表带偏。
    expect(visibleDoubaoModels(ROSTER, ['gone-model']).length).toBe(ROSTER.length)
  })

  it('不改动入参', () => {
    const before = ROSTER.map(row => row.id)
    visibleDoubaoModels(ROSTER, ['3'])
    expect(ROSTER.map(row => row.id)).toEqual(before)
  })
})

describe('极性：存的是「关掉的」，不是「留下的」', () => {
  it('Config 字段叫 doubaoDisabledModels，默认空数组', () => {
    expect(indexSource).toContain('doubaoDisabledModels')
    // 若有人改成 enabled 白名单，下一个断言会连同上一条一起失败。
    expect(indexSource).not.toContain('doubaoEnabledModelIds')
  })

  it('adapter 的规则是「隐藏 disabled 里的」，空值放行', () => {
    expect(adapterSource).toContain('visibleDoubaoModels')
    expect(adapterSource).toMatch(/if \(disabled === undefined \|\| disabled\.length === 0\) return models/)
  })

  it('未勾选列表「没配」时不写 host，避免把 host 上的列表清空', () => {
    // 清过浏览器的浏览器读不到 skipped；这时推送 `[]` 等于替用户做了一次
    // 「全部恢复」的声明。不推，host 保持它已有的答案。
    // 「全关」是例外：那时 skipped 可能为空但 hideAll 为真，仍然要推。
    expect(cardSource).toMatch(/if \(skipped === undefined && !hideAll\) return/)
  })
})

describe('三个接点都接上了', () => {
  it('注册 adapter 时注入 disabled 读数', () => {
    expect(indexSource).toContain('disabled: () => current().doubaoDisabledModels')
  })

  it('路由接受 POST 并严格校验', () => {
    expect(routesSource).toMatch(/req\.method !== 'GET' && req\.method !== 'POST'/)
    expect(routesSource).toContain("body['disabledModelIds']")
    expect(routesSource).toContain('settings service unavailable; doubao selection cannot be saved')
    expect(routesSource).toContain('disabledModelIds must contain non-empty strings')
  })

  it('卡片在勾选、全开全关、以及每次读取目录后都镜像一次', () => {
    const calls = cardSource.match(/await mirrorDoubaoDisabled\(\)/gu) ?? []
    // 三处：readDoubaoModels / toggleModel / setAllModels。
    expect(calls.length).toBeGreaterThanOrEqual(3)
  })

  it('镜像带指纹去重，卡片重读不会刷屏写入', () => {
    expect(cardSource).toContain('lastMirroredDoubaoDisabled')
    expect(cardSource).toMatch(/if \(fingerprint === lastMirroredDoubaoDisabled\) return/)
  })
})
