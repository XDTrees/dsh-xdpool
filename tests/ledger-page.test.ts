/**
 * The data dashboard page.
 *
 * This page's failure mode is not a crash but a LIE: a wrong number renders just
 * as smoothly as a right one. So the tests below are about the distinctions a
 * reader could otherwise not make — charged versus granted, "could not read" as
 * distinct from "spent nothing", an estimate labelled as an estimate — and about
 * the wiring that makes the page read the meter at all.
 *
 * The React tree is not rendered: the card bundle is CommonJS consumed by a host
 * dialog with no DOM in this process. Whatever can be checked as data is checked
 * against the real reducer (`assembleAccount`); everything else is checked as a
 * source contract, the same approach `card-shell.test.ts` takes.
 *
 * @module dsh-xdpool/tests/ledger-page
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assembleAccount, grantsOfPackage, spendAxis, spendDayKey, spendableOfPackage, SPEND_MAX_DAYS } from '../src/spend-report.ts'
import type { WorkBuddyResourceRow, WorkBuddyUsageEntry } from '../src/upstream.ts'

const page = readFileSync(new URL('../src/client/LedgerPage.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8')
const card = readFileSync(new URL('../src/client/PoolCard.tsx', import.meta.url), 'utf8')
const locales = readFileSync(new URL('../src/client/locales.ts', import.meta.url), 'utf8')
const paths = readFileSync(new URL('../src/status-paths.ts', import.meta.url), 'utf8')

/** A one-off package that is still live. */
function oneOff(over: Partial<WorkBuddyResourceRow> = {}): WorkBuddyResourceRow {
  return {
    packageName: '赠送包',
    capacityType: 1,
    createMs: Date.parse('2026-11-10T09:00:00'),
    cycleSize: 0,
    cycleRemain: 0,
    totalSize: 1000,
    totalRemain: 1000,
    status: 0,
    ...over,
  }
}

/** A subscription: `CapacityRemain` covers every cycle, `Cycle*` the current one. */
function subscription(over: Partial<WorkBuddyResourceRow> = {}): WorkBuddyResourceRow {
  return {
    packageName: '个人高级版',
    capacityType: 2,
    createMs: Date.parse('2026-10-20T00:00:00'),
    cycleStartMs: Date.parse('2026-11-05T00:00:00'),
    cycleEndMs: Date.parse('2026-12-05T00:00:00'),
    cycleSize: 4000,
    cycleRemain: 1200,
    totalSize: 8000,
    totalRemain: 8000,
    status: 0,
    ...over,
  }
}

function entry(at: string, credit: number, model = 'deepseek-v4.1-flash'): WorkBuddyUsageEntry {
  return { requestId: `${at}-${String(credit)}-${model}`, credit, model, at: Date.parse(at) }
}

/** Assemble one account over a fixed three-day window. */
function assemble(input: {
  entries?: readonly WorkBuddyUsageEntry[]
  packages?: readonly WorkBuddyResourceRow[]
  now?: string
}) {
  const now = Date.parse(input.now ?? '2026-11-16T12:00:00')
  const axis = spendAxis('2026-11-14', spendDayKey(now))
  return assembleAccount({
    id: 'acct-1',
    label: 'alice#a1',
    entries: input.entries ?? [],
    packages: input.packages ?? [],
    axis,
    windowStartMs: Date.parse('2026-11-14T00:00:00'),
    nowMs: now,
  })
}

