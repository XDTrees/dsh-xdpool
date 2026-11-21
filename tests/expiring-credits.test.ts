import { describe, expect, it } from 'vitest'
import {
  SOON_DAYS,
  expiringCredits,
  expiringSummary,
  expiringTotals,
} from '../src/client/expiring-credits.ts'

/**
 * Which credits are about to expire, across every channel.
 *
 * A card can only say what its own account holds. The question a reader actually has is "what am
 * I about to lose, and where" — and that answer only exists when the channels are looked at
 * together. Getting it wrong is costly in a quiet way: an unlisted bundle is lost without anyone
 * noticing, and a bundle listed as expiring forever is an emergency that never happens.
 */
const NOW = Date.parse('2026-11-18T12:00:00Z')
const DAY = 86_400_000

/** One channel's balances, in the shape the pool already produces. */
function channel(id: string, name: string, packages: { name: string; expiresAt?: number; amount?: number; unit?: string }[]) {
  return {
    id,
    name,
    balances: [{ accountId: `${id}-1`, nickname: `${id} 账号`, packages }],
  }
}

describe('the list', () => {
  it('orders by expiry, soonest first', () => {
    // The list exists to answer "what goes first"; any other order makes the reader sort it.
    const credits = expiringCredits({
      channels: [
        channel('a', '甲', [{ name: '临期额度', expiresAt: NOW + 5 * DAY, amount: 100 }]),
        channel('b', '乙', [{ name: '赠送额度', expiresAt: NOW + 2 * DAY, amount: 50 }]),
      ],
      now: NOW,
    })
    expect(credits.map(entry => entry.channelId)).toEqual(['b', 'a'])
  })

  it('skips a bundle that has already expired', () => {
    /**
     * An expired bundle is not "expiring" — it is gone, and listing it would suggest something
     * can still be rescued.
     */
    const credits = expiringCredits({
      channels: [channel('a', '甲', [
        { name: '已过期', expiresAt: NOW - DAY, amount: 10 },
        { name: '还有效', expiresAt: NOW + 3 * DAY, amount: 20 },
      ])],
      now: NOW,
    })
    expect(credits).toHaveLength(1)
    expect(credits[0]?.packageName).toBe('还有效')
  })

  it('skips a bundle with no expiry rather than guessing one', () => {
    /**
     * Treating an unknown expiry as "never" would bury it; treating it as "now" would invent an
     * emergency. Neither is a fact the vendor gave.
     */
    const credits = expiringCredits({
      channels: [channel('a', '甲', [{ name: '无限期', amount: 999 }])],
      now: NOW,
    })
    expect(credits).toEqual([])
  })

  it('honours the window when one is given', () => {
    const credits = expiringCredits({
      channels: [channel('a', '甲', [
        { name: '三天', expiresAt: NOW + 3 * DAY, amount: 10 },
        { name: '三十天', expiresAt: NOW + 30 * DAY, amount: 20 },
      ])],
      now: NOW,
      withinDays: SOON_DAYS,
    })
    expect(credits).toHaveLength(1)
    expect(credits[0]?.packageName).toBe('三天')
  })

  it('reports whole days left, and zero for today', () => {
    const credits = expiringCredits({
      channels: [channel('a', '甲', [
        { name: '今天', expiresAt: NOW + 3_600_000 },
        { name: '两天半', expiresAt: NOW + 2.5 * DAY },
      ])],
      now: NOW,
    })
    expect(credits[0]?.daysLeft).toBe(0)
    expect(credits[1]?.daysLeft).toBe(2)
  })

  it('carries the channel and account so a reader can act on it', () => {
    // A row that says "100 credits expiring" without saying where is not actionable.
    const credits = expiringCredits({
      channels: [channel('codearts', 'CodeArts', [{ name: '临期', expiresAt: NOW + DAY, amount: 100, unit: '积分' }])],
      now: NOW,
    })
    expect(credits[0]).toMatchObject({
      channelId: 'codearts',
      channelName: 'CodeArts',
      accountId: 'codearts-1',
      accountName: 'codearts 账号',
      amount: 100,
      unit: '积分',
    })
  })
})

describe('the totals', () => {
  it('adds up per unit, never across units', () => {
    /**
     * Adding tokens to credits produces a number that means nothing — the two are not
     * interchangeable and a combined figure would be read as a balance.
     */
    const credits = expiringCredits({
      channels: [
        channel('a', '甲', [{ name: 'x', expiresAt: NOW + DAY, amount: 100, unit: '积分' }]),
        channel('b', '乙', [{ name: 'y', expiresAt: NOW + DAY, amount: 200, unit: '积分' }]),
        channel('c', '丙', [{ name: 'z', expiresAt: NOW + DAY, amount: 5_000, unit: 'token' }]),
      ],
      now: NOW,
    })
    expect(expiringTotals(credits)).toEqual({ 积分: 300, token: 5_000 })
  })

  it('leaves out a bundle whose amount is unknown', () => {
    // A percentage-only bundle has no absolute number; summing it as 0 would understate the total.
    const credits = expiringCredits({
      channels: [channel('a', '甲', [{ name: 'x', expiresAt: NOW + DAY }])],
      now: NOW,
    })
    expect(expiringTotals(credits)).toEqual({})
  })
})

describe('the summary line', () => {
  it('names the total and how soon', () => {
    const credits = expiringCredits({
      channels: [channel('a', '甲', [{ name: 'x', expiresAt: NOW + 6 * DAY, amount: 233, unit: '积分' }])],
      now: NOW,
    })
    const line = expiringSummary(credits)
    expect(line).toContain('233')
    expect(line).toContain('6 天后')
  })

  it('says today when it is today', () => {
    const credits = expiringCredits({
      channels: [channel('a', '甲', [{ name: 'x', expiresAt: NOW + 3_600_000, amount: 10, unit: '积分' }])],
      now: NOW,
    })
    expect(expiringSummary(credits)).toContain('今天')
  })

  it('answers nothing when nothing is expiring', () => {
    // An always-present line trains the reader to ignore it.
    expect(expiringSummary([])).toBeUndefined()
  })
})
