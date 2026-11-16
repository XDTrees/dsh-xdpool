/**
 * The dashboard document, end to end against a stubbed meter.
 *
 * `readSpendReport` is the only part of this plugin whose numbers a user would
 * quote without checking, so its contract with the two upstream endpoints is
 * pinned here rather than left to the type system: the type says a page came
 * back, and says nothing about whether a truncated page was noticed, whether a
 * rate limit was retried, or whether one dead account took the whole document
 * down with it.
 *
 * The register/unregister half is the usual "did it mount" check, which is the
 * bug class that has bitten this file's neighbours: a route registered inside a
 * teardown closure looks perfect and is never reachable.
 */
import { describe, expect, it } from 'vitest'
import {
  assembleAccount,
  readSpendReport,
  SPEND_MAX_DAYS,
  spendAxis,
  spendDayKey,
  type SpendMeter,
  type SpendReportDeps,
} from '../src/spend-report.ts'
import type {
  WorkBuddyCredential,
  WorkBuddyUsageEntry,
  WorkBuddyUsagePage,
  WorkBuddyResourceRow,
} from '../src/upstream.ts'

const CREDENTIAL: WorkBuddyCredential = {
  accessToken: 'token',
  refreshToken: 'refresh',
  expiresAtMs: 0,
  domain: '',
  sourcePath: '',
}

/** A meter that answers from a fixed row list, honouring the window and the cap. */
function stubMeter(rows: readonly WorkBuddyUsageEntry[], options: {
  /**
   * How many rows the upstream will answer with per call.
   *
   * Separate from the `pageSize` the caller asks for, because the real meter
   * CLAMPS silently: asking for 10,000 gets 3,000 with no error. The production
   * walk decides "done" from the returned COUNT against its own page size, so a
   * stub that answered however many were asked for could never exercise the
   * sliding path at all.
   */
  clamp?: number
  rateLimitFirst?: number
  failAfter?: number
  packages?: readonly WorkBuddyResourceRow[]
} = {}): { meter: SpendMeter; calls: { start: number; end: number; size: number }[] } {
  const clamp = options.clamp ?? 3000
  const calls: { start: number; end: number; size: number }[] = []
  let budget = options.rateLimitFirst ?? 0
  let served = 0
  const meter: SpendMeter = {
    async fetchUsageEntries(_credential, query): Promise<WorkBuddyUsagePage> {
      calls.push({ start: query.startMs, end: query.endMs, size: query.pageSize })
      if (budget > 0) {
        budget -= 1
        return { ok: false, retryable: true, reason: 'rate-limited' }
      }
      if (options.failAfter !== undefined && served >= options.failAfter) {
        return { ok: false, retryable: false, reason: 'boom' }
      }
      served += 1
      const inWindow = rows
        .filter(row => row.at >= query.startMs && row.at <= query.endMs)
        // The meter answers newest first; the slice keeps the same convention.
        .sort((left, right) => right.at - left.at)
      const page = inWindow.slice(0, Math.min(clamp, query.pageSize))
      return { ok: true, entries: page, count: page.length }
    },
    async fetchResourceRows() {
      return { ok: true, rows: options.packages ?? [], truncated: false }
    },
  }
  return { meter, calls }
}

/** A second's worth of distinct rows, spaced so a boundary lands between them. */
function rowsAtSecond(base: string, count: number, credit = 1): WorkBuddyUsageEntry[] {
  const start = Date.parse(base)
  return Array.from({ length: count }, (_, index) => ({
    requestId: `r-${String(start)}-${String(index)}`,
    credit,
    model: 'deepseek-v4.1-flash',
    at: start + index * 1000,
  }))
}

function row(at: string, credit: number): WorkBuddyUsageEntry {
  return { requestId: `${at}|${String(credit)}`, credit, model: 'deepseek-v4.1-flash', at: Date.parse(at) }
}

const NOW = Date.parse('2026-11-16T12:00:00')

function deps(meter: SpendMeter, over: Partial<SpendReportDeps> = {}): SpendReportDeps {
  return {
    client: meter,
    accounts: [{ id: 'a1', label: 'alice#a1', credential: CREDENTIAL }],
    days: 3,
    now: NOW,
    ...over,
  }
}

