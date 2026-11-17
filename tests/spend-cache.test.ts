/**
 * The on-disk day cache.
 *
 * This is the one part of the dashboard that can be WRONG rather than slow, and
 * wrong in a way that looks right: a cached day whose figures round-trip
 * imperfectly renders as a plausible number. So the tests below are about
 * fidelity — the cache must reproduce a fresh read exactly — and about the three
 * ways it could quietly become untrustworthy:
 *
 *   · storing TODAY, which is still moving;
 *   · trusting a file it cannot fully parse;
 *   · growing forever until it is a log rather than a cache.
 *
 * The bug that motivated the fidelity test is recorded in the first case: an early
 * version synthesised one fake usage entry per model per cached day, so a day that
 * really held 3,459 requests came back as 1 while `spent` stayed correct.
 *
 * @module dsh-xdpool/tests/spend-cache
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CACHE_KEEP_DAYS,
  keepFromFor,
  loadSpendCache,
  lookupDays,
  mergeAccount,
  pruneCache,
  saveSpendCache,
  spendCachePath,
  type CachedDay,
  type SpendCacheFile,
} from '../src/spend-cache.ts'
import type { WorkBuddyResourceRow, WorkBuddyUsageEntry } from '../src/upstream.ts'
import { assembleAccount, spendAxis } from '../src/spend-report.ts'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'xdpool-cache-'))
  dirs.push(dir)
  return dir
}

function day(over: Partial<CachedDay> = {}): CachedDay {
  return { spent: 12.5, requests: 40, earned: 0, models: { m: { spent: 12.5, requests: 40 } }, ...over }
}

function file(accounts: SpendCacheFile['accounts'] = {}): SpendCacheFile {
  return { version: 1, accounts }
}

describe('a cached day reproduces a fresh read exactly', () => {
  /**
   * The regression this file exists for.
   *
   * A day that really held N requests must come back as N, not as one entry per
   * model. `spent` was already correct in the broken version — which is exactly
   * why a spot check of the KPI row would not have caught it.
   */
  it('keeps the request count and the model split', () => {
    const entries: WorkBuddyUsageEntry[] = [
      { requestId: 'a', credit: 1, model: 'deepseek-v4.1-flash', at: Date.parse('2026-11-15T01:00:00') },
      { requestId: 'b', credit: 2, model: 'deepseek-v4.1-flash', at: Date.parse('2026-11-15T02:00:00') },
      { requestId: 'c', credit: 3, model: 'hy4', at: Date.parse('2026-11-15T03:00:00') },
    ]
    const options = {
      id: 'a1', label: 'alice', packages: [],
      axis: spendAxis('2026-11-15', '2026-11-16'),
      windowStartMs: Date.parse('2026-11-15T00:00:00'),
      nowMs: Date.parse('2026-11-16T12:00:00'),
    }
    const fresh = assembleAccount({ ...options, entries })
    const asCached: CachedDay = {
      spent: fresh.days['2026-11-15']?.spent ?? 0,
      requests: fresh.days['2026-11-15']?.requests ?? 0,
      earned: fresh.days['2026-11-15']?.earned ?? 0,
      models: fresh.days['2026-11-15']?.models ?? {},
    }
    // The same day, replayed through the cache path with no usage entries at all.
    const replay = assembleAccount({ ...options, entries: [], cachedDays: { '2026-11-15': asCached } })
    expect(replay.days['2026-11-15']?.requests).toBe(3)
    expect(replay.days['2026-11-15']?.spent).toBe(6)
    expect(replay.totals.requests).toBe(3)
    expect(replay.totals.models.map(row => row.model).sort()).toEqual(['deepseek-v4.1-flash', 'hy4'])
    expect(replay.totals.models.find(row => row.model === 'deepseek-v4.1-flash')?.requests).toBe(2)
  })

  it('never lets a cached day override a day that was re-read', () => {
    // If both are presented, the live rows are the newer truth: today is fetched
    // every time, so a cached today would be a stale figure winning a race.
    const live: WorkBuddyUsageEntry[] = [
      { requestId: 'x', credit: 9, model: 'm', at: Date.parse('2026-11-16T01:00:00') },
    ]
    const account = assembleAccount({
      id: 'a1', label: 'alice', packages: [],
      entries: live,
      cachedDays: { '2026-11-16': day({ spent: 999, requests: 999 }) },
      axis: spendAxis('2026-11-16', '2026-11-16'),
      windowStartMs: Date.parse('2026-11-16T00:00:00'),
      nowMs: Date.parse('2026-11-16T12:00:00'),
    })
    expect(account.days['2026-11-16']?.spent).toBe(9)
    expect(account.days['2026-11-16']?.requests).toBe(1)
  })

  it('does NOT double-count a cached day\'s grants', () => {
    /**
     * The regression this exists for.
     *
     * Grants come from the PACKAGE rows, which are re-read on every call. Adding a
     * cached day's `earned` on top of that DOUBLED every completed day's figure —
     * measured live across a whole account as 108 → 216, 660 → 1320. The cached value
     * is a FLOOR (it can only rescue a day whose granting package has since aged out
     * of the meter's list), never an addition.
     */
    const packages: WorkBuddyResourceRow[] = [{
      packageName: 'daily',
      capacityType: 1,
      createMs: Date.parse('2026-11-15T02:00:00'),
      cycleSize: 0,
      cycleRemain: 0,
      totalSize: 108,
      totalRemain: 108,
      status: 0,
    }]
    const options = {
      id: 'a1', label: 'alice', packages,
      axis: spendAxis('2026-11-15', '2026-11-16'),
      windowStartMs: Date.parse('2026-11-15T00:00:00'),
      nowMs: Date.parse('2026-11-16T12:00:00'),
    }
    // The package alone explains 108 credits arriving on the 15th.
    expect(assembleAccount({ ...options, entries: [] }).days['2026-11-15']?.earned).toBe(108)
    // Caching the SAME day must not make it 216.
    const withCache = assembleAccount({
      ...options,
      entries: [],
      cachedDays: { '2026-11-15': day({ spent: 0, requests: 0, earned: 108 }) },
    })
    expect(withCache.days['2026-11-15']?.earned).toBe(108)
  })

  it('still lets a cached grant fill a day the live packages cannot explain', () => {
    // The case the floor exists for: a cycle whose package has since been pruned
    // upstream. The live rows know nothing about it; the cache remembers it.
    const account = assembleAccount({
      id: 'a1', label: 'alice', packages: [],
      entries: [],
      cachedDays: { '2026-11-15': day({ spent: 0, requests: 0, earned: 500 }) },
      axis: spendAxis('2026-11-15', '2026-11-16'),
      windowStartMs: Date.parse('2026-11-15T00:00:00'),
      nowMs: Date.parse('2026-11-16T12:00:00'),
    })
    expect(account.days['2026-11-15']?.earned).toBe(500)
  })
})

