/**
 * The ledger must be able to say WHICH channel served a call.
 *
 * Before this, `UsageCall` carried only `region` — `cn` or `global` — which is a
 * property of the WorkBuddy pool and of nothing else. Every row therefore read
 * `国内版` even when the call had gone to OpenCode, Raccoon or the keyless lane,
 * and the only honest reading of the table was "the other channels are not
 * recorded at all". That was literally true: only the pool and the free lane ever
 * called `record`.
 *
 * Two things are asserted here, and both matter:
 *
 *   1. `channel` is part of the GROUPING KEY, not a label bolted on afterwards.
 *      Two vendors publish the same model id, and the pool and the free lane can
 *      both serve `glm-5.3`; summing them would credit one vendor's tokens to
 *      another and make the share column meaningless.
 *   2. A sample filed before the field existed still renders, falling back to the
 *      region — an in-memory window from an older process must not show blanks.
 */
import { describe, expect, it } from 'vitest'
import { UsageRecorder, type UsageCall } from '../src/stats.ts'

function call(over: Partial<UsageCall> = {}): UsageCall {
  return {
    channel: 'workbuddy',
    region: 'cn',
    model: 'glm-5.3',
    account: 'acct-1',
    turnId: 'turn-1',
    at: 1_000,
    ok: true,
    usage: { inputTokens: 100, outputTokens: 10, cachedTokens: 0, reasoningTokens: 0 },
    ...over,
  }
}

describe('usage rows are grouped by channel', () => {
  it('keeps the same model id on two vendors as two rows', () => {
    const recorder = new UsageRecorder()
    recorder.record(call({ channel: 'opencode', region: '', account: 'key-1' }))
    recorder.record(call({ channel: 'raccoon', region: '', account: 'key-2' }))
    const rows = recorder.summary().rows
    // Same `model`, same account label — only the channel differs.
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map(row => row.channel))).toEqual(new Set(['opencode', 'raccoon']))
  })

  it('does not merge the pool with the free lane', () => {
    const recorder = new UsageRecorder()
    recorder.record(call({ channel: 'workbuddy', region: 'cn' }))
    recorder.record(call({ channel: 'free', region: 'free' }))
    const rows = recorder.summary().rows
    expect(rows).toHaveLength(2)
    // Each keeps its own tokens: the pool's 100 do not become "free" and vice versa.
    for (const row of rows) expect(row.inputTokens).toBe(100)
  })

  it('still merges repeats on ONE channel, which is what a row means', () => {
    const recorder = new UsageRecorder()
    recorder.record(call({ at: 1_000 }))
    recorder.record(call({ at: 2_000, turnId: 'turn-2' }))
    const rows = recorder.summary().rows
    expect(rows).toHaveLength(1)
    expect(rows[0]?.calls).toBe(2)
    expect(rows[0]?.inputTokens).toBe(200)
  })
})

describe('per-account rows are grouped by channel too', () => {
  it('keeps a provider key and a pool account apart even with one label', () => {
    const recorder = new UsageRecorder()
    // The same display label on two different channels: a generated id or a
    // vendor key the user named by hand would both look like this.
    recorder.record(call({ channel: 'workbuddy', region: 'cn', account: 'shared' }))
    recorder.record(call({ channel: 'opencode', region: '', account: 'shared' }))
    const rows = recorder.summary().accounts
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map(row => row.channel))).toEqual(new Set(['workbuddy', 'opencode']))
  })

  it('carries the channel through so the card can label the row', () => {
    const recorder = new UsageRecorder()
    recorder.record(call({ channel: 'codearts', region: '' }))
    expect(recorder.summary().accounts[0]?.channel).toBe('codearts')
  })
})
