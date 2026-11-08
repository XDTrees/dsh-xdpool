/**
 * Read the pack's token ledger off disk and estimate credit spend per channel.
 *
 * WHY IT READS THE FILE INSTEAD OF CALLING THE PACK
 *
 * `usage.tokenLedgerHistory` exists, but it is reachable only through the pack's
 * browser-facing RPC (`/api/channel-pack`), which the host half does not speak — that
 * route is installed by the pack for the CARD. Reading `token-ledger.json` directly is
 * cheaper, needs no round trip, and works while the pack is still mounting.
 *
 * The file is a build artifact of another repository, so its shape is treated as
 * external and every level is validated before use: an unexpected shape must degrade
 * to "no data", never to a wrong number. The only thing relied on is the documented
 * shape — `{ days: { 'YYYY-MM-DD': { '<mode>|<channel>|<account>|<model>': stats } } }`
 * — and each key component is parsed positionally with a length check.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not claim to know what the vendor charged. See `credits.ts` for the
 * arithmetic and for why the figure is labelled "estimated".
 *
 * @module dsh-xdpool/credit-report
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { UsageCall } from './stats.ts'
import { creditsOf, ratesFor, rateFromModelName, totalsByChannel, type CreditChannelTotal, type CreditRates, type CreditSpendRow } from './credits.ts'

/** One ledger entry: the token counts the pack recorded for a model on a day. */
interface LedgerStats {
  requests?: unknown
  inputTokens?: unknown
  outputTokens?: unknown
  /** Cache READS. Billed at the cache coefficient, and the largest term in agent use. */
  cacheReadTokens?: unknown
  /** Failed requests, so a row's `ok` can reflect them. */
  errors?: unknown
  reasoningTokens?: unknown
}

/**
 * Which ledger rows count as "the account pool spent this".
 *
 * The pack stamps every row with a `channel` of exactly two values:
 *
 *   - `direct`  — the pool (or a channel) was used by this plugin itself, which is the
 *                 DSH conversation spending pooled quota. This is what the strip reports;
 *   - `gateway` — the request arrived through the LAN relay, i.e. some OTHER device
 *                 using this machine as an OpenAI endpoint.
 *
 * Mixing them would make the strip answer a question nobody asked — "how much has my
 * whole household spent" — and would let a phone pointed at the relay inflate a number
 * the user reads as their own conversation. They are counted separately.
 */
const POOL_MODE = 'direct'

/** What the strip renders. */
export interface CreditSpendReport {
  /** `days` the caller asked for, or undefined for the whole retained window. */
  windowDays: number | undefined
  /** Inclusive date bounds actually covered, `YYYY-MM-DD`; '' when there is no data. */
  from: string
  to: string
  rows: readonly CreditSpendRow[]
  channels: readonly CreditChannelTotal[]
  /**
   * How many ledger keys could not be read as `<mode>|<channel>|<account>|<model>`.
   *
   * Reported rather than silently dropped: a pack refresh that renames the key format
   * would otherwise turn the whole panel into a confident zero.
   */
  unreadable: number
  /**
   * Requests that arrived through the LAN relay, excluded from every figure above.
   *
   * Counted, not ignored: a user who shares the gateway wants to know the strip is
   * about their own conversation, and a non-zero here explains why the totals look
   * smaller than the ledger.
   */
  gatewayRequests: number
  /** True when the ledger file does not exist, i.e. nothing has been recorded yet. */
  empty: boolean
}

/**
 * Where the ledger lives, relative to the DSH home.
 *
 * Under `channel-pack/`, not at the top of the home — the pack owns its own directory
 * and this file is one of its artifacts. Reading `home/token-ledger.json` finds
 * nothing and reports an empty ledger, which looks exactly like "you have spent
 * nothing" rather than "this is looking in the wrong place".
 */
const LEDGER_FILE = join('channel-pack', 'token-ledger.json')

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** `2026-11-07` minus N days, as the same string shape. */
/**
 * A `YYYY-MM-DD` key for `days` ago, in the LOCAL calendar.
 *
 * Not `toISOString()`: that is UTC, and the ledger's day keys are whatever the machine's
 * clock says when the pack writes them — i.e. local. Mixing the two shifts the window by
 * the UTC offset, so a user in UTC+8 reading "today" between midnight and 08:00 was shown
 * the previous day's totals. The bug is invisible for most of the day and wrong for
 * exactly the hours someone checks whether a long run has spent much.
 *
 * Built from local parts rather than by subtracting milliseconds, because a DST boundary
 * would otherwise land on the wrong day.
 */
