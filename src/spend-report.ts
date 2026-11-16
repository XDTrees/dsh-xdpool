/**
 * The pool's spend history: credits spent, credits granted, and the balance both
 * imply, per account and per day.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The usage panel (`stats.ts`) counts TOKENS, in process memory, since the last
 * restart. That answers "what did the gateway report", which is not the question
 * a pool user asks. The question is *am I burning quota, on which account, and is
 * anything about to expire* — and the only authoritative source for that is the
 * vendor's own billing meter, which is a 31-day server-side window that survives
 * restarts and knows what each request COST.
 *
 * So this module reads two upstream endpoints and reconciles them:
 *
 *   · SPEND — `billing/meter/get-user-request-usage`, one row per request with
 *     its `credit` charge. Summed per day and per account. Not estimated: these
 *     are the numbers the bill is made of.
 *   · GRANTS — `v2/billing/meter/get-user-resource`, one row per package. Not
 *     the package's SIZE, which is a lifetime total and would double-count a
 *     subscription's future cycles, but each CYCLE's allotment placed on the day
 *     that cycle started.
 *
 * THE BALANCE IS BACK-SOLVED, AND SAYS SO
 *
 * The meter reports the CURRENT balance and a 31-day history of charges. It does
 * not report what the balance was on any past day. So the series is walked
 * backwards from today's live figure:
 *
 *     balance(d) = balance(d+1) − granted(d+1) + spent(d+1) + lapsed(d+1)
 *
 * `lapsed` is the third term nobody remembers: a package that expired with
 * credits left on it reduces the balance by exactly that much, and it is neither
 * a spend nor a grant. Without it the first day of the window is overstated by
 * every credit the user ever let expire, and the curve looks like it is missing
 * money.
 *
 * A back-solved opening balance that comes out NEGATIVE means the three inputs do
 * not reconcile — a grant the meter did not list, a spend it clipped, a package
 * whose status flipped between calls. That is reported as `openingTrusted: false`
 * and the panel says the day is an estimate, rather than presenting a negative
 * balance as a fact.
 *
 * WHAT IT REFUSES TO DO
 *
 * - It never reads `data.total`: the upstream clamps it at 3000, so it cannot
 *   distinguish "3000 rows" from "3000 of 40,000 rows".
 * - It never treats a failed day as a zero-credit day. A day whose fetch errored
 *   is listed in `errors` and left out of the balance walk's assumptions by
 *   staying zero, but the panel shows the error count — a silent zero in a spend
 *   chart is indistinguishable from a day the user did not work.
 * - It never invents per-call timestamps. The dashboard's resolution is the day,
 *   which is what the meter can actually prove.
 *
 * @module dsh-xdpool/spend-report
 */

import type { WorkBuddyCredential } from './accounts.ts'
import type {
  WorkBuddyResourceRow,
  WorkBuddyUpstreamClient,
  WorkBuddyUsageEntry,
} from './upstream.ts'
import { formatMeterStamp } from './upstream.ts'

/**
 * Longest window the meter answers.
 *
 * Measured, not chosen: a 32-day request comes back with `data.total: 0` while
 * the same account's 31-day request answers thousands of rows. Asking for 32
 * days does not fail loudly — it returns an empty window, which a dashboard would
 * render as "you spent nothing last month".
 */
export const SPEND_MAX_DAYS = 31

/** Rows per meter page. Above this the upstream clamps silently. */
const PAGE_SIZE = 3000

/** Milliseconds in a local day, used only for the requested window. */
const DAY_MS = 86_400_000

/** Days ahead of today that still count as "expiring soon". */
const SOON_DAYS = 14

/**
 * Attempts per page before a day is reported as failed.
 *
 * The meter rate-limits aggressively — six parallel calls is enough to earn a
 * `429`, and the limit does not lift immediately. Retries are spaced further
 * apart than the failure itself takes, which is what turns "the dashboard shows
 * a hole" into "the dashboard took two seconds longer".
 */
const PAGE_ATTEMPTS = 4

/** Base delay before the second attempt, doubled each time. */
const RETRY_BASE_MS = 260

/**
 * Pause between two pages of one account's window.
 *
 * Not decoration: the meter answers a burst with a bare `429 Too Many
 * Requests`, and a 31-day window is a handful of pages fetched back to back.
 * Measure shows the limit lifts within a couple of seconds, so a short deliberate
 * gap is far cheaper than a retry ladder.
 */
