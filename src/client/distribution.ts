/**
 * The five ways a lane can spread requests across its credentials.
 *
 * Shared by the pool card (which distributes over ACCOUNTS) and the aggregate
 * page (which distributes over API KEYS). One vocabulary, one set of labels: the
 * user learns "priority / round-robin / balanced / per conversation / expiring
 * first" once, and a card that spelled the same idea differently would make the
 * two lanes look unrelated when they are the same decision at different scales.
 *
 * @module dsh-xdpool/client/distribution
 */
import type { PoolDistribution } from '../status-paths.ts'

/** Display order: the default first, then the rest by how often they are wanted. */
export const DIST_OPTIONS = ['sticky', 'priority', 'balanced', 'round-robin', 'expiry'] as const

/** The translator shape both callers can satisfy. */
type Translate = ((key: never, params?: Record<string, unknown>) => string) | undefined

/** Localized name of one distribution mode. */
export function distLabel(option: PoolDistribution, t: Translate): string {
  const at = t as ((key: string) => string) | undefined
  if (option === 'sticky') return at?.('row.distSticky') ?? 'Per conversation'
  if (option === 'priority') return at?.('row.distPriority') ?? 'Priority'
  if (option === 'balanced') return at?.('row.distBalanced') ?? 'Balanced'
  if (option === 'expiry') return at?.('row.distExpiry') ?? 'Expiring first'
  return at?.('row.distRoundRobin') ?? 'Round-robin'
}

/** One-line explanation of what a mode does to caching and spend. */
export function distHint(option: PoolDistribution, t: Translate): string {
  const at = t as ((key: string) => string) | undefined
  if (option === 'sticky') return at?.('row.distStickyHint') ?? ''
  if (option === 'priority') return at?.('row.distPriorityHint') ?? ''
  if (option === 'balanced') return at?.('row.distBalancedHint') ?? ''
  if (option === 'expiry') return at?.('row.distExpiryHint') ?? ''
  return at?.('row.distRoundRobinHint') ?? ''
}
