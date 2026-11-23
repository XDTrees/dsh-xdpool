/**
 * 登录通道页 —— 对照设计稿 xdpool-design/login.html（列表）与 login-start.html（登录中引导）。
 *
 * 结构（两列页面，PoolShell 的 children 只有这一个 main）：
 *
 *   main.main
 *     header.mhead   标题「登录通道」· N 家厂商 · 右侧搜索框
 *     div.mbody      p.note → div.groups（已登录 / 未登录 两组 .cards，每张 .card-ch）
 *
 * 点卡片上的「登录 / 再登一个」后，整个 main 换成登录中引导（login-start.html）：
 *
 *   header.mhead   渠道名 · 厂商 · pill「登录中」 · 取消
 *   div.mbody      .banner（转圈）→ .steps 三步 → .row（我已完成登录 / 取消）
 *
 * 这一页自己管轮询：一次登录可能要一分钟浏览器操作，所以页面离开时立刻停掉。
 *
 * 登录方式按渠道分三种，都走已有的后端路由：
 *   - pack 渠道：account.create 拿登录页 → 新标签页打开 → login.poll 轮询；
 *   - 插件自己开窗口的渠道（豆包 / Marvis / AStudio / MonkeyCode / 百智云）：POST 一次，
 *     后端开独立浏览器窗口，登录完成或超时才返回；
 *   - 只能粘贴凭据的渠道（Accio / AutoClaw）：粘贴框提交到各自的会话路由。
 *
 * @module dsh-xdpool/client/ChannelsPage
 */