const SLICE_PAUSE_MS = 240

/** Highest number of accounts fetched at once. */
const ACCOUNT_CONCURRENCY = 3

/** One account's day bucket. */
export interface SpendDay {
  /** Credits charged that day. */
  spent: number
  /** Requests the meter billed that day, free models included. */
  requests: number
  /** Credits GRANTED that day, across every package's cycle that started. */
  earned: number
  /** Credits that expired unused that day. */
  lapsed: number
  /** Balance at the end of that day, back-solved. */
  balance: number
}

/** One package that will expire with credits still on it. */
export interface SpendExpiring {
  /** `YYYY-MM-DD` it expires. */
  day: string
  /** Credits that will be lost. */
  remain: number
  name: string
}

/** What one account spent, in total and per day. */
export interface SpendAccount {
  /** Pool account id, so the panel can match a row to the card's own list. */
  id: string
  /** Display label, as the pool prints it. */
  label: string
  /** Credits still spendable right now. */
  live: number
  /**
   * The same figure counted the other way: sum of `CapacityRemain`.
   *
   * Differs from `live` for a subscription, whose `CapacityRemain` includes
   * cycles that have not started yet. Reported so the panel can explain a gap
   * instead of looking like it lost money.
   */
  liveGross: number
  /** Packages still holding anything. */
  activePacks: number
  /** Packages listed for this account, active or not. */
  packs: number
  /** Per-day figures, keyed `YYYY-MM-DD`. Days with no activity are absent. */
  days: Readonly<Record<string, SpendDay>>
  /** Back-solved balance at the opening of the window; negative means it did not reconcile. */
  opening: number
  /** False when `opening` came out negative, i.e. the three inputs disagree. */
  openingTrusted: boolean
  /** Credits already committed to expiring, soonest first. */
  expiring: readonly SpendExpiring[]
  totals: {
    spent: number
    earned: number
    lapsed: number
    requests: number
    /** Credits per request, or null when this account served nothing. */
    perRequest: number | null
    /** The single most expensive day, or null when nothing was spent. */
    peakDay: string | null
    /** Per-model spend, biggest first. */
    models: readonly { model: string; spent: number; requests: number }[]
  }
  /** Why this account's numbers may be incomplete, when they are. */
  error?: string
}

/** The whole document the dashboard page renders. */
export interface SpendReport {
  /** Local stamp this was assembled. */
  generatedAt: string
  /** First and last day covered, `YYYY-MM-DD`. */
  windowStart: string
  windowEnd: string
  /** Days asked for, and the cap that limited it. */
  requestedDays: number
  maxDays: number
  /** Every day in the window, in order, including quiet ones. */
  days: readonly string[]
  accounts: readonly SpendAccount[]
  totals: {
    live: number
    liveGross: number
    spent: number
    earned: number
    lapsed: number
    requests: number
    /** Credits expiring within {@link SOON_DAYS}. */
    expiringSoon: number
  }
  /** How many accounts could not be read at all. */
  failedAccounts: number
}