describe('what the cache will and will not answer', () => {
  it('reports every wanted day as missing for an unknown account', () => {
    const lookup = lookupDays(file(), 'nope', ['2026-11-15', '2026-11-16'])
    expect(lookup.missing).toEqual(['2026-11-15', '2026-11-16'])
    expect(lookup.days.size).toBe(0)
    // Package rows are only reusable when NOTHING is missing: the balance is live,
    // so a partial hit still needs a fresh read.
    expect(lookup.packages).toBeUndefined()
  })

  it('answers a fully cached window without needing the package rows', () => {
    const store = file({
      a1: { days: { '2026-11-15': day() }, packages: [], packagesAt: 1 },
    })
    const lookup = lookupDays(store, 'a1', ['2026-11-15'])
    expect(lookup.missing).toEqual([])
    expect(lookup.days.get('2026-11-15')?.spent).toBe(12.5)
    expect(lookup.packages).toEqual([])
  })

  it('names exactly the days it cannot answer', () => {
    const store = file({ a1: { days: { '2026-11-15': day() }, packages: [], packagesAt: 0 } })
    const lookup = lookupDays(store, 'a1', ['2026-11-14', '2026-11-15', '2026-11-16'])
    expect(lookup.missing).toEqual(['2026-11-14', '2026-11-16'])
    expect([...lookup.days.keys()]).toEqual(['2026-11-15'])
  })
})

describe('the file survives being wrong', () => {
  it('treats a missing file as an empty cache', async () => {
    const store = await loadSpendCache(await home())
    expect(store.version).toBe(1)
    expect(store.accounts).toEqual({})
  })

  it('treats unparseable JSON as an empty cache rather than throwing', async () => {
    const home_ = await home()
    // The parent directory has to exist before the file can: `loadSpendCache` only
    // reads, so it does not create anything.
    await mkdir(join(home_, '.xdpool'), { recursive: true })
    await writeFile(spendCachePath(home_), '{ this is not json', 'utf8')
    const store = await loadSpendCache(home_)
    expect(store.accounts).toEqual({})
  })

  it('drops a file written by a different version whole', async () => {
    // A shape change must not be half-read: guessing which fields survived is how
    // a cache starts reporting numbers nobody can trace.
    const home_ = await home()
    await saveSpendCache(home_, file({ a1: { days: { '2026-11-15': day() }, packages: [], packagesAt: 0 } }))
    const raw = JSON.parse(await readFile(spendCachePath(home_), 'utf8')) as Record<string, unknown>
    raw['version'] = 99
    await writeFile(spendCachePath(home_), JSON.stringify(raw), 'utf8')
    expect((await loadSpendCache(home_)).accounts).toEqual({})
  })

  it('discards individual rows that do not validate, and keeps the rest', async () => {
    const home_ = await home()
    await saveSpendCache(home_, file({
      a1: {
        days: {
          '2026-11-14': day({ spent: 5 }),
          // A hand edit or a half-written temp: `spent` is a string.
          '2026-11-15': { spent: 'lots', requests: 3, earned: 0, models: {} } as unknown as CachedDay,
          'not-a-date': day(),
        },
        packages: [{ packageName: 'ok', capacityType: 1, createMs: 1, cycleSize: 0, cycleRemain: 0, totalSize: 1, totalRemain: 1, status: 0 }],
        packagesAt: 5,
      },
    }))
    const store = await loadSpendCache(home_)
    const account = store.accounts['a1']
    expect(account).toBeDefined()
    // The good day survives, the bad `spent` becomes 0 rather than NaN, and the
    // malformed key is dropped.
    expect(account?.days['2026-11-14']?.spent).toBe(5)
    expect(account?.days['2026-11-15']?.spent).toBe(0)
    expect(account?.days['not-a-date']).toBeUndefined()
    // `NaN` reaching the KPI row would render as "NaN credits", which looks like a
    // meter bug rather than a cache bug.
    expect(Number.isNaN(account?.days['2026-11-15']?.spent)).toBe(false)
    expect(account?.packages).toHaveLength(1)
  })

  it('writes atomically, leaving no temp file behind', async () => {
    const home_ = await home()
    expect(await saveSpendCache(home_, file())).toBe(true)
    const text = await readFile(spendCachePath(home_), 'utf8')
    expect(JSON.parse(text)).toEqual({ version: 1, accounts: {} })
    await expect(readFile(spendCachePath(home_) + '.tmp', 'utf8')).rejects.toThrow()
  })
})

