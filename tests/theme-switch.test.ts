/**
 * 亮 / 暗切换的回归测试（护眼绿）。
 *
 * 这一套守的是 3.0.0 用户报的那条：「插件只有暗色，没有亮色模式」。
 *
 * 事情经过值得写下来，因为它不是「忘了做」而是「做了相反的决定」：2.x 的
 * `tokens.ts` 顶部明确写着「THERE IS NO THEME SWITCH, ON PURPOSE」——理由是
 * 宿主已经有主题开关，插件再放一个就有两处可看。等 3.0.0 把设计稿整套接进来
 * 之后，插件开始在 `.app` 上自带一整套暗色变量，不再问宿主要颜色，那条理由
 * 就失效了：一个自己决定颜色的界面，不给自己切换等于没有亮色。
 *
 * 断言分四层，缺一层都修不好这件事：
 *   1. **变量层**：护眼绿那一档必须真的存在，且关键变量全部被换掉
 *      （只换 --bg 不换 --text，就是一屏白底白字）。
 *   2. **作用域层**：挂在 `.app[data-theme]` 上，不是 `:root` —— 插件跑在宿主
 *      对话框里，往 html 上写主题会改到宿主。
 *   3. **一致性**：插件里的 `theme-css.ts` 与设计稿 `theme-light.css` 是同一套值，
 *      否则改一处漏一处，预览与实装会慢慢分家。
 *   4. **接线层**：开关把 `data-theme` 写到 `.app` 上，手机档也够得着。
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hostTheme, initialTheme, otherTheme, storedTheme } from '../src/client/theme.ts'

const themeModule = readFileSync(new URL('../src/client/theme-css.ts', import.meta.url), 'utf8')
const designTokens = readFileSync(new URL('../../xdpool-design/theme-light.css', import.meta.url), 'utf8')
const styleInstaller = readFileSync(new URL('../src/client/design-style.ts', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../src/client/shell.tsx', import.meta.url), 'utf8')
const responsive = readFileSync(new URL('../src/client/responsive-css.ts', import.meta.url), 'utf8')
const locales = readFileSync(new URL('../src/client/locales.ts', import.meta.url), 'utf8')

/** 取 `selector { ... }` 的规则体，找不到返回 undefined。 */
/**
 * 取 `selector { ... }` 的规则体（按花括号配平）。
 *
 * 不能用 `indexOf(selector)`：文件头注释里也写着这个选择器（解释「为什么是 .app
 * 而不是 :root」），而 CSS 里还有 `.app[data-theme="light"] .sw::after { … }` 这类
 * 派生规则。所以认的是「选择器 + 紧跟着的左花括号」，再看花括号配对取整块。
 */
function ruleBody(css: string, selector: string): string | undefined {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = new RegExp(`${escaped}\\s*\\{`, 'u').exec(css)
  if (match === null) return undefined
  const open = match.index + match[0].length - 1
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  return undefined
}

/** One declaration's value, or undefined. */
function valueOf(body: string, name: string): string | undefined {
  return new RegExp(`${name}:\\s*([^;]+);`, 'u').exec(body)?.[1]?.trim()
}

const REQUIRED = [
  '--bg', '--surface', '--surface-2', '--surface-3',
  '--text', '--muted', '--faint',
  '--line', '--line-2', '--line-3',
  '--accent', '--accent-strong', '--accent-dim', '--accent-line', '--accent-ink',
  '--ok', '--warn', '--danger', '--info',
  '--sh-sm', '--sh-md', '--sh-lg',
] as const

