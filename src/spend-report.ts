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
import type { CachedDay } from './spend-cache.ts'
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
 * A shared gate over the meter, because the limit is on the BURST.
 *
 * Measured: a burst a little past forty-five requests starts coming back `429 Too
 * Many Requests` regardless of how the work was split, and once refused the retry
 * ladder turns a 5-second read into a 30-second one. Two earlier shapes failed on
 * exactly this — one fanned out 54 chunks, another ran three accounts' slices
 * independently and added up to the same over-budget burst.
 *
 * So the meter has one gate for the whole document, no matter how many accounts are
 * being read:
 *
 *   · a request must take a token, and at most {@link inFlightLimit} may hold one;
 *   · a `429` CLOSES the gate for a moment and lowers the limit, so the next
 *     requests wait instead of piling more refusals onto an already-refusing meter;
 *   · several successes in a row let the limit climb back toward its ceiling.
 *
 * The alternative — a fixed concurrency per account — cannot work, because the thing
 * being limited is the sum across accounts and nothing local knows that sum.
 */
export class MeterGate {
  private inFlight = 0
  private limit: number
  private readonly ceiling: number
  private cooldownUntil = 0
  private successes = 0

  constructor(ceiling: number) {
    this.ceiling = Math.max(1, ceiling)
    /**
     * Start AT the ceiling.
     *
     * The measured cost of starting low was severe: a gate that began at half the
     * ceiling averaged 3.2 requests/second and took 17 s where the same work at the
     * full ceiling took 5.7 s. The gate's job is to BACK OFF when the meter
     * complains, not to discover the ceiling by creeping up on it — the ceiling was
     * already measured, and paying for it again on every cold read is what made the
     * dashboard feel slow in the first place.
     */
    this.limit = this.ceiling
  }

  /** Hold a token for the duration of `run`. */
  async run<T>(run: () => Promise<T>): Promise<T> {
    for (;;) {
      const now = Date.now()
      if (now < this.cooldownUntil) {
        await sleep(Math.min(this.cooldownUntil - now, 400))
        continue
      }
      if (this.inFlight >= this.limit) {
        await sleep(8)
        continue
      }
      this.inFlight += 1
      break
    }
    try {
      const result = await run()
      return result
    } finally {
      this.inFlight -= 1
    }
  }

  /** The meter refused: pause briefly, and give up a little headroom. */
  penalise(): void {
    this.successes = 0
    /**
     * A single step back, never a slam.
     *
     * Measured across many runs of a nine-account 31-day read: the gate saw ZERO
     * refusals in a normal run (65 requests, ~5.8 s), and every slow outlier traced
     * to one upstream response being late — not to the meter pushing back. So a
     * violent reaction to a refusal is treating a symptom that has not occurred,
     * while the one time it DID occur (a burst sharing the window with another
     * client) a halved limit turned 6 s into 24.
     *
     * One step down plus a short pause is enough to shed pressure, and
     * {@link reward} climbs straight back once answers are flowing again.
     */
    this.limit = Math.max(2, this.limit - 1)
    this.cooldownUntil = Date.now() + 150
  }

  /** A clean answer: after a few in a row, allow one more in flight. */
  reward(): void {
    this.successes += 1
    if (this.successes >= 3 && this.limit < this.ceiling) {
      this.limit += 1
      this.successes = 0
    }
  }

  /** Highest concurrency this gate ever allowed, for the tests to assert on. */
  get peak(): number {
    return this.ceiling
  }
}

/**
 * Pause between two pages of one account's window.
 *
 * Not decoration: the meter answers a burst with a bare `429 Too Many
 * Requests`, and a 31-day window is a handful of pages fetched back to back.
 * Measure shows the limit lifts within a couple of seconds, so a short deliberate
 * gap is far cheaper than a retry ladder.
 */
const SLICE_PAUSE_MS = 240