function daysAgoKey(days: number, now = new Date()): string {
  const copy = new Date(now.getTime())
  copy.setDate(copy.getDate() - days)
  const year = copy.getFullYear()
  const month = String(copy.getMonth() + 1).padStart(2, '0')
  const day = String(copy.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

/** Split `mode|channel|account|model`, refusing anything that is not four parts. */
function parseLedgerKey(key: string): { mode: string; channel: string; model: string } | undefined {
  const parts = key.split('|')
  if (parts.length < 4) return undefined
  const mode = (parts[0] ?? '').trim()
  const channel = (parts[1] ?? '').trim()
  const model = (parts[3] ?? '').trim()
  if (mode === '' || channel === '' || model === '') return undefined
  return { mode, channel, model }
}

/**
 * Build the report.
 *
 * `rateOf` resolves a model's multiplier from the channel's catalogue. It is a
 * callback rather than a table because the catalogue is the pack's live data — reading
 * it here would mean a second copy that drifts. Returning undefined for a model means
 * "no published rate", which the report counts separately instead of billing at zero.
 */
export async function readCreditSpend(input: {
  /** Directory holding `token-ledger.json`, typically the DSH home. */
  home: string
  days: number | undefined
  /** The three billing coefficients for a model, or undefined when unpublished. */
  rateOf: (channel: string, model: string) => CreditRates | undefined
  now?: Date
}): Promise<CreditSpendReport> {
  const empty: CreditSpendReport = {
    windowDays: input.days,
    from: '',
    to: '',
    rows: [],
    channels: [],
    unreadable: 0,
    gatewayRequests: 0,
    empty: true,
  }
  let text: string
  try {
    text = await readFile(join(input.home, LEDGER_FILE), 'utf8')
  } catch {
    // No ledger yet: the strip says so rather than showing a confident 0.
    return empty
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return empty
  }
  const daysNode = (parsed as { days?: unknown }).days
  if (daysNode === null || typeof daysNode !== 'object') return empty

  /**
   * `days: 1` means TODAY ALONE, not "today plus yesterday".
   *
   * The old arithmetic subtracted the window size before taking the bound
   * (`daysAgoKey(days)`), so a one-day window covered today AND yesterday: a strip labelled
   * "today" reported a figure that included yesterday evening's work. `days - 1` makes the
   * label true — one day back from today is the start of today.
   */
  const earliest = input.days === undefined ? undefined : daysAgoKey(Math.max(0, input.days - 1), input.now)
  // Accumulate per (channel, model) across every day in the window, because the strip
  // answers "which channel, which model" — not "what happened on Tuesday".
  const acc = new Map<string, { channel: string; model: string; requests: number; inputTokens: number; cacheTokens: number; outputTokens: number }>()
  let unreadable = 0
  // Counted separately rather than dropped: a user who shares the gateway should be
  // able to see that the strip is not counting those requests.
  let gatewayRequests = 0
  let sawAnyDay = false
  let from = ''
  let to = ''

  for (const [day, entries] of Object.entries(daysNode as Record<string, unknown>)) {
    // `YYYY-MM-DD` sorts lexicographically, so the window needs no date parsing.
    if (/^\d{4}-\d{2}-\d{2}$/u.test(day)) {
      if (earliest !== undefined && day < earliest) continue
      sawAnyDay = true
      if (from === '' || day < from) from = day
      if (to === '' || day > to) to = day
    } else {
      continue
    }
    if (entries === null || typeof entries !== 'object') continue
    for (const [key, stats] of Object.entries(entries as Record<string, unknown>)) {
      const named = parseLedgerKey(key)
      if (named === undefined) {
        unreadable += 1
        continue
      }
      // Only the pool's own spend. `gateway` rows are another device borrowing this
      // machine through the relay; see POOL_MODE.
      if (named.mode !== POOL_MODE) {
        const entry = stats as LedgerStats | null
        if (entry !== null && typeof entry === 'object') gatewayRequests += numberOf(entry.requests)
        continue
      }
      if (stats === null || typeof stats !== 'object') continue
      const entry = stats as LedgerStats
      const id = `${named.channel}\u0000${named.model}`
      const current = acc.get(id) ?? {
        channel: named.channel,
        model: named.model,
        requests: 0,
        inputTokens: 0,
        cacheTokens: 0,
        outputTokens: 0,
      }
      current.requests += numberOf(entry.requests)
      current.inputTokens += numberOf(entry.inputTokens)
      // Cache reads are a SEPARATE field, not part of `inputTokens`. At 0.29 credits/M
      // they still dominate a real bill — 197M cached against 3.5M fresh is a normal
      // agent day — so dropping this field is what made the estimate two orders of
      // magnitude too low.
      current.cacheTokens += numberOf(entry.cacheReadTokens)
      current.outputTokens += numberOf(entry.outputTokens)
      acc.set(id, current)
    }
  }

  const rows: CreditSpendRow[] = [...acc.values()]
    .map(entry => {
      const rates = input.rateOf(entry.channel, entry.model)
      return {
        channel: entry.channel,
        model: entry.model,
        requests: entry.requests,
        inputTokens: entry.inputTokens,
        cacheTokens: entry.cacheTokens,
        outputTokens: entry.outputTokens,
        rates,
        credits: creditsOf(entry.inputTokens, entry.cacheTokens, entry.outputTokens, rates),
      }
    })
    // Most tokens first: a channel with no published rate still has a shape, and
    // burying it under the priced rows would hide the one thing worth investigating.
    .sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))

  return {
    windowDays: input.days,
    from: sawAnyDay ? from : '',
    to: sawAnyDay ? to : '',
    rows,
    channels: totalsByChannel(rows),
    unreadable,
    gatewayRequests,
    empty: !sawAnyDay,
  }
}

