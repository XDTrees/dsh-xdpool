import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 亮色主题（护眼绿）的回归守卫。
 *
 * 为什么需要它：`design-css.ts` 的 `.app{}` 里现在有几十个颜色变量，
 * 将来有人加一个 `--c-new: oklch(78% …)` 或 `--danger: oklch(70% …)`，
 * 暗色正常、亮色就会冒出「深底专用」的提亮值 —— 界面上表现为某个角落
 * 发白、发荧光，而大部分区域仍然正常，很难靠眼睛发现。
 *
 * 所以这里锁两件事：
 *   1. 暗色里出现过的**颜色**变量，亮色必须逐个覆盖（漏一个就失败）；
 *   2. 亮色的分界线/阴影必须是深色半透明，不能是暗色那套「一道白光」。
 *
 * 只查颜色，不查半径/字号/缓动 —— 那些和主题无关。
 */

const dark = readFileSync('src/client/design-css.ts', 'utf8')
const light = readFileSync('src/client/theme-css.ts', 'utf8')

/** 取 CSS 文本里第一个 `.app {` 块的声明体 */
function block(css: string, selector: string): string {
  const at = css.indexOf(selector)
  expect(at, `找不到选择器 ${selector}`).toBeGreaterThan(-1)
  const open = css.indexOf('{', at)
  const close = css.indexOf('\n}', open)
  expect(close).toBeGreaterThan(open)
  return css.slice(open + 1, close)
}

/**
 * 取**所有** `.app {` 块的声明体并拼起来。
 *
 * 暗色的颜色变量散在两段里：主 token 一段，22 个 `--c-*` 渠道色另一段
 * （design-css.ts 里明确分了两个 `.app {}`）。只读第一段会把渠道色当成
 * 「亮色多出来的变量」，所以这里全收。
 */
function allAppBlocks(css: string): string {
  const parts: string[] = []
  let from = 0
  for (;;) {
    const at = css.indexOf('.app {', from)
    if (at === -1) break
    const open = css.indexOf('{', at)
    const close = css.indexOf('\n}', open)
    if (close === -1) break
    parts.push(css.slice(open + 1, close))
    from = close
  }
  expect(parts.length, '一个 .app 块都没找到').toBeGreaterThan(0)
  return parts.join('\n')
}

/** 去掉 /* … *\/ 注释，避免注释里出现的词被当成样式断言 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//gu, '')
}

/** 解析 `--name: value;`，只保留长得像颜色的那些 */
function colorTokens(body: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gu)) {
    const name = m[1] as string
    const value = (m[2] as string).trim()
    if (/(?:oklch|oklab|rgba?|#|%)/u.test(value) && !/^\d+(?:\.\d+)?(?:px|rem|s|ms)?$/u.test(value)) {
      out.set(name, value)
    }
  }
  return out
}

/** 亮色块 = `.app[data-theme="light"]` 的第一段 */
const lightBody = block(light, '.app[data-theme="light"]')
const lightCode = stripComments(light)
const darkColors = colorTokens(allAppBlocks(dark))
const lightColors = colorTokens(lightBody)

describe('亮色主题', () => {
  it('暗色用到的每个颜色变量，亮色都覆盖了', () => {
    const missing = [...darkColors.keys()].filter(name => !lightColors.has(name))
    expect(missing, `亮色漏掉这些颜色变量：${missing.join(', ')}`).toEqual([])
  })

  it('亮色不引入暗色没有的变量（防止拼错名字导致静默失效）', () => {
    /*
      这条断言的目的是抓「名字拼错」：亮色写 --surfce-2，暗色的 --surface-2 照旧生效，
      白底上就会冒出暗色文字，而大部分区域正常，很难靠眼睛发现。

      但有一类变量是**只属于亮色**的：暗色用 var(--x, 原值) 的兜底值，不需要自己声明。
      这种必须显式登记，并且下面还要验证它真的被组件用到 —— 否则登记表会变成垃圾场。
    */
    const LIGHT_ONLY = new Set(['--xd-pop-shadow'])
    const extra = [...lightColors.keys()].filter(name => !darkColors.has(name) && !LIGHT_ONLY.has(name))
    expect(extra, `亮色多出这些暗色没有的变量：${extra.join(', ')}`).toEqual([])
  })

  it('亮色专属变量都被组件真实引用（不是登记了就忘）', () => {
    const read = (p: string) => readFileSync(p, 'utf8')
    const sources = ['src/client/LedgerPage.tsx'].map(read).join('\n')
    for (const name of ['--xd-pop-shadow']) {
      expect(sources, `${name} 在亮色里声明了，但没有任何组件引用它`).toContain(`var(${name},`)
    }
  })

  it('分界线是深色半透明，不是暗色的白色半透明', () => {
    for (const name of ['--line', '--line-2', '--line-3'] as const) {
      const value = lightColors.get(name) ?? ''
      expect(value, `${name} 应改成深色半透明`).toMatch(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\.?\d/u)
      expect(value, `${name} 不应再是白色`).not.toMatch(/rgba\(\s*255\s*,\s*255\s*,\s*255/u)
    }
  })

  it('主色块上的字必须反色（亮色主题里主色是深的）', () => {
    expect(lightColors.get('--accent-ink')).toBe('#FFFFFF')
  })

  it('选择器挂在 .app[data-theme="light"] 上，不碰宿主 :root', () => {
    expect(lightCode).toContain('.app[data-theme="light"]')
    expect(lightCode).not.toMatch(/(^|\n)\s*:root\s*\{/u)
    expect(lightCode).not.toMatch(/prefers-color-scheme/u)
  })

  it('滚动条滑块与开关滑块的字面色也被换掉了', () => {
    expect(light).toMatch(/::-webkit-scrollbar-thumb/u)
    expect(light).toMatch(/\.sw::after/u)
  })
})
