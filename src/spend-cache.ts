/**
 * The dashboard's on-disk ledger: finished days, kept so a window change costs
 * only the days it newly covers.
 *
 * WHY THIS EXISTS
 *
 * The billing meter answers a 31-day window for nine accounts with about 63 MB
 * of JSON over 54 requests — every row carries the prompt text the meter records
 * alongside the charge, none of which this plugin reads. Measured cold, that is
 * ~36 s; and the page originally re-fetched all of it for EVERY window, so
 * switching 31 → 7 → 14 re-derived days it had already been told about.
 *
 * The observation that makes this cacheable is simple and was checked rather than
 * assumed: **a past day's charges do not change.** The same completed day fetched
 * twice answers byte-for-byte the same rows (verified across a restart and an
 * hour apart). Only today is still moving.
 *
 * So the cache stores per (account, day) the two things a day contributes — what
 * it was charged and what was granted — plus the package rows needed for the
 * expiry list. Today is never stored: it is always re-read, which keeps the "live"
 * figure honest. A window that is fully cached answers from disk without touching
 * the network at all.
 *
 * WHAT IT IS NOT
 *
 * Not a source of truth. Every read is validated, an entry that fails validation
 * is dropped rather than trusted, and a missing cache means "ask the meter" — the
 * report is identical either way. The cache only decides how much of it had to be
 * asked for.
 *
 * Not the token ledger. `channel-pack/token-ledger.json` is the pack's own
 * day-aggregated token record, kept for a different question; this file holds
 * CHARGES, which is what the dashboard is about.
 *
 * @module dsh-xdpool/spend-cache
 */
import { readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkBuddyResourceRow } from './upstream.ts'
import { ensureSecretDir, writeSecretFile } from './file-perms.ts'

/**
 * File format version.
 *
 * Bumped whenever the stored shape changes, which makes every older file
 * unreadable in one step. That is deliberate: a cache that must be migrated is a
 * cache that can be read WRONG, and a dashboard that reports a wrong number is
 * worse than one that takes 30 seconds once.
 */
const CACHE_VERSION = 1

/** Answers the file at `channel-pack/spend-cache.json`-time; renamed for clarity. */
const CACHE_FILE = join('.xdpool', 'spend-cache.json')

/**
 * Earliest day the file is allowed to keep.
 *
 * The meter answers 31 days, so 40 keeps a little slack for a window whose start
 * drifts earlier between visits — and the slack costs only a few hundred bytes
 * per account per day.
 */
export const CACHE_KEEP_DAYS = 40

/** One completed day, as stored. */
export interface CachedDay {
  /** Credits charged. */
  spent: number
  /** Requests billed. */
  requests: number
  /** Credits granted by packages whose cycle started that day. */
  earned: number
  /**
   * Per-model charges for that day.
   *
   * Stored because the account table's model breakdown is a lifetime-of-window
   * figure, so a cached day has to carry the same detail a fresh one would.
   */
  models: Readonly<Record<string, { spent: number; requests: number }>>
}

/** One account's cached slice. */
export interface CachedAccount {
  /** Completed days, keyed `YYYY-MM-DD`. Today is never present. */
  days: Readonly<Record<string, CachedDay>>
  /**
   * The package rows, as last read.
   *
   * Not per day: a package's REMAINING balance is a live figure, so these are
   * refreshed whenever the cache is refreshed. They are kept so a fully-cached
   * read can still build the expiry list and the live balance without a round
   * trip — and they are stamped with when they were read, so the panel can be
   * honest about how old the balance is.
   */
  packages: readonly WorkBuddyResourceRow[]
  /** When `packages` was read, epoch ms. */
  packagesAt: number
}

/** The whole file. */
export interface SpendCacheFile {
  version: number
  accounts: Record<string, CachedAccount>
}

/** What a caller can get out of the cache without the network. */
export interface SpendCacheLookup {
  /** Days that were present, keyed `YYYY-MM-DD`. Missing days must be fetched. */
  days: Map<string, CachedDay>
  /** Package rows, when the whole window was cached. */
  packages: readonly WorkBuddyResourceRow[] | undefined
  packagesAt: number | undefined
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * Read one day, or undefined when the stored row is not usable.
 *
 * Every field is re-validated rather than trusted. The file is written by this
 * plugin, but it also survives downgrades, hand edits and a half-written temp
 * file from a crash — and `spent: "12"` reaching the KPI row would render as
 * `NaN` credits, which reads as a real number to nobody but looks like a bug in
 * the meter.
 */
function readDay(value: unknown): CachedDay | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const modelsRaw = raw['models']
  const models: Record<string, { spent: number; requests: number }> = {}
  if (typeof modelsRaw === 'object' && modelsRaw !== null && !Array.isArray(modelsRaw)) {
    for (const [model, entry] of Object.entries(modelsRaw as Record<string, unknown>)) {
      if (typeof entry !== 'object' || entry === null) continue
      const row = entry as Record<string, unknown>
      models[model] = { spent: numberOf(row['spent']), requests: numberOf(row['requests']) }
    }
  }
  return {
    spent: numberOf(raw['spent']),
    requests: numberOf(raw['requests']),
    earned: numberOf(raw['earned']),
    models,
  }
}

