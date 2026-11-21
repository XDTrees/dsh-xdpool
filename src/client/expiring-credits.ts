/**
 * Which credits are about to expire, across every channel.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * Each card can say what its own account holds, but the question a reader actually has is
 * "what am I about to lose, and where" — and that answer is only visible when the channels are
 * looked at together. A card-by-card reading makes a 233-credit bundle expiring in six days
 * invisible whenever it is not the card you happen to be looking at.
 *
 * The shape mirrors what the pool already knows: a balance per account, packages within it. This
 * module turns that into one ordered list, and does it as a pure function so the ordering rules
 * are testable without a browser.
 *
 * @module dsh-xdpool/client/expiring-credits
 */
import type { ChannelBalance, ChannelCreditPackage } from './channel-rpc.ts'

/** One expiring bundle, with the account and channel it belongs to. */
export interface ExpiringCredit {
  channelId: string
  channelName: string
  accountId: string
  accountName?: string
  packageName: string
  /** Epoch milliseconds. */
  expiresAt: number
  /** How many days are left, rounded down — 0 means "today". */
  daysLeft: number
  /** Units left in this bundle, when the vendor reports a number. */
  amount?: number
  unit?: string
}

/** How soon counts as "expiring soon" for the summary line. */
export const SOON_DAYS = 7

/**
 * Turn every channel's balances into one ordered list of expiring bundles.
 *
 * Sorted by expiry, soonest first: the list exists to answer "what goes first", so anything else
 * would make the reader do the sorting themselves.
 *
 * A bundle with no `expiresAt` is skipped rather than guessed at. Treating an unknown expiry as
 * "never" would bury it; treating it as "now" would invent an emergency.
 */
export function expiringCredits(input: {
  channels: readonly { id: string; name: string; balances: readonly ChannelBalance[] }[]
  now: number
  /** Include bundles expiring within this many days; `undefined` means all of them. */
  withinDays?: number
}): readonly ExpiringCredit[] {
  const out: ExpiringCredit[] = []
  for (const channel of input.channels) {
    for (const balance of channel.balances) {
      for (const bundle of balance.packages ?? []) {
        const expiresAt = bundle.expiresAt
        if (expiresAt === undefined || !Number.isFinite(expiresAt)) continue
        // An already-expired bundle is not "expiring" — it is gone, and listing it would look
        // like something can still be rescued.
        if (expiresAt <= input.now) continue
        if (input.withinDays !== undefined) {
          const limit = input.now + input.withinDays * 86_400_000
          if (expiresAt > limit) continue
        }
        out.push({
          channelId: channel.id,
          channelName: channel.name,
          accountId: balance.accountId,
          ...(balance.nickname === undefined ? {} : { accountName: balance.nickname }),
          packageName: bundle.name,
          expiresAt,
          daysLeft: Math.max(0, Math.floor((expiresAt - input.now) / 86_400_000)),
          ...(bundle.amount === undefined ? {} : { amount: bundle.amount }),
          ...(bundle.unit === undefined ? {} : { unit: bundle.unit }),
        })
      }
    }
  }
  return out.sort((a, b) => a.expiresAt - b.expiresAt)
}

/** The total about to be lost, per unit, within `withinDays`. */
export function expiringTotals(
  credits: readonly ExpiringCredit[],
): Readonly<Record<string, number>> {
  const totals: Record<string, number> = {}
  for (const credit of credits) {
    if (credit.amount === undefined) continue
    const unit = credit.unit ?? '积分'
    totals[unit] = (totals[unit] ?? 0) + credit.amount
  }
  return totals
}

/** The summary line: what is going, and how soon. */
export function expiringSummary(credits: readonly ExpiringCredit[]): string | undefined {
  if (credits.length === 0) return undefined
  const soonest = credits[0]
  if (soonest === undefined) return undefined
  const totals = expiringTotals(credits)
  const parts = Object.entries(totals).map(([unit, amount]) => `${String(Math.round(amount))} ${unit}`)
  const head = parts.length === 0 ? `${String(credits.length)} 份额度` : parts.join(' + ')
  const when = soonest.daysLeft === 0
    ? '今天'
    : soonest.daysLeft === 1
      ? '明天'
      : `${String(soonest.daysLeft)} 天后`
  return `${head} 即将过期（最近一份${when}）`
}
