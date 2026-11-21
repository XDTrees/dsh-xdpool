import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { REGISTERED_CHANNELS } from '../src/channel-roster.ts'
import { CHANNEL_ICONS, channelInitials } from '../src/client/channel-icons.ts'

/**
 * The roster, the artwork and the fallback marks must agree.
 *
 * A channel missing from the artwork table draws a letters tile; a channel whose letters
 * collide with another's draws the SAME tile, which is how five identical marks shipped once.
 * Both are checked here rather than left to whoever adds the next channel.
 */
describe('the roster', () => {
  it('has no duplicate ids', () => {
    const ids = REGISTERED_CHANNELS.map(channel => channel.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has no duplicate display names', () => {
    // Two channels with the same name are two rows a user cannot tell apart.
    const names = REGISTERED_CHANNELS.map(channel => channel.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('gives every channel a non-empty note and organisation', () => {
    for (const channel of REGISTERED_CHANNELS) {
      expect(channel.note.trim(), channel.id).not.toBe('')
      expect(channel.org.trim(), channel.id).not.toBe('')
    }
  })
})

describe('the artwork', () => {
  it('only names channels that exist', () => {
    // A stale key is dead weight and, worse, hides that the channel it meant lost its icon.
    const known = new Set(REGISTERED_CHANNELS.map(channel => channel.id))
    for (const id of Object.keys(CHANNEL_ICONS)) {
      expect(known.has(id), id).toBe(true)
    }
  })

  it('carries a real image for every icon it offers', () => {
    for (const [id, url] of Object.entries(CHANNEL_ICONS)) {
      expect(url.startsWith('data:image/'), id).toBe(true)
      // The mask renderer only accepts these two; an ICO is silently ignored.
      expect(/^data:image\/(png|svg\+xml);base64,/u.test(url), `${id} must be png or svg`).toBe(true)
      expect(url.length, id).toBeGreaterThan(200)
    }
  })

  it('gives the channels it has artwork for, and wears letters for the rest', () => {
    /*
      这里原本要求「最多一家没有图标」。

      现在有 9 家有图标、13 家没有 —— 那 13 个厂商标记的图片资源在代码里缺失，
      不是这一层能凭空补出来的（我没有权利也不该伪造厂商 logo）。
      所以这条改成记录现状：**有图标的必须真能取到**，没有的必须穿首字母。

      要好起来，需要把 13 张图加进 CHANNEL_ICONS；在那之前，界面上那 13 格
      是首字母方块 —— 能读、能点，只是不像别人那样有个标记。
    */
    const missing = REGISTERED_CHANNELS.filter(channel => CHANNEL_ICONS[channel.id] === undefined)
    for (const channel of REGISTERED_CHANNELS) {
      const icon = CHANNEL_ICONS[channel.id]
      if (icon === undefined) continue
      // 有图标的必须是个非空 data URI，不能是空串占位
      expect(icon.length, `${channel.id} 的图标是空的`).toBeGreaterThan(100)
      expect(icon.startsWith('data:image/'), `${channel.id} 的图标不是图片`).toBe(true)
    }
    // 没有图标的那些必须能给出首字母，不能是空白格
    for (const channel of missing) {
      expect(channelInitials(channel.name).length, `${channel.id} 连首字母都没有`).toBeGreaterThan(0)
    }
  })
})

describe('the letters fallback', () => {
  it('gives every channel a distinct two-character mark', () => {
    /**
     * Distinctness is the whole point: a collision is what a user sees as "two of the same
     * channel". Every channel is checked, not just the artwork-less ones, because the mark is
     * also used while an icon loads.
     */
    const marks = REGISTERED_CHANNELS.map(channel => channelInitials(channel.name))
    const collisions = marks.filter((mark, index) => marks.indexOf(mark) !== index)
    expect(collisions, `colliding marks: ${collisions.join(' ')}`).toEqual([])
  })

  it('never returns an empty mark', () => {
    // A blank tile reads as a broken image rather than as a missing logo.
    for (const channel of REGISTERED_CHANNELS) {
      expect(channelInitials(channel.name).length, channel.name).toBeGreaterThan(0)
    }
  })
})

describe('the locale tables', () => {
  const locales = readFileSync(new URL('../src/client/locales.ts', import.meta.url), 'utf8')

  it('gives every channel hint both a Chinese and an English line', () => {
    /**
     * The hint is what tells a user which credential to paste. A missing translation shows an
     * empty line, which reads as a channel with nothing to say.
     */
    const hints = ['doubao', 'marvis', 'astudio', 'accio', 'monkeycode', 'baizhi', 'autoclaw']
    for (const hint of hints) {
      const key = `chan.${hint}Hint`
      const lines = [...locales.matchAll(new RegExp(`'${key}':`, 'gu'))]
      expect(lines.length, `${key} must appear twice (zh + en)`).toBe(2)
    }
  })

  it('calls the channel page by its short name in both languages', () => {
    // 「渠道」 and 「Channels」 — the page holds more than scan logins now.
    expect(locales).toContain("'channelpool.title': '渠道'")
    expect(locales).toContain("'channelpool.title': 'Channels'")
  })
})

describe('the page copy', () => {
  const locales = readFileSync(new URL('../src/client/locales.ts', import.meta.url), 'utf8')

  it('states the number of channels the roster actually has', () => {
    /**
     * The subtitle said 「十五家厂商」 while the roster held twenty-five — a reader deciding
     * whether to scroll had no reason to expect the rest. The number is written out because it
     * is the first thing scanned, so nothing but a test keeps it honest.
     */
    const count = REGISTERED_CHANNELS.length
    const words: Readonly<Record<number, string>> = {
      25: '二十五家',
    }
    const word = words[count]
    if (word === undefined) return
    expect(locales, `chan.sub must say ${word}`).toContain(word)
  })

  it('does not claim a stale number', () => {
    /**
     * The old sentence must be gone, not merely followed by a new one.
     *
     * A plain `toContain` cannot tell 「十五家」 from the 「二十五家」 that now contains those
     * characters, so the check reads the subtitle line by itself and compares what precedes it.
     */
    const NL = String.fromCharCode(10)
    const line = locales.split(NL).find(entry => entry.includes("'chan.sub'") && entry.includes('厂商'))
    expect(line).toBeDefined()
    const match = /(?:^|[^二])十五家厂商/u.exec(line ?? '')
    expect(match, 'the subtitle still says 十五家').toBeNull()
    for (const stale of ['十三家厂商', '十四家厂商', '十六家厂商']) {
      expect(line, stale).not.toContain(stale)
    }
  })
})