describe('credit arithmetic: charged and granted are different numbers', () => {
  it('sums the meter\'s own charge, not a token estimate', () => {
    // Two requests on one day, billed 2.5 and 7.25. The page must print 9.75 —
    // the figure the bill is made of — not anything derived from token counts.
    const account = assemble({
      entries: [entry('2026-11-15T10:00:00', 2.5), entry('2026-11-15T11:00:00', 7.25)],
      packages: [oneOff({ createMs: Date.parse('2026-11-01T00:00:00'), totalRemain: 0 })],
    })
    expect(account.totals.spent).toBe(9.75)
    expect(account.days['2026-11-15']?.spent).toBe(9.75)
    expect(account.days['2026-11-15']?.requests).toBe(2)
  })

  it('counts a subscription\'s CURRENT cycle, not its lifetime total', () => {
    // The trap this exists for: `CapacityRemain` is 8000 across every cycle, so
    // reading it as a balance overstated a real pool by 30× before it was fixed.
    expect(spendableOfPackage(subscription())).toBe(1200)
    expect(spendableOfPackage(oneOff())).toBe(1000)
  })

  it('credits a subscription once per cycle, on each cycle\'s own start day', () => {
    // Not once on CreateTime: the earlier grant and the 11-05 refill are two
    // separate arrivals, and putting both on CreateTime would make every day
    // after it overstate the balance by a whole cycle.
    //
    // The earlier cycle is derived from the CURRENT cycle's LENGTH, not from a
    // calendar month: 10-05 → 11-05 is 31 days in October, but the model reads
    // `CycleEndTime − CycleStartTime` (here a clean 30-day cycle), so stepping
    // back lands on 10-06. That is deliberate — the meter's own cycle length is
    // the only definition that stays correct for a 7-day or 90-day plan, where a
    // calendar month would be simply wrong.
    const grants = grantsOfPackage(subscription(), Date.parse('2026-09-20T00:00:00'), Date.parse('2026-11-16T12:00:00'))
    const days = grants.map(grant => spendDayKey(grant.at)).sort()
    expect(days).toEqual(['2026-10-06', '2026-11-05'])
    expect(grants.every(grant => grant.amount === 4000)).toBe(true)
  })

  it('drops grants outside the window instead of counting them anyway', () => {
    const grants = grantsOfPackage(subscription(), Date.parse('2026-11-01T00:00:00'), Date.parse('2026-11-16T12:00:00'))
    expect(grants).toHaveLength(1)
    expect(spendDayKey(grants[0]?.at ?? 0)).toBe('2026-11-05')
  })
})

describe('the balance walk', () => {
  it('reaches today\'s live balance by walking back through the window', () => {
    // live 1200, yesterday charged 300: the day BEFORE yesterday must therefore
    // read 1500. A page that printed the live figure on every day would look
    // correct at a glance and say nothing.
    const account = assemble({
      entries: [entry('2026-11-15T10:00:00', 300)],
      packages: [subscription()],
    })
    expect(account.days['2026-11-14']?.balance).toBe(1500)
    expect(account.days['2026-11-15']?.balance).toBe(1200)
  })

  it('subtracts a lapsed package, so a drop with no spend still explains itself', () => {
    // An expired package with 500 left is neither a charge nor a grant; without
    // the third term the previous day reads 500 too low and the curve looks like
    // it lost money to nothing.
    const account = assemble({
      entries: [],
      packages: [
        subscription({ cycleRemain: 1200, totalRemain: 1200 }),
        oneOff({
          packageName: '过期包',
          createMs: Date.parse('2026-10-01T00:00:00'),
          totalSize: 500,
          totalRemain: 500,
          status: 3,
          expiredMs: Date.parse('2026-11-15T00:00:00'),
        }),
      ],
    })
    expect(account.days['2026-11-15']?.lapsed).toBe(500)
    expect(account.days['2026-11-15']?.balance).toBe(1200)
    expect(account.days['2026-11-14']?.balance).toBe(1700)
  })

  it('flags an opening balance that did not reconcile', () => {
    // A 99,999-credit package granted inside the window, against a live balance
    // of 1. Spending nothing, the walk back has to claim the day before held
    // 99,998 credits that are not there — a negative balance, which is the only
    // outward sign that a grant or a charge is missing from the meter. The page
    // must SAY that rather than printing a negative balance as a fact.
    const account = assemble({
      entries: [],
      packages: [oneOff({ totalSize: 99_999, totalRemain: 1, createMs: Date.parse('2026-11-15T00:00:00') })],
    })
    expect(account.days['2026-11-14']?.balance).toBeLessThan(0)
    expect(account.opening).toBeLessThan(0)
    expect(account.openingTrusted).toBe(false)
    expect(page).toContain('ledger.estimate')
  })

  it('accepts an opening balance that does reconcile', () => {
    // The other half of the contract: a plain live balance with no grants in the
    // window is NOT flagged, or the warning would be permanent noise.
    const account = assemble({ entries: [], packages: [oneOff()] })
    expect(account.opening).toBe(1000)
    expect(account.openingTrusted).toBe(true)
  })
})

describe('a missing number is never a zero', () => {
  it('keeps a failed account as a row with a reason, not a silent zero', () => {
    // The whole point: "spent 0" and "could not be read" are different facts and
    // merging them is how a dashboard loses trust permanently.
    const source = readFileSync(new URL('../src/spend-report.ts', import.meta.url), 'utf8')
    expect(source).toContain("error: result.reason")
    expect(source).toContain('failedAccounts')
    expect(page).toContain('ledger.partial')
  })

  it('reports an incomplete account inline, beside its label', () => {
    expect(page).toContain('ledger.rowIncomplete')
    expect(page).toContain('data-ok={account.error === undefined}')
  })

  it('does not treat a day the meter never mentioned as a day that charged zero', () => {
    // Every day in the window gets a row, because the balance series is
    // continuous — but a day with no charge has `requests: 0` and `spent: 0`,
    // which is a different statement from "the meter did not answer". The
    // distinction lives in `error`, not in a zero.
    const account = assemble({ entries: [], packages: [] })
    expect(account.days['2026-11-14']?.requests).toBe(0)
    expect(account.days['2026-11-14']?.spent).toBe(0)
    expect(account.error).toBeUndefined()
    expect(account.totals.requests).toBe(0)
  })

  it('refuses to publish a per-request average from zero requests', () => {
    expect(assemble({ entries: [], packages: [] }).totals.perRequest).toBeNull()
  })
})

