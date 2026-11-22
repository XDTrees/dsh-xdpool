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
import {
  POOL_ASTUDIO_LOGIN_PATH,
  POOL_ACCIO_SESSION_PATH,
  POOL_MONKEYCODE_CN_SESSION_PATH,
  POOL_MONKEYCODE_INTL_SESSION_PATH,
  POOL_BAIZHI_SESSION_PATH,
  POOL_AUTOCLAW_INTL_SESSION_PATH,
  POOL_AUTOCLAW_CN_SESSION_PATH,
} from '../status-paths.ts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  POOL_CHANNELS_PATH,
  POOL_DOUBAO_SESSION_PATH,
  ROUTE_OWNED_ELSEWHERE,
  type PoolWebChannel,
  type PoolWebChannelsStatus,
} from '../status-paths.ts'
import type { ChannelAccount, ChannelRpcEnvelope } from '../channels.ts'
import { accountsFrom, autoCheckinFrom, callPack, createdFrom, fetchChannels, pollFrom, providerStatusesFrom, type ChannelAutoCheckin } from './channel-rpc.ts'
import type { XdPoolSettingsKey } from './locales.ts'
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
type ChannelPhase = 'idle' | 'signing-in' | 'paste-credential' | 'done' | 'failed'
interface ChannelUiState {
  phase: ChannelPhase
  /** The pack's account id while a login is in flight. */
  accountId?: string | undefined
  /** Where to send the user, once the pack has minted a login page. */
  loginUrl?: string | undefined
  /** A line to print under the row. */
  message?: string | undefined
  /** 粘贴框里正在输入的内容（只在内存里，不落盘）。 */
  paste?: string | undefined
}
const IDLE: ChannelUiState = { phase: 'idle' }

/**
 * 只能粘贴凭据进来的渠道。
 *
 * 这五家的登录要验证码或桌面流程，本页扛不住 —— 用户从官方页面复制一段东西
 * （bearer、cookie 串、整份文档都可以），这里送上去并让后端解析。
 *
 * AStudio 走 LOGIN 而不是 SESSION：它是唯一一个必须先解析「你给的是什么」才能入库的。
 */
const PASTE_ROUTES: Readonly<Record<string, string>> = {
  'astudio': POOL_ASTUDIO_LOGIN_PATH,
  'accio': POOL_ACCIO_SESSION_PATH,
  'monkeycode': POOL_MONKEYCODE_CN_SESSION_PATH,
  'monkeycode-intl': POOL_MONKEYCODE_INTL_SESSION_PATH,
  'baizhi': POOL_BAIZHI_SESSION_PATH,
  'autoclaw-intl': POOL_AUTOCLAW_INTL_SESSION_PATH,
  'autoclaw': POOL_AUTOCLAW_CN_SESSION_PATH,
}


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

/**
 * 这个渠道要不要粘贴框。
 *
 * 单独一个函数而不是散在 JSX 里：五个渠道的判断各写一次就会漂，
 * 而漂掉的后果是「按钮点了没反应」——最难查的那种。
 */
function needsPaste(channel: { id: string }): boolean {
  /*
    逐个写出来，不从表里查。

    这五个 id 是「本页能处理的」白名单，而 PASTE_ROUTES 是「路由在哪」的映射。
    两件事分开写是有意的：将来有人给表里加一条路由，不会因此让一个
    本就该走扫码的渠道突然多出个粘贴框。
  */
  if (channel.id === 'astudio') return true
  if (channel.id === 'accio') return true
  if (channel.id === 'monkeycode') return true
  if (channel.id === 'monkeycode-intl') return true
  if (channel.id === 'baizhi') return true
  if (channel.id === 'autoclaw') return true
  if (channel.id === 'autoclaw-intl') return true
  return false
}

