/**
 * The login page's row order.
 *
 * The page used to draw the roster verbatim, so adding an account to the ninth channel
 * left the row in ninth place and the user scrolling eight untouched channels to
 * confirm the thing they had just done. The order is now "newest account first", and
 * the subtleties that make that safe are what these tests pin:
 *
 * - the sort must be total and stable, or a page with nothing to sort by would shuffle
 *   between two renders that changed nothing;
 * - a missing stamp means "never added", which must lose to every real timestamp —
 *   including the pack's synthetic `createdAt: 0` rows, which describe a credential the
 *   plugin found on disk rather than one the user just created;
 * - Doubao has no pack account row at all, so the browser's own stamps are the only
 *   thing that can order it, and those must survive a restart.
 *
 * The React tree is not rendered (this process has no DOM); the page-level claim is
 * asserted against its source, the same way `card-shell.test.ts` does.
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  channelRecency,
  orderChannelsByRecency,
  readChannelAddedAt,
  rememberChannelAddedAt,
} from '../src/client/channel-order.ts'
import { accountsFrom } from '../src/client/channel-rpc.ts'

const page = readFileSync(new URL('../src/client/ChannelsPage.tsx', import.meta.url), 'utf8')

/** The roster as the host answers it: a catalogue list, not an activity list. */
const ROSTER = [
  { id: 'codearts' },
  { id: 'buddy' },
  { id: 'lobsterai' },
  { id: 'trae' },
  { id: 'cline' },
  { id: 'doubao' },
] as const

describe('recency comes from the accounts, then from this browser', () => {
  it('takes the newest account per channel, not the first or the last', () => {
    const recency = channelRecency([
      { provider: 'trae', createdAt: 1_000 },
      { provider: 'trae', createdAt: 9_000 },
      { provider: 'trae', createdAt: 5_000 },
    ], {})
    expect(recency.get('trae')).toBe(9_000)
  })

  it('lets a session stamp beat an older pack stamp for the same channel', () => {
    const recency = channelRecency([{ provider: 'trae', createdAt: 1_000 }], { trae: 4_000 })
    expect(recency.get('trae')).toBe(4_000)
  })

  it('keeps the pack stamp when the session stamp is older', () => {
    // A restored backup can carry a stamp from the future of this browser's session;
    // the newest fact wins whichever side it came from.
    const recency = channelRecency([{ provider: 'trae', createdAt: 9_000 }], { trae: 4_000 })
    expect(recency.get('trae')).toBe(9_000)
  })

  it('drops zero and non-finite stamps instead of ranking them', () => {
    // The pack writes `createdAt: 0` on a row it synthesised from a credential it found
    // on disk. That row was not "added just now", and a `0` that sorts as a real value
    // would tie with "never added" and scramble the tie-break.
    const recency = channelRecency([
      { provider: 'cline', createdAt: 0 },
      { provider: 'trae', createdAt: Number.NaN },
      { provider: 'lobsterai', createdAt: undefined },
    ], { minimax: 0 })
    expect(recency.size).toBe(0)
  })

  it('ignores an account whose provider is empty rather than filing it under ""', () => {
    const recency = channelRecency([{ provider: '', createdAt: 5_000 }], {})
    expect(recency.has('')).toBe(false)
  })
})

describe('the order: newest first, roster order underneath', () => {
  it('moves the channel that was just added to the top', () => {
    const ordered = orderChannelsByRecency(ROSTER, new Map([['trae', 9_000]]))
    expect(ordered.map((channel) => channel.id)).toEqual([
      'trae', 'codearts', 'buddy', 'lobsterai', 'cline', 'doubao',
    ])
  })

  it('ranks several added channels by time, not by roster position', () => {
    const ordered = orderChannelsByRecency(ROSTER, new Map<string, number>([
      ['doubao', 2_000],
      ['cline', 7_000],
    ]))
    expect(ordered.slice(0, 2).map((channel) => channel.id)).toEqual(['cline', 'doubao'])
  })

  it('leaves a roster with no activity exactly as it was', () => {
    // The fresh-install case. Sorting must be a no-op here, or the fourteen channels
    // would look shuffled on a page where the user has done nothing yet.
    const ordered = orderChannelsByRecency(ROSTER, new Map())
    expect(ordered.map((channel) => channel.id)).toEqual(ROSTER.map((channel) => channel.id))
  })

  it('breaks a tie with the order it was handed, not with the timestamps', () => {
    // Two channels stamped in the same millisecond (a restored backup, or a pack write
    // that rounds) must not swap places between two renders that changed nothing. The
    // page hands in the roster, so a tie resolves to roster order — every time.
    const tied = new Map([['cline', 5_000], ['trae', 5_000], ['doubao', 5_000]])
    const once = orderChannelsByRecency(ROSTER, tied).map((channel) => channel.id)
    const twice = orderChannelsByRecency(ROSTER, tied).map((channel) => channel.id)
    expect(once).toEqual(['trae', 'cline', 'doubao', 'codearts', 'buddy', 'lobsterai'])
    expect(twice).toEqual(once)
  })

  it('never mutates the array it was handed', () => {
    const input = [...ROSTER]
    orderChannelsByRecency(input, new Map([['doubao', 1_000]]))
    expect(input.map((channel) => channel.id)).toEqual(ROSTER.map((channel) => channel.id))
  })
})

