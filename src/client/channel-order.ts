/**
 * Which order the scan-login rows are drawn in.
 *
 * WHY THIS IS NOT THE ROSTER ORDER
 *
 * The roster is a fixed list written for a catalogue — CodeArts first because it is
 * alphabetically convenient, not because anybody just signed into it. The channel page's
 * whole job is "add an account", so the row the user just added an account to is the one
 * they want to look at next; leaving it at position nine of fourteen makes them scroll
 * past eight channels they did not touch to confirm the thing they just did worked.
 *
 * So the page sorts by recency: a channel whose newest account is newer floats above one
 * whose newest account is older. Everything with no account at all stays in roster order
 * underneath, which keeps the page readable on a fresh install (there is no recency to
 * sort by, and shuffling an unconfigured list would just look random).
 *
 * WHY THIS MODULE IS SEPARATE FROM THE PAGE
 *
 * It is the only part of the page with a rule in it, and the page itself is JSX that this
 * process cannot mount. Keeping the arithmetic here is what lets a test assert the actual
 * comparison instead of a regex over the component.
 *
 * @module dsh-xdpool/client/channel-order
 */

/** The minimal shape of a channel row, so this module need not import the wire contract. */
export interface OrderableChannel {
  id: string
}

/** The minimal shape of a connected account, for {@link channelRecency}. */
export interface RecencyAccount {
  provider: string
  /**
   * When the pack created this row, in epoch milliseconds.
   *
   * Absent for anything but a real login: the pack synthesises a row for a credential it
   * finds on disk without a pool entry and stamps it `createdAt: 0`, and an unknown value
   * must not win a recency comparison it cannot support.
   */
  createdAt?: number | undefined
}

/**
 * Where this browser remembers "I added an account to channel X at time T".
 *
 * Versioned like the other two browser-side stores on this card, because the shape is
 * expected to change and a stale blob must never be fed to new code.
 */
const ADDED_AT_KEY = 'dsh-xdpool.channel-added-at.v1'

/**
 * The session stamps that outlive the session: one channel id → epoch ms.
 *
 * The pack's `createdAt` already answers this for the channels it owns, so this store is
 * not the primary source — it covers the two gaps that field cannot:
 *
 * - **Doubao.** Its lane belongs to this plugin, not the pack, so there is no account row
 *   and no `createdAt` anywhere on disk. Without a stamp it would drift back to its roster
 *   position — last — on every restart, one row after a login that had just put it first.
 * - **Immediately after a click.** `account.list` is re-read only when a login lands, and
 *   the pack writes its row seconds before that; the stamp is what makes the row move on
 *   the same paint as the "已添加" badge.
 *
 * Read defensively: a private-mode window, a full quota, or a hand-edited blob all mean
 * "nothing remembered", which is the same state as a fresh install.
 */
export function readChannelAddedAt(): Readonly<Record<string, number>> {
  try {
    const raw = globalThis.localStorage?.getItem(ADDED_AT_KEY)
    if (raw === null || raw === undefined) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, number> = {}
    for (const [channelId, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (channelId === '' || typeof at !== 'number' || !Number.isFinite(at) || at <= 0) continue
      out[channelId] = at
    }
    return out
  } catch {
    return {}
  }
}

/** Record one "added at" stamp, returning the new map. Failure is silent. */
export function rememberChannelAddedAt(
  previous: Readonly<Record<string, number>>,
  channelId: string,
  at: number,
): Readonly<Record<string, number>> {
  const next = { ...previous, [channelId]: at }
  try {
    globalThis.localStorage?.setItem(ADDED_AT_KEY, JSON.stringify(next))
  } catch {
    // The row still moves this session; it simply is not remembered past a restart.
  }
  return next
}

/**
 * The newest known timestamp per channel.
 *
 * Two sources, in that order: the accounts the pack reports (persists across restarts and
 * covers every channel it owns), then the stamps this browser session recorded when a
 * sign-in landed (covers the seconds before `account.list` catches up, and covers Doubao,
 * which has no pack account at all).
 *
 * A stamp of `0` — or any non-finite one — is dropped rather than stored. It would tie
 * with "never added", and a channel that sorts at the bottom anyway is exactly what `0`
 * means.
 */
export function channelRecency(
  accounts: readonly RecencyAccount[],
  sessionStamps: Readonly<Record<string, number | undefined>>,
): ReadonlyMap<string, number> {
  const newest = new Map<string, number>()
  const offer = (channelId: string, at: number | undefined): void => {
    if (at === undefined || !Number.isFinite(at) || at <= 0) return
    const current = newest.get(channelId)
    if (current === undefined || at > current) newest.set(channelId, at)
  }
  for (const account of accounts) {
    if (account.provider === '') continue
    offer(account.provider, account.createdAt)
  }
  for (const [channelId, at] of Object.entries(sessionStamps)) offer(channelId, at ?? undefined)
  return newest
}

/**
 * Channels sorted newest-first, with everything un-stamped in its original order.
 *
 * The sort is explicit about its tie-break rather than trusting `Array#sort`'s stability:
 * two channels can share a timestamp (a pack write rounds to the millisecond, and a
 * restored backup can carry identical stamps), and the fallback has to be "the roster's
 * own order" or the page shuffles between two renders that changed nothing.
 */
export function orderChannelsByRecency<T extends OrderableChannel>(
  channels: readonly T[],
  recency: ReadonlyMap<string, number>,
): readonly T[] {
  return channels
    .map((channel, index) => ({ channel, index, at: recency.get(channel.id) ?? 0 }))
    .sort((a, b) => (b.at - a.at) || (a.index - b.index))
    .map((entry) => entry.channel)
}
