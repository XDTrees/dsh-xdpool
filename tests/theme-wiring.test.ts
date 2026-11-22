/**
 * 主题开关的接线守卫。
 *
 * 外观切换最容易出现的退化不是「颜色不对」，而是**按钮在、点了没反应**：
 * `data-theme` 没挂到根元素上（那 CSS 一行都不会命中）、图标名写错（画成空白）、
 * 或者只加了英语没加中文（界面里露出 key）。这些在截图里都看不出来，
 * 所以照仓库既有的做法（card-shell.test.ts / host-compat.test.ts）查源码契约。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const shell = readFileSync(new URL('../src/client/shell.tsx', import.meta.url), 'utf8')
const icons = readFileSync(new URL('../src/client/rail-icons.ts', import.meta.url), 'utf8')
const locales = readFileSync(new URL('../src/client/locales.ts', import.meta.url), 'utf8')
const designStyle = readFileSync(new URL('../src/client/design-style.ts', import.meta.url), 'utf8')

describe('主题开关接线', () => {
  it('根元素把当前主题写进 data-theme（亮色样式全靠这个属性命中）', () => {
    expect(shell).toMatch(/className=\{wide \? 'app app-wide' : 'app'\}[^>]*data-theme=\{theme\}/u)
  })

  it('主题按钮真的绑了点击，并且按状态标记 aria-pressed', () => {
    expect(shell).toMatch(/aria-pressed=\{theme === 'light'\}/u)
    expect(shell).toMatch(/onClick=\{switchTheme\}/u)
  })

  it('图标在图标表里存在（否则画出来是空白，且不会报错）', () => {
    expect(icons).toMatch(/^\s*sun:\s*'</mu)
    expect(icons).toMatch(/^\s*moon:\s*'</mu)
  })

  it('切换的两套文案在中英两本词典里都齐全', () => {
    for (const key of ['shell.themeLight', 'shell.themeDark', 'shell.themeToLight', 'shell.themeToDark']) {
      const hits = [...locales.matchAll(new RegExp(`'${key.replace('.', '\\.')}'`, 'gu'))]
      expect(hits.length, `${key} 必须 en/zh 各出现一次`).toBe(2)
    }
  })

  it('亮色样式表排在最后注入（权重和顺序都压过前面几份）', () => {
    expect(designStyle).toMatch(/import \{ LIGHT_THEME_CSS \} from '\.\/theme-css\.ts'/u)
    const full = designStyle.match(/const FULL_CSS = `([^`]*)`/u)
    expect(full).not.toBeNull()
    const expr = (full as RegExpMatchArray)[1] as string
    expect(expr.trimEnd().endsWith('${LIGHT_THEME_CSS}'), `FULL_CSS 结尾是：${expr}`).toBe(true)
  })
})