import {
  POOL_ASTUDIO_LOGIN_PATH,
  POOL_MAGICREW_CN_LOGIN_PATH,
  POOL_MAGICREW_INTL_LOGIN_PATH,
  POOL_MAGICREW_CN_SESSION_PATH,
  POOL_MAGICREW_INTL_SESSION_PATH,
  POOL_ASTUDIO_SESSION_PATH,
  POOL_ASTUDIO_BROWSER_LOGIN_PATH,
  POOL_ACCIO_SESSION_PATH,
  POOL_MONKEYCODE_CN_SESSION_PATH,
  POOL_MONKEYCODE_INTL_SESSION_PATH,
  POOL_MONKEYCODE_CN_BROWSER_LOGIN_PATH,
  POOL_MONKEYCODE_INTL_BROWSER_LOGIN_PATH,
  POOL_BAIZHI_SESSION_PATH,
  POOL_BAIZHI_BROWSER_LOGIN_PATH,
  POOL_AUTOCLAW_INTL_SESSION_PATH,
  POOL_AUTOCLAW_CN_SESSION_PATH,
  POOL_MARVIS_LOGIN_PATH,
  POOL_MARVIS_SESSION_PATH,
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
import { accountsFrom, callPack, createdFrom, fetchChannels, pollFrom, providerStatusesFrom } from './channel-rpc.ts'
/* 登录路由表抽到共享模块了 —— 账号池那边也要用它直接发起登录 */
import { PASTE_ROUTES, WINDOW_LOGIN_ROUTES } from './login-routes.ts'
/** 登录成功后要作废账号数缓存，否则账号池还显示旧的计数。 */
import { invalidateProviderStatusCache } from './ChannelPoolSection.tsx'
import type { XdPoolSettingsKey } from './locales.ts'
import { channelIcon, channelInitials } from './channel-icons.ts'

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
type ChannelPhase = 'idle' | 'choose-method' | 'signing-in' | 'paste-credential' | 'done' | 'failed'
interface ChannelUiState {
  phase: ChannelPhase
  /** The pack's account id while a login is in flight. */
  accountId?: string | undefined
  /** Where to send the user, once the pack has minted a login page. */
  loginUrl?: string | undefined
  /** 引导页 / 卡片上要显示的一行中文。 */
  message?: string | undefined
  /** 粘贴框里正在输入的内容（只在内存里，不落盘）。 */
  paste?: string | undefined
  /** 这次登录走哪条路：pack 登录页 / 插件自己开的窗口 / 粘贴凭据。 */
  via?: 'pack' | 'window' | 'paste' | undefined
  /** 开始登录时这家已有几个账号 —— 「我已完成登录」靠它判断有没有多出来。 */
  startCount?: number | undefined
  /** 腾讯 Marvis 用哪条登录路：QQ 还是微信。 */
  loginType?: 'QC' | 'WX' | undefined
}
const IDLE: ChannelUiState = { phase: 'idle' }

/** 含中文才原样显示；后端的英文提示一律换成中文兜底。 */
const CJK = /[\u4e00-\u9fff]/u
function zh(message: string | undefined, fallback: string): string {
  return message !== undefined && CJK.test(message) ? message : fallback
}

/**
 * 只能粘贴凭据进来的渠道，各自的提交路由。
 *
 * AStudio 走 LOGIN 而不是 SESSION：它是唯一一个必须先解析「你给的是什么」才能入库的。
 * 渠道 id 与 channel-roster.ts 一致：`autoclaw` 是国际站，`autoclaw-cn` 是国内站。
 */

/**
 * 插件自己开独立浏览器窗口登录的渠道。
 *
 * POST 一次，后端开 Chromium 窗口等用户登录，登录完成（或窗口关掉、超时）才返回。
 * 这几家不在 pack 里，走 account.create 只会得到「unknown provider」。
 */

/**
 * 插件自己的渠道，账号数从各自的会话路由读。
 *
 * pack 的 provider.status 对这几家答 unsupported —— 不单独读的话，
 * 它们永远落在「未登录」组里，即使账号已经存好了。
 */
const OWN_SESSION_ROUTES: Readonly<Record<string, string>> = {
  'astudio': POOL_ASTUDIO_SESSION_PATH,
  'accio': POOL_ACCIO_SESSION_PATH,
  'monkeycode': POOL_MONKEYCODE_CN_SESSION_PATH,
  'monkeycode-intl': POOL_MONKEYCODE_INTL_SESSION_PATH,
  'baizhi': POOL_BAIZHI_SESSION_PATH,
  'autoclaw': POOL_AUTOCLAW_INTL_SESSION_PATH,
  'autoclaw-cn': POOL_AUTOCLAW_CN_SESSION_PATH,
  'doubao': POOL_DOUBAO_SESSION_PATH,
  'marvis': POOL_MARVIS_SESSION_PATH,
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

/** 一家渠道现有的账号数：pack 的账号（去重）与插件自己会话路由的账号，取大的那个。 */
function countOf(
  channelId: string,
  accounts: readonly ChannelAccount[],
  own: Readonly<Record<string, number>>,
): number {
  const pack = distinctAccounts(
    accounts.filter(account => account.provider === channelId && account.enabled !== false),
  ).length
  return Math.max(pack, own[channelId] ?? 0)
}

/**
 * 这个渠道有没有粘贴凭据这条路。
 *
 * 逐个写出来，不从表里查：这是「本页能处理的」白名单，PASTE_ROUTES 是「路由在哪」的映射，
 * 两件事分开写，将来有人给表里加一条路由，不会让一个本该走扫码的渠道突然多出粘贴框。
 */
function canPaste(channel: { id: string }): boolean {
  if (channel.id === 'astudio') return true
  if (channel.id === 'accio') return true
  if (channel.id === 'monkeycode') return true
  if (channel.id === 'monkeycode-intl') return true
  if (channel.id === 'baizhi') return true
  if (channel.id === 'autoclaw') return true
  if (channel.id === 'autoclaw-cn') return true
  return false
}

/** 引导页第二步下面那行说明：每家登录页的特殊之处。 */
function signInHint(channel: PoolWebChannel): string {
  if (channel.id === 'doubao') return '扫码或填手机号都行；豆包已关闭第三方扫码接口，只能这样登。'
  if (channel.id === 'marvis') return '用 QQ 扫码或账号授权，不需要 API Key。'
  if (channel.smsHint === true) return '该页二维码很快就会失效，建议用同屏的短信验证码登录。'
  return '用手机号或已有的登录方式都行。'
}

export function ChannelsPage(_props: ChannelsPageProps) {
  const [status, setStatus] = useState<PoolWebChannelsStatus | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [ui, setUi] = useState<Record<string, ChannelUiState>>({})
  /** 渠道搜索：只过滤显示，不改数据。 */
  const [query, setQuery] = useState('')
  const [connected, setConnected] = useState<readonly ChannelAccount[]>([])
  /** 插件自己渠道的账号数，按渠道 id。 */
  const [ownCounts, setOwnCounts] = useState<Readonly<Record<string, number>>>({})
  /** 正在看登录引导的渠道；undefined 时显示渠道列表。 */
  const [active, setActive] = useState<string | undefined>(undefined)
  const mounted = useRef(true)
  /** Timers for in-flight logins, keyed by channel id. */
  const timers = useRef(new Map<string, number>())
  /**
   * 每家渠道的登录「第几次」。
   *
   * 窗口登录的请求要等用户登完才返回；用户中途点了取消、又重新点登录，
   * 旧请求晚到的答案不能覆盖新一次的状态。
   */
  const attempts = useRef(new Map<string, number>())
  useEffect(() => {
    // Set on MOUNT, not only cleared on unmount: a ref keeps its value across a re-mount of
    // the same component in React's StrictMode, so a flag that is only cleared stays false
    // forever after the first unmount.
    mounted.current = true
    return () => {
      mounted.current = false
      for (const handle of timers.current.values()) window.clearInterval(handle)
      timers.current.clear()
    }
  }, [])
  const bump = useCallback((channelId: string): number => {
    const next = (attempts.current.get(channelId) ?? 0) + 1
    attempts.current.set(channelId, next)
    return next
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
        if (mounted.current) setError(zh(detail?.error, `读取登录通道失败（HTTP ${String(response.status)}）`))
        return
      }
      if (mounted.current && signal?.aborted !== true) {
        setStatus(value as PoolWebChannelsStatus)
        setError(undefined)
      }
    } catch (cause: unknown) {
      if (signal?.aborted === true) return
      if (mounted.current) setError(zh(cause instanceof Error ? cause.message : undefined, '读取登录通道失败'))
    }
  }, [])
  /**
   * Re-read which pack channels are connected.
   *
   * `account.list` filters by provider on its very first line, so an empty payload matches
   * no account at all. `provider.status` counts every channel in one answer; the accounts
   * themselves only need fetching for the channels it reports as connected.
   */
  /**
   * 插件主池里的 WorkBuddy 账号 —— issue #205。
   *
   * 「登录通道」页只问 pack 的 `account.list`，而桌面客户端读到的账号活在插件
   * 自己的池里（`~/.dsh/.xdpool/accounts.json`），manifest 里根本没有它们。于是
   * 主池有 5 个账号、这一页写着「1 个」。两套池子谁也看不见谁，所以这里把插件
   * 池的那部分并进来：编号用插件自己的 account id，昵称沿用卡片上的显示名。
   */
  const loadPoolAccounts = useCallback(async (): Promise<readonly ChannelAccount[]> => {
    const routes: readonly (readonly [string, string])[] = [
      ['buddy', '/plugins/dsh-xdpool/status?region=cn'],
      ['workbuddy', '/plugins/dsh-xdpool/status?region=global'],
    ]
    const pairs = await Promise.all(routes.map(async ([provider, route]): Promise<ChannelAccount[]> => {
      try {
        const response = await fetch(route, { credentials: 'same-origin', headers: { accept: 'application/json' } })
        if (!response.ok) return []
        const body = await response.json().catch(() => undefined) as
          | { accounts?: { id?: unknown; nickname?: unknown; label?: unknown }[] }
          | undefined
        const rows = Array.isArray(body?.accounts) ? body.accounts : []
        return rows
          .filter(row => typeof row.id === 'string' && row.id !== '')
          .map(row => ({
            id: row.id as string,
            provider,
            nickname: typeof row.nickname === 'string' && row.nickname !== ''
              ? row.nickname
              : typeof row.label === 'string' && row.label !== '' ? row.label : (row.id as string),
            enabled: true,
          }))
      } catch {
        return []
      }
    }))
    return pairs.flat()
  }, [])

  const loadConnected = useCallback(async (): Promise<readonly ChannelAccount[]> => {
    const roster = await fetchChannels()
    const statuses = providerStatusesFrom(await callPack('provider.status', {
      providers: roster.map(channel => channel.id),
    }))
    const connectedIds = roster
      .map(channel => channel.id)
      .filter(id => (statuses.get(id)?.accountsTotal ?? 0) > 0)
    const perChannel = await Promise.all(connectedIds.map(id => callPack('account.list', { provider: id })))
    const accounts = [...perChannel.flatMap(accountsFrom), ...await loadPoolAccounts()]
    if (mounted.current) setConnected(accounts)
    return accounts
  }, [])
  /** 读插件自己渠道的账号数。读不到的一家算 0，不影响其它家。 */
  const loadOwn = useCallback(async (): Promise<Record<string, number>> => {
    const pairs = await Promise.all(Object.entries(OWN_SESSION_ROUTES).map(async ([id, route]): Promise<[string, number]> => {
      try {
        const response = await fetch(route, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
        if (!response.ok) return [id, 0]
        const body = await response.json().catch(() => undefined) as { signedIn?: boolean; accounts?: unknown } | undefined
        const accounts = body?.accounts
        if (Array.isArray(accounts)) return [id, accounts.length]
        return [id, body?.signedIn === true ? 1 : 0]
      } catch {
        return [id, 0]
      }
    }))
    const counts: Record<string, number> = Object.fromEntries(pairs)
    if (mounted.current) setOwnCounts(counts)
    return counts
  }, [])
  const refresh = useCallback((): void => {
    void loadConnected().catch(() => {})
    void loadOwn()
  }, [loadConnected, loadOwn])
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    void loadConnected().catch(() => {})
    void loadOwn()
    return () => { controller.abort() }
  }, [load, loadConnected, loadOwn])
  const countFor = useCallback(
    (channel: PoolWebChannel): number => countOf(channel.id, connected, ownCounts),
    [connected, ownCounts],
  )
  const stopPolling = useCallback((channelId: string): void => {
    const handle = timers.current.get(channelId)
    if (handle !== undefined) window.clearInterval(handle)
    timers.current.delete(channelId)
  }, [])
  /** 登录成功：回到列表，卡片上写一句「已添加」。 */
  const finishDone = useCallback((channelId: string, message?: string): void => {
    setUi(prev => ({ ...prev, [channelId]: { phase: 'done', message } }))
    setActive(prev => (prev === channelId ? undefined : prev))
  }, [])
  const fail = useCallback((channelId: string, message: string, via?: ChannelUiState['via']): void => {
    setUi(prev => ({ ...prev, [channelId]: { phase: 'failed', message, via } }))
  }, [])
  /**
   * Watch one pack login until it lands, gives up, or times out.
   *
   * The interval is scheduled inside a single function, so one slow response can never
   * produce two collectors for the same account.
   */
  const watch = useCallback(
    (channel: PoolWebChannel, accountId: string, startedAt: number): void => {
      stopPolling(channel.id)
      const tick = async (): Promise<void> => {
        if (!mounted.current) return stopPolling(channel.id)
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          stopPolling(channel.id)
          fail(channel.id, '等了 10 分钟还没登录完成，已取消。可以再试一次。', 'pack')
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
          fail(channel.id, zh(answer.error, '登录失败，可以再试一次。'), 'pack')
          return
        }
        finishDone(channel.id)
        /*
          账号数缓存作废 —— 登录通道刚刚多了一个账号，
          账号池那边若还拿着 30 秒前的计数，会显示旧的数字，
          看起来就像「登上了但池子没同步」。
        */
        invalidateProviderStatusCache()
        refresh()
      }
      timers.current.set(channel.id, window.setInterval(() => { void tick() }, POLL_INTERVAL_MS))
    },
    [fail, finishDone, refresh, stopPolling],
  )
  const signIn = useCallback(
    async (channel: PoolWebChannel, startCount: number, loginType?: 'QC' | 'WX'): Promise<void> => {
      setActive(channel.id)
      const token = bump(channel.id)
      const windowRoute = WINDOW_LOGIN_ROUTES[channel.id]
      if (windowRoute !== undefined) {
        /*
          插件自己开窗口：请求要等用户登完才返回（可能几分钟），
          所以先把引导页放出来，告诉用户去弹出的窗口里登录。
        */
        setUi(prev => ({ ...prev, [channel.id]: { phase: 'signing-in', via: 'window', startCount } }))
        try {
          const response = await fetch(windowRoute, {
            method: 'POST',
            credentials: 'same-origin',
            ...channel.id === 'marvis'
              ? {
                  headers: { 'content-type': 'application/json' },
                  /* 用用户选的那条路；没选过就按 QQ —— 它与微信都能登，QQ 是国内默认 */
                  body: JSON.stringify({ loginType: loginType ?? 'QC' }),
                }
              : {},
          })
          const body = await response.json().catch(() => undefined) as
            | { ok?: boolean; signedIn?: boolean; reason?: string; message?: string; warning?: string }
            | undefined
          if (!mounted.current) return
          // 不管这一次还算不算数，账号可能已经存进去了：数字先刷新。
          refresh()
          if (attempts.current.get(channel.id) !== token) return
          if (body?.signedIn === true || body?.ok === true) {
            const warning = body?.warning
            finishDone(channel.id, warning !== undefined && CJK.test(warning) ? warning : undefined)
            /*
              插件自己开窗口的那条登录路（Marvis / CodeArts / 各类扫码）在这里成功。
              原来只调了 load() 刷新登录通道自己的数据 —— 账号池那份 30 秒的
              账号数缓存没作废，切过去还是旧数字，看起来像「登上了但池子没同步」。
            */
            invalidateProviderStatusCache()
            void load()
            return
          }
          fail(channel.id, zh(body?.reason ?? body?.message, '没有等到登录完成，可以再试一次。'), 'window')
        } catch (cause: unknown) {
          if (!mounted.current || attempts.current.get(channel.id) !== token) return
          fail(channel.id, zh(cause instanceof Error ? cause.message : undefined, '登录请求没有发出去，可以再试一次。'), 'window')
        }
        return
      }
      setUi(prev => ({ ...prev, [channel.id]: { phase: 'signing-in', via: 'pack', startCount } }))
      let envelope: ChannelRpcEnvelope
      try {
        envelope = await callPack('account.create', { provider: channel.id })
      } catch (cause: unknown) {
        if (!mounted.current || attempts.current.get(channel.id) !== token) return
        fail(channel.id, zh(cause instanceof Error ? cause.message : undefined, '登录失败，可以再试一次。'), 'pack')
        return
      }
      if (!mounted.current || attempts.current.get(channel.id) !== token) return
      if (!envelope.ok) {
        fail(channel.id, zh(envelope.error?.message, '登录失败，可以再试一次。'), 'pack')
        return
      }
      const created = createdFrom(envelope)
      if (created === undefined) {
        fail(channel.id, '没有拿到登录页，可以再试一次。', 'pack')
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
          via: 'pack',
          accountId: created.accountId,
          loginUrl: created.loginUrl,
          startCount,
        },
      }))
      watch(channel, created.accountId, Date.now())
    },
    [bump, fail, finishDone, load, refresh, watch],
  )
  /** 打开粘贴凭据的引导。 */
  const startPaste = useCallback((channel: PoolWebChannel): void => {
    stopPolling(channel.id)
    bump(channel.id)
    setActive(channel.id)
    setUi(prev => ({ ...prev, [channel.id]: { phase: 'paste-credential', paste: '' } }))
  }, [bump, stopPolling])
  /** 卡片上的「登录 / 再登一个」。 */
  const start = useCallback((channel: PoolWebChannel): void => {
    /*
      腾讯 Marvis 有两条登录路：QQ 和微信。
      原来这里直接进登录、把 loginType 写死成 'QC'，微信那条路在界面上根本不存在。
      现在先问一句用哪个，再走。
    */
    if (channel.id === 'marvis') {
      setUi(prev => ({ ...prev, [channel.id]: { phase: 'choose-method' } }))
      setActive(channel.id)
      return
    }
    if (WINDOW_LOGIN_ROUTES[channel.id] === undefined && canPaste(channel)) {
      startPaste(channel)
      return
    }
    void signIn(channel, countFor(channel))
  }, [countFor, signIn, startPaste])
  const cancel = useCallback((channelId: string): void => {
    stopPolling(channelId)
    bump(channelId)
    setUi(prev => ({ ...prev, [channelId]: IDLE }))
    setActive(undefined)
  }, [bump, stopPolling])
  /**
   * 「我已完成登录」：立刻查一次，不等下一轮。
   *
   * pack 登录直接问 login.poll；插件窗口登录重新数一次账号，比开始时多了就算成功。
   */
  const checkNow = useCallback(async (channel: PoolWebChannel): Promise<void> => {
    const current = ui[channel.id] ?? IDLE
    if (current.via === 'pack' && current.accountId !== undefined) {
      try {
        const envelope = await callPack('login.poll', { provider: channel.id, accountId: current.accountId })
        if (!mounted.current) return
        if (envelope.ok) {
          const answer = pollFrom(envelope)
          if (answer.done && answer.success !== false) {
            stopPolling(channel.id)
            finishDone(channel.id)
            invalidateProviderStatusCache()
            refresh()
            return
          }
          if (answer.done) {
            stopPolling(channel.id)
            fail(channel.id, zh(answer.error, '登录失败，可以再试一次。'), 'pack')
            return
          }
        }
      } catch {
        // 查不到就当还没完成，下面给提示。
      }
      if (!mounted.current) return
    } else {
      const [accounts, own] = await Promise.all([
        loadConnected().catch((): readonly ChannelAccount[] => connected),
        loadOwn(),
      ])
      if (!mounted.current) return
      if (countOf(channel.id, accounts, own) > (current.startCount ?? 0)) {
        bump(channel.id)
        finishDone(channel.id)
        /* 自家适配器的登录（astudio / accio / magicrew）也走这条，同样要作废账号数缓存 */
        invalidateProviderStatusCache()
        return
      }
    }
    setUi(prev => ({
      ...prev,
      [channel.id]: { ...(prev[channel.id] ?? IDLE), message: '还没检测到登录完成。在窗口里登录好之后再点一次。' },
    }))
  }, [bump, connected, fail, finishDone, loadConnected, loadOwn, refresh, stopPolling, ui])
  /**
   * 提交一次粘贴的凭据。
   *
   * 成功后刷新账号数并回到列表；失败把原因写在引导页里 —— 不弹窗：
   * 弹窗会盖住刚粘贴的内容，而用户正想改它。
   */
  const submitPaste = useCallback(async (channelId: string): Promise<void> => {
    const route = PASTE_ROUTES[channelId]
    if (route === undefined) return
    const value = (ui[channelId]?.paste ?? '').trim()
    if (value === '') return
    const token = bump(channelId)
    setUi(prev => ({ ...prev, [channelId]: { phase: 'signing-in', via: 'paste' } }))
    try {
      const response = await fetch(route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ credential: value }),
      })
      const body = await response.json().catch(() => undefined) as { ok?: boolean; error?: string; reason?: string } | undefined
      if (!mounted.current || attempts.current.get(channelId) !== token) return
      if (body?.ok === false || !response.ok) {
        fail(channelId, zh(body?.error ?? body?.reason, '凭据没被接受，检查一下是否复制完整。'), 'paste')
        return
      }
      finishDone(channelId)
      invalidateProviderStatusCache()
      refresh()
      void load()
    } catch (cause: unknown) {
      if (!mounted.current || attempts.current.get(channelId) !== token) return
      fail(channelId, zh(cause instanceof Error ? cause.message : undefined, '提交失败，可以再试一次。'), 'paste')
    }
  }, [bump, fail, finishDone, load, refresh, ui])

  const state = status?.state ?? 'pending'
  // `?? []` 挡不住「后端把数组写成对象」，那时 .filter 会抛错、整页空白；
  // 数组里也可能塞了 null —— 读它的 .id 会抛错，整页白掉。
  const channels = useMemo(
    (): readonly PoolWebChannel[] => {
      const list: readonly PoolWebChannel[] = Array.isArray(status?.channels) ? status.channels : []
      return list.filter(c => c !== null && typeof c === 'object')
    },
    [status],
  )
  /* 已经登上了的厂家数 —— 副标题里和总数并列，一眼看出还剩几家没接 */
  const connectedCount = useMemo(
    (): number => channels.filter(channel => countFor(channel) > 0).length,
    [channels, countFor],
  )
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

  const ownedElsewhere = status?.reason === ROUTE_OWNED_ELSEWHERE
  const activeChannel = active === undefined ? undefined : channels.find(c => c.id === active)
  const activeUi = active === undefined ? IDLE : (ui[active] ?? IDLE)

  /* ---------- 登录中引导（login-start.html） ---------- */
  if (activeChannel !== undefined && activeUi.phase !== 'idle' && activeUi.phase !== 'done') {
    const channel = activeChannel
    const phase = activeUi.phase
    const pasteValue = activeUi.paste ?? ''
    const pillTone = phase === 'failed' ? 'err' : 'warn'
    const pillText = phase === 'failed' ? '未完成'
      : phase === 'paste-credential' ? '待粘贴凭据'
        : activeUi.via === 'paste' ? '验证中' : '登录中'
    return (
      <main className="main">
        <header className="mhead">
          <div className="mhead-title">
            <span className="mhead-name">{channel.name}</span>
            <span className="mhead-org">{channel.org}</span>
            <span className="pill" data-tone={pillTone}>{pillText}</span>
          </div>
          <div className="mhead-actions">
            <button type="button" className="btn" onClick={() => { cancel(channel.id) }}>取消</button>
          </div>
        </header>
        <div className="mbody">
          {/*
            腾讯 Marvis 的登录方式选择。

            它有两条 OAuth 路：QQ（graph.qq.com）和微信（open.weixin.qq.com）。
            原来这里直接进登录、把 loginType 写死成 'QC'，微信那条路在界面上不存在 ——
            用户只能拿 QQ 登，微信账号进不来。
          */}
          {phase === 'choose-method' && (
            <>
              <div className="banner">
                <span className="banner-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 8v4l3 2" />
                  </svg>
                </span>
                <span className="banner-body">
                  <span className="banner-t">选一种登录方式</span>
                  <span className="banner-d">
                    两条路走的是同一个腾讯账号体系，登进来之后用法一样。
                  </span>
                </span>
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setUi(prev => ({ ...prev, [channel.id]: { ...prev[channel.id], phase: 'signing-in', via: 'window', startCount: countFor(channel), loginType: 'QC' } }))
                    void signIn(channel, countFor(channel), 'QC')
                  }}
                >
                  QQ 登录
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setUi(prev => ({ ...prev, [channel.id]: { ...prev[channel.id], phase: 'signing-in', via: 'window', startCount: countFor(channel), loginType: 'WX' } }))
                    void signIn(channel, countFor(channel), 'WX')
                  }}
                >
                  微信登录
                </button>
                <button type="button" className="btn" onClick={() => { cancel(channel.id) }}>取消</button>
              </div>
            </>
          )}
          {phase === 'signing-in' && activeUi.via !== 'paste' && (
            <>
              <div className="banner">
                <span className="banner-icon"><span className="spinner" /></span>
                <span className="banner-body">
                  <span className="banner-t">
                    {activeUi.via === 'pack' ? '已打开登录页，请在里面完成登录' : '已打开登录窗口，请在里面完成登录'}
                  </span>
                  <span className="banner-d">
                    {activeUi.via === 'pack'
                      ? '登录页在新标签页里，10 分钟没完成就会取消。凭据只留在这台机器上。'
                      : '窗口关掉或长时间没完成就会取消。凭据只留在这台机器上。'}
                  </span>
                </span>
              </div>
              <div className="steps">
                <div className="step">
                  <span className="step-n" data-done="true">✓</span>
                  <span className="step-b">
                    <span className="step-t">{activeUi.via === 'pack' ? '打开登录页' : '打开浏览器窗口'}</span>
                    <span className="step-d">
                      {activeUi.via === 'pack'
                        ? '已在新标签页打开；没弹出来就点下面的「重新打开登录页」。'
                        : '用的是独立配置目录，不会动你自己的浏览器。'}
                    </span>
                  </span>
                </div>
                <div className="step">
                  <span className="step-n" data-wait="true">2</span>
                  <span className="step-b">
                    <span className="step-t" data-wait="true">{`在窗口里登录${channel.name}`}</span>
                    <span className="step-d">{signInHint(channel)}</span>
                  </span>
                </div>
                <div className="step">
                  <span className="step-n" data-wait="true">3</span>
                  <span className="step-b">
                    <span className="step-t" data-wait="true">自动读取凭据并接入账号池</span>
                    <span className="step-d">读到后这里会自动回到登录通道，新账号出现在账号池里。</span>
                  </span>
                </div>
              </div>
              <div className="row">
                <button type="button" className="btn" onClick={() => { void checkNow(channel) }}>我已完成登录</button>
                {activeUi.loginUrl !== undefined && (
                  <a className="btn" href={activeUi.loginUrl} target="_blank" rel="noopener noreferrer">重新打开登录页</a>
                )}
                <button type="button" className="btn" onClick={() => { cancel(channel.id) }}>取消</button>
              </div>
              {activeUi.message !== undefined && <p className="hint">{activeUi.message}</p>}
            </>
          )}
          {phase === 'signing-in' && activeUi.via === 'paste' && (
            <>
              <div className="banner">
                <span className="banner-icon"><span className="spinner" /></span>
                <span className="banner-body">
                  <span className="banner-t">正在验证凭据…</span>
                  <span className="banner-d">验证通过后会自动接入账号池。凭据只留在这台机器上。</span>
                </span>
              </div>
              <div className="row">
                <button type="button" className="btn" onClick={() => { cancel(channel.id) }}>取消</button>
              </div>
            </>
          )}
          {phase === 'paste-credential' && (
            <>
              <div className="banner">
                <span className="banner-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <rect x="8" y="3" width="12" height="14" rx="2" />
                    <path d="M16 17v2a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2h2" />
                  </svg>
                </span>
                <span className="banner-body">
                  <span className="banner-t">这个渠道要粘贴凭据</span>
                  <span className="banner-d">它的登录要过验证码或桌面流程，本页接不住。凭据只留在这台机器上，不会上传。</span>
                </span>
              </div>
              <div className="steps">
                <div className="step">
                  <span className="step-n">1</span>
                  <span className="step-b">
                    <span className="step-t">{`打开${channel.name}官方控制台并登录`}</span>
                  </span>
                </div>
                <div className="step">
                  <span className="step-n">2</span>
                  <span className="step-b">
                    <span className="step-t">复制凭据</span>
                    <span className="step-d">bearer、cookie 串、整份文档都可以，后端会自己解析。</span>
                  </span>
                </div>
                <div className="step">
                  <span className="step-n">3</span>
                  <span className="step-b">
                    <span className="step-t">粘贴到下面并提交</span>
                  </span>
                </div>
              </div>
              <input
                className="search"
                type="password"
                style={{ width: '100%' }}
                placeholder="粘贴凭据（bearer / cookie / 整份文档）"
                aria-label="粘贴凭据"
                value={pasteValue}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  setUi(prev => ({ ...prev, [channel.id]: { phase: 'paste-credential', paste: value } }))
                }}
                onKeyDown={(event) => { if (event.key === 'Enter') void submitPaste(channel.id) }}
              />
              <div className="row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={pasteValue.trim() === ''}
                  onClick={() => { void submitPaste(channel.id) }}
                >
                  提交
                </button>
                <button type="button" className="btn" onClick={() => { cancel(channel.id) }}>取消</button>
              </div>
            </>
          )}
          {phase === 'failed' && (
            <>
              <div className="banner">
                <span className="banner-icon" aria-hidden="true">!</span>
                <span className="banner-body">
                  <span className="banner-t">登录没有完成</span>
                  <span className="banner-d">{activeUi.message ?? '登录失败，可以再试一次。'}</span>
                </span>
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    if (activeUi.via === 'paste') startPaste(channel)
                    else start(channel)
                  }}
                >
                  重试
                </button>
                {activeUi.via !== 'paste' && canPaste(channel) && PASTE_ROUTES[channel.id] !== undefined && (
                  <button type="button" className="btn" onClick={() => { startPaste(channel) }}>改为粘贴凭据</button>
                )}
                <button type="button" className="btn" onClick={() => { cancel(channel.id) }}>返回</button>
              </div>
            </>
          )}
        </div>
      </main>
    )
  }

  /* ---------- 渠道列表（login.html） ---------- */
  const bound = filtered.filter(c => countFor(c) > 0)
  const unbound = filtered.filter(c => countFor(c) === 0)
  const reason = status?.reason
  const card = (channel: PoolWebChannel) => (
    <ChannelCard
      key={channel.id}
      channel={channel}
      count={countFor(channel)}
      ui={ui[channel.id] ?? IDLE}
      /*
        pack 被另一个插件挂着时，本页登不了 pack 的渠道（account.create 由那个插件答）。
        插件自己的渠道不受影响，照常给按钮。
      */
      ownedElsewhere={ownedElsewhere && OWN_SESSION_ROUTES[channel.id] === undefined}
      onStart={() => { start(channel) }}
    />
  )
  return (
    <main className="main">
      <header className="mhead">
        <div className="mhead-title">
          <span className="mhead-name">登录通道</span>
          <span className="mhead-org">
            {channels.length === 0
              ? '正在读取渠道…'
              : `${String(channels.length)} 家厂商 · 已连接 ${String(connectedCount)}`}
          </span>
        </div>
        <div className="mhead-actions">
          <input
            className="search"
            type="search"
            placeholder="搜索渠道"
            aria-label="搜索渠道"
            value={query}
            onChange={(event) => { setQuery(event.target.value) }}
          />
        </div>
      </header>
      <div className="mbody">
        <p className="note">每个渠道点「登录」都会打开一个浏览器窗口，登录完成后自动接上。凭据只存在本机，不会上传。</p>
        {error !== undefined && <p className="hint">{error}</p>}
        {state === 'pending' && channels.length === 0 && error === undefined && (
          <p className="hint">正在读取登录通道…</p>
        )}
        {state === 'unavailable' && ownedElsewhere && (
          <p className="hint">pack 渠道已由另一个插件接管，这些渠道请在它自己的页面上登录；豆包、Marvis 等本插件自己的渠道照常可用。</p>
        )}
        {state === 'unavailable' && !ownedElsewhere && (
          <p className="hint">
            {reason !== undefined && CJK.test(reason) ? `本机上登录通道没能启动：${reason}` : '本机上登录通道没能启动。'}
          </p>
        )}
        {state === 'ready' && channels.length === 0 && <p className="hint">还没有可用的登录通道。</p>}
        {query.trim() !== '' && channels.length > 0 && filtered.length === 0 && (
          <p className="hint">{`没有匹配「${query.trim()}」的渠道。`}</p>
        )}
        <div className="groups">
          {bound.length > 0 && (
            <section>
              <div className="group-head">
                <span className="group-dot" aria-hidden="true" />
                <span className="group-title">已登录</span>
                <span className="group-n num">{String(bound.length)}</span>
                <span className="group-hint">账号池里能直接用的渠道</span>
              </div>
              <div className="cards">{bound.map(card)}</div>
            </section>
          )}
          {unbound.length > 0 && (
            <section>
              <div className="group-head">
                <span className="group-dot" data-empty="true" aria-hidden="true" />
                <span className="group-title">未登录</span>
                <span className="group-n num">{String(unbound.length)}</span>
                <span className="group-hint">点「登录」会打开浏览器窗口</span>
              </div>
              <div className="cards">{unbound.map(card)}</div>
            </section>
          )}
        </div>
      </div>
    </main>
  )
}

