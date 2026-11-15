/**
 * Read TODAY's measured credit spend out of cost-meter's statistics file.
 *
 * WHY A SECOND SOURCE
 *
 * `credit-report.ts` prices the pack's own token ledger, and that is the right answer to
 * "what did this conversation cost" — but it is an ESTIMATE (published unit prices times
 * token counts) and the pack only writes the ledger while it is serving requests. A pack
 * that stopped writing left the credits row empty on every poll, which read on screen as
 * "you used nothing today" even in the middle of a long session.
 *
 * cost-meter observes something different and stronger: it samples every pooled account's
 * balance and books each DECREASE under the local calendar day. That total is measured
 * from the vendor's own numbers, survives a DSH restart, and includes quota burned by
 * anything else using the same accounts. It is the only figure that can honestly be
 * printed without a "≈".
 *
 * WHY IT READS FILES
 *
 * cost-meter registers no HTTP route of its own (`webServer` never appears in its
 * package), so the host half cannot ask it anything. The statistics file is its
 * documented output and is read here directly — no round trip, and it works while the
 * other plugin is still mounting.
 *
 * Those files belong to another repository, so every shape is treated as EXTERNAL and
 * every level is validated: an unexpected shape must degrade to "no data", never to a
 * wrong number.
 *
 * WHERE THE SAMPLER IS NOT ENOUGH
 *
 * A recorded drop is an observation, but it only exists when a sample WITNESSED the
 * balances fall. Between two samples (15 minutes) a spend masked by a refill, a package
 * roll-over or an account switch leaves no trace, and a spend made in the WorkBuddy
 * client rather than through this pool never reaches the sampler at all. Neither is
 * merely late — it is lost. So the day also keeps a START-OF-DAY balance per account and
 * counts `max(recorded, start - now)`, which is the only comparison that can see a drop
 * nobody watched. The baseline file is scoped to ONE local day, which is what makes the
 * figure reset at 0:00 by construction rather than by subtracting two clocks.
 *
 * @module dsh-xdpool/credit-today
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { XDPOOL_GLOBAL_PROVIDER, XDPOOL_PROVIDER } from './adapter.ts'
import { POOL_OWNED_CHANNELS } from './channels.ts'
import { creditsOf, ratesFor } from './credits.ts'
import type { PoolWebCreditsToday } from './status-paths.ts'

/** Where cost-meter keeps its per-account, per-day credit totals. */
const STATISTICS_FILE = 'storages/cost-meter/workbuddy-statistics.json'
/** cost-meter's priced token ledger: `days[day].byProviderModel['<provider>:<model>']`. */
const TOKEN_LEDGER_FILE = 'storages/cost-meter/ledger.json'
/** The pack's own token ledger, the second pricing source. */
const PACK_LEDGER_FILE = join('channel-pack', 'token-ledger.json')
/**
 * The day-start balance of every pooled account.
 *
 * A file of our own rather than a cost-meter artefact: the sampler has no notion of "the
 * balance at midnight", so nothing else on this machine can answer the question the
 * masked-drop case needs answered.
 */
const BASELINE_FILE = 'storages/cost-meter/workbuddy-day-baseline.json'
/**
 * Which pack-ledger rows belong to the pool.
 *
 * The pack stamps every row with a `mode` and a `channel`, and only one pair is pool
 * traffic: `direct` is this plugin serving the DSH conversation, `gateway` is another
 * device borrowing the relay. The channel matters just as much — TRAE, CodeArts, Qoder and
 * Cline ride the same `direct` mode against their OWN quota, so matching the mode alone
 * would bill their tokens to the pool balance.
 */
const POOL_MODE = 'direct'
/**
 * The two provider routes whose traffic spends pooled credits.
 *
 * Imported from `adapter.ts` rather than spelled out again: these ids are the prefix
 * cost-meter writes into `byProviderModel`, so a rename there must break this file at
 * compile time instead of silently pricing nothing.
 */
const POOL_LANES: ReadonlySet<string> = new Set([XDPOOL_PROVIDER, XDPOOL_GLOBAL_PROVIDER])

