/**
 * Per-channel usage order.
 *
 * WHY A FILE OF ITS OWN
 *
 * The pool-wide `distribution` setting covers the two WorkBuddy lanes, where every account is
 * one vendor's and one strategy suits them all. A channel with two or three accounts of its own
 * is a different decision — draining one CodeArts account first is not the same choice as
 * draining one WorkBuddy account first — so each channel needs its own answer.
 *
 * The host's settings document is not available for it: a plugin's write path there accepts
 * only the section's own `{auto}` toggle, and the settings UI would fight a second writer. This
 * plugin already keeps `accounts.json` beside its other state, so the overrides go there.
 *
 * ABSENT MEANS "FOLLOW THE POOL"
 *
 * A channel with no entry uses the pool-wide strategy. That is why clearing an override deletes
 * the key instead of storing the pool's current value: a stored copy would freeze, and a later
 * change to the pool default would silently not reach that channel.
 *
 * @module dsh-xdpool/channel-usage
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pluginDataDir } from './ignored.ts'

/** The five strategies, in the order the UI offers them. */
export const USAGE_STRATEGIES = ['priority', 'round-robin', 'balanced', 'sticky', 'expiry'] as const

/** One of the five. */
export type UsageStrategy = (typeof USAGE_STRATEGIES)[number]

/** Whether a value is a strategy this build understands. */
export function isUsageStrategy(value: unknown): value is UsageStrategy {
  return typeof value === 'string' && (USAGE_STRATEGIES as readonly string[]).includes(value)
}

/** The file the overrides live in. */
const FILE = 'channel-usage.json'

/** Absolute path of the override file. */
function usagePath(): string {
  return join(pluginDataDir(), FILE)
}

/**
 * The stored overrides.
 *
 * Read on every call rather than cached: the file is small, the route is not hot, and a cache
 * would need invalidating from the write path for no gain. A malformed file answers with an
 * empty map — "every channel follows the pool" is a state the caller already handles.
 */
export function readChannelUsage(): Readonly<Record<string, UsageStrategy>> {
  try {
    // Synchronous on purpose: this runs inside a JSON response builder, and an async read there
    // would make the route's shape depend on I/O that cannot fail usefully.
    const text = readFileSync(usagePath(), 'utf8')
    const parsed = JSON.parse(text) as unknown
    if (parsed === null || typeof parsed !== 'object') return {}
    const out: Record<string, UsageStrategy> = {}
    for (const [channel, strategy] of Object.entries(parsed as Record<string, unknown>)) {
      if (isUsageStrategy(strategy)) out[channel] = strategy
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Hand the stored strategies to the pack.
 *
 * The pack reads them from the environment on each call, so this is the bridge between the file
 * the pane writes and the selection it affects. Called at mount and after every write — a value
 * that only took effect on restart would make the pane look broken.
 */
export function publishChannelUsage(): void {
  const overrides = readChannelUsage()
  if (Object.keys(overrides).length === 0) {
    delete process.env['DSH_XDPOOL_CHANNEL_USAGE']
    return
  }
  process.env['DSH_XDPOOL_CHANNEL_USAGE'] = JSON.stringify(overrides)
}

/**
 * Set one channel's strategy, or clear it.
 *
 * `undefined` removes the key, so the channel goes back to following the pool default. Writing
 * is atomic: a half-written file would be read back as "no overrides at all", silently resetting
 * every channel the user had configured.
 */
export function writeChannelUsage(channel: string, strategy: UsageStrategy | undefined): void {
  const current = { ...readChannelUsage() }
  if (strategy === undefined) delete current[channel]
  else current[channel] = strategy
  try {
    const target = usagePath()
    mkdirSync(dirname(target), { recursive: true })
    const temporary = `${target}.tmp`
    writeFileSync(temporary, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
    renameSync(temporary, target)
    // The pack reads the environment, so the file is not enough on its own.
    publishChannelUsage()
  } catch {
    // A read-only state directory leaves the previous answer in place, which is worse than the
    // user's edit but better than losing the others.
  }
}
