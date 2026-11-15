/**
 * The login-channel page: the thirteen vendors that sign you in with a browser
 * or a QR code, plus the four plumbing actions the vendored pack exposes for it.
 *
 * Split out of {@link ../client/PoolCard} for the same reason as
 * {@link ./AggregatePage}: it reads a different document and must not ride the
 * pool card's 30-second poll. There is a second reason too — its whole lifecycle
 * is push-driven. A login can take a minute of browser work, so this page owns
 * its own polling and stops it the moment the user leaves.
 *
 * @module dsh-xdpool/client/ChannelsPage
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  POOL_CHANNELS_PATH,
  ROUTE_OWNED_ELSEWHERE,
  type PoolWebChannel,
  type PoolWebChannelsStatus,
} from '../status-paths.ts'
import type { ChannelAccount, ChannelRpcEnvelope } from '../channels.ts'
import { accountsFrom, autoCheckinFrom, callPack, createdFrom, fetchChannels, pollFrom, providerStatusesFrom, type ChannelAutoCheckin } from './channel-rpc.ts'
import type { XdPoolSettingsKey } from './locales.ts'
import { CHANNEL_CARD_CSS } from './styles.ts'
import { BrandTile } from './brand-tile.tsx'
import { channelIcon, channelInitials } from './channel-icons.ts'
import { PageHero } from './shell.tsx'
type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string
export interface ChannelsPageProps {
  t?: Translate | undefined
}
/** How often a login in flight is checked, in milliseconds. */
const POLL_INTERVAL_MS = 2_000
/**
 * How long to keep checking before giving up.
 *
 * A scan-and-confirm login is normally seconds; ten minutes covers a phone
 * delay, a wrong first account and a re-read of the terms. Beyond that the user
 * has almost certainly walked away, and polling forever would hold a pending
 * account open for a session nobody is watching.
 */
const POLL_TIMEOUT_MS = 10 * 60_000
/** Per-channel UI phase. `signing-in` carries the pending login while it waits. */
type ChannelPhase = 'idle' | 'signing-in' | 'done' | 'failed'
interface ChannelUiState {
  phase: ChannelPhase
  /** The pack's account id while a login is in flight. */
  accountId?: string | undefined
  /** Where to send the user, once the pack has minted a login page. */
  loginUrl?: string | undefined
  /** A line to print under the row. */
  message?: string | undefined
}
const IDLE: ChannelUiState = { phase: 'idle' }

/**
 * How many distinct people a channel holds.
 *
 * `account.create` in the pack appends unconditionally — it never checks whether
 * an account with the same nickname is already there — so a user who clicks
 * "add account" twice on a channel that reuses one identity ends up with two
 * rows that are the same account. The pack prunes the duplicate on disk at its
 * next mount, but this badge is a live read, so it has to do the collapsing
 * itself or the number is simply wrong.
 *
 * The newest entry wins, because the pack rewrites a placeholder's nickname
 * from its generated id to the real display name only when a login lands: the
 * row that carries the real name is the row whose credential was written last.
 */