/** Local `YYYY-MM-DD` of an instant. */
export function spendDayKey(ms: number): string {
  const date = new Date(ms)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(date.getFullYear())}-${month}-${day}`
}

/** Midnight at the start of the local day containing `ms`. */
function startOfLocalDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** The next local day after `ms`'s day. */
function nextLocalDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + 1)
  return date.getTime()
}

/** Every day key from `fromKey` to `toKey`, inclusive. */
export function spendAxis(fromKey: string, toKey: string): string[] {
  const out: string[] = []
  const start = startOfLocalDay(Date.parse(`${fromKey}T00:00:00`))
  const end = startOfLocalDay(Date.parse(`${toKey}T00:00:00`))
  let cursor = start
  // Guarded rather than `while (cursor <= end)`: a malformed key parses to NaN
  // and `NaN <= end` is false, so the loop ends — but an inverted pair would
  // otherwise spin forever on a clock that never advances.
  for (let index = 0; index < 400 && cursor <= end; index += 1) {
    out.push(spendDayKey(cursor))
    cursor = nextLocalDay(cursor)
  }
  return out
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * The two upstream reads this module needs.
 *
 * Narrowed to the methods rather than the whole client so the arithmetic can be
 * exercised against a stub: the reconciliation below is the part that can be
 * wrong in a way nobody notices, and requiring a full HTTP client to test it
 * would mean it is only ever tested by hand.
 */
export type SpendMeter = Pick<WorkBuddyUpstreamClient, 'fetchUsageEntries' | 'fetchResourceRows'>

/**
 * Every meter row in the window, walked by sliding the window backwards.
 *
 * WHY NOT A DAY AT A TIME
 *
 * The obvious shape — one request per calendar day — was measured against a real
 * account and is both SLOWER and WRONGER than this:
 *
 *   · wronger: the meter clamps a response at 3000 rows, so a single busy day
 *     silently truncates. Measured on 2026-11-02: 31 days fetched day by day
 *     produced 13,075 rows / 8,676.89 credits, while the same 31 days fetched by
 *     sliding produced 13,163 rows / 8,976.57 credits. The 88 missing rows were
 *     all one day that exceeded the cap.
 *   · slower: 32 requests versus 5, and each request is ~360ms of upstream work.
 *
 * The meter has NO OFFSET — `pageNum: 2` answers empty — so a full page is
 * resolved by moving `endTime` to just before the oldest row received and asking
 * again. `requestId` de-duplicates the overlap, and the boundary second is
 * skipped wholesale rather than split, because several requests can share a
 * second and a half-read second loses charges without raising anything.
 *
 * Rows arrive newest first, so this walks BACKWARDS through the window; the
 * caller does not care about order because every figure is a sum per day.
 */
async function fetchWindowEntries(
  client: SpendMeter,
  credential: WorkBuddyCredential,
  windowStartMs: number,
  windowEndMs: number,
): Promise<{ entries: readonly WorkBuddyUsageEntry[]; pageCount: number; error?: string }> {
  const collected = new Map<string, WorkBuddyUsageEntry>()
  let cursor = windowEndMs
  let pageCount = 0
  // Bounded well above any real month: a 31-day window at the 3000-row cap is
  // ~11 pages at the heaviest usage measured, so 200 leaves room and still
  // terminates if the upstream ever answers a page that does not advance.
  for (let page = 0; page < 200; page += 1) {
    const result = await fetchPage(client, credential, windowStartMs, cursor, PAGE_SIZE)
    pageCount += 1
    if (!result.ok) return { entries: [...collected.values()], pageCount, error: result.reason }
    for (const entry of result.entries) collected.set(entry.requestId, entry)
    if (result.count < PAGE_SIZE) return { entries: [...collected.values()], pageCount }
    const oldest = result.entries.reduce((min, entry) => (entry.at < min ? entry.at : min), cursor)
    if (oldest >= cursor) {
      // A full page whose every row is at or after the cursor cannot advance;
      // stopping beats re-reading the same page until the loop cap.
      return { entries: [...collected.values()], pageCount }
    }
    // Back off a whole second so a second shared by more rows than fit on one
    // page is re-read rather than half-read. The duplicate filter absorbs it.
    cursor = oldest - 1000
    if (cursor <= windowStartMs) return { entries: [...collected.values()], pageCount }
    // The meter refuses bursts with a bare 429, so pages are spaced on purpose.
    await sleep(SLICE_PAUSE_MS)
  }
  return { entries: [...collected.values()], pageCount }
}

/** One page with retries. */
async function fetchPage(
  client: SpendMeter,
  credential: WorkBuddyCredential,
  startMs: number,
  endMs: number,
  pageSize: number,
): Promise<{ ok: true; entries: readonly WorkBuddyUsageEntry[]; count: number } | { ok: false; reason: string }> {
  let last = 'unknown'
  for (let attempt = 0; attempt < PAGE_ATTEMPTS; attempt += 1) {
    try {
      const page = await client.fetchUsageEntries(credential, { startMs, endMs, pageSize })
      if (page.ok) return page
      last = page.reason
      if (!page.retryable) return { ok: false, reason: page.reason }
    } catch (error: unknown) {
      last = error instanceof Error ? error.message : String(error)
    }
    await sleep(RETRY_BASE_MS * 2 ** attempt)
  }
  return { ok: false, reason: last }
}

/**
 * What one package contributes to "granted", and on which day.
 *
 * A one-off package is granted once, on `CreateTime`. A subscription (type 2) or
 * a monthly package (type 4) is granted EVERY CYCLE, and only the current cycle
 * is visible — `CycleStartTime` bounds it, `CycleEndTime` gives its length, and
 * earlier cycles are that length stepped backwards. Counting `CapacitySize`
 * instead would credit every future cycle on day one and then report the same
 * credits arriving again at each real refill.
 */
export function grantsOfPackage(
  row: WorkBuddyResourceRow,
  windowStartMs: number,
  nowMs: number,
): { at: number; amount: number }[] {
  const allotment = row.capacityType === 2 || row.capacityType === 4 ? row.cycleSize : row.totalSize
  if (!(allotment > 0)) return []
  if (row.capacityType !== 2 && row.capacityType !== 4) {
    return row.createMs >= windowStartMs && row.createMs <= nowMs
      ? [{ at: row.createMs, amount: allotment }]
      : []
  }
  const cycleStart = row.cycleStartMs
  if (cycleStart === undefined) {
    return row.createMs >= windowStartMs && row.createMs <= nowMs
      ? [{ at: row.createMs, amount: allotment }]
      : []
  }
  const cycleEnd = row.cycleEndMs
  const length = cycleEnd !== undefined && cycleEnd > cycleStart ? cycleEnd - cycleStart : 30 * DAY_MS
  const out: { at: number; amount: number }[] = []
  // Bounded at 24 cycles: the meter's own history is 31 days, so anything earlier
  // is outside the window anyway, and an absurd `CycleEndTime` cannot loop.
  for (let index = 0; index < 24; index += 1) {
    const at = cycleStart - index * length
    if (at > nowMs) continue
    if (at < windowStartMs) break
    out.push({ at, amount: allotment })
  }
  return out
}

/**
 * Credits this package can actually spend right now.
 *
 * `CapacityRemain` is the whole-period figure for a subscription and includes
 * cycles that have not started, so reading it as a balance overstates the pool —
 * measured once at 30× on an account holding one. The Cycle pair is the current
 * period and is the only one that answers "can I keep going".
 */
export function spendableOfPackage(row: WorkBuddyResourceRow): number {
  const value = row.capacityType === 2 || row.capacityType === 4 ? row.cycleRemain : row.totalRemain
  return value > 0 ? value : 0
}

/** The lifetime figure, for explaining the gap against {@link spendableOfPackage}. */
export function grossOfPackage(row: WorkBuddyResourceRow): number {
  return row.totalRemain > 0 ? row.totalRemain : 0
}

/** When a package stops being usable, or undefined when it never does. */
export function expiryOfPackage(row: WorkBuddyResourceRow): number | undefined {
  // A monthly package refills on its cycle boundary instead of expiring, so it
  // has no expiry to warn about — `CycleEndTime` there is a refill date, and
  // treating it as a deadline would fire the "expiring" warning every month.
  if (row.capacityType === 4) return undefined
  if (row.expiredMs !== undefined) return row.expiredMs
  if (row.deductionEndMs !== undefined) return row.deductionEndMs
  return row.cycleEndMs
}

/** Merge rows received twice (the meter can list one package under two ids). */
function indexByPackage(rows: readonly WorkBuddyResourceRow[]): WorkBuddyResourceRow[] {
  const seen = new Map<string, WorkBuddyResourceRow>()
  for (const row of rows) {
    const key = `${row.packageName}\u0000${String(row.createMs)}\u0000${String(row.capacityType)}`
    const existing = seen.get(key)
    // Keep the row that still holds credits: a duplicate listed as expired while
    // another copy is live would otherwise drop a real balance.
    if (existing === undefined || spendableOfPackage(row) > spendableOfPackage(existing)) {
      seen.set(key, row)
    }
  }
  return [...seen.values()]
}

/** Build one account's slice of the report from its two upstream answers. */
export function assembleAccount(input: {
  id: string
  label: string
  entries: readonly WorkBuddyUsageEntry[]
  packages: readonly WorkBuddyResourceRow[]
  axis: readonly string[]
  windowStartMs: number
  nowMs: number
}): SpendAccount {
  const { axis, entries, packages, windowStartMs, nowMs } = input
  const packRows = indexByPackage(packages)
  const active = packRows.filter(row => row.status !== 3)

  const live = active.reduce((sum, row) => sum + spendableOfPackage(row), 0)
  const liveGross = active.reduce((sum, row) => sum + grossOfPackage(row), 0)

  // Spend, per day and per model. One pass, because a second pass over the same
  // rows is a second chance for the two views to disagree.
  const days = new Map<string, SpendDay>()
  const models = new Map<string, { spent: number; requests: number }>()
  const touch = (key: string): SpendDay => {
    let day = days.get(key)
    if (day === undefined) {
      day = { spent: 0, requests: 0, earned: 0, lapsed: 0, balance: 0 }
      days.set(key, day)
    }
    return day
  }
  for (const entry of entries) {
    const day = touch(spendDayKey(entry.at))
    day.spent += entry.credit
    day.requests += 1
    const model = models.get(entry.model) ?? { spent: 0, requests: 0 }
    model.spent += entry.credit
    model.requests += 1
    models.set(entry.model, model)
  }
  for (const row of packRows) {
    for (const grant of grantsOfPackage(row, windowStartMs, nowMs)) {
      touch(spendDayKey(grant.at)).earned += grant.amount
    }
  }

  // Lapsed credits: expired with a balance left. Neither spent nor earned, so it
  // is the only term that can explain a balance drop on a day with no activity.
  for (const row of packRows) {
    const remain = spendableOfPackage(row)
    if (remain <= 0.5) continue
    const at = expiryOfPackage(row)
    if (at === undefined || at < windowStartMs || at > nowMs) continue
    touch(spendDayKey(at)).lapsed += remain
  }

  // Walk back from today's live balance. `axis` is every day, quiet or not: a
  // gap in the series would make the chart interpolate across it and show a
  // smooth curve where the data has a hole.
  const ordered = [...axis]
  let cursor = live
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const key = ordered[index]
    if (key === undefined) continue
    const day = days.get(key) ?? { spent: 0, requests: 0, earned: 0, lapsed: 0, balance: 0 }
    day.balance = round2(cursor)
    days.set(key, day)
    cursor = cursor - day.earned + day.spent + day.lapsed
  }
  const opening = round2(cursor)

  // Round what is published. `balance` is already rounded above; the flow figures
  // accumulate raw sums and are rounded once, at the end, so a month of
  // half-credit charges does not lose its remainder day by day.
  for (const day of days.values()) {
    day.spent = round2(day.spent)
    day.earned = round2(day.earned)
    day.lapsed = round2(day.lapsed)
  }
  for (const model of models.values()) model.spent = round2(model.spent)

  const dayRecord: Record<string, SpendDay> = {}
  for (const key of ordered) {
    const day = days.get(key)
    if (day === undefined) continue
    dayRecord[key] = day
  }

  const totalSpent = round2([...days.values()].reduce((sum, day) => sum + day.spent, 0))
  const totalEarned = round2([...days.values()].reduce((sum, day) => sum + day.earned, 0))
  const totalLapsed = round2([...days.values()].reduce((sum, day) => sum + day.lapsed, 0))
  const totalRequests = [...days.values()].reduce((sum, day) => sum + day.requests, 0)

  const expiring: SpendExpiring[] = []
  for (const row of active) {
    const remain = spendableOfPackage(row)
    if (remain <= 0) continue
    const at = expiryOfPackage(row)
    if (at === undefined) continue
    if (at - nowMs > SOON_DAYS * DAY_MS) continue
    if (at < nowMs) continue
    expiring.push({ day: spendDayKey(at), remain: round2(remain), name: row.packageName })
  }
  expiring.sort((left, right) => left.day.localeCompare(right.day))

  const peak = [...days.entries()]
    .filter(([, day]) => day.spent > 0)
    .sort((left, right) => right[1].spent - left[1].spent)[0]

  const report: SpendAccount = {
    id: input.id,
    label: input.label,
    live: round2(live),
    liveGross: round2(liveGross),
    activePacks: active.length,
    packs: packRows.length,
    days: dayRecord,
    opening,
    openingTrusted: opening >= 0,
    expiring,
    totals: {
      spent: totalSpent,
      earned: totalEarned,
      lapsed: totalLapsed,
      requests: totalRequests,
      perRequest: totalRequests === 0 ? null : round2(totalSpent / totalRequests),
      peakDay: peak?.[0] ?? null,
      models: [...models.entries()]
        .map(([model, value]) => ({ model, spent: value.spent, requests: value.requests }))
        .sort((left, right) => right.spent - left.spent),
    },
  }
  return report
}

/** What {@link readSpendReport} needs, injected so the arithmetic stays testable. */
export interface SpendReportDeps {
  client: SpendMeter
  /** The accounts to read, already filtered to one region. */
  accounts: readonly { id: string; label: string; credential: WorkBuddyCredential }[]
  /** Days to cover, clamped to {@link SPEND_MAX_DAYS}. */
  days: number | undefined
  /** Clock, injectable for tests. */
  now?: number
  logger?: { warn?(...args: unknown[]): void }
}

/** Assemble the whole document. Never throws: a dead account is a row with an error. */
export async function readSpendReport(deps: SpendReportDeps): Promise<SpendReport> {
  const now = deps.now ?? Date.now()
  const requested = deps.days === undefined || !Number.isFinite(deps.days) ? SPEND_MAX_DAYS : deps.days
  const requestedDays = Math.max(1, Math.trunc(requested))
  const covered = Math.min(requestedDays, SPEND_MAX_DAYS)
  const today = startOfLocalDay(now)
  const windowStartMs = startOfLocalDay(today - (covered - 1) * DAY_MS)
  const axis = spendAxis(spendDayKey(windowStartMs), spendDayKey(now))

  const accounts: SpendAccount[] = []
  for (let index = 0; index < deps.accounts.length; index += ACCOUNT_CONCURRENCY) {
    const slice = deps.accounts.slice(index, index + ACCOUNT_CONCURRENCY)
    // Accounts are read in small parallel batches: one request at a time per
    // account is the meter's real limit, and a batch of three keeps a nine-account
    // pool inside it. Every day inside an account is still sequential.
    const settled = await Promise.all(slice.map(async account => {
      try {
        return await readOne(deps, account, axis, windowStartMs, now)
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error)
        deps.logger?.warn?.(`dsh-xdpool: spend report failed for ${account.label}:`, error)
        return { account, reason }
      }
    }))
    for (const result of settled) {
      if ('reason' in result) {
        accounts.push({
          id: result.account.id,
          label: result.account.label,
          live: 0,
          liveGross: 0,
          activePacks: 0,
          packs: 0,
          days: {},
          opening: 0,
          openingTrusted: false,
          expiring: [],
          totals: { spent: 0, earned: 0, lapsed: 0, requests: 0, perRequest: null, peakDay: null, models: [] },
          // Named, not zeroed: an account whose meter refused to answer must not
          // render as an account that spent nothing.
          error: result.reason,
        })
      } else {
        accounts.push(result)
      }
    }
  }
  accounts.sort((left, right) => right.totals.spent - left.totals.spent || left.label.localeCompare(right.label))

  const sum = (pick: (account: SpendAccount) => number): number =>
    round2(accounts.reduce((total, account) => total + pick(account), 0))

  return {
    generatedAt: formatMeterStamp(now),
    windowStart: axis[0] ?? spendDayKey(windowStartMs),
    windowEnd: axis[axis.length - 1] ?? spendDayKey(now),
    requestedDays,
    maxDays: SPEND_MAX_DAYS,
    days: axis,
    accounts,
    totals: {
      live: sum(account => account.live),
      liveGross: sum(account => account.liveGross),
      spent: sum(account => account.totals.spent),
      earned: sum(account => account.totals.earned),
      lapsed: sum(account => account.totals.lapsed),
      requests: accounts.reduce((total, account) => total + account.totals.requests, 0),
      expiringSoon: sum(account => account.expiring.reduce((subtotal, item) => subtotal + item.remain, 0)),
    },
    failedAccounts: accounts.filter(account => account.error !== undefined).length,
  }
}

/** One account: its meter rows plus its packages. */
async function readOne(
  deps: SpendReportDeps,
  account: { id: string; label: string; credential: WorkBuddyCredential },
  axis: readonly string[],
  windowStartMs: number,
  now: number,
): Promise<SpendAccount> {
  const usage = await fetchWindowEntries(deps.client, account.credential, windowStartMs, now)
  const packs = await deps.client.fetchResourceRows(account.credential, {
    // 60 days back covers every cycle that can have started inside a 31-day
    // window plus the month before it, which is what a subscription's previous
    // cycle needs in order to be credited on the right day.
    beginMs: windowStartMs - 60 * DAY_MS,
    endMs: now + 400 * DAY_MS,
  })
  if (!packs.ok) throw new Error(packs.reason)
  const report = assembleAccount({
    id: account.id,
    label: account.label,
    entries: usage.entries,
    packages: packs.rows,
    axis,
    windowStartMs,
    nowMs: now,
  })
  // `pageCount` is reported in the failure text because it is the one number that
  // separates "the meter refused" from "the arc of the walk broke halfway": a
  // window that failed on its first page and one that failed on its ninth both
  // surface here, and only the count tells them apart.
  return usage.error === undefined
    ? report
    : { ...report, error: `第 ${String(usage.pageCount)} 页取数失败：${usage.error}` }
}