describe('护眼绿这一档真的存在', () => {
  it('插件侧有 .app[data-theme="light"]', () => {
    expect(ruleBody(themeModule, '.app[data-theme="light"]')).toBeDefined()
  })

  it('设计稿侧也有（静态页要能预览同一种亮色）', () => {
    expect(ruleBody(designTokens, '.app[data-theme="light"]')).toBeDefined()
  })

  it('关键变量全部被换掉，不留任何一个还是暗色的值', () => {
    const body = ruleBody(themeModule, '.app[data-theme="light"]') ?? ''
    for (const name of REQUIRED) {
      expect(body, `${name} 必须在亮色档里重新声明`).toContain(`${name}:`)
    }
  })

  it('亮色不挂在 :root 上，也不跟 prefers-color-scheme 走', () => {
    // 挂 :root 会改到宿主；跟系统走会在暗色宿主里冒出一块亮面板。
    expect(themeModule).not.toContain(':root[data-theme')
    expect(themeModule).not.toMatch(/^\s*@media\s*\(prefers-color-scheme/mu)
  })

  it('分隔线翻成深色半透明，而不是继续用白色', () => {
    const body = ruleBody(themeModule, '.app[data-theme="light"]') ?? ''
    expect(valueOf(body, '--line')).not.toContain('100% 0 0')
    expect(valueOf(body, '--line')).toMatch(/rgba\(/u)
  })

  it('主色在亮色下是深的，所以主色上的字反过来是白的', () => {
    const body = ruleBody(themeModule, '.app[data-theme="light"]') ?? ''
    expect(valueOf(body, '--accent')).toBe('#416D08')
    expect(valueOf(body, '--accent-ink')).toBe('#FFFFFF')
  })

  it('渠道色在白底上也要压暗（22 家一个不漏）', () => {
    const body = ruleBody(themeModule, '.app[data-theme="light"]') ?? ''
    const channels = body.match(/--c-[a-z-]+:/gu) ?? []
    expect(channels.length).toBeGreaterThanOrEqual(22)
    // 亮度统一 52%：原值（68–78%）搬到白底会发白、读数困难。
    for (const line of body.split('\n').filter(text => text.includes('--c-'))) {
      expect(line).toContain('oklch(52%')
    }
  })
})

describe('插件与设计稿是同一套值', () => {
  it('两边的前 20 个变量逐字相同', () => {
    // 改一处漏一处会让静态预览和实装慢慢分家，而这种分家没人会去核对。
    const plugin = ruleBody(themeModule, '.app[data-theme="light"]') ?? ''
    const design = ruleBody(designTokens, '.app[data-theme="light"]') ?? ''
    for (const name of REQUIRED.slice(0, 20)) {
      expect(valueOf(plugin, name), `${name} 两边不一致`).toBe(valueOf(design, name))
    }
  })
})

describe('样式表把它接进去了', () => {
  it('FULL_CSS 末尾追加护眼绿', () => {
    expect(styleInstaller).toContain('LIGHT_THEME_CSS')
    // 排在最后：将来任何一份样式表也写了同名变量时，仍然是亮色档说话。
    expect(styleInstaller).toContain('${LIGHT_THEME_CSS}`')
  })
})

describe('开关接到 .app 上', () => {
  it('PoolShell 把主题写到 .app 的 data-theme', () => {
    expect(shell).toContain('data-theme={theme}')
  })

  it('左下角有这一格，标签说清楚按了会变成什么', () => {
    expect(shell).toContain('rail-theme')
    expect(shell).toContain("'shell.themeToLight'")
    expect(shell).toContain("'shell.themeToDark'")
    expect(locales).toContain("'shell.themeLight': '护眼绿'")
  })

  it('手机档把它单独放回 dock（.rail-foot 整体是收起的）', () => {
    expect(responsive).toContain('.rail-foot > .rail-theme')
    expect(responsive).toContain('.rail-foot > *{display:none}')
  })
})

describe('没有 window 时也要能算出一个主题', () => {
  it('node 环境下退回暗色，不抛', () => {
    expect(initialTheme()).toBe('dark')
  })

  it('读不到宿主主题时返回 undefined，而不是猜一个', () => {
    expect(hostTheme()).toBeUndefined()
    expect(storedTheme()).toBeUndefined()
  })

  it('两个方向互反，不会切了没反应', () => {
    expect(otherTheme('light')).toBe('dark')
    expect(otherTheme('dark')).toBe('light')
  })
})