describe('storing a day', () => {
  it('merges without dropping days it was not told about', () => {
    const store = file({ a1: { days: { '2026-11-10': day({ spent: 1 }) }, packages: [], packagesAt: 0 } })
    mergeAccount(store, 'a1', {
      days: { '2026-11-11': day({ spent: 2 }) },
      packages: [],
      packagesAt: 7,
      keepFrom: '2026-10-01',
    })
    expect(Object.keys(store.accounts['a1']?.days ?? {}).sort()).toEqual(['2026-11-10', '2026-11-11'])
    expect(store.accounts['a1']?.packagesAt).toBe(7)
  })

  it('forgets days older than the retained range', () => {
    const store = file({ a1: { days: { '2026-09-01': day(), '2026-11-10': day() }, packages: [], packagesAt: 0 } })
    mergeAccount(store, 'a1', { days: {}, packages: [], packagesAt: 0, keepFrom: '2026-10-01' })
    expect(Object.keys(store.accounts['a1']?.days ?? {})).toEqual(['2026-11-10'])
  })

  it('replaces the package rows when fresh ones arrive, and keeps them otherwise', () => {
    const store = file({ a1: { days: {}, packages: [], packagesAt: 1 } })
    const rows = [{ packageName: 'p', capacityType: 1, createMs: 0, cycleSize: 0, cycleRemain: 0, totalSize: 5, totalRemain: 5, status: 0 }]
    mergeAccount(store, 'a1', { days: {}, packages: rows, packagesAt: 9, keepFrom: '2026-10-01' })
    expect(store.accounts['a1']?.packages).toHaveLength(1)
    expect(store.accounts['a1']?.packagesAt).toBe(9)
    // A later merge that read no packages must not blank them.
    mergeAccount(store, 'a1', { days: {}, keepFrom: '2026-10-01' })
    expect(store.accounts['a1']?.packages).toHaveLength(1)
    expect(store.accounts['a1']?.packagesAt).toBe(9)
  })
})

describe('pruning', () => {
  it('drops accounts that left the pool', () => {
    // Otherwise a cache quietly becomes a permanent record of accounts the user
    // removed, which is both stale and a privacy question nobody asked for.
    const store = file({
      keep: { days: {}, packages: [], packagesAt: 0 },
      gone: { days: {}, packages: [], packagesAt: 0 },
    })
    pruneCache(store, { accountIds: ['keep'], keepFrom: '2026-01-01' })
    expect(Object.keys(store.accounts)).toEqual(['keep'])
  })

  it('drops days outside the retained range but keeps the live balance', () => {
    const store = file({
      a1: { days: { '2026-01-01': day(), '2026-11-15': day() }, packages: [], packagesAt: 3 },
    })
    pruneCache(store, { accountIds: ['a1'], keepFrom: '2026-10-01' })
    expect(Object.keys(store.accounts['a1']?.days ?? {})).toEqual(['2026-11-15'])
    expect(store.accounts['a1']?.packagesAt).toBe(3)
  })
})

describe('the retained range', () => {
  it('reaches further back than the meter itself, so an earlier window starts warm', () => {
    // The meter answers 31 days; the file keeps 40, so that a user who opens 7 days
    // and then 31 finds the earlier days already there.
    expect(CACHE_KEEP_DAYS).toBeGreaterThan(31)
    // Nine days before the 31-day window's start, i.e. 40 days of history.
    expect(keepFromFor('2026-11-01')).toBe('2026-10-23')
    // A seven-day window stores a range ending at its own start: retention is
    // absolute (40 days of history from TODAY), so a shorter window keeps MORE than
    // it displays. 2026-11-24 is that window's start, so 40 - 7 = 33 days before it.
    expect(keepFromFor('2026-11-24', 7)).toBe('2026-10-22')
  })
})