/** Re-exported so the host half can parse a name without importing `credits.ts` twice. */
export { rateFromModelName }

/**
 * Refill a `UsageRecorder` with TODAY's totals from the pack ledger.
 *
 * The recorder keeps process memory only, so every restart emptied the usage panel and the
 * pool card printed "the gateway reported no token counts" — an accusation aimed at the
 * gateway for something this plugin had forgotten. The pack already persists a 90-day
 * ledger, so the same period was on disk the whole time.
 *
 * Day granularity on purpose: the ledger aggregates per (channel, account, model) per day
 * and keeps no per-call timestamps, so one `UsageCall` is synthesised per row carrying the
 * day's totals. That makes the TOTALS correct after a restart while the panel's
 * recent-calls list stays empty — inventing timestamps to fill a list would be worse than
 * an empty list.
 *
 * Returns how many rows were restored, so a startup note can say whether it worked.
 */
export async function backfillUsageFromLedger(
  home: string,
  recorder: { record(call: UsageCall): void; reset(): void },
  logger?: { info?(...args: unknown[]): void; warn?(...args: unknown[]): void },
): Promise<number> {
  let text: string
  try {
    text = await readFile(join(home, LEDGER_FILE), 'utf8')
  } catch {
    // No ledger yet: a fresh install has nothing to restore, and the panel's own empty
    // state is the truthful one.
    return 0
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    logger?.warn?.('dsh-xdpool: token ledger is not readable JSON; usage starts empty')
    return 0
  }
  const daysNode = (parsed as { days?: unknown }).days
  if (daysNode === null || typeof daysNode !== 'object') return 0

  const today = daysKey(new Date())
  const day = (daysNode as Record<string, unknown>)[today]
  if (day === null || day === undefined || typeof day !== 'object') return 0

  const calls: UsageCall[] = []
  for (const [key, raw] of Object.entries(day as Record<string, unknown>)) {
    const named = parseLedgerKey(key)
    // Only the pool's own traffic; relay rows are another device's usage and would inflate
    // a panel that reads as "what I did today".
    if (named === undefined || named.mode !== POOL_MODE) continue
    if (raw === null || typeof raw !== 'object') continue
    const entry = raw as LedgerStats
    const requests = numberOf(entry.requests)
    const input = numberOf(entry.inputTokens)
    const cache = numberOf(entry.cacheReadTokens)
    const output = numberOf(entry.outputTokens)
    calls.push({
      channel: named.channel,
      // The ledger key carries no region; the pool channels encode it in their own id.
      region: named.channel === 'workbuddy' ? 'global' : named.channel === 'buddy' ? 'cn' : '',
      model: named.model,
      account: '',
      turnId: `backfill:${today}:${named.channel}:${named.model}`,
      // Midnight local, because the ledger's resolution is the day; a per-call timestamp
      // does not exist to restore.
      at: startOfLocalDay(new Date()).getTime(),
      ok: requests > numberOf(entry.errors),
      usage: {
        inputTokens: input,
        outputTokens: output,
        cachedTokens: cache,
        // Reasoning tokens are billed as output and the ledger keeps them apart; the
        // backfilled row reports them so the panel's breakdown is not silently short.
        reasoningTokens: numberOf(entry.reasoningTokens),
      },
    })
  }
  if (calls.length === 0) return 0
  recorder.reset()
  for (const call of calls) recorder.record(call)
  logger?.info?.(`dsh-xdpool: restored ${String(calls.length)} usage row(s) for ${today} from the ledger`)
  return calls.length
}

/** Local `YYYY-MM-DD`, matching how the pack names its day buckets. */
function daysKey(now: Date): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

/** Midnight at the start of `now`'s local day. */
function startOfLocalDay(now: Date): Date {
  const copy = new Date(now.getTime())
  copy.setHours(0, 0, 0, 0)
  return copy
}