/** One account as the sampler observed it. */
interface ObservedAccount {
  /** Account key as cost-meter names it, e.g. `cn:xdpool:9095c709fd1d2c5d`. */
  readonly id: string
  /** Credits the sampler BOOKED for the day. 0 when it booked nothing (yet). */
  readonly credits: number
  /** Balance at the last sample, when the row carries one. */
  readonly balance: number | undefined
  /** Whether the sampler BOOKED a figure, as opposed to a balance we merely watched. */
  readonly booked: boolean
}

/** What a priced fallback found, when it found anything. */
interface PricedDay {
  total: number
  source: 'cost-meter-ledger' | 'pack-ledger'
}

/**
 * The day key cost-meter writes: the LOCAL calendar day, zero-padded.
 *
 * Local, not UTC, because the figure is meant to answer "how much have I used since
 * midnight here" — a UTC key would roll over at the wrong hour for most of the world and
 * silently show the previous day's total.
 */
function dayKeyLocal(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(date.getFullYear())}-${month}-${day}`
}

/** A finite, non-negative number, or 0 — the answer every unreadable field degrades to. */
function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** A finite, non-negative number, or undefined — for fields whose ABSENCE is meaningful. */
function maybeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * Every account the sampler saw today, with whatever it managed to book.
 *
 * An account counts as soon as it carries a BALANCE, not only when a day node exists: the
 * balance is what the day-start comparison runs against, and a missing day node simply
 * means "nothing booked yet".
 */
async function readObserved(home: string, day: string): Promise<readonly ObservedAccount[]> {
  let text: string
  try {
    text = await readFile(join(home, STATISTICS_FILE), 'utf8')
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (parsed === null || typeof parsed !== 'object') return []
  const accounts = (parsed as { accounts?: unknown }).accounts
  if (accounts === null || typeof accounts !== 'object') return []
  const seen: ObservedAccount[] = []
  for (const [id, row] of Object.entries(accounts as Record<string, unknown>)) {
    if (row === null || typeof row !== 'object') continue
    const days = (row as { days?: unknown }).days
    const booked = days !== null && typeof days === 'object'
      ? maybeNumber((days as Record<string, unknown>)[day])
      : undefined
    const balance = maybeNumber((row as { remaining?: unknown }).remaining)
    if (booked === undefined && balance === undefined) continue
    seen.push({ id, credits: booked ?? 0, balance, booked: booked !== undefined })
  }
  return seen
}

/**
 * Price the day's recorded token counts with the pool's own rate table.
 *
 * The last resort, and the honest answer to "the sampler booked nothing, but tokens were
 * certainly spent". Two sources, best first: cost-meter's ledger covers every provider
 * on the machine and is current; the pack's ledger would be authoritative on a pack that
 * still writes it. Both are priced with the same three coefficients, so the two lines can
 * be compared — the failure this fixes was pricing only ONE of the two pool lanes here
 * while the measured branch summed both, so the day's two numbers disagreed in a way
 * nothing on the card explained.
 *
 * `output` is used as recorded, without adding `reasoning`: on this machine's ledger the
 * output figure already moved by more than the reasoning figure, and the four pricing
 * variants tried against five measured days (recorded / +reasoning / fresh-input /
 * fresh+reasoning) all landed between 0.34x and 0.51x of what the balances actually lost.
 * No variant closes that gap, which is why this figure is a FALLBACK that is labelled
 * `priced` and never replaces a measured drop.
 */
async function readPricedToday(home: string, day: string): Promise<PricedDay | undefined> {
  const dayNodeOf = async (file: string): Promise<Record<string, unknown> | undefined> => {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch {
      return undefined
    }
    try {
      const parsed = JSON.parse(text) as { days?: unknown }
      const days = parsed.days
      if (days === null || typeof days !== 'object') return undefined
      const node = (days as Record<string, unknown>)[day]
      return node !== null && typeof node === 'object' ? node as Record<string, unknown> : undefined
    } catch {
      return undefined
    }
  }

  const costMeter = await dayNodeOf(join(home, TOKEN_LEDGER_FILE))
  const byProviderModel = costMeter?.['byProviderModel']
  if (byProviderModel !== null && typeof byProviderModel === 'object') {
    let total = 0
    let priced = 0
    for (const [key, stats] of Object.entries(byProviderModel as Record<string, unknown>)) {
      if (stats === null || typeof stats !== 'object') continue
      const cut = key.indexOf(':')
      if (cut <= 0) continue
      if (!POOL_LANES.has(key.slice(0, cut))) continue
      const row = stats as { input?: unknown; cacheRead?: unknown; output?: unknown }
      const credits = creditsOf(numberOf(row.input), numberOf(row.cacheRead), numberOf(row.output), ratesFor(key.slice(cut + 1)))
      if (credits === undefined) continue
      total += credits
      priced += 1
    }
    if (priced > 0) return { total: Math.round(total * 100) / 100, source: 'cost-meter-ledger' }
  }

  const pack = await dayNodeOf(join(home, PACK_LEDGER_FILE))
  if (pack !== undefined) {
    let total = 0
    let priced = 0
    for (const [key, stats] of Object.entries(pack)) {
      if (stats === null || typeof stats !== 'object') continue
      // `mode|channel|account|model` — four parts, and only the pool's own pair bills here.
      const parts = key.split('|')
      if (parts.length < 4) continue
      const mode = (parts[0] ?? '').trim()
      const channel = (parts[1] ?? '').trim()
      const model = (parts[3] ?? '').trim()
      if (mode !== POOL_MODE || !POOL_OWNED_CHANNELS.has(channel) || model === '') continue
      const row = stats as { inputTokens?: unknown; cacheReadTokens?: unknown; outputTokens?: unknown }
      const credits = creditsOf(numberOf(row.inputTokens), numberOf(row.cacheReadTokens), numberOf(row.outputTokens), ratesFor(model))
      if (credits === undefined) continue
      total += credits
      priced += 1
    }
    if (priced > 0) return { total: Math.round(total * 100) / 100, source: 'pack-ledger' }
  }
  return undefined
}

/**
 * The balance each pooled account STARTED this local day with.
 *
 * Seeded from the first sample of the day and then carried, so `start - now` covers the
 * whole day no matter how many samples were missed. An account first seen midway is
 * seeded with the last observed balance — that under-reports whatever it spent earlier
 * (there is nothing to compare against) but keeps every later drop countable and never
 * invents a drop from an unknown starting point.
 *
 * The file is scoped to ONE day and its day key is checked on every read, so yesterday's
 * opening balance can never be compared against today's balance. It is never moved
 * BACKWARDS in time either: a query for a past day may read, but must not overwrite the
 * day the panel is actually showing.
 */
async function readDayBaseline(
  home: string,
  day: string,
  observed: readonly ObservedAccount[],
  now: Date,
): Promise<ReadonlyMap<string, number>> {
  const file = join(home, BASELINE_FILE)
  const known = new Map<string, number>()
  let stored: unknown
  try {
    stored = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    stored = undefined
  }
  let storedDay = ''
  if (stored !== null && typeof stored === 'object') {
    const record = stored as { version?: unknown; day?: unknown; accounts?: unknown }
    if (record.version === 1 && typeof record.day === 'string') {
      storedDay = record.day
      if (record.day === day && record.accounts !== null && typeof record.accounts === 'object') {
        for (const [id, value] of Object.entries(record.accounts as Record<string, unknown>)) {
          const balance = maybeNumber(value)
          if (balance !== undefined) known.set(id, balance)
        }
      }
    }
  }
  let changed = storedDay !== day
  for (const row of observed) {
    if (row.balance === undefined || known.has(row.id)) continue
    known.set(row.id, row.balance)
    changed = true
  }
  // `YYYY-MM-DD` sorts lexicographically, so this is a plain "not older than" test.
  if (changed && day >= storedDay) {
    try {
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, JSON.stringify({
        version: 1,
        day,
        at: now.getTime(),
        accounts: Object.fromEntries(known),
      }), 'utf8')
    } catch {
      // A baseline that cannot be cached only costs accuracy on the NEXT read; the day's
      // figure below is computed either way, so this is not worth failing the route over.
    }
  }
  return known
}

/**
 * Sum every account's recorded spend for `now`'s local day.
 *
 * `accounts` counts the rows that CARRIED a figure for the day, which is the only
 * evidence that anything was observed — a file full of accounts with no entry for today
 * means nothing sampled the day, and that must come back as `available: false` rather
 * than as a zero.
 *
 * A missing or malformed file is not an error: it is the same "no data" answer, because
 * an unreadable observer must not be reported as "you spent nothing".
 *
 * @param home DSH home directory, e.g. `~/.dsh`.
 * @param now  Clock to read the day from; injectable so a test can pin it.
 * @returns The day's total, or `available: false` when nothing recorded it.
 */
export async function readCreditsToday(home: string, now: Date = new Date()): Promise<PoolWebCreditsToday> {
  const day = dayKeyLocal(now)
  /**
   * The window is spelled out rather than implied.
   *
   * `dayKeyLocal` names the day but never says where it starts, so a number labelled
   * "today" could be read as a rolling 24h window. Returning `[00:00, 24:00)` in local
   * time makes "resets at 0:00" checkable from the outside instead of merely asserted.
   */
  const window = {
    from: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime(),
    to: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).getTime(),
    zone: 'local' as const,
  }
  const observed = await readObserved(home, day)
  if (observed.length > 0) {
    const baseline = await readDayBaseline(home, day, observed, now)
    /** Rows that carried a figure: a booked drop, or a fall we could measure. */
    let contributed = 0
    /**
     * Booked drops first, day-start balance second, and never both.
     *
     * For one account the two numbers describe the same spend, so the LARGER one wins:
     * `credits` is what a sample watched leave the account, `start - balance` is
     * everything that left it since local midnight. A refill makes the second negative and
     * is clamped to zero, so a top-up can never masquerade as negative spend — it just
     * stops counting.
     */
    let total = 0
    let recovered = 0
    let recoveredAccounts = 0
    for (const row of observed) {
      const start = baseline.get(row.id)
      const drop = start === undefined || row.balance === undefined ? 0 : Math.max(0, start - row.balance)
      if (drop > row.credits) {
        total += drop
        recovered += drop - row.credits
        recoveredAccounts += 1
        contributed += 1
      } else {
        total += row.credits
        if (row.booked) contributed += 1
      }
    }
    const measured = Math.round(total * 100) / 100
    if (measured > 0) {
      return recovered > 0
        ? {
          day,
          window,
          total: measured,
          accounts: contributed,
          source: 'balance-baseline',
          recovered: Math.round(recovered * 100) / 100,
          recoveredAccounts,
          available: true,
        }
        : { day, window, total: measured, accounts: contributed, source: 'cost-meter', available: true }
    }
    /**
     * A measured ZERO is not an answer.
     *
     * The sampler books a day only when it OBSERVES a drop, so a day node that reads 0 can
     * mean either "nothing was spent" or "nothing was witnessed yet". Pricing the same day
     * from recorded token counts tells the two apart; when it also finds nothing, the
     * measured zero stands and the answer stays honest.
     */
    const priced = await readPricedToday(home, day)
    if (priced !== undefined && priced.total > 0) {
      return { day, window, total: priced.total, accounts: contributed, source: priced.source, priced: true, available: true }
    }
    /**
     * A baseline that has only just been seeded has nothing to report.
     *
     * The account was watched, but nothing left it and nothing was booked, so the honest
     * answer is still "no record yet" -- not a measured zero, which the card would print as
     * a plain 0 and which reads as "you spent nothing today" before the day has begun.
     */
    if (contributed === 0) return { day, window, accounts: 0, source: 'cost-meter', available: false }
    return { day, window, total: measured, accounts: contributed, source: 'cost-meter', available: true }
  }
  const priced = await readPricedToday(home, day)
  if (priced !== undefined && priced.total > 0) {
    return { day, window, total: priced.total, accounts: 0, source: priced.source, priced: true, available: true }
  }
  return { day, window, accounts: 0, source: 'cost-meter', available: false }
}
