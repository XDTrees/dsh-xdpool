/**
 * The credit arithmetic, which was WRONG once in a way worth pinning down.
 *
 * The model picker shows a figure like `x0.11`. Reading it as "0.11 credits per million
 * tokens" is wrong: it is a display label, and billing is three separate per-model
 * coefficients in credits per million tokens —
 *
 *   积分 = 未命中输入 × 输入系数 + 缓存命中 × 缓存系数 + 输出 × 输出系数
 *
 * The old flat-rate formula understated a real day by two orders of magnitude, because in
 * agent use the CACHE tier dominates: 288M cached tokens against 3.6M fresh is normal,
 * and at the cache coefficient those 288M still cost real money. A formula that ignores
 * the cache field does not miss a rounding error, it misses most of the bill.
 *
 * The coefficients are a dated snapshot measured against the live gateway. They move, so
 * a model absent from the table is reported UNPRICED rather than billed at a guess.
 */
import { describe, expect, it } from 'vitest'
import { creditsOf, ratesFor, totalsByChannel, RATES_MEASURED_AT, type CreditSpendRow } from '../src/credits.ts'
import { readCreditSpend } from '../src/credit-report.ts'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DS = { input: 14.29, cache: 0.29, output: 57.1 }

describe('the three-coefficient formula', () => {
  it('bills each tier at its own coefficient', () => {
    // 1M of each tier, at DeepSeek-V4.1-Flash's measured rates.
    expect(creditsOf(1_000_000, 0, 0, DS)).toBeCloseTo(14.29, 4)
    expect(creditsOf(0, 1_000_000, 0, DS)).toBeCloseTo(0.29, 4)
    expect(creditsOf(0, 0, 1_000_000, DS)).toBeCloseTo(57.1, 4)
  })

  it('does NOT treat the picker figure as a flat per-million rate', () => {
    // The regression this file exists for: `x0.11` over 3.5M tokens is 0.39 credits under
    // the old formula. The real charge for that day was ~155 credits, because 288M of
    // cached input came along with it.
    const realDay = creditsOf(3_560_000, 288_200_000, 360_000, DS)
    expect(realDay).toBeGreaterThan(150)
    expect(realDay).toBeLessThan(160)
    // And the flat-rate reading of the same tokens, for contrast.
    const flat = (3_560_000 + 288_200_000 + 360_000) / 1_000_000 * 0.11
    expect(flat).toBeLessThan(33)
  })

  it('counts the cache tier as the dominant term for agent traffic', () => {
    // 288M cached vs 3.6M fresh: the cache term must outweigh the fresh-input term even
    // though its coefficient is 49× smaller.
    const cacheTerm = 288_200_000 * DS.cache / 1_000_000
    const freshTerm = 3_560_000 * DS.input / 1_000_000
    expect(cacheTerm).toBeGreaterThan(freshTerm)
  })

  it('returns undefined for a model with no published coefficients', () => {
    // "We do not know the price" must not collapse into "this was free".
    expect(creditsOf(1_000_000, 1_000_000, 1_000_000, undefined)).toBeUndefined()
  })

  it('rounds to four decimals without pretending to more precision', () => {
    // 1234×14.29 + 5678×0.29 + 91011×57.1, all over 1e6.
    expect(creditsOf(1234, 5678, 91011, DS)).toBe(5.216)
  })
})