export function ChannelsPage({ t }: ChannelsPageProps) {
  const [status, setStatus] = useState<PoolWebChannelsStatus | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [ui, setUi] = useState<Record<string, ChannelUiState>>({})
  /**
   * 渠道搜索。

   * 22 家渠道平铺时，找一家要滚很久 —— 设计稿的登录页有搜索框。
   * 只过滤显示，不改数据。
   */
  const [query, setQuery] = useState('')
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
      /**
       * Doubao is not a pack channel.
       *
       * Every other row here is served by the vendored pack, which drives its own login page
       * and reports the account back through `account.create`. Doubao has no adapter there —
       * the pack answers `unknown provider: doubao` — because its lane is this plugin's own:
       * one browser session, the catalogue read from the vendor, the wire its own.
       *
       * So the button calls the plugin's own sign-in, which opens a Chromium window and
       * harvests the jar over the DevTools protocol.
       */
      if (channel.id === 'doubao') {
        // The window opens server-side, so the user is told what to expect before the request
        // returns — the sign-in can run for minutes while they scan.
        setUi(prev => ({
          ...prev,
          [channel.id]: {
            phase: 'signing-in',
            message: '已打开浏览器，请在弹出的窗口里扫码或短信登录…',
          },
        }))
        try {
          const response = await fetch(POOL_DOUBAO_SESSION_PATH, { method: 'POST', credentials: 'same-origin' })
          const body = await response.json().catch(() => undefined) as
            | { ok?: boolean; signedIn?: boolean; message?: string }
            | undefined
          if (!mounted.current) return
          if (body?.signedIn === true) {
            setUi(prev => ({ ...prev, [channel.id]: { phase: 'done' } }))
            void load()
            void loadConnected()
            return
          }
          setUi(prev => ({
            ...prev,
            [channel.id]: {
              phase: 'failed',
              message: body?.message ?? '没有等到登录完成，可以再点一次',
            },
          }))
        } catch (cause: unknown) {
          if (!mounted.current) return
          setUi(prev => ({
            ...prev,
            [channel.id]: { phase: 'failed', message: cause instanceof Error ? cause.message : String(cause) },
          }))
        }
        return
      }
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
  /**
   * 提交一次粘贴的凭据。
   *
   * 成功后刷新渠道列表（新账号要出现），失败把原因写在行下 —— 不弹窗：
   * 弹窗会盖住刚粘贴的内容，而用户正想改它。
   */
  const submitPaste = async (channelId: string): Promise<void> => {
    const route = PASTE_ROUTES[channelId]
    if (route === undefined) return
    const value = (ui[channelId]?.paste ?? '').trim()
    if (value === '') return
    setUi(prev => ({ ...prev, [channelId]: { phase: 'signing-in' } }))
    try {
      const response = await fetch(route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ credential: value }),
      })
      const body = await response.json() as { ok?: boolean; error?: string; reason?: string }
      if (body.ok === false || !response.ok) {
        setUi(prev => ({
          ...prev,
          [channelId]: { phase: 'failed', message: body.error ?? body.reason ?? '凭据没被接受' },
        }))
        return
      }
      await load()
      setUi(prev => ({ ...prev, [channelId]: { phase: 'done' } }))
    } catch (cause) {
      setUi(prev => ({
        ...prev,
        [channelId]: { phase: 'failed', message: cause instanceof Error ? cause.message : '提交失败' },
      }))
    }
  }

  const state = status?.state ?? 'pending'
  // `?? []` 挡不住「后端把数组写成对象」，那时 .filter 会抛错、整页空白
  // 数组里也可能塞了 null —— 读它的 .id 会抛错，整页白掉
  const channels = (Array.isArray(status?.channels) ? status.channels : [])
    .filter(c => c !== null && typeof c === 'object')

  /* 搜索过滤：名字、厂商、备注任一命中 */
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return channels
    return channels.filter(c => {
      const name = typeof c.name === 'string' ? c.name.toLowerCase() : ''
      const org = typeof c.org === 'string' ? c.org.toLowerCase() : ''
      const note = typeof c.note === 'string' ? c.note.toLowerCase() : ''
      return name.includes(needle) || org.includes(needle) || note.includes(needle)
    })
  }, [channels, query])

  return (
    <div className="main">
      <PageHero
        title={t?.('chan.title') ?? 'Login channels'}
        /*
          副标题里的「多少家」不写死 —— 渠道数从 14 涨到 22 之后，
          硬编码的数字一直是错的。用当前实际数量。
        */
        sub={channels.length > 0
          ? (t?.('chan.sub', { count: channels.length }) ?? `${String(channels.length)} 家厂商：登一次，它们的免费模型就出现在同一个选择器里。`)
          : (t?.('chan.subLoading') ?? '正在读取渠道…')}
        // The hero's pill slot, not the big total card. `.panel-total` is a
        // full-width banner: centred text, a 3px bar across its top edge, meant
        // to be read across a section. Dropped into a row of 11px capsules it
        // rendered at the size of a title inside a box the size of a chip, and
        // the user read the mismatch as "this one never got styled".
        pills={<span
          className="pill"
          data-tone={connectedCount > 0 ? 'ok' : 'off'}
        >
          {t?.('chan.connectedCount', { count: connectedCount }) ?? `${connectedCount} connected`}
        </span>}
      />
      <div className="mbody">
      {/*
        说明行 —— 设计稿 mbody 的第一块是 p.note。
        读者进来先要知道「这些渠道各自怎么登录」，而不是直接面对二十六张卡。
      */}
      <p className="note">
        {t?.('chan.note') ?? '每个渠道点「登录」都会打开一个浏览器窗口，登录完成后自动接上。凭据只存在本机，不会上传。'}
      </p>
      {/*
        搜索框 —— 设计稿的 login 页有。
        22 家渠道时它省掉的是滚动，不是点击。
      */}
      <div className="search-wrap">
        <input
          type="search"
          className="search"
          value={query}
          placeholder={t?.('chan.search') ?? '搜索渠道'}
          aria-label={t?.('chan.search') ?? '搜索渠道'}
          onChange={event => { setQuery(event.target.value) }}
        />
        {query === '' ? null : (
          <span className="hint" role="status">
            {String(filtered.length)} / {String(channels.length)}
          </span>
        )}
      </div>
      <div className="groups">
      {autoCheckin !== undefined && (
        <div className="hint">
          <label className="sw">
            <input
              type="checkbox"
              checked={autoCheckin.enabled}
              disabled={autoBusy || autoCheckin.running}
              onChange={() => { void toggleAutoCheckin() }}
            />
            <span>{t?.('chan.autoCheckin') ?? 'Claim daily credits automatically'}</span>
          </label>
          {autoCheckin.lastResult !== undefined && (
            <span className="hint">{autoCheckin.lastResult}</span>
          )}
        </div>
      )}
      {error !== undefined && (
        <p className="hint">{error}</p>
      )}
      {state === 'pending' && (
        <p className="hint">{t?.('chan.pending')}</p>
      )}
      {/*
        Two different failures, two different sentences. A pack that is already
        mounted by the sibling login-channel build is not a failure at all — the
        same thirteen channels are one click away on that build's own page — and
        printing the host's "could not start" line for it told the user
        something was broken when nothing was.
      */}
      {state === 'unavailable' && status?.reason === ROUTE_OWNED_ELSEWHERE && (
        <p className="hint">
          {t?.('chan.ownedElsewhere', { count: channels.length })
            ?? `Another plugin already serves these ${String(channels.length)} login channels.`}
        </p>
      )}
      {state === 'unavailable' && status?.reason !== ROUTE_OWNED_ELSEWHERE && (
        <p className="hint">
          {t?.('chan.unavailable')}{status?.reason !== undefined ? ` (${status.reason})` : ''}
        </p>
      )}
      {state === 'ready' && channels.length === 0 && (
        <p className="hint">{t?.('chan.empty')}</p>
      )}
      {/*
        两组：已连接 / 未连接 —— 设计稿的 .group-head + .cards。

        平铺成一张长表时，读者要逐行看右侧的「已登录」才知道哪些能用，
        而这两个组的答案本来是不同的（一个"能用"，一个"还得登"）。
      */}
      {([[t?.('chan.groupBound') ?? '已连接', filtered.filter(c => connectedFor(c).length > 0)],
        [t?.('chan.groupUnbound') ?? '未连接', filtered.filter(c => connectedFor(c).length === 0)]] as const)
        .filter(([, list]) => list.length > 0)
        .map(([label, list]) => (
          <section key={label}>
            <div className="group-head">
              <span className="group-dot" aria-hidden="true" />
              <span className="group-title">{label}</span>
              <span className="group-n num">{String(list.length)}</span>
            </div>
            <div className="cards">
      {list.map((channel) => (
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
          onPasteChange={(value) => {
            setUi(prev => ({ ...prev, [channel.id]: { phase: 'paste-credential', paste: value } }))
          }}
          onSubmitPaste={() => { void submitPaste(channel.id) }}
        />
      ))}
            </div>
          </section>
        ))}
      </div>
      </div>
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
  /** 粘贴框的内容变了。 */
  onPasteChange: (value: string) => void
  /** 提交粘贴的凭据。 */
  onSubmitPaste: () => void
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
  onPasteChange,
  onSubmitPaste,
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
      className="card-ch"
      style={{ '--dsm-xdpool-channel-accent': channel.accent } as Record<string, string>}
    >
      <div className="ch-head">
        <BrandTile accent={channel.accent} glyph="login" {...tileMark} />
        {/*
          名字与厂商放在一列里 —— 设计稿的 .ch-titles。
          平铺的话 .ch-title 的 ellipsis 没有容器约束，长名字会把厂商名挤出去。
        */}
        <span className="ch-titles">
          <span className="ch-title">{channel.name}</span>
          <span className="ch-org">{channel.org}</span>
        </span>
        {connectedCount > 0 && (
          <span className="ch-state">
            {t?.('chan.connected', { count: connectedCount }) ?? 'Connected'}
          </span>
        )}
      </div>
      {/* What the vendor actually gives away. The pool page says this too, but a
          user standing on this page has not seen that card, and the answer to
          "is signing in here worth it" is this line and nothing else. */}
      {channel.note !== '' && (
        <p className="ch-note">{channel.note}</p>
      )}
      <div className="ch-foot">
        {ui.phase === 'paste-credential' ? (
          <>
            {/* 这五家要验证码或桌面流程，本页只能收复制来的凭据。 */}
            <input
              className="input"
              type="password"
              placeholder={'粘贴凭据（bearer / cookie / 整份文档）'}
              value={ui.paste ?? ''}
              onChange={(event) => {
                const value = event.currentTarget.value
                onPasteChange(value)
              }}
            />
            <button type="button" className="tiny tiny-primary" onClick={onSubmitPaste}>
              {'提交'}
            </button>
            <button type="button" className="tiny" onClick={onCancel}>
              {t?.('agg.clear') ?? '取消'}
            </button>
          </>
        ) : busy ? (
          <>
            <span className="ch-note">
              {ui.message ?? t?.('chan.signingIn') ?? 'Waiting for sign-in…'}
            </span>
            {ui.loginUrl !== undefined && (
              <a
                className="btn"
                href={ui.loginUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t?.('chan.openLogin') ?? 'Open the sign-in page'}
              </a>
            )}
            <button type="button" className="btn" onClick={onCancel}>
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
              <span className="ch-note">
                {t?.('chan.ownedElsewhereRow') ?? '在「我们的免费模型」里登录'}
              </span>
            ) : (
              <button type="button" className="btn" onClick={onSignIn}>
                {t?.('chan.login') ?? 'Add account'}
              </button>
            )}
            {/*
              登录进行中：三步引导 —— 设计稿的 .steps / .step。

              点了按钮之后会弹出一个浏览器窗口，而「那窗口是干什么的、
              要不要关、关早了会不会失败」没有人告诉读者。原来这里
              只有一个禁用的按钮，看不出正在做什么。
            */}
            {busy && (
              <div className="steps">
                <div className="step">
                  <span className="step-n" data-done="true">✓</span>
                  <span className="step-b">
                    <span className="step-t">{t?.('chan.stepOpen') ?? '打开浏览器窗口'}</span>
                    <span className="step-d">{t?.('chan.stepOpenHint') ?? '用的是独立配置目录，不会动你自己的浏览器。'}</span>
                  </span>
                </div>
                <div className="step">
                  <span className="step-n" data-wait="true">2</span>
                  <span className="step-b">
                    <span className="step-t" data-wait="true">
                      {t?.('chan.stepSignIn', { name: channel.name }) ?? `在窗口里登录 ${channel.name}`}
                    </span>
                    <span className="step-d">{t?.('chan.stepSignInHint') ?? '用手机号或已有的登录方式都行。'}</span>
                  </span>
                </div>
                <div className="step">
                  <span className="step-n">3</span>
                  <span className="step-b">
                    <span className="step-t">{t?.('chan.stepDone') ?? '关掉窗口，这里会自动接上'}</span>
                  </span>
                </div>
              </div>
            )}
            {/* Raccoon's own login page shows the QR and the phone-code form on
                one screen, and its QR is the one that goes stale while the user
                reads the message. The plugin cannot switch which door it opens —
                the pack drives that page — so the advice has to sit next to the
                button instead. */}
            {channel.smsHint === true && (
              <span className="ch-note">{t?.('chan.loginSmsHint') ?? ''}</span>
            )}
            {/* What the button will actually do, before it is pressed. */}
            {channel.loginHint === 'doubao' && (
              <span className="ch-note">{t?.('chan.doubaoHint') ?? ''}</span>
            )}
            {ui.phase === 'done' && (
              <span className="ch-count">{t?.('chan.done') ?? 'Account added'}</span>
            )}
            {ui.phase === 'failed' && (
              <span className="ch-note">
                {ui.message ?? t?.('chan.failed') ?? 'Sign-in failed'}
              </span>
            )}
          </>
        )}
      </div>

    </div>
  )
}