describe('the meter walk', () => {
  it('slides the window backwards when a page comes back full', async () => {
    // The upstream has no offset — `pageNum: 2` answers empty — and clamps a
    // response at 3000 rows with NO error. So the only signal that more rows exist
    // is "the page came back full", and the walk has to resolve that by moving
    // `endTime`. This is the shape that lost 88 rows and 300 credits when it was
    // done a calendar day at a time, so it is exercised at the real boundary:
    // 3005 rows against a 3000-row page.
    const rows = rowsAtSecond('2026-11-16T00:00:00', 3005, 0.5)
    const { meter, calls } = stubMeter(rows)
    const report = await readSpendReport(deps(meter))
    expect(calls.length).toBe(2)
    // Every row is counted exactly once: the overlap the slide re-reads is
    // dropped by `requestId`, and the boundary second is not split.
    expect(report.accounts[0]?.totals.requests).toBe(3005)
    expect(report.accounts[0]?.totals.spent).toBe(1502.5)
    expect(report.accounts[0]?.error).toBeUndefined()
  })

  it('retries a rate limit instead of reporting an empty day', () => {
    // Six parallel calls earn a bare `429 Too Many Requests`. Reporting that as
    // "you spent nothing" is the exact failure mode this walk exists to avoid.
    const { meter } = stubMeter([row('2026-11-15T10:00:00', 5)], { rateLimitFirst: 2 })
    return readSpendReport(deps(meter)).then(report => {
      expect(report.accounts[0]?.totals.spent).toBe(5)
      expect(report.accounts[0]?.error).toBeUndefined()
    })
  })

  it('keeps the rows it did get when a later page fails, and says so', async () => {
    // 3001 rows so the FIRST page is full and the walk is forced to try a
    // second — which is configured to fail. What survives must be the first
    // page's rows plus a named reason, never a confident zero.
    const rows = rowsAtSecond('2026-11-16T00:00:00', 3001, 1)
    const { meter } = stubMeter(rows, { failAfter: 1 })
    const report = await readSpendReport(deps(meter))
    expect(report.accounts[0]?.error).toContain('boom')
    expect(report.failedAccounts).toBe(1)
    expect(report.accounts[0]?.totals.requests).toBe(3000)
  })

  it('reads only the requested window', () => {
    const { meter, calls } = stubMeter([
      row('2026-11-14T10:00:00', 1),
      row('2026-11-10T10:00:00', 99),
    ])
    return readSpendReport(deps(meter)).then(report => {
      expect(report.accounts[0]?.totals.spent).toBe(1)
      expect(Math.min(...calls.map(call => call.start))).toBe(Date.parse('2026-11-14T00:00:00'))
    })
  })

  it('clamps a request for more history than the meter keeps', () => {
    const { meter } = stubMeter([])
    return readSpendReport(deps(meter, { days: 90 })).then(report => {
      expect(report.requestedDays).toBe(90)
      expect(report.maxDays).toBe(SPEND_MAX_DAYS)
      expect(report.days).toHaveLength(SPEND_MAX_DAYS)
    })
  })
})

describe('the assembled document', () => {
  it('is a row per account, with the totals summed from those rows', () => {
    // The KPI row and the table must not be able to disagree: both read
    // `totals`, and `totals` is summed from `accounts`.
    const rows = [row('2026-11-15T10:00:00', 4), row('2026-11-15T11:00:00', 6)]
    const { meter } = stubMeter(rows, {
      packages: [{
        packageName: 'x', capacityType: 1, createMs: Date.parse('2026-11-01T00:00:00'),
        cycleSize: 0, cycleRemain: 0, totalSize: 500, totalRemain: 400, status: 0,
      }],
    })
    return readSpendReport(deps(meter)).then(report => {
      expect(report.accounts).toHaveLength(1)
      expect(report.totals.spent).toBe(10)
      expect(report.totals.live).toBe(400)
      expect(report.totals.requests).toBe(2)
      expect(report.totals.spent).toBe(report.accounts.reduce((sum, account) => sum + account.totals.spent, 0))
    })
  })

  it('turns one dead account into a named row, not a failed document', async () => {
    const { meter } = stubMeter([], { failAfter: 0 })
    const report = await readSpendReport(deps(meter, {
      accounts: [
        { id: 'a1', label: 'alice#a1', credential: CREDENTIAL },
        { id: 'a2', label: 'bob#b2', credential: CREDENTIAL },
      ],
    }))
    // Both accounts failed, so the document still exists and both say why.
    expect(report.accounts).toHaveLength(2)
    expect(report.failedAccounts).toBe(2)
    expect(report.accounts.every(account => account.error !== undefined)).toBe(true)
  })

  it('sorts the busiest account first, because that is what "who is eating it" means', async () => {
    /**
     * Accounts are fetched in a small parallel batch, so the stub cannot key its
     * answer off a call counter — it keys off the CREDENTIAL, which is the one
     * thing that belongs to exactly one account. Batching is a rate-limit
     * concession and must not be observable in the output.
     */
    const meter: SpendMeter = {
      async fetchUsageEntries(credential) {
        const credit = credential.accessToken === 'big' ? 100 : 1
        return { ok: true, entries: [row('2026-11-16T09:00:00', credit)], count: 1 }
      },
      async fetchResourceRows() {
        return { ok: true, rows: [], truncated: false }
      },
    }
    const report = await readSpendReport(deps(meter, {
      accounts: [
        { id: 'a1', label: 'low', credential: { ...CREDENTIAL, accessToken: 'small' } },
        { id: 'a2', label: 'high', credential: { ...CREDENTIAL, accessToken: 'big' } },
      ],
    }))
    expect(report.accounts[0]?.label).toBe('high')
    expect(report.accounts[1]?.label).toBe('low')
  })
})