describe('the page draws the ordered list, and stamps a completed login', () => {
  it('sorts the roster instead of mapping it in place', () => {
    // The bug was literally `channels.map(...)` over the untouched roster. Both halves
    // are asserted: the orderer is imported and applied, and the render reads its result.
    expect(page).toContain("from './channel-order.ts'")
    expect(page).toMatch(/orderChannelsByRecency\(/)
    expect(page).toMatch(/channels\.map\(/)
    expect(page).not.toMatch(/const channels = status\?\.channels \?\? \[\]/u)
  })

  it('stamps a channel on both login paths, pack and Doubao', () => {
    // The pack path lands through `login.poll`; Doubao answers on its own route. A stamp
    // on only one of them would make the other channel move only after a page reload.
    expect([...page.matchAll(/rememberChannelAddedAt\(prev, channel\.id, Date\.now\(\)\)/gu)]).toHaveLength(2)
  })

  it('reads the remembered stamps during the first render, not in an effect', () => {
    // An effect would paint the roster order and then re-sort, so the row the user came
    // back to find jumps under the cursor one frame after the page appears.
    expect(page).toMatch(/useState<Readonly<Record<string, number>>>\(\(\) => readChannelAddedAt\(\)\)/u)
  })
})

describe('the stamp store', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
    })
  })

  it('round-trips a stamp through storage, so Doubao survives a restart', () => {
    const next = rememberChannelAddedAt({}, 'doubao', 1_700_000_000_000)
    expect(next['doubao']).toBe(1_700_000_000_000)
    expect(readChannelAddedAt()).toEqual({ doubao: 1_700_000_000_000 })
  })

  it('keeps earlier stamps when a second channel is added', () => {
    rememberChannelAddedAt(rememberChannelAddedAt({}, 'doubao', 1_000), 'trae', 2_000)
    expect(readChannelAddedAt()).toEqual({ doubao: 1_000, trae: 2_000 })
  })

  it('reports nothing rather than throwing when storage is unusable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('quota') },
      setItem: () => { throw new Error('quota') },
    })
    expect(readChannelAddedAt()).toEqual({})
    // The row still moves for this session: the returned map is what the state holds.
    expect(rememberChannelAddedAt({}, 'trae', 5)['trae']).toBe(5)
  })

  it('discards a hand-edited entry instead of ranking garbage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ trae: 'yesterday', cline: 0, doubao: 12 }),
      setItem: () => {},
    })
    expect(readChannelAddedAt()).toEqual({ doubao: 12 })
  })
})

describe('the pack\'s createdAt reaches the ordering', () => {
  it('is carried out of account.list rather than dropped with the other extra fields', () => {
    // `accountsFrom` narrows every row to the fields the card claims. A field it forgets
    // is silently absent, which reads as "never added" — the ordering would then depend
    // on this browser alone and forget everything across an install.
    const [account] = accountsFrom({
      ok: true,
      value: { accounts: [{ id: 'trae-1', provider: 'trae', createdAt: 1_782_000_000_000 }] },
    })
    expect(account?.createdAt).toBe(1_782_000_000_000)
  })

  it('omits an absent or zero stamp instead of claiming epoch', () => {
    const rows = accountsFrom({
      ok: true,
      value: { accounts: [{ id: 'a-1', provider: 'line' }, { id: 'b-1', provider: 'trae', createdAt: 0 }] },
    })
    for (const row of rows) expect(row.createdAt).toBeUndefined()
  })
})