/** Read one package row, or undefined when it is not usable. */
function readPackage(value: unknown): WorkBuddyResourceRow | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw['packageName'] !== 'string') return undefined
  const num = (key: string): number => numberOf(raw[key])
  const optional = (key: string): { [K in typeof key]?: number } => {
    const at = raw[key]
    return typeof at === 'number' && Number.isFinite(at) ? { [key]: at } as { [K in typeof key]?: number } : {}
  }
  return {
    packageName: raw['packageName'],
    capacityType: num('capacityType'),
    createMs: num('createMs'),
    cycleSize: num('cycleSize'),
    cycleRemain: num('cycleRemain'),
    totalSize: num('totalSize'),
    totalRemain: num('totalRemain'),
    status: num('status'),
    ...optional('cycleStartMs'),
    ...optional('cycleEndMs'),
    ...optional('deductionEndMs'),
    ...optional('expiredMs'),
  }
}

/** Read one account's slice, or undefined when it is not usable. */
function readAccount(value: unknown): CachedAccount | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const daysRaw = raw['days']
  const days: Record<string, CachedDay> = {}
  if (typeof daysRaw === 'object' && daysRaw !== null && !Array.isArray(daysRaw)) {
    for (const [key, entry] of Object.entries(daysRaw as Record<string, unknown>)) {
      // The key is the day, so an unparseable one is not recoverable.
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(key)) continue
      const day = readDay(entry)
      if (day !== undefined) days[key] = day
    }
  }
  const packagesRaw = raw['packages']
  const packages: WorkBuddyResourceRow[] = []
  if (Array.isArray(packagesRaw)) {
    for (const entry of packagesRaw) {
      const row = readPackage(entry)
      if (row !== undefined) packages.push(row)
    }
  }
  return { days, packages, packagesAt: numberOf(raw['packagesAt']) }
}

