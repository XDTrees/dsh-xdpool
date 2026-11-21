/**
 * Turning the pool's entries into a rail, and the rail back into one entry.
 *
 * WHY THIS IS A SEPARATE, PURE MODULE
 *
 * The rail needs three facts per channel — is it bound, how many accounts, is anything about to
 * expire — and each of those is already computed for other reasons. Deriving them in the
 * component would mean the order rule (bound first) lives next to JSX, where it cannot be tested
 * and cannot be reused by the mobile strip; deriving them here makes the ordering a fact with a
 * test rather than a detail of how the markup happens to be written.
 *
 * @module dsh-xdpool/client/pool-rail
 */
import type { ChannelAccount } from '../channels.ts'
import type { ChannelBalance } from './channel-rpc.ts'
import type { RailEntry } from './AccountPoolShell.tsx'
import { expiringCredits } from './expiring-credits.ts'

/** The minimum a channel needs to appear in the rail. */
export interface RailSource {
  id: string
  name: string
  icon?: string | undefined
  accounts: readonly ChannelAccount[]
  balances: readonly ChannelBalance[]
}

/** Two characters for the fallback tile, taken from the name. */
export function railInitials(name: string): string {
  const latin = name.replace(/[^\p{Script=Latin}\p{N}]/gu, ' ').trim()
  const source = latin === '' ? name : latin
  const words = source.split(/\s+/u).filter(word => word !== '')
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase()
  }
  const only = words[0] ?? source
  return only.slice(0, 2).toUpperCase()
}

/**
 * Build the rail, bound channels first.
 *
 * The ORDER is the feature: a user opening this wants their working channels at the top, and every
 * caller that repeated the rule would eventually drift from it. Within each group the roster's
 * own order is kept, so a channel does not move because its balance happened to load.
 */
export function railEntries(input: {
  channels: readonly RailSource[]
  now: number
}): readonly RailEntry[] {
  const expiringByChannel = new Map<string, number>()
  for (const credit of expiringCredits({
    channels: input.channels.map(channel => ({
      id: channel.id,
      name: channel.name,
      balances: channel.balances,
    })),
    now: input.now,
  })) {
    expiringByChannel.set(credit.channelId, (expiringByChannel.get(credit.channelId) ?? 0) + 1)
  }

  const rows = input.channels.map((channel): RailEntry => {
    const accountCount = channel.accounts.length
    const hasBalanceError = channel.balances.some(balance => balance.error !== undefined)
    return {
      id: channel.id,
      name: channel.name,
      ...(channel.icon === undefined ? {} : { icon: channel.icon }),
      initials: railInitials(channel.name),
      accountCount,
      bound: accountCount > 0,
      /**
       * An error outranks an expiry.
       *
       * A broken account needs attention now; credits expiring next week do not. One dot, so the
       * worse of the two is what the rail shows.
       */
      attention: hasBalanceError
        ? 'error'
        : (expiringByChannel.get(channel.id) ?? 0) > 0
          ? 'expiring'
          : undefined,
    }
  })

  /** `sort` is stable, so the roster's order survives inside each group. */
  return [...rows].sort((a, b) => Number(b.bound) - Number(a.bound))
}

/**
 * Which channel the detail should show.
 *
 * Falls back to the first BOUND channel rather than the first row: landing on an unbound channel
 * would open with an empty panel and a login button, which is not what "open the pool" means when
 * there is anything signed in.
 */
export function activeRailId(
  entries: readonly RailEntry[],
  requested: string | undefined,
): string | undefined {
  if (requested !== undefined && entries.some(entry => entry.id === requested)) return requested
  const bound = entries.find(entry => entry.bound)
  return bound?.id ?? entries[0]?.id
}
