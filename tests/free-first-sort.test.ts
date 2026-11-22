import { describe, expect, it } from 'vitest'
import { isFreeChannelModel, sortChannelModels, type ChannelModel } from '../src/client/channel-rpc.ts'

/**
 * 免费模型排最前面。
 *
 * 大多数厂商不带 isFree 标记，而是把价格写进名字（`Hy3 · x0.00`、`Qwen · 免费`）。
 * 只看标记的话，这些免费模型会混在收费的里面，用户要一行行找。
 */
describe('free models come first', () => {
  const m = (id: string, name: string, extra: Partial<ChannelModel> = {}): ChannelModel => ({ id, name, ...extra })

  it('reads free from the name as well as the flag', () => {
    expect(isFreeChannelModel(m('a', 'Hy3 · x0.00'))).toBe(true)
    expect(isFreeChannelModel(m('b', 'Qwen3.8-Flash · 免费'))).toBe(true)
    expect(isFreeChannelModel(m('c', 'GLM 5 · 限时免费'))).toBe(true)
    expect(isFreeChannelModel(m('d', 'DeepSeek · x0.12→x0'))).toBe(true)
    expect(isFreeChannelModel(m('e', 'DeepSeek · x0.12→x0.06'))).toBe(false)
    expect(isFreeChannelModel(m('f', 'Hy4 · x0.40'))).toBe(false)
    expect(isFreeChannelModel(m('g', 'Plain name'))).toBe(false)
    expect(isFreeChannelModel(m('h', 'Plain name', { isFree: true }))).toBe(true)
  })

  it('sorts every free model ahead of every paid one', () => {
    const sorted = sortChannelModels([
      m('paid-wide', 'Big · x1.0', { contextWindow: 1_000_000 }),
      m('free-name', 'Small · 免费', { contextWindow: 8_000 }),
      m('paid-small', 'Tiny · x0.40'),
      m('free-zero', 'Hy3 · x0.00', { contextWindow: 128_000 }),
    ])
    expect(sorted.map(row => row.id)).toEqual(['free-zero', 'free-name', 'paid-wide', 'paid-small'])
  })
})
