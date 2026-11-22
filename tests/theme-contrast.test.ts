import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DEFAULT_THEME, isXdTheme, readTheme, rememberTheme, toggleTheme } from '../src/client/theme.ts'

/**
 * 亮色主题的可读性守卫 —— 把「对比度够不够」变成可复算的数字。
 *
 * 为什么要有：截图只能看出「大概能读」，而配色微调一次就可能把
 * `--faint` 从 4.7:1 掉到 3.9:1，肉眼几乎看不出来。这里按 WCAG 2.1
 * 的相对亮度公式实算，阈值卡死。
 *
 * 阈值：正文/说明文字 ≥ 4.5（AA 小字）；大字号、图标、边框 ≥ 3.0。
 */

const light = readFileSync('src/client/theme-css.ts', 'utf8')

/** 从亮色块里取变量值 */
function token(name: string): string {
  const m = light.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})\\s*;`, 'u'))
  expect(m, `亮色里找不到 ${name}（十六进制形式）`).not.toBeNull()
  return (m as RegExpMatchArray)[1] as string
}

function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** WCAG 相对亮度 */
function luminance(hex: string): number {
  const f = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = rgbOf(hex)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(fg: string, bg: string): number {
  const a = luminance(fg)
  const b = luminance(bg)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

const bg = token('--bg')
const surface = token('--surface')
const surface2 = token('--surface-2')
const text = token('--text')
const muted = token('--muted')
const faint = token('--faint')
const accent = token('--accent')
const accentInk = token('--accent-ink')

describe('护眼绿 · 对比度', () => {
  it('正文在各个表面上都过 AA 小字（≥4.5）', () => {
    for (const [name, back] of [['--bg', bg], ['--surface', surface], ['--surface-2', surface2]] as const) {
      const r = contrast(text, back)
      expect(r, `--text 在 ${name} 上只有 ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('次级文字过 AA（≥4.5）', () => {
    for (const [name, back] of [['--bg', bg], ['--surface', surface], ['--surface-2', surface2]] as const) {
      const r = contrast(muted, back)
      expect(r, `--muted 在 ${name} 上只有 ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('三级文字（时间戳、单位）在最差表面 --surface-2 上仍 ≥4.5', () => {
    const r = contrast(faint, surface2)
    expect(r, `--faint 在 --surface-2 上只有 ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
  })

  it('主色做文字时 ≥4.5，做底时配反色字 ≥4.5', () => {
    expect(contrast(accent, surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(accentInk, accent)).toBeGreaterThanOrEqual(4.5)
  })

  it('状态色做文字时 ≥4.5', () => {
    for (const name of ['--ok', '--warn', '--danger', '--info'] as const) {
      const r = contrast(token(name), surface)
      expect(r, `${name} 在 --surface 上只有 ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('页面上不会出现「白字压白底」：--accent-ink 必须是白，且只压在主色上', () => {
    expect(accentInk).toBe('#FFFFFF')
    expect(contrast(accentInk, surface)).toBeLessThan(2)
  })
})

describe('主题开关的逻辑', () => {
  it('默认是暗色，未知值一律回落到默认', () => {
    expect(DEFAULT_THEME).toBe('dark')
    expect(isXdTheme('light')).toBe(true)
    expect(isXdTheme('dark')).toBe(true)
    expect(isXdTheme('护眼绿')).toBe(false)
    expect(isXdTheme(null)).toBe(false)
    expect(isXdTheme(undefined)).toBe(false)
  })

  it('两个主题互相切换', () => {
    expect(toggleTheme('dark')).toBe('light')
    expect(toggleTheme('light')).toBe('dark')
  })

  it('没有 localStorage（测试环境/隐私模式）时不抛错，读回默认值', () => {
    expect(() => rememberTheme('light')).not.toThrow()
    expect(readTheme()).toBe(DEFAULT_THEME)
  })
})
