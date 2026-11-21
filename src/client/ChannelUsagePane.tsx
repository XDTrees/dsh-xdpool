/**
 * 「账号使用方式」 for one channel.
 *
 * WHY EACH CHANNEL GETS ITS OWN
 *
 * The pool-wide setting covers the two WorkBuddy lanes, where every account is one vendor's and
 * one strategy suits them all. A channel with two or three accounts of its own is a different
 * decision: draining one CodeArts account before the other is not the same choice as draining one
 * WorkBuddy account, and until now there was no way to say so.
 *
 * WHAT IT ACTUALLY CHANGES
 *
 * The plugin hands the chosen strategy to the pack, whose `getAvailableAccount` walks its account
 * list in order. `priority` keeps the stored order (what the drag handles write), `round-robin`
 * rotates the start, `balanced` shuffles, `expiry` spends the soonest-expiring credential first,
 * and `sticky` starts every new conversation from the same account. A channel with one account is
 * unaffected by any of them, so the pane says so rather than offering a choice that cannot matter.
 *
 * @module dsh-xdpool/client/ChannelUsagePane
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { POOL_CHANNEL_USAGE_PATH } from '../status-paths.ts'
import { DIST_OPTIONS, distHint, distLabel } from './distribution.ts'
import type { PoolDistribution } from '../status-paths.ts'
import type { XdPoolSettingsKey } from './locales.ts'

type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string

/** What the route reports. */
interface UsageState {
  pool?: string
  channels?: Record<string, string>
}

/** The strategy this channel uses, and whether it is its own choice. */
function strategyOf(state: UsageState | undefined, channel: string): { effective: PoolDistribution; own: boolean } {
  const own = state?.channels?.[channel]
  if (own !== undefined) return { effective: own as PoolDistribution, own: true }
  return { effective: (state?.pool ?? 'priority') as PoolDistribution, own: false }
}

export function ChannelUsagePane(input: {
  channel: string
  /** How many accounts the channel has; with one, the choice cannot change anything. */
  accountCount: number
  t?: Translate | undefined
}): ReactElement {
  const { channel, accountCount, t } = input
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<UsageState | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    // Set on MOUNT: a ref only cleared on unmount stays false across a React StrictMode remount,
    // and every guard below would then return before touching state.
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(POOL_CHANNEL_USAGE_PATH, { credentials: 'same-origin' })
      const body = await response.json().catch(() => undefined) as UsageState | undefined
      if (mounted.current && body !== undefined) setState(body)
    } catch {
      // The pane keeps its last known value; the next open retries.
    }
  }, [])

  useEffect(() => { void load() }, [load])

  /** Write one strategy. An empty string clears the override. */
  const choose = useCallback(async (next: string): Promise<void> => {
    setBusy(true)
    try {
      const response = await fetch(POOL_CHANNEL_USAGE_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel, strategy: next }),
      })
      const body = await response.json().catch(() => undefined) as UsageState | undefined
      if (mounted.current && body !== undefined) setState(body)
    } catch {
      // Left as it was; a failed write must not look like a successful one.
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [channel])

  const { effective, own } = strategyOf(state, channel)
  const single = accountCount <= 1
  /**
   * The trigger and the pane are SIBLINGS, not nested.
   *
   * Nesting put the pane inside the trigger's own narrow column, so opening it pushed only that
   * column down — the card grew a lopsided bulge instead of the panel appearing across the full
   * width beneath the button row. The trigger carries the open state; the pane is a block of its
   * own in the card's flow.
   */
  return (
    <>
      <button
        type="button"
        className="field"
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <span className="strip-caret" aria-hidden="true">▸</span>
        <span>{t?.('row.distTitle') ?? '账号使用方式'}</span>
        <span className="td-num">
          {distLabel(effective, t as never)}
          {own ? '' : `（${t?.('usage.inherited') ?? '跟随全局'}）`}
        </span>
      </button>
      <div className="card" hidden={!open}>
        {single ? (
          <p className="hint">
            {t?.('usage.single') ?? '这个渠道只有一个账号，使用方式不影响选号。'}
          </p>
        ) : null}
        <div className="row">
          {DIST_OPTIONS.map(option => (
            <button
              key={option}
              type="button"
              className="btn"
              data-tone={effective === option ? 'primary' : undefined}
              aria-pressed={effective === option}
              disabled={busy}
              title={distHint(option, t as never)}
              onClick={() => { void choose(option) }}
            >
              {distLabel(option, t as never)}
            </button>
          ))}
        </div>
        <p className="hint">{distHint(effective, t as never)}</p>
        {own ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => { void choose('') }}
          >
            {t?.('usage.followPool') ?? '改回跟随全局'}
          </button>
        ) : null}
      </div>
    </>
  )
}
