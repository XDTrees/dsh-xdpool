import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ROOT = new URL('../', import.meta.url)
const read = (relative: string): string =>
  readFileSync(new URL(relative, ROOT), 'utf8').replace(/\r\n/gu, '\n')

const icons = read('src/client/provider-icons.ts')
const registry = JSON.parse(read('src/providers-registry.json'))
const card = read('src/client/AggregatePage.tsx')
const channelIcons = read('src/client/channel-icons.ts')

const rows = [...icons.matchAll(/^ {2}'([^']+)': '([^']*)', \/\/ (.+)$/gmu)]
const entries = new Map(rows.map(([, id, uri, note]) => [id, { uri, note }]))
const vendorIds = registry.map((provider) => provider.id)

describe('the aggregate vendors carry their own artwork', () => {
  it('holds an icon for almost every vendor in the registry', () => {
    const without = vendorIds.filter((id) => !entries.has(id))
    expect(entries.size).toBe(vendorIds.length - without.length)
    // Morph（morphllm.com）、NaraRoute（router.bynara.id）的 favicon 已转成 32px PNG；
    // LLaMA.cpp 用的是它所属组织 ggml-org 的 GitHub 头像（不是 Meta 的）。
    // 只剩 `custom_openai`：它不是一家厂商，是用户自己填的任意接口地址，
    // 没有可取的图标，首字母是唯一正确的答案。
    expect([...without].sort()).toEqual(['custom_openai'])
  })

  it('invents no key the registry does not have', () => {
    expect([...entries.keys()].filter((id) => !vendorIds.includes(id))).toEqual([])
  })

  it('paints every vector mark white, because the tile behind it is dark', () => {
    const vector = [...entries].filter(([, { uri }]) => uri.startsWith('data:image/svg+xml;'))
    expect(vector.length).toBeGreaterThan(30)
    for (const [id, { uri }] of vector) {
      const decoded = decodeURIComponent(uri.slice('data:image/svg+xml;utf8,'.length))
      expect(decoded, id).toMatch(/^<svg [^>]*><path fill="white" d="[^"]+"\/><\/svg>$/u)
      // simple-icons' own fill is near-black; leaving it would put an invisible
      // mark on a near-black card.
      expect(decoded, id).not.toContain('#191919')
    }
  })

  it('carries every raster mark as a real PNG', () => {
    const raster = [...entries].filter(([, { uri }]) => uri.startsWith('data:image/png;base64,'))
    expect(raster.length).toBeGreaterThan(25)
    for (const [id, { uri }] of raster) {
      const bytes = Buffer.from(uri.slice('data:image/png;base64,'.length), 'base64')
      expect(bytes.subarray(1, 4).toString('latin1'), id).toBe('PNG')
      // Google's endpoint answers a missing favicon with 404 and a 726-byte
      // placeholder body; a payload that small is what got frozen by mistake.
      expect(bytes.byteLength, id).toBeGreaterThan(100)
    }
  })

  it('never emits a payload that would terminate its own string literal', () => {
    for (const [id, { uri }] of entries) {
      expect(uri, id).not.toContain("'")
      expect(uri, id).not.toContain('\\')
      expect(uri, id).toMatch(/^data:image\/(?:svg\+xml;utf8,|png;base64,)/u)
    }
  })

  it('reads the table through the accessor rather than the raw object', () => {
    expect(icons).toContain('export function providerIcon(id: string): string | undefined')
    expect(card).toContain("import { providerIcon } from './provider-icons.ts'")
  })
})

describe('the aggregate row reaches for artwork before initials', () => {
  it('prefers sign-in artwork, then vendor artwork, then initials', () => {
    expect(card).toContain(
      'const icon = channelIcon(provider.id) ?? providerIcon(provider.id)',
    )
    expect(card).toContain(
      "const tileMark =\n    icon === undefined ? { initials: channelInitials(provider.name) } : { icon }",
    )
  })

  it('spreads that mark onto the tile instead of an empty object', () => {
    // The conditional used to be inverted, which handed the letters to exactly
    // the vendors that had a logo and the logo to the ones that did not.
    expect(card).not.toContain('{...icon === undefined ? {} : { icon }}')
    // 设计稿卡片头的图标是 20px，所以多传一个 size。
    expect(card).toContain('<BrandTile accent={accentFor(provider.id)} glyph="globe" size={20} {...tileMark} />')
  })

  it('reuses the one initials helper the sign-in page uses', () => {
    expect(card).toContain("import { channelIcon, channelInitials } from './channel-icons.ts'")
    expect(channelIcons).toContain('export function channelInitials')
  })

  it('never claims a vendor list that no longer holds', () => {
    // The comment above the tile used to say two vendors have artwork.
    expect(card).not.toContain('Two of the seventy-six vendors have')
  })
})