describe('the window is what the meter can answer', () => {
  it('clamps to the measured 31-day ceiling', () => {
    expect(SPEND_MAX_DAYS).toBe(31)
  })

  it('offers only windows the meter can honour', () => {
    for (const size of ['7', '14', '31']) {
      expect(page).toContain(size)
    }
    // A 90-day button would silently draw a 31-day chart under a 90-day label.
    expect(page).not.toContain('90d')
  })

  it('says so when the requested window was clamped', () => {
    expect(page).toContain('ledger.meterWindow')
    expect(locales).toContain("'ledger.meterWindow'")
  })
})

describe('the page is wired to the meter, not to the token recorder', () => {
  it('reads its own route rather than the usage endpoint', () => {
    expect(paths).toContain("export const POOL_SPEND_REPORT_PATH = '/plugins/dsh-xdpool/spend/report'")
    expect(page).toContain('POOL_SPEND_REPORT_PATH')
    // The old page shared the pool card's in-memory usage poll. Sharing it again
    // would mean the dashboard reverts to "since this process started".
    expect(page).not.toContain('POOL_USAGE_PATH')
  })

  it('asks the host to refresh rather than re-reading on its own', () => {
    // Only the host knows whether its cache is current, and a read costs ~30
    // upstream requests per account.
    expect(page).toContain('refresh=1')
    expect(page).toContain('setNonce')
  })

  it('is still a tab in the shell, not a section inside the pool page', () => {
    expect(card).toContain("{ id: 'ledger', label: t?.('shell.tabLedger')")
    expect(card).toMatch(/page === 'ledger' \? <LedgerPage t=\{t\} \/>/)
  })

  it('translates every string it renders', () => {
    for (const key of [
      'ledger.title', 'ledger.sub', 'ledger.kpiLive', 'ledger.kpiSpent', 'ledger.kpiEarned',
      'ledger.flowTitle', 'ledger.balanceTitle', 'ledger.heatTitle', 'ledger.refresh',
    ]) {
      expect(enHas(key), `${key} missing from en`).toBe(true)
    }
    expect(enHas('shell.tabLedger')).toBe(true)
    // zh is typed against en's key set, so a missing zh key is a build error.
    const zhStart = locales.indexOf('export const zh')
    expect(locales.slice(zhStart)).toContain("'ledger.kpiSpent'")
  })

  it('carries its own stylesheet and every class it renders is defined', () => {
    expect(page).toContain('DASHBOARD_CARD_CSS')
    const sheet = styles.slice(styles.indexOf('export const DASHBOARD_CARD_CSS'))
    const used = new Set([...page.matchAll(/dsm-xdpool-(?:dash|sec|sectitle|table|tablewrap|num|ellipsis|btn)[a-z-]*/g)].map(m => m[0]))
    const missing = [...used].filter(name => !sheet.includes(`.${name}`))
    expect(missing, 'LedgerPage renders classes with no CSS rule').toEqual([])
  })
})

describe('charts never collapse two different days into one', () => {
  it('draws charged and granted as two bars, not one net line', () => {
    // "spent 900, earned 900" and "spent 0, earned 0" are different days; a net
    // figure draws them identically and one of them is a day the user worked.
    expect(page).toContain('dsm-xdpool-dash-bar-spend')
    expect(page).toContain('dsm-xdpool-dash-bar-earn')
    expect(page).toContain('day.earned > 0')
    expect(page).toContain('day.spent > 0')
  })

  it('gives every heat cell its own printed number', () => {
    // Colour must never be the only carrier of a value.
    expect(page).toContain("value === 0 ? '·' : fmtCredit(value)")
  })

  it('scales sparks on a shared range so rows are comparable', () => {
    expect(page).toContain('sparkRangeOf')
    expect(page).toContain('range: { min: number; max: number }')
  })
})

function enHas(key: string): boolean {
  const start = locales.indexOf('export const en = {')
  const end = locales.indexOf('} as const', start)
  return locales.slice(start, end).includes(`'${key}':`)
}