/** `YYYY-MM-DD` minus N days, in the local calendar. */
function shiftDay(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00`)
  at.setDate(at.getDate() - days)
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const date = String(at.getDate()).padStart(2, '0')
  return `${String(at.getFullYear())}-${month}-${date}`
}

/** Where the cache lives, given the DSH home. */
export function spendCachePath(home: string): string {
  return join(home, CACHE_FILE)
}

/**
 * Load the whole file.
 *
 * Never throws. A cache that cannot be read is indistinguishable from one that
 * does not exist: the caller refetches, which is the correct outcome and also the
 * one that repairs the file on the next write.
 */
export async function loadSpendCache(home: string): Promise<SpendCacheFile> {
  const empty: SpendCacheFile = { version: CACHE_VERSION, accounts: {} }
  let text: string
  try {
    text = await readFile(spendCachePath(home), 'utf8')
  } catch {
    return empty
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return empty
  }
  if (typeof parsed !== 'object' || parsed === null) return empty
  const raw = parsed as Record<string, unknown>
  // A different version is a different shape: drop it whole rather than guess
  // which fields survived.
  if (raw['version'] !== CACHE_VERSION) return empty
  const accountsRaw = raw['accounts']
  const accounts: Record<string, CachedAccount> = {}
  if (typeof accountsRaw === 'object' && accountsRaw !== null && !Array.isArray(accountsRaw)) {
    for (const [id, entry] of Object.entries(accountsRaw as Record<string, unknown>)) {
      const account = readAccount(entry)
      if (account !== undefined) accounts[id] = account
    }
  }
  return { version: CACHE_VERSION, accounts }
}

/**
 * What the cache can answer for one account and a set of wanted days.
 *
 * Returns every day it could read plus the days that are missing, and reports
 * `complete` when nothing is missing — which is the only case in which the
 * package rows are trustworthy enough to skip the network for.
 */
export function lookupDays(
  file: SpendCacheFile,
  accountId: string,
  wanted: readonly string[],
): SpendCacheLookup & { missing: string[] } {
  const account = file.accounts[accountId]
  const days = new Map<string, CachedDay>()
  const missing: string[] = []
  if (account === undefined) {
    return { days, missing: [...wanted], packages: undefined, packagesAt: undefined }
  }
  for (const day of wanted) {
    const cached = account.days[day]
    if (cached === undefined) missing.push(day)
    else days.set(day, cached)
  }
  return {
    days,
    missing,
    // The balance is live, so the package rows are only reusable when the whole
    // window came from the cache — otherwise a fresh read is happening anyway and
    // its rows are the newer ones.
    packages: missing.length === 0 ? account.packages : undefined,
    packagesAt: missing.length === 0 ? account.packagesAt : undefined,
  }
}

/**
 * Merge one account's freshly read days into the file, and forget days that have
 * aged out.
 *
 * `today` is passed in rather than read from the clock so the caller's notion of
 * the day is the one used everywhere; a test can then pin it.
 */
export function mergeAccount(
  file: SpendCacheFile,
  accountId: string,
  update: {
    /** Completed days only — the caller must not pass today. */
    days: Readonly<Record<string, CachedDay>>
    /** New package rows, when they were re-read. */
    packages?: readonly WorkBuddyResourceRow[]
    packagesAt?: number
    /** The earliest day worth keeping, `YYYY-MM-DD`. */
    keepFrom: string
  },
): void {
  const existing = file.accounts[accountId] ?? { days: {}, packages: [], packagesAt: 0 }
  const days: Record<string, CachedDay> = { ...existing.days }
  for (const [day, value] of Object.entries(update.days)) days[day] = value
  // Prune on write rather than on read: a cache that only ever grows turns into a
  // file nobody looks at and everybody pays to parse.
  const floor = update.keepFrom
  for (const day of Object.keys(days)) {
    if (day < floor) delete days[day]
  }
  file.accounts[accountId] = {
    days,
    packages: update.packages ?? existing.packages,
    packagesAt: update.packagesAt ?? existing.packagesAt,
  }
}

/**
 * Keep only accounts that still exist, and days inside the retained range.
 *
 * Called before a write so an account removed from the pool does not keep a
 * permanent slice of the file, which is how a cache quietly becomes a log.
 */
export function pruneCache(
  file: SpendCacheFile,
  options: { accountIds: readonly string[]; keepFrom: string },
): void {
  const kept: Record<string, CachedAccount> = {}
  for (const id of options.accountIds) {
    const account = file.accounts[id]
    if (account === undefined) continue
    const days: Record<string, CachedDay> = {}
    for (const [day, value] of Object.entries(account.days)) {
      if (day >= options.keepFrom) days[day] = value
    }
    kept[id] = { days, packages: account.packages, packagesAt: account.packagesAt }
  }
  file.accounts = kept
}

/**
 * Write the file atomically.
 *
 * Temp file then rename, the same dance `account-store.ts` does, because the file
 * is read while the host is running: a crash mid-write must leave the previous
 * file readable rather than a truncated one. Owner-only, because the rows carry
 * the account labels the user's own pool uses.
 *
 * Failures are swallowed on purpose. The cache is an optimisation; a read-only
 * home directory should slow the dashboard down, not break it.
 */
export async function saveSpendCache(home: string, file: SpendCacheFile): Promise<boolean> {
  const path = spendCachePath(home)
  const temp = `${path}.tmp`
  try {
    await ensureSecretDir(join(home, '.xdpool'))
    await writeSecretFile(temp, JSON.stringify(file))
    await rename(temp, path)
    return true
  } catch {
    // Leave no half-written temp behind: the next successful save recreates it.
    await rm(temp, { force: true }).catch(() => undefined)
    return false
  }
}

/**
 * The earliest day worth keeping, given the window a caller wants.
 *
 * `CACHE_KEEP_DAYS` back from the window START, not from today. The window start
 * is the oldest day the caller just asked for; keeping a further
 * `CACHE_KEEP_DAYS - windowLength` before it means a user who opens 7 days and
 * then 31 finds the earlier days already on disk.
 *
 * The subtraction is of the WINDOW LENGTH because `windowStart` already moved back
 * by that much: `keepFromFor('2026-11-01')` with a 31-day window and 40 retained
 * days must reach 2026-10-23, i.e. nine days before the window start. Getting this
 * backwards (widening by the wrong sign) silently shrank the retained range to
 * less than the window it was serving.
 */
export function keepFromFor(windowStart: string, windowLength = 31): string {
  return shiftDay(windowStart, CACHE_KEEP_DAYS - windowLength)
}
