import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { fetchLiveModels, resetLiveModelsCache } from '../src/doubao-catalog-live.ts'
import type { DoubaoSession } from '../src/doubao-auth.ts'

/**
 * The live catalogue, cached PER ACCOUNT.
 *
 * THE BUG THIS PINS
 *
 * `fetchLiveModels` cached its last answer in a single module-level variable. With one session
 * that was invisible; the moment the lane holds a roster (#171) it becomes the same class of
 * bug as the quota cache — account B's picker would be answered from account A's menu. A plan
 * that publishes fewer models would appear to have the other one's, and a plan that publishes
 * MORE would appear short.
 *
 * The HTTP call is stubbed: the cache decision is what is under test, and the endpoint needs a
 * live cookie jar.
 */
function sessionOf(uid: string): DoubaoSession {
  return {
    cookies: { sessionid: `${uid}-sid`, sessionid_ss: `${uid}-sid`, sid_tt: `${uid}-sid`, uid_tt: uid },
    userAgent: 'ua SamanthaDoubao/2.31.4',
    savedAt: '2026-11-16T00:00:00.000Z',
  }
}

/** Replace `fetch` with an endpoint that answers one model whose id names its caller. */
function stubEndpoint(): { calls: string[] } {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (_url: string, init: { headers?: Record<string, string> }) => {
    const cookie = init.headers?.['cookie'] ?? ''
    const uid = /uid_tt=([^;]+)/u.exec(cookie)?.[1] ?? 'unknown'
    calls.push(uid)
    return {
      ok: true,
      json: async () => ({
        data: { items: [{ model_item_key: `${uid}-model`, name: `${uid} 的模型` }] },
      }),
    }
  })
  return { calls }
}

beforeEach(() => {
  resetLiveModelsCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetLiveModelsCache()
})

describe('the live Doubao catalogue', () => {
  it('asks the vendor once per account, not once per lane', async () => {
    const { calls } = stubEndpoint()
    const a = await fetchLiveModels(sessionOf('a'))
    const b = await fetchLiveModels(sessionOf('b'))
    // Two accounts, two reads: B must not be answered from A's cache entry.
    expect(calls).toEqual(['a', 'b'])
    expect(a.map(model => model.id)).toContain('a-model')
    expect(b.map(model => model.id)).toContain('b-model')
    expect(b.map(model => model.id)).not.toContain('a-model')
  })

  it('reuses ONE account\'s answer within the TTL', async () => {
    const { calls } = stubEndpoint()
    await fetchLiveModels(sessionOf('a'))
    await fetchLiveModels(sessionOf('a'))
    expect(calls).toEqual(['a'])
  })

  it('drops one account\'s entry without disturbing the other', async () => {
    const { calls } = stubEndpoint()
    await fetchLiveModels(sessionOf('a'))
    await fetchLiveModels(sessionOf('b'))
    resetLiveModelsCache(sessionOf('a'))
    // B still has its listing, so only A re-asks: signing A out must not cost B a round trip.
    await fetchLiveModels(sessionOf('b'))
    expect(calls).toEqual(['a', 'b'])
    await fetchLiveModels(sessionOf('a'))
    expect(calls).toEqual(['a', 'b', 'a'])
  })

  it('answers the measured six for a session-less caller, from no cache at all', async () => {
    const { calls } = stubEndpoint()
    const models = await fetchLiveModels(undefined)
    expect(calls).toEqual([])
    // The card needs this list for a signed-out user — it says what the channel supports. The
    // PICKER's gate lives in `DoubaoHostAdapter.listModels`, which answers `[]` (issue #169).
    expect(models.length).toBeGreaterThan(0)
  })
})