function distinctAccounts(accounts: readonly ChannelAccount[]): readonly ChannelAccount[] {
  const byKey = new Map<string, ChannelAccount>()
  const order: string[] = []
  for (const account of accounts) {
    const nickname = (account.nickname ?? '').trim()
    const key = nickname === '' ? `id:${account.id}` : `n:${nickname}`
    if (!byKey.has(key)) order.push(key)
    byKey.set(key, account)
  }
  return order.map(key => byKey.get(key)).filter((account): account is ChannelAccount => account !== undefined)
}
export function ChannelsPage({ t }: ChannelsPageProps) {
  const [status, setStatus] = useState<PoolWebChannelsStatus | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [ui, setUi] = useState<Record<string, ChannelUiState>>({})
  const [connected, setConnected] = useState<readonly ChannelAccount[]>([])
  const mounted = useRef(true)
  /** Timers for in-flight logins, keyed by channel id. */
  const timers = useRef(new Map<string, number>())
  useEffect(() => {
    // Set on MOUNT, not only cleared on unmount: a ref keeps its value across a re-mount of
    // the same component in React's StrictMode, so a flag that is only cleared stays false
    // forever after the first unmount — and every `if (!mounted.current) return` below then
    // returns before touching state, leaving the page stale for a reason no log explains.
    mounted.current = true
    return () => {
      mounted.current = false
      for (const handle of timers.current.values()) window.clearInterval(handle)
      timers.current.clear()
    }
  }, [])
  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const response = await fetch(POOL_CHANNELS_PATH, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        ...signal === undefined ? {} : { signal },
      })
      const value: unknown = await response.json().catch(() => undefined)
      if (!response.ok) {
        const detail = value as { error?: string } | undefined
        if (mounted.current) setError(detail?.error ?? `HTTP ${response.status}`)
        return
      }
      if (mounted.current && signal?.aborted !== true) {
        setStatus(value as PoolWebChannelsStatus)
        setError(undefined)
      }
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])
  /**
   * Re-read which channels are connected.
   *
   * A failure is swallowed on purpose: this is a decoration on top of the login
   * list, and turning its failure into a panel-wide error would blank the page
   * for something the user did not ask about. The connected badges are the
   * first thing to go and the last to be missed.
   */
  const loadConnected = useCallback(async (): Promise<void> => {
    // `account.list` filters by provider on its very first line
    // (pool.listAccounts), so an empty payload matches no account at all and
    // answers "nothing is connected" for a channel that holds several — the
    // "added N accounts" badge then disappears the moment the page reloads.
    // `provider.status` counts every channel in one answer; the accounts
    // themselves only need fetching for the channels it reports as connected.
    const roster = await fetchChannels()
    const statuses = providerStatusesFrom(await callPack('provider.status', {
      providers: roster.map(channel => channel.id),
    }))
    const connectedIds = roster
      .map(channel => channel.id)
      .filter(id => (statuses.get(id)?.accountsTotal ?? 0) > 0)
    const perChannel = await Promise.all(connectedIds.map(id => callPack('account.list', { provider: id })))
    if (!mounted.current) return
    setConnected(perChannel.flatMap(accountsFrom))
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    void loadConnected().catch(() => {})
    return () => { controller.abort() }
  }, [load, loadConnected])
  const connectedFor = useCallback(
    (channel: PoolWebChannel): readonly ChannelAccount[] =>
      distinctAccounts(
        connected.filter((account) => account.provider === channel.id && account.enabled !== false),
      ),
    [connected],
  )
  const stopPolling = useCallback((channelId: string): void => {
    const handle = timers.current.get(channelId)
    if (handle !== undefined) window.clearInterval(handle)
    timers.current.delete(channelId)
  }, [])
  /**
   * Watch one login until it lands, gives up, or times out.
   *
   * The interval is scheduled inside a single function and re-arms itself, so
   * one slow response can never produce two collectors for the same account —
   * which would show the same channel twice and could claim its completion
   * twice.
   */
  const watch = useCallback(
    (channel: PoolWebChannel, accountId: string, startedAt: number): void => {
      stopPolling(channel.id)
      const tick = async (): Promise<void> => {
        if (!mounted.current) return stopPolling(channel.id)
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          stopPolling(channel.id)
          setUi(prev => ({
            ...prev,
            [channel.id]: { phase: 'failed', accountId, message: t?.('chan.failed') ?? 'Sign-in failed' },
          }))
          return
        }
        let envelope: ChannelRpcEnvelope
        try {
          envelope = await callPack('login.poll', { provider: channel.id, accountId })
        } catch (cause: unknown) {
          // A single unreachable poll is not a failed login: keep watching.
          void cause
          return
        }
        if (!mounted.current) return
        if (!envelope.ok) return
        const answer = pollFrom(envelope)
        if (!answer.done) return
        stopPolling(channel.id)
        if (answer.success === false) {
          setUi(prev => ({
            ...prev,
            [channel.id]: { phase: 'failed', accountId, message: answer.error ?? t?.('chan.failed') ?? 'Sign-in failed' },
          }))
          return
        }
        setUi(prev => ({ ...prev, [channel.id]: { phase: 'done', accountId } }))
        void loadConnected().catch(() => {})
      }
      timers.current.set(channel.id, window.setInterval(() => { void tick() }, POLL_INTERVAL_MS))
    },
    [loadConnected, stopPolling, t],
  )
  const signIn = useCallback(
    async (channel: PoolWebChannel): Promise<void> => {
      setUi(prev => ({ ...prev, [channel.id]: { phase: 'signing-in' } }))
      let envelope: ChannelRpcEnvelope
      try {
        envelope = await callPack('account.create', { provider: channel.id })
      } catch (cause: unknown) {
        if (!mounted.current) return
        const message = cause instanceof Error ? cause.message : String(cause)
        setUi(prev => ({ ...prev, [channel.id]: { phase: 'failed', message } }))
        return
      }
      if (!mounted.current) return
      if (!envelope.ok) {
        setUi(prev => ({
          ...prev,
          [channel.id]: {
            phase: 'failed',
            message: envelope.error?.message ?? t?.('chan.failed') ?? 'Sign-in failed',
          },
        }))
        return
      }
      const created = createdFrom(envelope)
      if (created === undefined) {
        setUi(prev => ({
          ...prev,
          [channel.id]: { phase: 'failed', message: t?.('chan.failed') ?? 'Sign-in failed' },
        }))
        return
      }
      // Open the login page in a new tab rather than this one: the pack's flow
      // ends back on the host origin, and navigating the settings panel away
      // mid-login would leave the user with no way back to the poll.
      window.open(created.loginUrl, '_blank', 'noopener')
      setUi(prev => ({
        ...prev,
        [channel.id]: {
          phase: 'signing-in',
          accountId: created.accountId,
          loginUrl: created.loginUrl,
          message: t?.('chan.waiting'),
        },
      }))
      watch(channel, created.accountId, Date.now())
    },
    [t, watch],
  )
  const cancel = useCallback((channelId: string): void => {
    stopPolling(channelId)
    setUi(prev => ({ ...prev, [channelId]: IDLE }))
  }, [stopPolling])
  /**
   * Channels with at least one account, not accounts in total.
   *
   * The hero pill counts connections — "six channels are hooked up" is the
   * question that pill has always answered, and a second pill counting accounts
   * would compete with the per-channel badges that already do it.
   */
  const connectedCount = useMemo(
    () => new Set(connected.map((account) => account.provider)).size,
    [connected],
  )
  /**
   * One switch for every channel, because that is the only granularity the pack
   * offers: its auto check-in run targets each provider that holds an account
   * and claims through one path, with no per-provider switch to set. Drawing
   * thirteen toggles that all drove the same boolean would be thirteen ways to
   * be wrong; the state is read back from the pack rather than assumed, so the
   * switch shows what the last run will actually do.
   */
  const [autoCheckin, setAutoCheckin] = useState<ChannelAutoCheckin | undefined>(undefined)
  const [autoBusy, setAutoBusy] = useState(false)
  const loadAutoCheckin = useCallback(async (): Promise<void> => {
    try {
      const envelope = await callPack('usage.autoCheckin', {})
      if (!mounted.current) return
      setAutoCheckin(autoCheckinFrom(envelope))
    } catch {
      // The switch is a convenience; the pack not answering it is not a page
      // failure, so it simply stays absent.
    }
  }, [])
  useEffect(() => { void loadAutoCheckin() }, [loadAutoCheckin])
  const toggleAutoCheckin = useCallback(async (): Promise<void> => {
    const next = autoCheckin?.enabled === true ? false : true
    setAutoBusy(true)
    try {
      const envelope = await callPack('usage.autoCheckin', { enabled: next })
      if (!mounted.current) return
      setAutoCheckin(autoCheckinFrom(envelope))
    } catch (cause) {
      if (!mounted.current) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setAutoBusy(false)
    }
  }, [autoCheckin])
  const state = status?.state ?? 'pending'
  const channels = status?.channels ?? []
  return (
    <div className="dsm-xdpool-channels">
      <style>{CHANNEL_CARD_CSS}</style>
      <PageHero
        title={t?.('chan.title') ?? 'Login channels'}
        sub={t?.('chan.sub') ?? ''}
        // The hero's pill slot, not the big total card. `.panel-total` is a
        // full-width banner: centred text, a 3px bar across its top edge, meant
        // to be read across a section. Dropped into a row of 11px capsules it
        // rendered at the size of a title inside a box the size of a chip, and
        // the user read the mismatch as "this one never got styled".
        pills={<span
          className="dsm-xdpool-pill"
          data-tone={connectedCount > 0 ? 'ok' : 'off'}
        >
          {t?.('chan.connectedCount', { count: connectedCount }) ?? `${connectedCount} connected`}
        </span>}
      />
      {autoCheckin !== undefined && (
        <div className="dsm-xdpool-autocheckin">
          <label className="dsm-xdpool-switch">
            <input
              type="checkbox"
              checked={autoCheckin.enabled}
              disabled={autoBusy || autoCheckin.running}
              onChange={() => { void toggleAutoCheckin() }}
            />
            <span>{t?.('chan.autoCheckin') ?? 'Claim daily credits automatically'}</span>
          </label>
          {autoCheckin.lastResult !== undefined && (
            <span className="dsm-xdpool-autocheckin-note">{autoCheckin.lastResult}</span>
          )}
        </div>
      )}
      {error !== undefined && (
        <p className="dsm-xdpool-panel-error">{error}</p>
      )}
      {state === 'pending' && (
        <p className="dsm-xdpool-panel-empty">{t?.('chan.pending')}</p>
      )}
      {/*
        Two different failures, two different sentences. A pack that is already
        mounted by the sibling login-channel build is not a failure at all — the
        same thirteen channels are one click away on that build's own page — and
        printing the host's "could not start" line for it told the user
        something was broken when nothing was.
      */}
      {state === 'unavailable' && status?.reason === ROUTE_OWNED_ELSEWHERE && (
        <p className="dsm-xdpool-panel-empty">
          {t?.('chan.ownedElsewhere') ?? 'Another plugin already serves these login channels.'}
        </p>
      )}
      {state === 'unavailable' && status?.reason !== ROUTE_OWNED_ELSEWHERE && (
        <p className="dsm-xdpool-panel-error">
          {t?.('chan.unavailable')}{status?.reason !== undefined ? ` (${status.reason})` : ''}
        </p>
      )}
      {state === 'ready' && channels.length === 0 && (
        <p className="dsm-xdpool-panel-empty">{t?.('chan.empty')}</p>
      )}
      {channels.map((channel) => (
        <ChannelRow
          key={channel.id}
          channel={channel}
          t={t}
          ui={ui[channel.id] ?? IDLE}
          connectedCount={connectedFor(channel).length}
          /**
           * When the pack is mounted ELSEWHERE, this page cannot log anybody in.
           *
           * `account.create` is answered by the pack, and the pack that owns it lives in
           * another plugin — so pressing the button produced the host's "not supported"
           * line for a channel that works perfectly well, on a page the user was told to
           * use. The row says where the sign-in actually is instead of offering a button
           * that cannot work.
           */
          ownedElsewhere={status?.reason === ROUTE_OWNED_ELSEWHERE}
          onSignIn={() => { void signIn(channel) }}
          onCancel={() => cancel(channel.id)}
        />
      ))}
    </div>
  )
}
interface ChannelRowProps {
  channel: PoolWebChannel
  t?: Translate | undefined
  ui: ChannelUiState
  connectedCount: number
  onSignIn: () => void
  onCancel: () => void
  /**
   * True when the pack that owns this channel's sign-in lives in another plugin.
   *
   * Then the button cannot work from here, and saying so is better than a button that
   * fails with the host's own "not supported" wording.
   */
  ownedElsewhere?: boolean | undefined
}
function ChannelRow({
  channel,
  t,
  ui,
  connectedCount,
  onSignIn,
  onCancel,
  ownedElsewhere,
}: ChannelRowProps) {
  const busy = ui.phase === 'signing-in'
  const icon = channelIcon(channel.id)
  /* Eight of the thirteen channels carry real artwork in this build; the other
     five have none anywhere, so they wear their own initials on their own
     accent. Both paths are the tile working as designed - see the decision
     list at the top of brand-tile.tsx. Note the spread is keyed on `icon`
     being ABSENT: a channel that has a logo must never also get letters, and
     artwork always wins inside the tile as well. */
  const tileMark = icon === undefined ? { initials: channelInitials(channel.name) } : { icon }
  return (
    <div
      className="dsm-xdpool-channel"
      style={{ '--dsm-xdpool-channel-accent': channel.accent } as Record<string, string>}
    >
      <div className="dsm-xdpool-channel-head">
        <BrandTile accent={channel.accent} glyph="login" {...tileMark} />
        <span className="dsm-xdpool-channel-name">{channel.name}</span>
        <span className="dsm-xdpool-channel-org">{channel.org}</span>
        {connectedCount > 0 && (
          <span className="dsm-xdpool-channel-tag">
            {t?.('chan.connected', { count: connectedCount }) ?? 'Connected'}
          </span>
        )}
      </div>
      {/* What the vendor actually gives away. The pool page says this too, but a
          user standing on this page has not seen that card, and the answer to
          "is signing in here worth it" is this line and nothing else. */}
      {channel.note !== '' && (
        <p className="dsm-xdpool-channel-note">{channel.note}</p>
      )}
      <div className="dsm-xdpool-channel-actions">
        {busy ? (
          <>
            <span className="dsm-xdpool-channel-waiting">
              {ui.message ?? t?.('chan.signingIn') ?? 'Waiting for sign-in…'}
            </span>
            {ui.loginUrl !== undefined && (
              <a
                className="dsm-xdpool-btn"
                href={ui.loginUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t?.('chan.openLogin') ?? 'Open the sign-in page'}
              </a>
            )}
            <button type="button" className="dsm-xdpool-btn" onClick={onCancel}>
              {t?.('agg.clear') ?? 'Cancel'}
            </button>
          </>
        ) : (
          <>
            {/* The button is permanent, not a one-shot: a channel can hold any
               number of accounts, so the confirmation sits beside it as a
               status line instead of replacing it. Replacing it (the earlier
               shape) left a channel with no way to add a second account and no
               way to see what the click had done. */}
            {ownedElsewhere === true ? (
              <span className="dsm-xdpool-channel-hint">
                {t?.('chan.ownedElsewhereRow') ?? '在「我们的免费模型」里登录'}
              </span>
            ) : (
              <button type="button" className="dsm-xdpool-btn" onClick={onSignIn}>
                {t?.('chan.login') ?? 'Add account'}
              </button>
            )}
            {/* Raccoon's own login page shows the QR and the phone-code form on
                one screen, and its QR is the one that goes stale while the user
                reads the message. The plugin cannot switch which door it opens —
                the pack drives that page — so the advice has to sit next to the
                button instead. */}
            {channel.smsHint === true && (
              <span className="dsm-xdpool-channel-hint">{t?.('chan.loginSmsHint') ?? ''}</span>
            )}
            {ui.phase === 'done' && (
              <span className="dsm-xdpool-channel-ok">{t?.('chan.done') ?? 'Account added'}</span>
            )}
            {ui.phase === 'failed' && (
              <span className="dsm-xdpool-channel-error">
                {ui.message ?? t?.('chan.failed') ?? 'Sign-in failed'}
              </span>
            )}
          </>
        )}
      </div>

    </div>
  )
}