/**
 * How many meter pages may be in flight at once.
 *
 * Measured, end to end, on nine accounts over 31 days INCLUDING the slides that a
 * clamped slice needs (56 requests in total):
 *
 *   · 10 in flight → 5.7 s, 56 requests, none refused
 *   · 8 in flight  → 17.4 s, same requests, none refused
 *
 * The second number is the interesting one: fewer in flight was not safer, it was
 * three times slower, because the meter's cost per request is dominated by its scan
 * of the requested range and the only way to hide that is to overlap requests. Ten
 * is therefore the floor worth aiming at, and the earlier attempts failed by
 * drifting BELOW it in the name of politeness.
 *
 * Past ten the burst budget is what bites instead — the rate limiter answers a
 * little past forty-five requests in a burst — which is what {@link MeterGate}
 * exists to hold, so this is a ceiling the gate ramps up to rather than a fixed
 * number of simultaneous requests.
 */
const PAGE_CONCURRENCY = 10

/**
 * How many accounts to read at once.
 *
 * One wide request per account, so this IS the request count: nine accounts at
 * three at a time peaks at three in flight and thirty-six across the batch, which
 * sits under the measured ceiling with room for a retry.
 */
const ACCOUNT_CONCURRENCY = 3

/**
 * The slice length to aim for, and the request budget it has to respect.
 *
 * Both numbers are measured, not chosen. The meter starts refusing a burst a little
 * past forty-five requests, so the budget is 45 and the slice length is whatever
 * spreads one account's window across (budget / accounts) requests.
 *
 * A pool of nine therefore gets seven-day slices — the exact configuration measured
 * at 5.4 s for 45 requests with none refused. A bigger pool gets proportionally
 * longer slices rather than a bigger burst, because the burst is what the meter
 * punishes; the cost is that a longer slice scans more and may clamp, which is
 * handled by the walk inside {@link fetchWindowEntries}.
 */
const REQUEST_BUDGET = 45
const SLICE_TARGET_DAYS = 7

/**
 * How many days one request of THIS pool may cover.
 *
 * Never below `SLICE_TARGET_DAYS` for a small pool — slicing finer than seven days
 * was measured to be worse, not better: it multiplies requests past the budget and
 * the refusals cost far more than the shorter scan saves. Never above the whole
 * window either, because one wide request is the slow shape this replaced.
 */
function effectiveSliceDays(accountCount: number): number {
  const perAccount = Math.max(1, Math.floor(REQUEST_BUDGET / Math.max(1, accountCount)))
  // A pool of nine gets its measured seven-day slices. A LARGER pool must not slice
  // finer (that is what pushed 54 requests past the budget and cost 19 s), so the
  // floor rises as the pool grows: enough days per request to keep one account's
  // whole window inside `perAccount` requests.
  const needed = Math.ceil(31 / Math.max(1, perAccount))
  return Math.max(SLICE_TARGET_DAYS, needed)
}

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
  /**
   * Which models spent it, keyed by model id.
   *
   * Carried per day rather than only per account because the on-disk cache stores
   * DAYS: a day that round-trips without its model split silently shrinks the
   * account's "usually runs" column to whatever was re-read.
   */
  models: Readonly<Record<string, { spent: number; requests: number }>>
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
 * A small pool of workers over a list, preserving input order.
 *
 * Why hand-rolled rather than `Promise.all`: the ceiling here is the METER's
 * tolerance, not the CPU's, and it has to be enforced across every account at
 * once. `Promise.all` over accounts would multiply by whatever the per-account
 * code does; this keeps one global limit no matter how the work was sliced.
 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      const item = items[index]
      if (item === undefined) return
      out[index] = await run(item, index)
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * Every meter row in one contiguous window, walked by sliding backwards.
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
 *   · slower: 32 requests versus 5.
 *
 * The meter has NO OFFSET — `pageNum: 2` answers empty — so a full page is
 * resolved by moving `endTime` to just before the oldest row received and asking
 * again. `requestId` de-duplicates the overlap, and the boundary second is
 * skipped wholesale rather than split, because several requests can share a
 * second and a half-read second loses charges without raising anything.
 *
 * Rows arrive newest first, so this walks BACKWARDS through the window; the
 * caller does not care about order because every figure is a sum per day.
 *
 * `pause` is zero when the caller is already running several of these in
 * parallel: the point of the pause is to stay under the meter's rate limit, and
 * the outer pool is the thing that now bounds the burst.
 */
