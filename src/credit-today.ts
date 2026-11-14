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
 * WHY IT READS A FILE
 *
 * cost-meter registers no HTTP route of its own (`webServer` never appears in its
 * package), so the host half cannot ask it anything. The statistics file is its
 * documented output and is read here directly — no round trip, and it works while the
 * other plugin is still mounting.
 *
 * The file belongs to another repository, so its shape is treated as EXTERNAL and every
 * level is validated: an unexpected shape must degrade to "no data", never to a wrong
 * number. Nothing about the arithmetic is assumed beyond the documented
 * `{ accounts: { '<region>:<origin>:<id>': { days: { 'YYYY-MM-DD': credits } } } }`.
 *
 * @module dsh-xdpool/credit-today
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PoolWebCreditsToday } from './status-paths.ts'

/** Where cost-meter keeps its per-account, per-day credit totals. */
const STATISTICS_FILE = 'storages/cost-meter/workbuddy-statistics.json'

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
  const empty: PoolWebCreditsToday = { day, accounts: 0, source: 'cost-meter', available: false }
  let text: string
  try {
    text = await readFile(join(home, STATISTICS_FILE), 'utf8')
  } catch {
    return empty
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return empty
  }
  if (parsed === null || typeof parsed !== 'object') return empty
  const accounts = (parsed as { accounts?: unknown }).accounts
  if (accounts === null || typeof accounts !== 'object') return empty

  let total = 0
  let seen = 0
  for (const row of Object.values(accounts as Record<string, unknown>)) {
    if (row === null || typeof row !== 'object') continue
    const days = (row as { days?: unknown }).days
    if (days === null || typeof days !== 'object') continue
    const credits = (days as Record<string, unknown>)[day]
    if (typeof credits !== 'number' || !Number.isFinite(credits) || credits < 0) continue
    total += credits
    seen += 1
  }
  if (seen === 0) return empty
  // Two decimals: cost-meter already stores them, and a hundredth of a credit is the
  // smallest unit the vendor's own counter moves in.
  return { day, total: Math.round(total * 100) / 100, accounts: seen, source: 'cost-meter', available: true }
}