describe('the coefficient table', () => {
  it('knows the models the pool actually serves', () => {
    expect(ratesFor('deepseek-v4.1-flash')).toBeDefined()
    expect(ratesFor('hy4-preview')).toBeDefined()
    expect(ratesFor('glm-5.3-flash')).toBeDefined()
  })

  it('matches case-insensitively, because three sources spell it three ways', () => {
    // The pool catalog says `deepseek-v4.1-flash`, the ledger may say
    // `DeepSeek-V4.1-Flash`, a channel listing adds a vendor prefix.
    expect(ratesFor('DeepSeek-V4.1-Flash')).toEqual(ratesFor('deepseek-v4.1-flash'))
    expect(ratesFor('nvidia/deepseek-v4.1-flash')).toEqual(ratesFor('deepseek-v4.1-flash'))
  })

  it('is dated, because these numbers move', () => {
    // The public measurement recorded GLM-5.3-Flash rising ~30% between rounds; a table
    // without a date invites someone to trust it long after it went stale.
    expect(RATES_MEASURED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
  })

  it('does not guess for an unknown model', () => {
    expect(ratesFor('some-model-nobody-measured')).toBeUndefined()
  })
})

describe('per-channel roll-up', () => {
  const row = (channel: string, input: number, cache: number, output: number, priced = true): CreditSpendRow => ({
    channel,
    model: 'm',
    requests: 1,
    inputTokens: input,
    cacheTokens: cache,
    outputTokens: output,
    rates: priced ? DS : undefined,
    credits: creditsOf(input, cache, output, priced ? DS : undefined),
  })

  it('sums by channel', () => {
    const totals = totalsByChannel([row('buddy', 1_000_000, 0, 0), row('buddy', 1_000_000, 0, 0)])
    expect(totals).toHaveLength(1)
    expect(totals[0]?.credits).toBeCloseTo(28.58, 2)
  })

  it('counts unpriced models instead of billing them at zero', () => {
    const totals = totalsByChannel([row('trae', 1_000_000, 0, 0), row('trae', 9_000_000, 0, 0, false)])
    expect(totals[0]?.credits).toBeCloseTo(14.29, 2)
    expect(totals[0]?.unpricedModels).toBe(1)
  })

  it('puts the biggest spender first', () => {
    const cheap = { input: 1, cache: 1, output: 1 }
    const rows: CreditSpendRow[] = [
      { ...row('cheap', 1_000_000, 0, 0), rates: cheap, credits: creditsOf(1_000_000, 0, 0, cheap) },
      row('pricey', 1_000_000, 0, 0),
    ]
    expect(totalsByChannel(rows)[0]?.channel).toBe('pricey')
  })
})

describe('reading the pack ledger', () => {
  it('reads cacheReadTokens as its own tier', async () => {
    // The field the old code ignored entirely.
    const dir = await mkdtemp(join(tmpdir(), 'xdpool-ledger-'))
    try {
      await mkdir(join(dir, 'channel-pack'), { recursive: true })
      await writeFile(join(dir, 'channel-pack', 'token-ledger.json'), JSON.stringify({
        days: {
          '2026-11-08': {
            'direct|buddy|a1|deepseek-v4.1-flash': {
              requests: 2,
              inputTokens: 3_560_000,
              cacheReadTokens: 288_200_000,
              outputTokens: 360_000,
            },
          },
        },
      }), 'utf8')
      const report = await readCreditSpend({
        home: dir,
        days: 1,
        rateOf: () => DS,
        now: new Date('2026-11-08T12:00:00Z'),
      })
      expect(report.rows).toHaveLength(1)
      expect(report.rows[0]?.cacheTokens).toBe(288_200_000)
      expect(report.rows[0]?.credits).toBeCloseTo(155.1, 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('excludes relay traffic, but counts it so the exclusion is visible', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xdpool-ledger-'))
    try {
      await mkdir(join(dir, 'channel-pack'), { recursive: true })
      await writeFile(join(dir, 'channel-pack', 'token-ledger.json'), JSON.stringify({
        days: {
          '2026-11-08': {
            'direct|buddy|a1|hy3': { requests: 2, inputTokens: 1_000_000, outputTokens: 0 },
            'gateway|buddy|a1|hy3': { requests: 7, inputTokens: 9_000_000, outputTokens: 0 },
          },
        },
      }), 'utf8')
      const report = await readCreditSpend({
        home: dir,
        days: 1,
        rateOf: () => DS,
        now: new Date('2026-11-08T12:00:00Z'),
      })
      expect(report.rows).toHaveLength(1)
      expect(report.rows[0]?.requests).toBe(2)
      expect(report.gatewayRequests).toBe(7)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('counts unparseable keys instead of silently dropping them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xdpool-ledger-'))
    try {
      await mkdir(join(dir, 'channel-pack'), { recursive: true })
      // Dated "today" rather than a literal, because the window is the LOCAL calendar day
      // now; a hard-coded date falls outside it the moment the suite runs on another day.
      const today = new Date()
      const key = `${String(today.getFullYear())}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      await writeFile(join(dir, 'channel-pack', 'token-ledger.json'), JSON.stringify({
        days: { [key]: { 'renamed-format': { requests: 1 } } },
      }), 'utf8')
      const report = await readCreditSpend({ home: dir, days: 1, rateOf: () => undefined })
      expect(report.unreadable).toBe(1)
      expect(report.rows).toHaveLength(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports "empty" when there is no ledger, never a confident zero', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xdpool-ledger-'))
    try {
      const report = await readCreditSpend({ home: dir, days: 1, rateOf: () => DS })
      expect(report.empty).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('the day window means the LOCAL calendar day', () => {
  /** Write a ledger with one entry on each of two adjacent local days. */
  async function ledgerWithTwoDays(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'xdpool-day-'))
    await mkdir(join(dir, 'channel-pack'), { recursive: true })
    await writeFile(join(dir, 'channel-pack', 'token-ledger.json'), JSON.stringify({
      days: {
        '2026-11-07': { 'direct|buddy|a1|hy3': { requests: 5, inputTokens: 5_000_000 } },
        '2026-11-08': { 'direct|buddy|a1|hy3': { requests: 2, inputTokens: 1_000_000 } },
      },
    }), 'utf8')
    return dir
  }

  it('`days: 1` covers TODAY ONLY, not today plus yesterday', async () => {
    // The strip is labelled "today"; a figure that silently included yesterday evening's
    // work is the defect this pins. `daysAgoKey(days - 1)` is what makes the label true.
    const dir = await ledgerWithTwoDays()
    try {
      const today = await readCreditSpend({
        home: dir,
        days: 1,
        rateOf: () => DS,
        now: new Date(2026, 10, 8, 20, 0, 0),
      })
      expect(today.rows).toHaveLength(1)
      expect(today.rows[0]?.requests).toBe(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('`days: 2` reaches back to include yesterday', async () => {
    const dir = await ledgerWithTwoDays()
    try {
      const two = await readCreditSpend({
        home: dir,
        days: 2,
        rateOf: () => DS,
        now: new Date(2026, 10, 8, 20, 0, 0),
      })
      expect(two.rows[0]?.requests).toBe(7)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('uses the LOCAL date, not UTC', async () => {
    // Between midnight and 08:00 in UTC+8 the UTC date is still yesterday, so a UTC-based
    // bound reported the previous day's totals for most of the early morning.
    const dir = await ledgerWithTwoDays()
    try {
      // 00:30 local on the 8th — the UTC date is the 7th.
      const report = await readCreditSpend({
        home: dir,
        days: 1,
        rateOf: () => DS,
        now: new Date(2026, 10, 8, 0, 30, 0),
      })
      expect(report.rows[0]?.requests).toBe(2)
      expect(report.from).toBe('2026-11-08')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