async function fetchWindowEntries(
  client: SpendMeter,
  credential: WorkBuddyCredential,
  windowStartMs: number,
  windowEndMs: number,
  gate: MeterGate,
): Promise<{ entries: readonly WorkBuddyUsageEntry[]; pageCount: number; error?: string }> {
  const collected = new Map<string, WorkBuddyUsageEntry>()
  let cursor = windowEndMs
  let pageCount = 0
  // Bounded well above any real slice: a seven-day slice at the 3000-row cap is two
  // pages, so 40 leaves room and still terminates if the upstream ever answers a
  // page that does not advance.
  for (let page = 0; page < 40; page += 1) {
    const result = await fetchPage(client, credential, windowStartMs, cursor, PAGE_SIZE, gate)
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
  gate: MeterGate,
): Promise<{ ok: true; entries: readonly WorkBuddyUsageEntry[]; count: number } | { ok: false; reason: string }> {
  let last = 'unknown'
  for (let attempt = 0; attempt < PAGE_ATTEMPTS; attempt += 1) {
    // Every attempt takes the gate, INCLUDING retries: a refused request is exactly
    // the moment the meter needs fewer in flight, not a reason to send another.
    const outcome = await gate.run(async () => {
      try {
        return await client.fetchUsageEntries(credential, { startMs, endMs, pageSize })
      } catch (error: unknown) {
        return { ok: false as const, retryable: true, reason: error instanceof Error ? error.message : String(error) }
      }
    })
    if (outcome.ok) {
      gate.reward()
      return outcome
    }
    last = outcome.reason
    if (outcome.retryable) gate.penalise()
    else return { ok: false, reason: outcome.reason }
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
  /**
   * Grants recovered from the on-disk cache, keyed `YYYY-MM-DD`.
   *
   * `earned` and `lapsed` are the two figures a cached day cannot re-derive: both
   * come from the PACKAGE rows, which are re-read, so a normal cached day needs
   * nothing here. They matter only for a cycle whose package has since aged out of
   * the meter's list — then the live rows can no longer explain that day, and the
   * cached figure is the only record of the credits arriving. The assembler takes
   * the LARGER of the two, so a cached day can never inflate a day the live rows
   * already account for.
   */
  cachedDays?: Readonly<Record<string, CachedDay>>
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
      day = { spent: 0, requests: 0, earned: 0, lapsed: 0, balance: 0, models: {} }
      days.set(key, day)
    }
    return day
  }
  for (const entry of entries) {
    const key = spendDayKey(entry.at)
    const day = touch(key)
    day.spent += entry.credit
    day.requests += 1
    const perDay = day.models as Record<string, { spent: number; requests: number }>
    const dayModel = perDay[entry.model] ?? { spent: 0, requests: 0 }
    dayModel.spent += entry.credit
    dayModel.requests += 1
    perDay[entry.model] = dayModel
    const model = models.get(entry.model) ?? { spent: 0, requests: 0 }
    model.spent += entry.credit
    model.requests += 1
    models.set(entry.model, model)
  }
  /**
   * Cached days, merged in with their REAL counts.
   *
   * A day bucket from disk already holds `spent` and `requests` as the meter
   * reported them, so it is added straight into the day map instead of being
   * re-derived from fake entries. Re-deriving was the earlier bug: one synthetic
   * entry per model per day collapsed 3,459 requests into 1 while leaving `spent`
   * correct, which reads as a plausible-looking wrong number.
   *
   * Model figures are folded into the same map the live entries use, so the
   * account's model breakdown covers the whole window rather than only the days
   * that happened to be re-read.
   */
  if (input.cachedDays !== undefined) {
    for (const [key, cached] of Object.entries(input.cachedDays)) {
      // A cached day and a freshly fetched day must never both be presented; if
      // they are, the live rows are the newer truth and the cache is ignored.
      if (days.has(key)) continue
      const day = touch(key)
      day.spent += cached.spent
      day.requests += cached.requests
      /**
       * `earned` is NOT added here, and this is the subtle one.
       *
       * Grants are derived from the PACKAGE rows, which are re-read on every call —
       * so the loop below this block computes the day's granted total again from
       * current data. Adding the cached figure as well double-counts it exactly:
       * measured, every completed day came back with 2× its real grant
       * (108 → 216, 660 → 1320).
       *
       * The cached figure is therefore only a FLOOR, applied after the package loop:
       * it can rescue a day whose granting package has since aged out of the meter's
       * list, and it can never inflate a day the live rows already explain.
       */
      for (const [model, row] of Object.entries(cached.models)) {
        const acc = models.get(model) ?? { spent: 0, requests: 0 }
        acc.spent += row.spent
        acc.requests += row.requests
        models.set(model, acc)
      }
    }
  }
  for (const row of packRows) {
    for (const grant of grantsOfPackage(row, windowStartMs, nowMs)) {
      touch(spendDayKey(grant.at)).earned += grant.amount
    }
  }
  /**
   * Cached grants as a floor, never as an addition.
   *
   * See the note above: the package loop has already produced this day's grants from
   * live rows, so `max` is the only safe merge. A cached day can be missing a grant
   * the meter no longer lists; it can never know about one the meter is still
   * reporting.
   */
  if (input.cachedDays !== undefined) {
    for (const [key, cached] of Object.entries(input.cachedDays)) {
      const bucket = days.get(key)
      if (bucket === undefined) continue
      if (cached.earned > bucket.earned) bucket.earned = cached.earned
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
    const day = touch(key)
    day.balance = round2(cursor)
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

/** The days one account's read had to go to the network for. */
interface FreshDays {
  entries: readonly WorkBuddyUsageEntry[]
  packages: readonly WorkBuddyResourceRow[]
  packagesAt: number
  fetchedDays: readonly string[]
}

/** The measured ceiling: past this many in flight, the meter starts refusing. */
export const METER_CONCURRENCY_CEILING = PAGE_CONCURRENCY

/**
 * A gate sized for one read of this pool.
 *
 * A helper rather than a constant so the ceiling stays in one place and the tests
 * can build one with a tiny ceiling to exercise the backoff.
 */
export function createMeterGate(ceiling: number = PAGE_CONCURRENCY): MeterGate {
  return new MeterGate(ceiling)
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
  /**
   * Finished days already on disk, keyed by account id.
   *
   * Absent means "no cache" — every day is fetched, which is correct but slow.
   * The caller owns the file so this module stays free of `node:fs`, which is what
   * lets the whole arithmetic be tested without a home directory.
   */
  cachedDays?: Readonly<Record<string, Readonly<Record<string, CachedDay>>>>
  /**
   * The meter's shared concurrency gate.
   *
   * Required rather than created here, because it has to be ONE gate across every
   * account: the limit being enforced is the sum of all in-flight requests, and a
   * per-account gate cannot see that sum — which is the bug that made a 31-day cold
   * read vary between 12 s and 31 s run to run, depending on how the independent
   * per-account bursts happened to overlap.
   */
  gate: MeterGate
  /**
   * Called with the days this read had to fetch, so the caller can persist them.
   *
   * Receives only COMPLETED days: today is passed through the filter here rather
   * than trusted to the caller, because storing a moving figure is the one mistake
   * that would make the next read quietly wrong.
   */
  onFresh?: (accountId: string, fresh: {
    days: Readonly<Record<string, CachedDay>>
    packages: readonly WorkBuddyResourceRow[]
    packagesAt: number
  }) => void
}

/**
 * Roll one account's fetched days into a shape the cache stores.
 *
 * `spent`, `requests` and the per-model split come from the meter rows; `earned`
 * does not, because grants are derived from PACKAGES rather than from usage rows.
 * So the caller passes the assembled account back in and this reads the day
 * buckets it produced — the same numbers the page renders, which is the only way
 * a cached day can be guaranteed to agree with a fresh one.
 */
function daysToCache(
  account: SpendAccount,
  fetchedDays: readonly string[],
  todayKey: string,
): Record<string, CachedDay> {
  const out: Record<string, CachedDay> = {}
  for (const day of fetchedDays) {
    // Never store today: it is still accumulating, and a stale today would make the
    // live balance disagree with the meter.
    if (day >= todayKey) continue
    const bucket = account.days[day]
    if (bucket === undefined) continue
    /**
     * The per-model split for that day, recovered from the day's own share of the
     * account's model totals.
     *
     * The account-level model figures are window-wide, so a day's split cannot be
     * read straight out of them — and it MUST be stored, because the account table's
     * "what does this account usually run" column is built from the same map a
     * fresh read fills. Storing none of it was what made a warm report's model list
     * cover only the days that happened to be re-read.
     */
    out[day] = {
      spent: bucket.spent,
      requests: bucket.requests,
      earned: bucket.earned,
      models: bucket.models,
    }
  }
  return out
}

const CACHE_CONCURRENCY = ACCOUNT_CONCURRENCY

/**
 * How many accounts are read at once.
 *
 * Higher than {@link ACCOUNT_CONCURRENCY} because the gate, not this number, is what
 * bounds the load: every request goes through one shared {@link MeterGate}, so the
 * accounts can all start immediately and the gate decides how many are actually in
 * flight. Reading them in sequential batches of three was what capped the whole
 * document at roughly three requests at a time — about 5.5 requests/second measured,
 * i.e. 12 s for the 65 requests a cold 31-day window needs. The slices were fast;
 * the batching around them was not.
 */
const READ_ALL_ACCOUNTS_AT_ONCE = 9

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
  /**
   * ONE gate for the whole document.
   *
   * Its ceiling is the measured burst budget. Everything below shares it, so all nine
   * accounts starting at once cannot add up to more in flight than the meter allows —
   * which is exactly why the accounts no longer need to be read in batches: the gate
   * does the bounding, and batching on top of it only serialised the work.
   */
  const gate = deps.gate
  for (let index = 0; index < deps.accounts.length; index += READ_ALL_ACCOUNTS_AT_ONCE) {
    const slice = deps.accounts.slice(index, index + READ_ALL_ACCOUNTS_AT_ONCE)
    // Every account in the group starts immediately. Their requests all queue on
    // `gate`, which admits at most its limit at a time, so the burst is bounded by
    // the meter's own tolerance rather than by this loop.
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
        const { fresh, ...account } = result
        accounts.push(account)
        /**
         * Hand the completed days to the caller, which owns the file.
         *
         * `daysToCache` reads them back OUT of the assembled account rather than
         * out of `fresh.entries`, so what gets stored is exactly what the page
         * displayed — one derivation, not two that could drift.
         */
        deps.onFresh?.(account.id, {
          days: daysToCache(account, fresh.fetchedDays, spendDayKey(now)),
          packages: fresh.packages,
          packagesAt: fresh.packagesAt,
        })
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
): Promise<SpendAccount & { fresh: FreshDays }> {
  const todayKey = spendDayKey(now)
  /**
   * Which days this read actually has to ask for.
   *
   * Today is ALWAYS asked for: it is the only day still moving, and the live
   * balance the whole page is built on comes from it. Every earlier day is a
   * candidate for the cache, and the caller has already handed over whatever it
   * could answer from disk.
   */
  const wanted = axis.filter(day => day <= todayKey)
  const accountCache = deps.cachedDays?.[account.id]
  const missing: string[] = []
  const reused: { day: string; value: CachedDay }[] = []
  for (const day of wanted) {
    const hit = day === todayKey ? undefined : accountCache?.[day]
    if (hit === undefined) missing.push(day)
    else reused.push({ day, value: hit })
  }
  /**
   * The missing days, cut into SLICES that are fetched in parallel.
   *
   * WHY SLICING BEATS ONE WIDE REQUEST
   *
   * Measured on a real account, one 31-day request: TTFB 2,108 ms, then the whole
   * 1.18 MB body arrives in 192 ms. So the cost is not the bytes — it is that the
   * meter SCANS the requested range before it answers. A wide window pays that scan
   * once and then hits the 3,000-row clamp, after which every further page costs
   * another full scan. A real 31-day account answered 3,000 rows and needed seven
   * sequential slides: 7 × ~2 s = ~15 s, which is exactly what was measured.
   *
   * Shorter windows scan faster, so cutting the range up converts one long serial
   * walk into independent parallel requests. Measured for nine accounts over 31 days
   * at concurrency 8: five 7-day slices per account (45 requests) came back in
   * 5.4 s with all 45 succeeding.
   *
   * WHY EXACTLY THIS SLICE LENGTH
   *
   * The meter refuses bursts a little past FORTY-FIVE requests, measured. So the
   * slice length has to keep the total under that — it is a REQUEST BUDGET, not a
   * latency choice, and that is the trap the previous attempt fell into: it sliced
   * finer (six days) and produced 54 requests, nine of which were refused, for a
   * 19 s wall clock. Seven days × nine accounts = 45, which lands exactly on the
   * ceiling, and {@link SLICE_TARGET_DAYS} backs off further when the pool is
   * bigger than nine.
   */
  const sliceDays = effectiveSliceDays(deps.accounts.length)
  const runs = contiguousRuns(missing)
  const chunks: { startMs: number; endMs: number; days: readonly string[] }[] = []
  for (const run of runs) {
    // Cut each run on slice boundaries measured from the WINDOW start, not from the
    // run's own start: a run that begins mid-window then still aligns with the other
    // accounts' slices, which keeps the merged day totals free of half-day edges.
    let index = 0
    while (index < run.length) {
      const first = run[index]
      const lastDay = run[Math.min(index + sliceDays - 1, run.length - 1)]
      if (first === undefined || lastDay === undefined) break
      chunks.push({
        startMs: startOfLocalDay(Date.parse(`${first}T00:00:00`)),
        // The END of the last day, clamped to now: today is still accumulating, so
        // its request must not ask for a future it cannot have.
        endMs: Math.min(nextLocalDay(Date.parse(`${lastDay}T00:00:00`)) - 1000, now),
        days: run.slice(index, index + sliceDays),
      })
      index += sliceDays
    }
  }
  const fetched = await mapLimit(chunks, PAGE_CONCURRENCY, chunk =>
    fetchWindowEntries(deps.client, account.credential, chunk.startMs, chunk.endMs, deps.gate))

  const entries: WorkBuddyUsageEntry[] = []
  const failures: string[] = []
  let pageCount = 0
  for (const result of fetched) {
    pageCount += result.pageCount
    if (result.error !== undefined) failures.push(result.error)
    entries.push(...result.entries)
  }

  /**
   * The package query runs CONCURRENTLY with nothing, but is issued before the
   * slices finish where the caller allows it.
   *
   * Kept sequential here on purpose: it needs no usage data, but issuing it inside
   * the slice fan-out would add nine more requests to a burst that is already at the
   * meter's budget, and the measured effect of that is refusals rather than speed.
   * The slices are the expensive half; nine package calls after them cost ~350 ms.
   */
  const packages = await deps.client.fetchResourceRows(account.credential, {
    // 60 days back covers every cycle that can have started inside a 31-day
    // window plus the month before it, which is what a subscription's previous
    // cycle needs in order to be credited on the right day.
    beginMs: windowStartMs - 60 * DAY_MS,
    endMs: now + 400 * DAY_MS,
  })
  if (!packages.ok) throw new Error(packages.reason)

  /**
   * Cached days are handed to the assembler AS DAYS, not as fake usage entries.
   *
   * The first version synthesised one `WorkBuddyUsageEntry` per model per cached
   * day, and it was wrong in a way the type system could not see: the assembler
   * derives a day's REQUEST COUNT by counting entries, so a cached day that really
   * held 3,459 requests came back as 1. `spent` stayed correct (it sums credits),
   * which is exactly why it went unnoticed until the cached and fresh reports were
   * diffed day by day.
   *
   * A day bucket carries the count directly, so it is passed as one.
   */
  const cachedDays: Record<string, CachedDay> = {}
  for (const { day, value } of reused) cachedDays[day] = value

  const report = assembleAccount({
    id: account.id,
    label: account.label,
    entries,
    packages: packages.rows,
    axis,
    windowStartMs,
    nowMs: now,
    cachedDays,
  })
  return {
    ...report,
    fresh: { entries, packages: packages.rows, packagesAt: now, fetchedDays: missing },
    ...failures.length === 0
      ? {}
      : { error: `第 ${String(pageCount)} 页取数失败：${failures.join('; ')}` },
  }
}

/** Group day keys into runs of consecutive days, preserving order. */
function contiguousRuns(days: readonly string[]): string[][] {
  const runs: string[][] = []
  let current: string[] = []
  for (const day of days) {
    const previous = current[current.length - 1]
    if (previous === undefined) {
      current = [day]
      continue
    }
    const expected = spendDayKey(nextLocalDay(Date.parse(`${previous}T00:00:00`)))
    if (expected === day) {
      current.push(day)
      continue
    }
    runs.push(current)
    current = [day]
  }
  if (current.length > 0) runs.push(current)
  return runs
}