interface ChannelCardProps {
  channel: PoolWebChannel
  /** 这家现有的账号数（去重后）。 */
  count: number
  ui: ChannelUiState
  /** pack 由另一个插件挂着、本页登不了这一家时为 true：不画按钮，只说去哪儿登。 */
  ownedElsewhere: boolean
  onStart: () => void
}

/** 一张渠道卡 —— 设计稿 article.card-ch。 */
function ChannelCard({ channel, count, ui, ownedElsewhere, onStart }: ChannelCardProps) {
  const bound = count > 0
  const icon = channelIcon(channel.id)
  const done = ui.phase === 'done'
  const countText = ownedElsewhere
    ? '在「我们的免费模型」里登录'
    : done
      ? (bound ? `已添加 · ${String(count)} 个账号` : '已添加账号')
      : (bound ? `${String(count)} 个账号` : '')
  return (
    <article className="card-ch" data-bound={bound ? undefined : 'false'}>
      <div className="ch-head">
        {icon === undefined
          /* 没有任何图标的厂商：用名字的两个字母 */
          ? (
              <span
                className="ch-logo"
                aria-hidden="true"
                style={{ display: 'grid', placeItems: 'center', fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--muted)' }}
              >
                {channelInitials(channel.name)}
              </span>
            )
          /* css:--icon-xxx 是「用设计稿的 CSS 变量」，不能包进 url() */
          : (
              <span
                className="ch-logo"
                aria-hidden="true"
                style={{ backgroundImage: icon.startsWith('css:') ? `var(${icon.slice(4)})` : `url("${icon}")` }}
              />
            )}
        <span className="ch-titles">
          <span className="ch-title">{channel.name}</span>
          <span className="ch-org">{channel.org}</span>
        </span>
        <span className="ch-state" data-bound={bound ? 'true' : undefined}>{bound ? '已登录' : '未登录'}</span>
      </div>
      <p className="ch-note">{done && ui.message !== undefined ? ui.message : channel.note}</p>
      <div className="ch-foot">
        <span className="ch-count">{countText}</span>
        {ownedElsewhere ? null : (
          <button type="button" className="tiny tiny-primary" onClick={onStart}>
            {bound ? '再登一个' : '登录'}
          </button>
        )}
      </div>
    </article>
  )
}