describe('the day axis', () => {
  it('has one entry per day, in order, with no gaps', () => {
    const axis = spendAxis('2026-11-01', '2026-11-05')
    expect(axis).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'])
  })

  it('is local-time based, so a late-evening charge lands on today', () => {
    // 23:30 local is still today; a UTC conversion would push it to tomorrow and
    // make the current day look empty every evening.
    expect(spendDayKey(Date.parse('2026-11-16T23:30:00'))).toBe('2026-11-16')
  })

  it('survives an inverted range instead of looping', () => {
    expect(spendAxis('2026-11-05', '2026-11-01')).toEqual([])
  })
})

describe('per-account figures', () => {
  it('keeps a model breakdown, biggest spender first', () => {
    const account = assembleAccount({
      id: 'a1',
      label: 'alice',
      entries: [
        { requestId: '1', credit: 1, model: 'cheap', at: Date.parse('2026-11-15T10:00:00') },
        { requestId: '2', credit: 9, model: 'pricey', at: Date.parse('2026-11-15T11:00:00') },
      ],
      packages: [],
      axis: spendAxis('2026-11-14', '2026-11-16'),
      windowStartMs: Date.parse('2026-11-14T00:00:00'),
      nowMs: NOW,
    })
    expect(account.totals.models.map(model => model.model)).toEqual(['pricey', 'cheap'])
  })

  it('names the peak day, and leaves it null when nothing was charged', () => {
    const spent = assembleAccount({
      id: 'a1', label: 'alice',
      entries: [row('2026-11-15T10:00:00', 3), row('2026-11-16T10:00:00', 9)],
      packages: [], axis: spendAxis('2026-11-14', '2026-11-16'),
      windowStartMs: Date.parse('2026-11-14T00:00:00'), nowMs: NOW,
    })
    expect(spent.totals.peakDay).toBe('2026-11-16')
    const quiet = assembleAccount({
      id: 'a2', label: 'bob', entries: [], packages: [],
      axis: spendAxis('2026-11-14', '2026-11-16'),
      windowStartMs: Date.parse('2026-11-14T00:00:00'), nowMs: NOW,
    })
    expect(quiet.totals.peakDay).toBeNull()
  })

  it('lists only packages that will actually lapse, soonest first', () => {
    const account = assembleAccount({
      id: 'a1', label: 'alice', entries: [],
      packages: [
        {
          packageName: 'later', capacityType: 1, createMs: 0, cycleSize: 0, cycleRemain: 0,
          totalSize: 10, totalRemain: 10, status: 0, expiredMs: Date.parse('2026-11-25T00:00:00'),
        },
        {
          packageName: 'sooner', capacityType: 1, createMs: 0, cycleSize: 0, cycleRemain: 0,
          totalSize: 20, totalRemain: 20, status: 0, expiredMs: Date.parse('2026-11-20T00:00:00'),
        },
        {
          // A monthly package refills instead of expiring, so it must never show
          // up here — otherwise the warning fires every month forever.
          packageName: 'monthly', capacityType: 4, createMs: 0, cycleSize: 500, cycleRemain: 500,
          totalSize: 500, totalRemain: 500, status: 0, cycleEndMs: Date.parse('2026-11-18T00:00:00'),
        },
        {
          packageName: 'far', capacityType: 1, createMs: 0, cycleSize: 0, cycleRemain: 0,
          totalSize: 30, totalRemain: 30, status: 0, expiredMs: Date.parse('2027-06-01T00:00:00'),
        },
      ],
      axis: spendAxis('2026-11-14', '2026-11-16'),
      windowStartMs: Date.parse('2026-11-14T00:00:00'),
      nowMs: NOW,
    })
    expect(account.expiring.map(item => item.name)).toEqual(['sooner', 'later'])
  })
})
