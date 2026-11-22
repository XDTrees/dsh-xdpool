import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 字面色覆盖守卫 —— 这条测试是「上一轮漏检」的直接产物。
 *
 * 背景：第一次排查字面色时我按「行首是属性名」去 grep，结果漏掉了单行规则
 * （`.acct:hover{border-color:oklch(64% .14 155 / .45)}` 这种选择器与声明同一行的写法）。
 * 后来改成解析声明才扫出 21 处，其中 5 处荧光绿在亮色下合成白底只有 1.64:1，
 * 既跑出色相又几乎看不见。
 *
 * 所以干脆把这件事变成断言：`design-css.ts` 里**任何**带字面颜色（oklch/rgba/hex）
 * 的声明，都必须在 `theme-css.ts` 里有一条 `.app[data-theme="light"]` 前缀的规则
 * 覆盖**同一个属性**；否则失败。剩下的极少数「两主题都成立」的项走显式白名单，
 * 每条都要写明理由 —— 白名单本身就是评审入口。
 */

const dark = readFileSync('src/client/design-css.ts', 'utf8')
const light = readFileSync('src/client/theme-css.ts', 'utf8')

/** 真解析：逐条规则取声明，而不是按行首匹配 */
function literalDeclarations(raw: string): Array<{ selector: string; prop: string; value: string }> {
  // 注释先抹成空格（保留换行），否则文件头的模块注释会被当成「选择器」
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  const out: Array<{ selector: string; prop: string; value: string }> = []
  const rule = /([^{}]+)\{([^{}]*)\}/g
  for (const m of css.matchAll(rule)) {
    // 模板字符串前面的 `export const … = ` 也不是选择器：只保留最后一个反引号之后的部分
    const bt = m[1].lastIndexOf('`')
    const selector = (bt >= 0 ? m[1].slice(bt + 1) : m[1]).replace(/\s+/g, ' ').trim()
    if (!selector || selector.startsWith('@') || selector.includes('export const')) continue
    for (const decl of m[2].split(';')) {
      const idx = decl.indexOf(':')
      if (idx < 0) continue
      const prop = decl.slice(0, idx).trim()
      const value = decl.slice(idx + 1).trim()
      if (!prop || prop.startsWith('--')) continue
      if (!/(oklch\(|rgba?\(|#[0-9a-fA-F]{3,8}\b)/.test(value)) continue
      out.push({ selector, prop, value })
    }
  }
  return out
}

/** 亮色侧：`<前缀> 选择器 { 声明 }`，多选择器行也要拆开 */
const PREFIX = '.app[data-theme="light"]'
function lightOverrides(css: string): Array<{ selectors: string[]; props: Set<string> }> {
  const out: Array<{ selectors: string[]; props: Set<string> }> = []
  const rule = /\.app\[data-theme="light"\][^{]*\{[^{}]*\}/g
  for (const m of css.matchAll(rule)) {
    const text = m[0].replace(/\s+/g, ' ')
    const open = text.indexOf('{')
    const head = text.slice(0, open)
    const body = text.slice(open + 1, text.lastIndexOf('}'))
    const selectors = head
      .split(',')
      .map((s) => s.replace(PREFIX, '').trim())
      .filter(Boolean)
    const props = new Set(
      body
        .split(';')
        .map((d) => d.slice(0, Math.max(0, d.indexOf(':'))).trim())
        .filter(Boolean),
    )
    out.push({ selectors, props })
  }
  return out
}

/**
 * 白名单：字面值在两个主题下都成立，强行覆盖反而更差。
 * 每一条都要有理由，而不是「测不过就加进去」。
 */
const ALLOWED = new Map<string, string>([
  ['.qr|background', '二维码必须永远是白底黑码，两主题一致'],
  ['.qr|color', '同上：扫码对比度优先，不跟主题走'],
  ['.ch-logo-letters|color', '渠道首字母压在彩色图标上，两主题都该是白字'],
  ['.ch-logo-letters|text-shadow', '白字在浅色图标上的暗描边，两主题都需要'],
  ['.sw[aria-checked="true"]::after|background', '开关滑块本体：两主题都应是近白色圆点，靠投影区分'],
])

const hits = literalDeclarations(dark)
const overrides = lightOverrides(light)

describe('亮色主题：design-css.ts 的字面色必须逐个有交代', () => {
  it('确实扫到了字面色（防止解析器写坏后空转通过）', () => {
    expect(hits.length).toBeGreaterThanOrEqual(20)
    expect(overrides.length).toBeGreaterThanOrEqual(8)
  })

  it('除白名单外，每个字面色都有同属性的亮色覆盖', () => {
    const missing: string[] = []
    for (const hit of hits) {
      const key = `${hit.selector}|${hit.prop}`
      if (ALLOWED.has(key)) continue
      const covered = overrides.some((o) => o.selectors.includes(hit.selector) && o.props.has(hit.prop))
      if (!covered) missing.push(`${hit.selector} { ${hit.prop}: ${hit.value} }`)
    }
    expect(missing, `以下字面色在亮色主题下没有覆盖：\n${missing.join('\n')}`).toEqual([])
  })

  it('白名单不能膨胀：条目数锁死，新增必须显式改这个测试', () => {
    expect(ALLOWED.size).toBe(5)
  })

  it('白名单里的选择器在 design-css.ts 里仍然存在（防止陈旧条目）', () => {
    for (const key of ALLOWED.keys()) {
      const selector = key.slice(0, key.lastIndexOf('|'))
      expect(
        hits.some((h) => h.selector === selector),
        `白名单条目 ${selector} 在 design-css.ts 里已经不存在了，应删除`,
      ).toBe(true)
    }
  })
})