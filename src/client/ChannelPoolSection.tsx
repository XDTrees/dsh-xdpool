/**
 * Account-pool page, scan-channel section.
 *
 * The pool page's two region cards only ever showed the WorkBuddy lanes — the
 * thirteen scan-login channels lived in a parallel world on the login page.
 * This section closes that gap: every scan channel that holds at least one
 * account gets a card here, laid out like the reference build's channel card —
 * identity on top, a one-line note about what the vendor actually gives away,
 * a numbers row (accounts, models, credits), then two collapsible lists.
 *
 * Three decisions worth stating, because each of them is a way this could have
 * looked wrong:
 *
 * 1. The enable state IS the pack's model blacklist — `model.setDisabled` with
 *    `disabled: false` unhides a model, `disabled: true` hides it again — and
 *    each row saves on its own. A channel can publish thirty models; a Save
 *    button at the bottom of a list the user has to scroll back down to turns
 *    "pick the two you want" into bookkeeping.
 * 2. Credits come from the pack and are shown in the vendor's own unit, never
 *    normalised: Cline pays dollars, ZCode pays tokens, Gemini publishes
 *    percentage windows. A single "credits" column would be wrong for a third
 *    of the roster.
 * 3. Model descriptions are the ONE thing the pack cannot answer. Its
 *    `model.list` keeps only `id`, `name` and two flags, so descriptions come
 *    from the host's catalogue — the same one the model picker reads.
 *
 * @module dsh-xdpool/client/ChannelPoolSection
 */

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { BrandTile } from './brand-tile.tsx'
import { channelIcon, channelInitials } from './channel-icons.ts'
import { ModelFactsRow } from './model-facts-row.tsx'
import { modelFactsFor, formatModelCapacity, type ModelFacts, baseName, multiplierOf, multiplierTone } from './model-facts.ts'
import { recommendUse } from './recommend-use.ts'
import { PASTE_ROUTES, WINDOW_LOGIN_ROUTES, canStartLoginInPlace, loginKindOf } from './login-routes.ts'
import {
  accountsFrom,
  autoCheckinFrom,
  balancesFrom,
  balancesTotal,
  balanceAmount,
  balancePackages,
  callPack,
  claimResultFrom,
  createdFrom,
  creditStatusesFrom,
  fetchChannelModels,
  fetchChannels,
  modelsFrom,
  pollFrom,
  providerStatusesFrom,
  setChannelModelContextBudget,
  sortChannelModels,
  type ChannelBalance,
  type ChannelCreditPackage,
  type ChannelCreditStatus,
  type ChannelModel,
  type ChannelProviderStatus,
} from './channel-rpc.ts'
import type { ChannelAccount, ChannelRpcEnvelope } from '../channels.ts'
import {
  POOL_ASTUDIO_WALLET_PATH,
  POOL_ACCIO_QUOTA_PATH,
  POOL_MONKEYCODE_CN_WALLET_PATH,
  POOL_MONKEYCODE_INTL_WALLET_PATH,
  POOL_BAIZHI_WALLET_PATH,
  POOL_AUTOCLAW_INTL_WALLET_PATH,
  POOL_AUTOCLAW_CN_WALLET_PATH,
  POOL_ASTUDIO_SESSION_PATH,
  POOL_ACCIO_SESSION_PATH,
  POOL_MONKEYCODE_CN_SESSION_PATH,
  POOL_BAIZHI_SESSION_PATH,
  POOL_AUTOCLAW_CN_SESSION_PATH,
  POOL_AUTOCLAW_INTL_SESSION_PATH,
  POOL_ASTUDIO_CHECKIN_PATH,
  POOL_BAIZHI_CHECKIN_PATH,
  POOL_MAGICREW_CN_CHECKIN_PATH,
  POOL_MAGICREW_INTL_CHECKIN_PATH,
  POOL_MAGICREW_CN_WALLET_PATH,
  POOL_MAGICREW_INTL_WALLET_PATH,
  POOL_ACCOUNT_PREFER_PATH,
  POOL_CHANNEL_USAGE_PATH,
} from '../status-paths.ts'

import {
  POOL_CATALOG_REFRESH_PATH,
  POOL_DOUBAO_CLAIM_PATH,
  POOL_DOUBAO_MODELS_PATH,
  POOL_DOUBAO_QUOTA_PATH,
  POOL_DOUBAO_SESSION_PATH,
  POOL_MARVIS_SESSION_PATH,
  POOL_MARVIS_WALLET_PATH,
} from '../status-paths.ts'
// The DATA module, not `doubao-llm.ts`: the latter reaches `node:fs`/`node:child_process`
// through the auth module, and a client bundle containing those does not load at all.
import { doubaoListing } from '../doubao-models.ts'
import { REGISTERED_CHANNELS } from '../channel-roster.ts'
import { DoubaoAutomationPane } from './DoubaoAutomationPane.tsx'
import type { PoolDistribution, PoolWebChannel, PoolWebChannelModel } from '../status-paths.ts'
import type { XdPoolSettingsKey } from './locales.ts'

type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string

/**
 * The last good answer, kept OUTSIDE the component.
 *
 * Switching tabs unmounts this section — the page body is a three-way ternary —
 * so component state cannot survive a tab change and every return re-ran the
 * whole chain, showing blank cards for the 2-4 seconds it took (#102). A
 * module-level store is the only place a value can live across mounts, which is
 * what lets the first frame after a remount render the previous cards and
 * revalidate behind them.
 *
 * Written BEFORE the `mountedRef` checks, deliberately: a request that lands
 * after this component unmounted still carries a correct answer, and it belongs
 * in the store whether or not anybody is looking at it. Ordering it the other
 * way is what made the previous code throw away results it had already paid
 * for — "the answer arrived while the reader was away".
 */
interface ChannelPoolSnapshot {
  entries: readonly ChannelEntry[]
  /** The failure the last attempt reported, or undefined when it succeeded. */
  error?: string | undefined
}
let poolSnapshot: ChannelPoolSnapshot | undefined

/**
 * The last answered counts, kept on disk so a RESTART does not start from zero.
 *
 * The in-memory snapshot above survives a tab switch; it does not survive the process, so
 * every launch of DSH re-walked thirteen account pools before the cards could show a number —
 * which is the "why is it loading again" a reader feels on each start.
 *
 * Only the counts and the balances are stored, never credentials: the card draws a number
 * whose worst case is being stale, and a stale number is what the reader already expects on
 * the first frame. The first successful read replaces it.
 *
 * Versioned, because the shape will change and a stale blob must not be fed to new code.
 */
const COUNTS_STORE_KEY = 'dsh-xdpool.channel-counts.v1'

/** Where Doubao's own model selection lives. Versioned for the same reason as the counts. */
const DOUBAO_SKIP_KEY = 'dsh-xdpool.doubao-skipped-models.v1'

/**
 * Whether the user pressed 「全关」 on the Doubao card.
 *
 * Kept beside the skip list because the skip list cannot express it: pressing
 * 全关 before the roster has loaded writes `[]`, which reads back as "nothing
 * switched off" and left the picker showing every model. This flag says exactly
 * what was pressed, and survives a card reopen.
 */
const DOUBAO_HIDE_ALL_KEY = 'dsh-xdpool.doubao-hide-all.v1'

/** Read the 「全关」 flag; false when it was never set. */
function readDoubaoHideAll(): boolean {
  try {
    return globalThis.localStorage?.getItem(DOUBAO_HIDE_ALL_KEY) === 'true'
  } catch {
    return false
  }
}

/** Record the 「全关」 flag. */
function saveDoubaoHideAll(hidden: boolean): void {
  try {
    if (hidden) globalThis.localStorage?.setItem(DOUBAO_HIDE_ALL_KEY, 'true')
    else globalThis.localStorage?.removeItem(DOUBAO_HIDE_ALL_KEY)
  } catch {
    // A blocked storage leaves the flag unset; the id list still carries the rest.
  }
}

/**
 * The Doubao models the user switched off.
 *
 * `undefined` means "never configured", which is different from "none switched off": the first
 * shows everything, the second shows nothing. Collapsing them would make a fresh account look
 * as though the user had already made choices.
 */
function readDoubaoSkipped(): ReadonlySet<string> | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(DOUBAO_SKIP_KEY)
    if (raw === null || raw === undefined) return undefined
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return undefined
    return new Set(parsed.filter((id): id is string => typeof id === 'string'))
  } catch {
    return undefined
  }
}

/** Record one model as switched off, or back on. */
async function saveDoubaoSkipped(modelId: string, disabled: boolean): Promise<void> {
  const current = readDoubaoSkipped() ?? new Set<string>()
  const next = new Set(current)
  if (disabled) next.add(modelId)
  else next.delete(modelId)
  globalThis.localStorage?.setItem(DOUBAO_SKIP_KEY, JSON.stringify([...next]))
}

/**
 * The disable-list last pushed to the host (this browser session), for dedupe.
 *
 * The card re-reads itself after every action, and every read mirrors — without
 * the fingerprint a single toggle would POST three times.
 */
let lastMirroredDoubaoDisabled: string | undefined

/**
 * Push this browser's Doubao ticks into the host — issue #196.
 *
 * The picker is built in the host process, which cannot read this card's
 * localStorage; without the mirror it published the whole live roster however
 * few models the card showed as enabled ("4/16" on the card, 16 in the picker).
 *
 * An UNSAVED list is not pushed: `readDoubaoSkipped() === undefined` is "the
 * user never touched a tick", and leaving the host at its default (`[]`, meaning
 * "nothing switched off, show everything") is the honest reading. Pushing `[]`
 * there would be the same value but a different claim — and it also means a
 * cleared browser can never wipe a list the host is still honouring.
 *
 * A refused write is not recorded as mirrored, so the next card read retries it.
 */
async function mirrorDoubaoDisabled(): Promise<void> {
  const skipped = readDoubaoSkipped()
  const hideAll = readDoubaoHideAll()
  if (skipped === undefined && !hideAll) return
  const ids = [...(skipped ?? [])]
  // The flag is part of the fingerprint: 全关 then 全开 sends the same (empty)
  // list twice, and the second one has to reach the host or the picker stays
  // empty.
  const fingerprint = JSON.stringify([[...ids].sort(), hideAll])
  if (fingerprint === lastMirroredDoubaoDisabled) return
  try {
    const response = await fetch(POOL_DOUBAO_MODELS_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      // A Set serialises to `{}`, so the array is spelled out here.
      body: JSON.stringify({ disabledModelIds: ids, hideAll }),
    })
    // fetch does not reject on 4xx/5xx: a refused write stays unrecorded and is
    // retried on the next card read or toggle, not silently marked mirrored.
    if (!response.ok) return
    lastMirroredDoubaoDisabled = fingerprint
  } catch {
    // Host unreachable or the route is not mounted: the local tick still holds.
  }
}

/** What is stored per channel: counts, not accounts. */
interface StoredCounts {
  /** Epoch ms of the read that produced these numbers. */
  at: number
  channels: Record<string, { accounts: number; models: number; balance?: number; unit?: string }>
}

/** Read the stored counts, or undefined when there is nothing usable. */
function readStoredCounts(): StoredCounts | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(COUNTS_STORE_KEY)
    if (raw === null || raw === undefined) return undefined
    const parsed = JSON.parse(raw) as Partial<StoredCounts>
    if (typeof parsed.at !== 'number' || typeof parsed.channels !== 'object' || parsed.channels === null) {
      return undefined
    }
    return parsed as StoredCounts
  } catch {
    return undefined
  }
}

/** Store the counts as they are now. Failure is ignored: a full quota must not break a card. */
function writeStoredCounts(entries: readonly ChannelEntry[]): void {
  try {
    const channels: StoredCounts['channels'] = {}
    for (const entry of entries) {
      const enabled = entry.accounts.filter(account => account.enabled !== false).length
      const total = balancesTotal(entry.balances)
      channels[entry.channel.id] = {
        accounts: entry.accounts.length === 0 ? enabled : entry.accounts.length,
        models: entry.models.length,
        ...(total === undefined ? {} : { balance: total }),
      }
    }
    globalThis.localStorage?.setItem(COUNTS_STORE_KEY, JSON.stringify({ at: Date.now(), channels }))
  } catch {
    // Private mode, a full quota, or no DOM: the counts simply are not remembered.
  }
}
/**
 * `provider.status` answered recently, kept across unmounts.
 *
 * One request counts EVERY named provider's accounts, so its cost is the sum of
 * thirteen pool walks. Re-running that on the next visit, for numbers that cannot
 * have moved, is what made this section feel slow on every open while the login page
 * (static metadata, no counting) appeared instantly.
 *
 * Module-level rather than component state on purpose: switching settings tabs
 * unmounts the section, and the whole point is that coming back is cheap.
 */
let providerStatusCache: { at: number; key: string; answer: ChannelRpcEnvelope } | undefined
const PROVIDER_STATUS_TTL_MS = 30_000

/**
 * 丢掉账号数缓存。
 *
 * 30 秒的缓存让「回到账号池」很便宜，但登录完一个账号后它就是错的：
 * 登录通道（不走缓存）显示 3，账号池（走缓存）还显示 1，要等半分钟才对上。
 * 任何会改变账号数量的动作之后都调一次。
 */
export function invalidateProviderStatusCache(): void {
  providerStatusCache = undefined
}

/**
 * Channels whose rewards are collected through `onboarding.claim`, not a daily
 * check-in.
 *
 * Kept as a literal rather than derived from `channel.credits`, because the two
 * rewards are different in kind: `credits.claim` is repeatable tomorrow and pays
 * daily points, while these pay once per account and are then gone. The pack exposes
 * them on separate endpoints for exactly that reason, and a channel can have either,
 * both, or neither:
 *
 *   - `raccoon` — the daily points arrive on their own (the server credits them),
 *     so its `credits` field is EMPTY on purpose. Only the desktop-login bonus is
 *     claimable, and it lives here.
 *   - `loomy` — onboarding tasks, topped up to a maximum rather than granted per
 *     task.
 *
 * Both are implemented in the pack; before this the card simply never called the
 * endpoint, so a signed-in Raccoon account had no way to collect the bonus its own
 * note told the reader to look for.
 */
const ONBOARDING_CHANNELS: ReadonlySet<string> = new Set(['raccoon', 'loomy'])

/**
 * Drop the snapshot after anything that changes the data behind it.
 *
 * Logins, deletions, toggles and manual balance refreshes all make the snapshot
 * stale in a way a silent revalidation cannot hide: showing yesterday's account
 * list for a card the user just added an account to is worse than showing the
 * "reading" line for a moment.
 *
 * The provider-status cache is dropped with it, or a rescan that just found an
 * account would be invisible behind a 30-second-old count.
 */
export function invalidatePoolSnapshot(): void {
  poolSnapshot = undefined
  providerStatusCache = undefined
}

/** Which of the two lists a card has open. At most one, like the reference. */
type Fold = 'accounts' | 'models'

/** How many automatic retries a cold-start mount gets before giving up. */
const LOAD_RETRIES = 5
/** Gap between those retries, in milliseconds. */
const RETRY_INTERVAL_MS = 2_000

/**
 * Channels whose accounts are shown by the two region cards instead.
 *
 * `buddy` (CodeBuddy CN) and `workbuddy` (WorkBuddy international) are the
 * two lanes the pool itself serves. A scan login for either writes into the
 * same place the desktop app's credentials land, so listing them again as
 * channel cards would show every account twice — once with credits and
 * cooldowns, once bare. They are filtered out here rather than special-cased
 * in the renderer, so an account added on the login page shows up in exactly
 * one place no matter which path created it.
 */
/**
 * The catalogue length at which a model search box earns its place.
 *
 * Below this the reader scrolls faster than they type, and the field would be
 * one more control to look past on every card.
 */
const MODEL_SEARCH_THRESHOLD = 8

/** 设计稿 policies 分段按钮的顺序：优先 · 轮换 · 均衡 · 粘住 · 按到期。 */
const MODE_ORDER: readonly PoolDistribution[] = ['priority', 'round-robin', 'balanced', 'sticky', 'expiry']
/** 五种策略的中文名。 */
const MODE_LABEL: Record<PoolDistribution, (tr?: Translate) => string> = {
  priority: tr => tr?.('channelpool.modePrefer') ?? '优先',
  'round-robin': tr => tr?.('channelpool.modeRoundRobin') ?? '轮换',
  balanced: tr => tr?.('channelpool.modeBalanced') ?? '均衡',
  sticky: tr => tr?.('channelpool.modeSticky') ?? '粘住',
  expiry: tr => tr?.('channelpool.modeExpiry') ?? '按到期',
}
function modeHint(tr: Translate | undefined, mode: PoolDistribution): string {
  if (mode === 'round-robin') return tr?.('channelpool.modeRoundRobinHint') ?? '轮换：每次请求依次用下一个账号。'
  if (mode === 'balanced') return tr?.('channelpool.modeBalancedHint') ?? '均衡：在还有额度的账号里随机挑。'
  if (mode === 'sticky') return tr?.('channelpool.modeStickyHint') ?? '粘住：一直用同一个，直到它不行了。'
  if (mode === 'expiry') return tr?.('channelpool.modeExpiryHint') ?? '按到期：先用即将到期的账号。'
  return tr?.('channelpool.modePreferHint') ?? '优先：总用排在前面的账号，它限流了才换下一个。'
}
/** channels/usage 路由的回答。 */
interface ChannelUsageState {
  pool?: string
  channels?: Record<string, string>
}

/**
 * The window a channel model is capped to when the user does not ask for more.
 *
 * Same number as the region cards' `DEFAULT_CONTEXT_BUDGET`, and for the same
 * reason: a published window is a ceiling the vendor supports, not a size every
 * request can carry, so the picker offers a conservative default next to the
 * native figure instead of presenting the maximum as the everyday choice.
 */
const CONTEXT_BUDGET_DEFAULT = 200_000

/**
 * 由区域卡管理的渠道。
 *
 * 曾经这个集合把 buddy / workbuddy 排除在外，因为它们的两张汇总卡
 * （WorkBuddy 国内版 / 国际版）由 PoolCard 单独渲染。
 *
 * 那两张卡已经不渲染了 —— 它们和渠道详情各占一格，把三列挤成一坨。
 * 所以这两家必须回到中栏，否则读者根本看不到自己能登什么。
 */
const REGION_OWNED_CHANNELS: ReadonlySet<string> = new Set()

interface ChannelEntry {
  channel: PoolWebChannel
  accounts: readonly ChannelAccount[]
  models: readonly ChannelModel[]
  /** Host-catalogue facts, keyed by model id. Empty when the host refused. */
  facts: ReadonlyMap<string, PoolWebChannelModel>
  /** One balance row per account, in the pack's order. */
  balances: readonly ChannelBalance[]
  /** Today's check-in state, when the pack reports one. */
  statuses: readonly ChannelCreditStatus[]
  /** True while the first balance read is in flight. */
  balancePending: boolean
  /** Why the balance read failed, in the pack's words. */
  balanceError?: string | undefined
  /**
   * Why `model.list` could not answer, when it refused. Surfaced instead of
   * being folded into "no models published": the pack's `model.list` needs the
   * host's `llm` service, and when that service is missing it answers an error
   * for a channel that in fact publishes a full catalogue.
   */
  modelError?: string | undefined
  /** The counts the pack reports, for the numbers row. */
  status?: ChannelProviderStatus | undefined
}

/**
 * Collapse repeated sign-ins of the same person into one row.
 *
 * The pack's `account.create` appends unconditionally — it has no idea an
 * account with the same nickname already exists — so clicking "add account"
 * twice leaves two entries. The pack prunes them on disk, but the prune only
 * runs at mount and on the next login, so a card can still render the
 * pre-prune list. Same provider plus same nickname is the same person (the
 * pack rewrites the nickname from a random id to the real display name the
 * moment a login lands), so the newest entry wins: it is the one whose
 * credential was written last.
 */
/**
 * Doubao's account, described in the pack's account shape.
 *
 * The lane is the plugin's own, so this reads its session route and translates the answer
 * into the row the rest of this page already knows how to draw. `undefined` means "no
 * session", which is the ordinary state before a sign-in.
 */
async function readDoubaoAccount(): Promise<ChannelAccount | undefined> {
  try {
    const response = await fetch(POOL_DOUBAO_SESSION_PATH, { credentials: 'same-origin' })
    const body = await response.json().catch(() => undefined) as
      | { signedIn?: boolean; savedAt?: string; name?: string }
      | undefined
    if (body?.signedIn !== true) return undefined
    return {
      id: 'doubao:session',
      provider: 'doubao',
      // The vendor's own name for the user, so two Doubao accounts are distinguishable.
      nickname: typeof body.name === 'string' && body.name !== '' ? body.name : '豆包账号',
      enabled: true,
    }
  } catch {
    return undefined
  }
}

/**
 * Doubao's quota, in the pack's balance row shape.
 *
 * The card prints one number per account, so it is the NARROWEST window: that is the one
 * that stops the next request, and reporting the widest would overstate what is left.
 */
/**
 * The models Doubao's account may use, from the plugin's own route.
 *
 * The card used to build this list from the static catalogue while the picker read the
 * account's live roster, so the two could disagree — six on the card, twelve in the picker.
 */
async function readDoubaoModels(): Promise<readonly { id: string; name: string; description?: string }[]> {
  try {
    const response = await fetch(POOL_DOUBAO_MODELS_PATH, { credentials: 'same-origin' })
    const body = await response.json().catch(() => undefined) as
      | { models?: { id?: string; name?: string; badge?: string; rate?: string; contextWindow?: number }[] }
      | undefined
    const models = Array.isArray(body?.models) ? body.models : []
    const rows = models
      .filter(model => typeof model.id === 'string' && typeof model.name === 'string')
      .map(model => ({
        id: model.id as string,
        /**
         * The multiplier is joined onto the name because that is the shape the card already
         * understands — every other channel writes it there (`DeepSeek-V4.1-Flash · x0.11`), and
         * `multiplierOf` splits it back out into its own badge. Doing it here keeps ONE rule for
         * every vendor instead of a Doubao-shaped exception in the renderer.
         */
        name: typeof model.rate === 'string' && model.rate !== ''
          ? `${model.name as string} · ${model.rate}`
          : model.name as string,
        ...(typeof model.badge === 'string' && model.badge !== '' ? { description: model.badge } : {}),
        ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
      }))
    /**
     * Close the restart gap — issue #196.
     *
     * A tick made before this fix, or in an earlier browser session, would leave
     * the host's list stale until the user happened to toggle something. Every
     * card read re-pushes the stored list, so opening the Doubao card once is
     * enough to make the picker agree with it.
     */
    await mirrorDoubaoDisabled()
    return rows
  } catch {
    return doubaoListing()
  }
}

async function readDoubaoBalance(): Promise<readonly ChannelBalance[]> {
  try {
    const response = await fetch(POOL_DOUBAO_QUOTA_PATH, { credentials: 'same-origin' })
    const body = await response.json().catch(() => undefined) as
      | {
        signedIn?: boolean
        error?: string
        windows?: {
          type?: string
          label?: string
          usedPercent?: number
          remainingPercent?: number
          usedAmount?: number
          totalAmount?: number
        }[]
      }
      | undefined
    if (body?.signedIn !== true) return []
    const windows = Array.isArray(body.windows) ? body.windows : []
    if (windows.length === 0) {
      return [{
        accountId: 'doubao:session',
        nickname: '豆包账号',
        ...(typeof body.error === 'string' && body.error !== '' ? { error: body.error } : {}),
      }]
    }
    /**
     * One package per quota window, so the card's own expander lists them the way it lists a
     * WorkBuddy account's several credit buckets.
     *
     * The headline figure is the points actually left, summed across windows — that is what a
     * user reads as "my credits". Each package also carries its own remaining percentage and
     * total for the expanded view.
     */
    const packages = windows.map(window => {
      const remainingPercent = typeof window.remainingPercent === 'number'
        ? window.remainingPercent
        : Math.max(0, 100 - (typeof window.usedPercent === 'number' ? window.usedPercent : 0))
      const total = typeof window.totalAmount === 'number' ? window.totalAmount : undefined
      const used = typeof window.usedAmount === 'number' ? window.usedAmount : undefined
      const points = total !== undefined && used !== undefined ? Math.max(0, total - used) : undefined
      return {
        name: typeof window.label === 'string' && window.label !== '' ? window.label : '额度',
        unit: '点',
        remaining: remainingPercent,
        ...(total === undefined ? {} : { total }),
        ...(points === undefined ? {} : { points }),
      }
    })
    const pointsLeft = packages.reduce((sum, entry) => sum + (typeof entry.points === 'number' ? entry.points : 0), 0)
    const lowestPercent = packages.reduce((low, entry) => Math.min(low, entry.remaining), 100)
    return [{
      accountId: 'doubao:session',
      nickname: '豆包账号',
      balance: pointsLeft > 0 ? pointsLeft : Math.round(lowestPercent),
      extra: { unit: pointsLeft > 0 ? '点' : '%', windows: windows.length },
      packages,
    }]
  } catch {
    return []
  }
}
/* ---------------------------------------------------------------
   腾讯 Marvis：按 token 计的渠道（设计稿 marvis.html）。

   pack 没有 Marvis 适配器，account.list / model.list / credits.balances 都会答
   "unknown provider"，所以和豆包一样走插件自己的路由：
     - POOL_MARVIS_SESSION_PATH：存下的账号（openid / nickname / loginType）和模型
     - POOL_MARVIS_WALLET_PATH：每个账号自己的 token 钱包（accounts 数组，一号一行）
   每个账号每天有自己的 1000 万计费 token，卡片上画的是「已用 / 总量 + 重置时间」，
   不是渠道级别的汇总。
   --------------------------------------------------------------- */

/** 一个 Marvis 账号今天的 token 用量。 */
interface MarvisQuota {
  openid: string
  nickname?: string | undefined
  used: number
  total: number
  available: number
  /** 今日额度重置的时刻（epoch ms）；后端没给就是 undefined。 */
  resetAt?: number | undefined
  /** 读不到时的原因（已转成中文）。 */
  error?: string | undefined
}

/** 上一次读到的用量，放在组件外面：切页回来第一帧就有数，不闪「…」。 */
let marvisQuotaSnapshot: readonly MarvisQuota[] | undefined

/* ---------------------------------------------------------------
   整份账号池快照，存在本机（localStorage）。

   为什么：每次打开 DSH，账号池都要等 provider.status 把二十多家的账号池走一遍、
   再逐家 account.list / model.list，冷启动要好几秒，读者看到的是一排「—」。
   而上一次读到的账号和模型，99% 的情况下和这一次一样。

   所以：第一帧直接画上一次的真实数据（账号名、模型、余额），后台照常重读，
   读完再无声替换。读者感觉是「瞬时」的，数据也不会因此变旧 —— 旧的只多活几秒。

   存什么：只存显示用的字段。账号只留 id / 昵称 / 开关 / 到期时间 / 首选，
   不含任何 token 或 cookie（accountsFrom 本来就不带凭据，这里再白名单一遍）。
   版本号 v2：结构变了就换 key，旧 blob 不会喂给新代码。
   --------------------------------------------------------------- */
const POOL_STORE_KEY = 'dsh-xdpool.pool-snapshot.v2'
/** 太旧的快照不用：一周没打开过，账号很可能已经变了，宁可显示占位。 */
const POOL_STORE_MAX_AGE_MS = 7 * 24 * 3_600_000

interface StoredPool {
  v: 2
  at: number
  entries: readonly ChannelEntry[]
  marvis?: readonly MarvisQuota[] | undefined
}

let storedPoolCache: StoredPool | null | undefined
/** 读一次就记住：初始化 entries 和 Marvis 用量都要它，不读两遍 localStorage。 */
function storedPoolOnce(): StoredPool | undefined {
  if (storedPoolCache !== undefined) return storedPoolCache ?? undefined
  storedPoolCache = readStoredPool() ?? null
  return storedPoolCache ?? undefined
}

function readStoredPool(): StoredPool | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(POOL_STORE_KEY)
    if (raw === null || raw === undefined) return undefined
    const parsed = JSON.parse(raw) as Partial<StoredPool> | null
    if (parsed === null || parsed.v !== 2 || typeof parsed.at !== 'number') return undefined
    if (Date.now() - parsed.at > POOL_STORE_MAX_AGE_MS) return undefined
    if (!Array.isArray(parsed.entries)) return undefined
    const entries: ChannelEntry[] = []
    for (const row of parsed.entries as unknown[]) {
      if (row === null || typeof row !== 'object') continue
      const entry = row as Partial<ChannelEntry>
      if (typeof entry.channel?.id !== 'string') continue
      entries.push({
        channel: entry.channel,
        accounts: Array.isArray(entry.accounts) ? entry.accounts : [],
        models: Array.isArray(entry.models) ? entry.models : [],
        facts: new Map(),
        balances: Array.isArray(entry.balances) ? entry.balances : [],
        statuses: Array.isArray(entry.statuses) ? entry.statuses : [],
        // 存下来的余额就是答案，不再画「…」；后台重读到了会替换
        balancePending: false,
        balanceError: undefined,
        modelError: undefined,
        status: entry.status,
      })
    }
    if (entries.length === 0) return undefined
    return {
      v: 2,
      at: parsed.at,
      entries,
      ...(Array.isArray(parsed.marvis) ? { marvis: parsed.marvis } : {}),
    }
  } catch {
    return undefined
  }
}

/** 写快照。配额满了、隐私模式都静默失败：缓存写不进去不能让卡片坏掉。 */
function writeStoredPool(entries: readonly ChannelEntry[], marvis: readonly MarvisQuota[] | undefined): void {
  try {
    const slim = entries.map(entry => ({
      channel: entry.channel,
      accounts: entry.accounts.map(account => ({
        id: account.id,
        provider: account.provider,
        ...(account.nickname === undefined ? {} : { nickname: account.nickname }),
        ...(account.enabled === undefined ? {} : { enabled: account.enabled }),
        ...(account.expiresAt === undefined ? {} : { expiresAt: account.expiresAt }),
        ...(account.refreshable === true ? { refreshable: true } : {}),
        ...(account.preferred === true ? { preferred: true } : {}),
      })),
      // 介绍太长的截一下，整份快照控制在几百 KB 以内
      models: entry.models.map(model => (model.description !== undefined && model.description.length > 160
        ? { ...model, description: model.description.slice(0, 160) }
        : model)),
      balances: entry.balances,
      statuses: entry.statuses,
      ...(entry.status === undefined ? {} : { status: entry.status }),
    }))
    const blob: StoredPool = { v: 2, at: Date.now(), entries: slim as unknown as ChannelEntry[], ...(marvis === undefined ? {} : { marvis }) }
    globalThis.localStorage?.setItem(POOL_STORE_KEY, JSON.stringify(blob))
  } catch {
    // 写不进去就算了，下次照常从后端读
  }
}

/** Marvis 的账号与模型。没登录 / 读不到都答 undefined。 */
async function readMarvisSession(): Promise<
  { accounts: readonly ChannelAccount[]; models: readonly { id: string; name: string }[] } | undefined
> {
  try {
    const response = await fetch(POOL_MARVIS_SESSION_PATH, { credentials: 'same-origin' })
    const body = await response.json().catch(() => undefined) as
      | {
        signedIn?: boolean
        accounts?: readonly { openid?: unknown; nickname?: unknown; loginType?: unknown }[]
        models?: readonly { id?: unknown; name?: unknown }[]
      }
      | undefined
    if (body?.signedIn !== true || !Array.isArray(body.accounts)) return undefined
    const accounts: ChannelAccount[] = []
    for (const row of body.accounts) {
      if (typeof row.openid !== 'string' || row.openid === '') continue
      accounts.push({
        id: row.openid,
        provider: 'marvis',
        ...(typeof row.nickname === 'string' && row.nickname !== '' ? { nickname: row.nickname } : {}),
        enabled: true,
      })
    }
    const models = (Array.isArray(body.models) ? body.models : [])
      .filter((model): model is { id: string; name: string } =>
        typeof model.id === 'string' && model.id !== '' && typeof model.name === 'string')
    return { accounts, models }
  } catch {
    return undefined
  }
}

/** 后端给的英文错误换成中文；认不出来的就说一句通用的，不把英文原样摆出来。 */
function marvisErrorText(raw: string): string {
  const status = /HTTP\s+(\d{3})/u.exec(raw)?.[1]
  if (status === '401') return '登录已失效，请重新登录这个账号'
  if (status === '403') return '今日额度已用完或账号受限'
  if (status !== undefined) return `用量读取失败（${status}）`
  if (/timeout|aborted|timed out/iu.test(raw)) return '用量读取超时'
  if (/[\u4e00-\u9fff]/u.test(raw)) return raw
  return '用量读取失败'
}

/** 每个账号自己的 token 用量。整个请求失败答空数组，卡片上显示「—」。 */
async function readMarvisQuotas(): Promise<readonly MarvisQuota[]> {
  try {
    const response = await fetch(POOL_MARVIS_WALLET_PATH, { credentials: 'same-origin' })
    const body = await response.json().catch(() => undefined) as
      | {
        signedIn?: boolean
        accounts?: readonly {
          openid?: unknown
          nickname?: unknown
          used?: unknown
          total?: unknown
          available?: unknown
          resetAt?: unknown
          error?: unknown
        }[]
      }
      | undefined
    if (body?.signedIn !== true || !Array.isArray(body.accounts)) return []
    const num = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0
    const rows: MarvisQuota[] = []
    for (const row of body.accounts) {
      if (typeof row.openid !== 'string' || row.openid === '') continue
      const used = num(row.used)
      const total = num(row.total)
      rows.push({
        openid: row.openid,
        nickname: typeof row.nickname === 'string' && row.nickname !== '' ? row.nickname : undefined,
        used,
        total,
        available: typeof row.available === 'number' ? num(row.available) : Math.max(0, total - used),
        resetAt: typeof row.resetAt === 'number' && Number.isFinite(row.resetAt) ? row.resetAt : undefined,
        error: typeof row.error === 'string' && row.error !== '' ? marvisErrorText(row.error) : undefined,
      })
    }
    return rows
  } catch {
    return []
  }
}

/**
 * 「今天 24:00 重置」「8 小时后重置」「3 天后重置」。
 *
 * 不到一小时说分钟，不到一天说小时；今天之内并且整点落在午夜的，直接说「今天 24:00」。
 */
function marvisResetText(resetAt: number | undefined, now: number = Date.now()): string {
  if (resetAt === undefined) return '每天重置'
  const left = resetAt - now
  if (left <= 0) return '即将重置'
  const minutes = Math.ceil(left / 60_000)
  if (minutes < 60) return `${String(minutes)} 分钟后重置`
  const hours = Math.round(left / 3_600_000)
  if (hours < 24) return `${String(hours)} 小时后重置`
  const days = Math.round(left / 86_400_000)
  return `${String(days)} 天后重置`
}

/** 鼠标悬停时给出的绝对时间：「今天 24:00 重置」「11月25日 00:00 重置」。 */
function marvisResetTitle(resetAt: number | undefined, now: number = Date.now()): string | undefined {
  if (resetAt === undefined) return undefined
  const at = new Date(resetAt)
  const today = new Date(now)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const tomorrow = new Date(now + 86_400_000)
  /* 落在明天 0 点的，就是「今天 24:00」 */
  if (sameDay(at, tomorrow) && at.getHours() === 0 && at.getMinutes() === 0) return '今天 24:00 重置'
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  if (sameDay(at, today)) return `今天 ${clock} 重置`
  return `${String(at.getMonth() + 1)}月${String(at.getDate())}日 ${clock} 重置`
}

/** 1234567 → 「1,234,567」。 */
function groupDigits(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

/** 2000_0000 → 「2,000」（单位万）。 */
function wanDigits(value: number): string {
  return (value / 10_000).toLocaleString('en-US', { maximumFractionDigits: 1 })
}

/**
 * The catalogue as cards, with no counts.
 *
 * Built from the same constant the host serves, so the placeholder is never a different list
 * from the real one — only a list without measurements. Every action is absent, which is what
 * makes it safe: a button on a card whose data has not arrived would act on nothing.
 */
function placeholderEntries(): readonly ChannelEntry[] {
  /**
   * Counts from the last run are fed in as SYNTHETIC rows.
   *
   * A card needs an account row to print a number, and inventing four of them would put four
   * sign-ins on screen that do not exist. Instead each stored count becomes ONE row standing
   * for the group, which the card renders as "4" — and the first real answer replaces the whole
   * entry, so the placeholder never outlives a successful read.
   */
  const stored = readStoredCounts()
  return REGISTERED_CHANNELS
    .filter(channel => !REGION_OWNED_CHANNELS.has(channel.id))
    .map(channel => {
      const known = stored?.channels[channel.id]
      const accountRows = known === undefined || known.accounts <= 0
        ? []
        : Array.from({ length: known.accounts }, (unused, index) => ({
          id: `cached-${channel.id}-${String(index)}`,
          provider: channel.id,
          // A placeholder row is numbered, not named: naming it would claim an identity the
          // cache does not hold.
          nickname: `—`,
          enabled: true,
        })) as ChannelAccount[]
      return {
        // The roster row IS the card's catalogue half: same name, note, accent and icon.
        channel: { ...channel, loginKind: channel.login, ownedByPool: channel.ownedByPool === true } as PoolWebChannel,
        accounts: accountRows,
        models: known === undefined || known.models <= 0
          ? []
          : Array.from({ length: known.models }, (unused, index) => ({
            id: `cached-${channel.id}-m${String(index)}`,
            name: '',
          })) as PoolWebChannelModel[],
        facts: new Map(),
        balances: known?.balance === undefined
          ? []
          : [{ accountId: `cached-${channel.id}-0`, balance: known.balance }] as ChannelBalance[],
        statuses: [],
        status: undefined,
        balancePending: known?.balance === undefined,
      }
    })
}

function dedupeAccounts(accounts: readonly ChannelAccount[]): readonly ChannelAccount[] {
  const byNickname = new Map<string, ChannelAccount>()
  const order: string[] = []
  for (const account of accounts) {
    const nickname = (account.nickname ?? '').trim()
    const key = nickname === '' ? `id:${account.id}` : `n:${nickname}`
    const kept = byNickname.get(key)
    if (kept === undefined) {
      byNickname.set(key, account)
      order.push(key)
      continue
    }
    byNickname.set(key, account)
  }
  return order.map(key => byNickname.get(key)).filter((account): account is ChannelAccount => account !== undefined)
}

/** A refusal shaped like the pack's own envelope, so one catch covers both. */
function refused(message: string): ChannelRpcEnvelope {
  return { ok: false, error: { message } }
}

/**
 * "3 days left" / "expired" / "no expiry", from a millisecond stamp.
 *
 * `never` is the honest answer for the channels whose credentials carry no
 * expiry at all (ZCode among them), and printing "expired" or a date for those
 * would be a number the user cannot check.
 */
function expiryText(
  expiresAt: number | undefined,
  t: Translate | undefined,
): string | undefined {
  if (expiresAt === undefined || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    return t?.('channelpool.expiryNever') ?? 'no expiry'
  }
  // Two defects fixed here, both of which made the label actively misleading:
  //
  // 1. An EXPIRED credential used to return the "no expiry" string. `days <= 0`
  //    covered both a negative value (already past) and zero (due today), and it
  //    shared the placeholder meant for channels that carry no expiry at all
  //    (ZCode among them). A CodeArts row whose STS token had lapsed read
  //    "长期有效" while the balance cell beside it said
  //    `APIG.0602: the security token has expired` — one row contradicting
  //    itself, each half pointing at a different, wrong fix (#114).
  //
  // 2. `Math.ceil(days)` collapsed every sub-day remainder into "1d", so the
  //    rows with the MOST urgent clocks (CodeArts STS tokens live about two
  //    hours) were exactly the ones that could never show one.
  //
  // So: a past stamp is its own state, and the unit steps down to hours and then
  // minutes as the deadline approaches. "no expiry" now means only what it says.
  const remainingMs = expiresAt - Date.now()
  if (remainingMs <= 0) return t?.('channelpool.expiryExpired') ?? 'expired'
  const minutes = Math.floor(remainingMs / 60_000)
  if (minutes < 60) return minutes <= 1 ? '不到 1 分钟后过期' : `${String(minutes)} 分钟后过期`
  const hours = Math.floor(remainingMs / 3_600_000)
  if (hours < 24) return `${String(hours)} 小时后过期`
  const days = Math.floor(remainingMs / 86_400_000)
  return `${String(days)} 天后过期`
}

/** The vendor's currency, spelled the way that vendor spells it. */
function creditUnitLabel(channel: PoolWebChannel, t: Translate | undefined): string {
  const unit = channel.credits?.unit
  if (unit === 'dollars') return t?.('channelpool.creditsDollar') ?? 'USD'
  if (unit === 'tokens') return t?.('channelpool.creditsToken') ?? 'tokens'
  if (channel.credits?.quota === true) return t?.('channelpool.creditsQuota') ?? 'quota'
  return t?.('channelpool.creditsUnit') ?? 'credits'
}

/** Trim a decimal to something a card can print without lying about it. */

/**
 * 账号显示名。
 *
 * `nickname` 声明是字符串，但后端可以给对象/数字/null —— React 直接渲染
 * 对象会抛「Objects are not valid as a React child」，整张账号卡消失。
 * 宁可显示 id 或一个占位，也不让卡片不见。
 */
function accountLabel(account: { id?: unknown; nickname?: unknown }): string {
  if (typeof account.nickname === 'string' && account.nickname !== '') return account.nickname
  if (typeof account.id === 'string' && account.id !== '') return account.id
  if (typeof account.id === 'number') return String(account.id)
  return '（未命名账号）'
}

/**
 * 名字是不是一串机器 id（openid / uuid / 随机串），而不是人能认的名字。
 *
 * Marvis 的 openid（83F37C07…952B）、pack 登录前占位的随机 id、uuid 都会被当成昵称存下来，
 * 卡片上于是是一长串十六进制。邮箱、手机号（含打码）、带中文或空格的名字都算「人名」。
 */
function looksLikeMachineId(text: string): boolean {
  const value = text.trim()
  if (value === '') return true
  /*
    pack 的占位名：某个 provider 的凭据文件里有引用、但找不到对应账号记录时，
    它写 `nickname: provider + " account"`（`buddy account`）。
    七个账号全叫这个名字 —— 那不是名字。
  */
  if (/^[a-z0-9][a-z0-9-]* account$/iu.test(value)) return true
  /*
    pack 生成的默认 id：`codearts-f882ad03` / `minimax-e8524f6e`。
    这家上游没有昵称接口（见下方 accountDisplay 的说明），pack 只能发一个唯一 id，
    而它同时把 id 当成了 nickname。
  */
  if (/^[a-z][a-z0-9-]*-[a-f0-9]{8}$/u.test(value)) return true
  if (/[\u4e00-\u9fff\s@]/u.test(value)) return false
  if (/^\+?[\d*]{7,15}$/u.test(value)) return false            // 手机号 / 打码手机号
  if (/^[0-9a-f-]{16,}$/iu.test(value)) return true              // hex / uuid
  if (value.length >= 20 && !/[aeiou]{2}/iu.test(value) && /\d/u.test(value)) return true
  if (/^[A-Za-z0-9_-]{22,}$/u.test(value) && /[A-Z]/u.test(value) && /[a-z]/u.test(value) && /\d/u.test(value)) return true
  return false
}

/**
 * 卡片上显示的账号名。
 *
 *   - 有像样的昵称 / 邮箱 / 手机号 → 原样；
 *   - 只有机器 id → 「腾讯 Marvis 账号 1」，id 的末四位放在副标题里方便区分；
 *   - 鼠标悬停（title）永远给完整的原始 id。
 */
function accountDisplay(
  account: { id?: unknown; nickname?: unknown },
  channelName: string,
  index: number,
): { name: string; tail?: string; full: string } {
  const raw = accountLabel(account)
  const id = typeof account.id === 'string' ? account.id : raw
  const full = raw === id ? raw : `${raw}（${id}）`
  /*
    昵称只是渠道名（含「CodeArts 代码」「腾讯 Marvis 账号 1」这类变体）时，
    它不区分任何账号 —— 三个 CodeArts 账号会长得一模一样。
    这种情况按「没有昵称」处理，改用 id 末四位区分。

    判据：昵称里去掉渠道名和常见后缀字之后，剩下的不是有意义的词。
  */
  if (sameAsChannel(raw, channelName)) {
    const tail = id.replace(/[^A-Za-z0-9]/gu, '').slice(-4)
    return { name: `${channelName} ${String(index + 1)}`, ...(tail === '' ? {} : { tail }), full }
  }
  if (!looksLikeMachineId(raw)) return { name: raw, full }
  const tail = id.replace(/[^A-Za-z0-9]/gu, '').slice(-4)
  return { name: `${channelName} 账号 ${String(index + 1)}`, ...(tail === '' ? {} : { tail }), full }
}

/**
 * 昵称是不是「就是渠道名」，或者只比渠道名多几个没有信息量的词。
 *
 * pack 的默认昵称是 `CodeArts 代码`、`腾讯 Marvis 账号 1` 这种：
 * 同一家的每个账号都叫这个，等于没有名字。
 */
function sameAsChannel(nickname: string, channelName: string): boolean {
  const strip = (text: string): string => text
    .toLowerCase()
    .replace(/\s+/gu, '')
    /* 去掉这些没有区分度的中文词：它们只是把渠道名拉长，不指向任何具体账号 */
    .replace(/代码|账号|账户|默认|用户|腾讯|国际版|国内版|国际|国内|的|号/gu, '')
  const a = strip(nickname)
  const b = strip(channelName)
  if (a === '' || b === '') return false
  /* 昵称去掉外壳后落在渠道名里，或渠道名落在昵称里 —— 都不是真名字 */
  return a.includes(b) || b.includes(a)
}

/**
 * 余额 / 配额读取失败的原因，换成中文且一句话说清该怎么办。
 *
 * 上游原文常是「配额查询被拒（HTTP 403）（VALIDATION_REQUIRED）：Verify your account to continue.」
 * 这种中英混排的长串，卡片放不下也看不懂。认得出的给出处理办法，认不出的保留中文部分、去掉英文。
 */
function balanceErrorText(raw: string): string {
  if (/VALIDATION_REQUIRED|verify your account/iu.test(raw)) return '需要先在浏览器里验证这个 Google 账号，验证后点「重新检测账号」'
  if (/HTTP\s*401|unauthori[sz]ed|token.*(expired|invalid)|expired/iu.test(raw)) return '登录已失效，请重新登录这个账号'
  if (/HTTP\s*429|rate.?limit|too many/iu.test(raw)) return '请求太频繁，稍后再试'
  if (/HTTP\s*403|forbidden/iu.test(raw)) return '查询被拒（403），可能需要重新登录'
  if (/timeout|timed out|aborted/iu.test(raw)) return '查询超时'
  if (/HTTP\s*5\d\d/iu.test(raw)) return '厂商服务暂时不可用'
  const chinese = raw.replace(/[（(][^）)]*[A-Za-z][^）)]*[）)]/gu, '').split(/[：:]/u)[0]?.trim() ?? ''
  return /[\u4e00-\u9fff]/u.test(chinese) ? chinese : '余额读取失败'
}

/** Marvis 每个账号每天的计费 token 额度（设计稿 marvis.html 写明 1,000 万）。后端答了总量就用后端的。 */
const MARVIS_DAILY_TOKENS = 10_000_000

function amount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

/**
 * 这一包的 `remaining` 是百分比还是绝对值。
 *
 * `ChannelCreditPackage.remaining` 的注释写「百分比」，但那只在**配额类渠道**成立：
 * Gemini 的窗口是 `remaining: 62, total: 100, unit: "%"`；qoder / codearts / trae 这些积分渠道
 * 给的是 `remaining: 1748, total: 1900`，`remaining` 就是剩余积分。
 */
function packageIsPercent(entry: ChannelCreditPackage | undefined): boolean {
  if (entry === undefined) return false
  return entry.unit === "%" || entry.unit === "percent" || entry.unit === "quota"
}

/** 进度条用的百分比：绝对值按 remaining / total 折算，百分比原样。 */
function packagePercent(entry: ChannelCreditPackage | undefined): number | undefined {
  if (entry === undefined) return undefined
  if (packageIsPercent(entry)) {
    return typeof entry.remaining === "number" ? Math.max(0, Math.min(100, Math.round(entry.remaining))) : undefined
  }
  if (typeof entry.total === "number" && entry.total > 0 && typeof entry.remaining === "number") {
    return Math.max(0, Math.min(100, Math.round((entry.remaining / entry.total) * 100)))
  }
  return undefined
}

/**
 * 「积分明细」里的一行：`剩余 / 总量`。
 *
 * 旧实现两种量纲都按 `total * remaining / 100` 算，于是 qoder 的 `1748 / 1900` 显示成
 * `33212 / 1900`（1900 * 1748 / 100）。这个系数只对百分比包成立。
 */
function packageDetailText(entry: ChannelCreditPackage): string {
  const percent = packageIsPercent(entry)
  if (typeof entry.total === "number" && typeof entry.remaining === "number") {
    const left = percent ? Math.round((entry.total * entry.remaining) / 100) : entry.remaining
    return `${amount(left)} / ${amount(entry.total)}`
  }
  if (typeof entry.total === "number" && typeof entry.amount === "number") return `${amount(entry.amount)} / ${amount(entry.total)}`
  if (typeof entry.remaining === "number") return percent ? `剩余 ${String(Math.round(entry.remaining))}%` : amount(entry.remaining)
  if (typeof entry.amount === "number") return amount(entry.amount)
  return "—"
}
async function cachedProviderStatus(providers: readonly string[]): Promise<ChannelRpcEnvelope> {
  // The key is the provider SET, not just a timestamp: a channel list that changed
  // (a new pack row, a removed channel) must not be answered from a cache built for
  // the old one.
  const key = [...providers].sort().join('\u0000')
  const hit = providerStatusCache
  if (hit !== undefined && hit.key === key && Date.now() - hit.at < PROVIDER_STATUS_TTL_MS) {
    return hit.answer
  }
  const answer = await callPack('provider.status', { providers: [...providers] })
  providerStatusCache = { at: Date.now(), key, answer }
  return answer
}


/**
 * 走自己钱包路由的渠道。
 *
 * 这五家的余额不在 pack 的 `credits.balances` 里 —— 那是给二十二家通用厂商用的，
 * 对它们只会答 "unsupported"。每家有自己的 route、自己的返回字段，
 * 所以用一张表列出来，比在读取处写五个 if 更容易核对。
 *
 * 缺了这张表的表现是「卡片上有账号、没有金额」，而且不报错 —— 用户以为它们没余额。
 */
const OWN_WALLET_ROUTES: Readonly<Record<string, string>> = {
  astudio: POOL_ASTUDIO_WALLET_PATH,
  accio: POOL_ACCIO_QUOTA_PATH,
  'monkeycode': POOL_MONKEYCODE_CN_WALLET_PATH,
  'monkeycode-intl': POOL_MONKEYCODE_INTL_WALLET_PATH,
  baizhi: POOL_BAIZHI_WALLET_PATH,
  'autoclaw-intl': POOL_AUTOCLAW_INTL_WALLET_PATH,
  'autoclaw': POOL_AUTOCLAW_CN_WALLET_PATH,
  /* 超级麦吉两站各自的钱包路由（magicrew-routes.ts 实现） */
  'magicrew': POOL_MAGICREW_CN_WALLET_PATH,
  'magicrew-intl': POOL_MAGICREW_INTL_WALLET_PATH,
}

/** 从一家自己的钱包路由读余额；失败返回 undefined，卡片就不印数字。 */
async function fetchOwnWallet(channel: string): Promise<number | undefined> {
  const route = OWN_WALLET_ROUTES[channel]
  if (route === undefined) return undefined
  try {
    const response = await fetch(route, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
    if (!response.ok) return undefined
    const body = await response.json() as { ok?: boolean; total?: number; buckets?: readonly { amount?: number }[] }
    if (body.ok === false) return undefined
    if (typeof body.total === 'number') return body.total
    // accio 报的是 buckets，加总才是总数
    if (Array.isArray(body.buckets)) {
      const sum = body.buckets.reduce((n, b) => n + (typeof b.amount === 'number' ? b.amount : 0), 0)
      return sum > 0 ? sum : undefined
    }
    return undefined
  } catch {
    return undefined
  }
}


/**
 * 签到不走 `credits.claimAll` 的渠道。
 *
 * pack 的 claimAll 对它们答 "unsupported provider" —— 那三个路由是插件自己实现的，
 * 于是「全部领取」按下去像是坏的，而不是没这个功能。
 */
const OWN_CHECKIN_CHANNELS: Readonly<Record<string, string>> = {
  'astudio': POOL_ASTUDIO_CHECKIN_PATH,
  'baizhi': POOL_BAIZHI_CHECKIN_PATH,
  'magicrew': POOL_MAGICREW_CN_CHECKIN_PATH,
  'magicrew-intl': POOL_MAGICREW_INTL_CHECKIN_PATH,
  /* autoclaw 与 magicrew 共用同一套签到实现 */
  'autoclaw': POOL_MAGICREW_CN_CHECKIN_PATH,
  'autoclaw-intl': POOL_MAGICREW_INTL_CHECKIN_PATH,
}

/**
 * 领一个渠道的签到积分。
 *
 * 一个分发器而不是四处复制：文案与随后的余额刷新必须一致，复制四份就会漂。
 * 返回一句给用户看的结果，失败也返回（而不是抛），调用处直接显示。
 */
async function ownCheckin(channel: string): Promise<string | undefined> {
  const route = OWN_CHECKIN_CHANNELS[channel]
  if (route === undefined) return undefined
  try {
    const response = await fetch(route, {
      method: 'POST',
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    })
    const body = await response.json() as { ok?: boolean; credit?: number; reason?: string; error?: string }
    if (body.ok === false) return body.reason ?? body.error ?? '签到失败'
    return typeof body.credit === 'number' ? `已领 ${String(body.credit)} 积分` : '已签到'
  } catch {
    return '签到失败'
  }
}


/**
 * 走自己会话路由的渠道。
 *
 * 这五家的「登进来了没有」不走 pack 的 provider.status —— 那对它们答 unsupported，
 * 卡片于是永远显示「未登录」，即使账号已经存好了。
 *
 * 每家一个路由，字段却是同一套（signedIn / accounts / name / savedAt），
 * 所以一张表就够，不用写五份读取逻辑。
 */
const OWN_SESSION_ROUTES: Readonly<Record<string, string>> = {
  'astudio': POOL_ASTUDIO_SESSION_PATH,
  'accio': POOL_ACCIO_SESSION_PATH,
  'monkeycode': POOL_MONKEYCODE_CN_SESSION_PATH,
  'baizhi': POOL_BAIZHI_SESSION_PATH,
  'autoclaw': POOL_AUTOCLAW_CN_SESSION_PATH,
  'autoclaw-intl': POOL_AUTOCLAW_INTL_SESSION_PATH,
}

/**
 * 读一家自己渠道的会话。
 *
 * 返回 undefined 表示「这个渠道没有自己的会话路由」或者「读不到」——
 * 两种情况调用处都该退回 pack 的判断，而不是把卡片标成未登录。
 */
async function fetchOwnSession(channel: string): Promise<
  { signedIn: boolean; accounts?: readonly { id?: string; name?: string; dailyClaimed?: boolean }[] | undefined; name?: string | undefined } | undefined
> {
  const route = OWN_SESSION_ROUTES[channel]
  if (route === undefined) return undefined
  try {
    const response = await fetch(route, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
    if (!response.ok) return undefined
    const body = await response.json() as {
      signedIn?: boolean
      accounts?: readonly { id?: string; name?: string; dailyClaimed?: boolean }[]
      name?: string
      dailyClaimed?: boolean
    }
    return { signedIn: body.signedIn === true, accounts: body.accounts, name: body.name }
  } catch {
    return undefined
  }
}

/**
 * 渠道详情。
 *
 * 设计稿的右栏是「选中那一个渠道的详情」：一个标题、三格统计、它的账号、
 * 它的模型。中栏的 .ch 行负责选中。
 *
 * 之前这里把二十家渠道的卡片平铺成网格 —— 每张卡里各有一套折叠。那不是设计稿
 * 的形状：读者要连着看两家渠道，得在两张卡之间来回滚，而设计稿里切换只需点
 * 中栏一行。
 *
 * `active` 为空时（首次进入、或选中的渠道被移除）退回第一家，这样右栏
 * 永远不会是空的。
 */
export function ChannelPoolSection({ t, active, onAddAccount, autoClaim, autoClaimBusy, onAutoClaim, autoClaimRunning, onAutoClaimRun, banner, regionCards }: {
  readonly t?: Translate | undefined
  /** 中栏选中的渠道 id；空则显示第一家。 */
  readonly active?: string | undefined
  /** 「添加账号」/ 点未登录渠道：去登录通道。 */
  readonly onAddAccount?: (() => void) | undefined
  /** 积分自动化（全局调度器）当前是否开着。 */
  readonly autoClaim?: boolean | undefined
  readonly autoClaimBusy?: boolean | undefined
  /** True while a 「立即执行」 run is in flight. */
  readonly autoClaimRunning?: boolean | undefined
  /** Run one automation pass now, instead of waiting for the scheduled hour. */
  readonly onAutoClaimRun?: (() => void) | undefined
  readonly onAutoClaim?: ((on: boolean) => void) | undefined
  /** 外层的提示条，放进详情列 mbody 顶部（不能落在 .app 网格里）。 */
  readonly banner?: ReactNode | undefined
  /**
   * 外层的插件池账号卡，和 banner 一样进详情列 mbody。
   *
   * 这一页是 .app 的三列网格（rail | 渠道列表 | 详情），detail 列之外没有第四格。
   * 多出来的内容挂在 .app 层都会自己占一格，把 list 和 main 顶到第二行，
   * 而 .app 是 height:100vh + overflow:hidden —— 第二行直接被裁掉。
   */
  readonly regionCards?: ReactNode | undefined
}): ReactElement {
  /*
    选中哪一家。外部传了就用外部的（中栏在别的组件里时），
    没传就自己管 —— 这样这一栏可以独立渲染成「列表 + 详情」。
  */
  const [ownActive, setOwnActive] = useState<string>('')
  /*
    「添加账号」直接在账号池里发起登录的状态。

    原来这个按钮只是 `setPage('channels')` —— 把读者扔到另一页，还要再找一次渠道、再点一次。
    现在点它就地开始登录：开窗／粘贴／pack 登录页三种，各自走各自的路。
      · working  正在等（窗口开着，或轮询中）
      · paste    需要用户贴一段凭据
      · failed   失败，附原因
  */
  const [loginState, setLoginState] = useState<
    { channelId: string; phase: 'working' | 'paste' | 'failed'; message?: string } | undefined
  >(undefined)
  /** 页面卸载或换渠道时让在跑的轮询停下来。 */
  const loginAbort = useRef<{ cancelled: boolean } | undefined>(undefined)
  /*
    外部没传（或传了空串）时用自己那份。

    原来是 `active ?? ownActive` —— 但 `active` 的默认值是 `''`，
    而 `??` 只对 null/undefined 回退，空串算「有值」。于是点了中栏
    什么都不会变：chosen 永远是 `''`，右栏永远显示不了选中的那家。
  */
  // Seeded from the cross-mount snapshot: a remount paints the last good cards
  // on its very first frame, then revalidates. Only a genuinely cold start
  // begins empty — and that one says so, instead of rendering air.
  /**
   * The cards start from a STATIC roster and fill in.
   *
   * `fetchChannels()` waits on the pack, which waits on the host's plugin graph — so the
   * whole page used to show "reading scan channels…" even though the thirteen names are
   * compile-time constants. A reader who has six accounts saw an empty page and concluded the
   * plugin was broken.
   *
   * The placeholder carries the catalogue rows only: names, notes, accents and icons. Counts
   * and balances stay blank until the real answer arrives, because a number that appears and
   * then changes is worse than one that appears a moment late.
   */
  const [entries, setEntries] = useState<readonly ChannelEntry[]>(() => {
    const snapshot = poolSnapshot?.entries
    if (snapshot !== undefined && snapshot.length > 0) return snapshot
    /* 进程里没有（刚启动 DSH）→ 用上一次存在本机的真实数据，第一帧就有账号和模型 */
    const stored = storedPoolOnce()
    if (stored !== undefined) return stored.entries
    return placeholderEntries()
  })
  const wanted = active === undefined || active === '' ? ownActive : active
  /*
    还没选过就默认第一家。
    右栏一进来就该是「某一家渠道的详情」，而不是一个标题加一片空白 ——
    读者看不出这个页面是干什么的。
  */
  const chosen = wanted !== '' ? wanted : (entries[0]?.channel.id ?? '')

  const [error, setError] = useState<string | undefined>(() => poolSnapshot?.error)
  /**
   * True until the first wave has answered once.
   *
   * The section used to render NOTHING while loading, so a cold start and a
   * broken RPC bridge looked identical: blank (#95). The bridge failing is a
   * real, common failure — `provider.status` answers `ok: false`, the map comes
   * back empty, `scanProviders` is empty and the old code returned `<></>` with
   * `error === undefined`. Silence was indistinguishable from "no accounts".
   */
  const [loading, setLoading] = useState<boolean>(() => poolSnapshot === undefined && storedPoolOnce() === undefined)
  /** 后台正在重读（第一帧画的是缓存）—— 中栏标题旁边转一个小圈，告诉读者数字马上会更新。 */
  const [refreshing, setRefreshing] = useState(false)
  /** 第一次真实读取完成后才开始写快照，避免把占位数据写回本机。 */
  const persistReady = useRef(false)
  /** pack 冷启动时自动重读的次数（见 load 里的合并规则）。 */
  const coldRetries = useRef(0)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  /** provider → the open list, or `undefined` for a card with both folded. */
  const [folds, setFolds] = useState<ReadonlyMap<string, Fold | undefined>>(new Map())
  /** provider → the set of model ids the user has ticked. */
  const [enabled, setEnabled] = useState<ReadonlyMap<string, ReadonlySet<string>>>(new Map())
  /** provider → true while one of its actions is in flight. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  /** Channels whose model catalogue is being re-read. */
  const [catalogBusy, setCatalogBusy] = useState<ReadonlySet<string>>(new Set())
  /**
   * Whether channels without an account are listed.
   *
   * They are hidden by default: a card for a channel nobody signed into says "– accounts, – 
   * models, – credit" and takes a full row to say it, so an account pool with one signed-in
   * channel scrolled past a dozen empty ones to reach it (#166). The switch brings them back for
   * the one case where they are wanted — adding another.
   */
  const [showAll, setShowAll] = useState(false)
  /** provider → what the reader typed into that card's model search box. */
  const [queries, setQueries] = useState<ReadonlyMap<string, string>>(new Map())
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const mountedRef = useRef(true)
  /**
   * Which load is current.
   *
   * Two things make a stale answer arrive late: the retry ladder re-runs the
   * whole chain, and a remount starts a new chain while the old request is
   * still in flight. Stamping each run is what keeps an older wave-2 result
   * from painting over a newer wave-1 one.
   */
  const loadSeq = useRef(0)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  /**
   * 每个渠道自己的「账号使用方式」，读写 channels/usage 路由。
   *
   * 之前这里是一个只存在内存里的草稿（点了按钮会变色，但后端从来没收到），
   * 而且那个 useState 写在提前 return 之后 —— 违反 hook 顺序规则。
   * 现在挪到所有 return 之前，并真的写进后端。没单独设过的渠道跟随全局。
   */
  const [usage, setUsage] = useState<ChannelUsageState | undefined>(undefined)
  /** Marvis 每个账号自己的 token 用量（marvis.html 的 .quota）。 */
  const [marvisQuotas, setMarvisQuotas] = useState<readonly MarvisQuota[] | undefined>(
    () => marvisQuotaSnapshot ?? storedPoolOnce()?.marvis)
  const [usageBusy, setUsageBusy] = useState(false)
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const response = await fetch(POOL_CHANNEL_USAGE_PATH, { credentials: 'same-origin' })
        const body = await response.json().catch(() => undefined) as ChannelUsageState | undefined
        if (live && body !== undefined) setUsage(body)
      } catch {
        // 读不到就按「优先」画；下一次写入会带回真实状态
      }
    })()
    return () => { live = false }
  }, [])
  const modeOf = (provider: string): PoolDistribution => {
    const picked = usage?.channels?.[provider] ?? usage?.pool ?? 'priority'
    return MODE_ORDER.find(option => option === picked) ?? 'priority'
  }
  const modeIsOwn = (provider: string): boolean => usage?.channels?.[provider] !== undefined
  const setChannelMode = async (provider: string, next: PoolDistribution): Promise<void> => {
    setUsageBusy(true)
    try {
      const response = await fetch(POOL_CHANNEL_USAGE_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: provider, strategy: next }),
      })
      const body = await response.json().catch(() => undefined) as (ChannelUsageState & { error?: string }) | undefined
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${String(response.status)}`)
      if (mountedRef.current && body !== undefined) setUsage(body)
    } catch (cause: unknown) {
      if (mountedRef.current) setNotice(`账号使用方式没保存上：${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      if (mountedRef.current) setUsageBusy(false)
    }
  }

  const markBusy = (provider: string, on: boolean): void => {
    setBusy(previous => {
      const next = new Set(previous)
      if (on) next.add(provider)
      else next.delete(provider)
      return next
    })
  }

  /**
   * Re-read one channel's model catalogue.
   *
   * Each adapter caches its catalogue for the life of the process, so a vendor that renames a
   * model — or changes its multiplier, which is part of the NAME — only reached the card after
   * a restart. The host exposes a refresh for exactly that; this is its button.
   */
  const refreshChannelModels = async (provider: string): Promise<void> => {
    setCatalogBusy(previous => new Set(previous).add(provider))
    try {
      await fetch(POOL_CATALOG_REFRESH_PATH, {
        method: 'POST',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      })
      invalidatePoolSnapshot()
      await load()
      setNotice(`${provider} 的模型列表已重新读取`)
    } catch (cause: unknown) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setCatalogBusy(previous => {
        const next = new Set(previous)
        next.delete(provider)
        return next
      })
    }
  }

  const load = async (): Promise<void> => {
    loadSeq.current += 1
    setRefreshing(true)
    try {
      /*
        第一波四个请求并行发：渠道名册、各家账号数、豆包会话、Marvis 会话互不依赖。
        原来是一个等一个，冷启动时四段等待叠在一起。各家账号数用编译期名册的 id 去问
        （和后端名册是同一份常量），不用先等名册回来。
      */
      const rosterIds = REGISTERED_CHANNELS
        .filter(channel => !REGION_OWNED_CHANNELS.has(channel.id))
        .map(channel => channel.id)
      const [channelsRaw, firstStatus, doubaoAccount, marvisSession] = await Promise.all([
        fetchChannels(),
        cachedProviderStatus(rosterIds),
        readDoubaoAccount(),
        readMarvisSession(),
      ])
      const channels = channelsRaw.filter(channel => !REGION_OWNED_CHANNELS.has(channel.id))
      // `account.list` filters by provider on its very first line
      // (pool.listAccounts), so an empty payload matches nothing and answers
      // "no accounts" for a channel that has three. The cheap way to learn
      // *which* providers hold accounts is one `provider.status` round trip:
      // it counts every named provider in a single answer, so the pool pays
      // two extra calls only for channels that actually have an account.
      //
      // CACHED, because it is the single most expensive call on this page: the
      // pack walks every named provider's account pool to count them, so one
      // request is the sum of thirteen. Opening this section again a minute later
      // pays that cost again for numbers that cannot have moved — which is why it
      // "loads slowly every time" while the login page (static metadata, no
      // counting) appears instantly.
      /* 后端名册里多出编译期名册没有的渠道（新版后端 + 旧版前端缓存）时，再问一次全集 */
      const extra = channels.some(channel => !rosterIds.includes(channel.id))
      const statusAnswer = extra
        ? await cachedProviderStatus(channels.map(channel => channel.id))
        : firstStatus
      const statuses = providerStatusesFrom(statusAnswer)
      /**
       * Doubao is added to the scan list by hand.
       *
       * `provider.status` counts accounts by walking the PACK's pools, and Doubao has no pack
       * adapter — so its count is always zero, and a filter keyed on that count drops the
       * channel before anything can be drawn. A signed-in Doubao session would then exist,
       * work, and appear nowhere on this page.
       */
      /* doubaoAccount / marvisSession 已在上面并行读好。Marvis 同理：pack 不认识它，账号只在插件自己的 session 路由里 */
      const scanProviders = channels
        .map(channel => channel.id)
        .filter(id => (statuses.get(id)?.accountsTotal ?? 0) > 0
          || (id === 'doubao' && doubaoAccount !== undefined)
          || (id === 'marvis' && (marvisSession?.accounts.length ?? 0) > 0))
      // Facts are fetched AFTER the model lists below, not before: the host's
      // own listing is gated per provider, and a gated channel answers "no
      // models" even while its card shows nine. The ids this page just rendered
      // are the authoritative set, so they are handed back to the host as a
      // hint — see `PoolWebChannelModelsRequest.ids`.
      const perProvider = await Promise.all(scanProviders.map(async provider => {
        const wantBalances = channels.find(channel => channel.id === provider)?.credits !== undefined
        // WAVE 1: only what the CARD itself needs, and all of it answered from
        // memory by the pack. `account.list` and `model.list` cost milliseconds;
        // `credits.balances` is the one call that goes to the network and it is
        // deliberately NOT awaited here. Joining all four behind a single
        // `Promise.all` — as the old code did — meant the channel name,
        // "connected", "1/1 accounts", "5/11 models" and every button waited on
        // the slowest余额 query, for facts that had been known for milliseconds
        // (#102). Wave 2 below fills the credits in.
        //
        // The calls are independent: a channel whose catalogue cannot be
        // listed still has accounts worth showing, so one failure must not
        // blank the other half of the card.
        /**
         * Doubao answers from THIS plugin's routes, not from the pack.
         *
         * `account.list` and `model.list` are pack RPCs, and the pack has no Doubao adapter —
         * both answer "unknown provider". Calling them anyway would draw a card reading
         * "0 accounts, 0 models" for a lane that has one session and six models, and the
         * empty numbers would look like a failed sign-in.
         */
        const accountsPromise = provider === 'doubao'
          ? Promise.resolve({ ok: true, value: { accounts: doubaoAccount === undefined ? [] : [doubaoAccount] } } as ChannelRpcEnvelope)
          : provider === 'marvis'
            ? Promise.resolve({ ok: true, value: { accounts: marvisSession?.accounts ?? [] } } as ChannelRpcEnvelope)
            : callPack('account.list', { provider })
        const modelsPromise = provider === 'doubao'
          ? readDoubaoModels().then(models => ({ ok: true, value: { models } } as ChannelRpcEnvelope))
          : provider === 'marvis'
            ? Promise.resolve({ ok: true, value: { models: marvisSession?.models ?? [] } } as ChannelRpcEnvelope)
            : callPack('model.list', { provider })
        // `callPack` answers an `ok: false` envelope as a value rather than a
        // rejection, so the catch arms only cover the transport itself.
        const [accounts, models] = await Promise.all([
          accountsPromise.catch(() => refused('account.list failed')),
          modelsPromise.catch(() => refused('model.list failed')),
        ])
        // `model.list` answers with a FLAT array for the one provider it was
        // asked about (`{models: [...]}`), not a provider→rows map, so it is
        // read with modelsFrom — reading it as a map found no key for this
        // provider and rendered an empty list under a plausible "no models
        // published" line.
        const modelRows = modelsFrom(models.value)
        const modelEmptyBecauseRefused = modelRows.length === 0 && models.ok !== true
        return [
          provider,
          {
            accounts: dedupeAccounts(accountsFrom(accounts)),
            // Sorted at read time so the order survives every re-load: the pack
            // returns each vendor's own chronology, which is not the order a
            // reader answers "which one do I pick?" in.
            models: sortChannelModels(modelRows),
            facts: new Map<string, PoolWebChannelModel>(),
            // Filled by wave 2. `balancePending` is what makes the renderer
            // print "…" instead of "—" while it waits — that branch already
            // existed in the render, but the writer hard-coded `false`, so it
            // was unreachable dead code and the wait was invisible.
            balances: [] as readonly ChannelBalance[],
            statuses: [] as readonly ChannelCreditStatus[],
            balancePending: wantBalances,
            balanceError: undefined,
            modelError: modelEmptyBecauseRefused
              ? (models.error?.message ?? 'model.list refused')
              : undefined,
          },
        ] as const
      }))
      const byProvider = new Map(perProvider)
      /*
        全部渠道都保留，不只是「有账号」的那些。

        原来这里 filter 了 byProvider —— 只有拿到账号的渠道才进 next。
        结果：一个账号都没登录时 next = []，中栏被清空成一片空白，
        连「未登录」的二十家都不显示，而设计稿的中栏始终是完整名册
        分两组。读者第一次进来根本看不到自己能登什么。

        byProvider 缺的渠道仍然要出现，只是 accounts 为空 —— 渲染层
        会把它归到「未登录」组。
      */
      const EMPTY_ENTRY = {
        accounts: [] as readonly ChannelAccount[],
        models: [] as readonly PoolWebChannelModel[],
        facts: new Map<string, PoolWebChannelModel>(),
        balances: [] as readonly ChannelBalance[],
        statuses: [] as readonly ChannelCreditStatus[],
        balancePending: false,
        balanceError: undefined as string | undefined,
        modelError: undefined as string | undefined,
      }
      /*
        名册是编译期常量，后端没答也照样列出来。

        `channels` 来自 /plugins/dsh-xdpool/channels —— 首装、或 pack 还没
        装上时它是空的。那时中栏就是一片空白：读者看不到自己能登什么，
        只看到一个 retry。而二十家的名字本来就是代码里的常量，
        没有理由等后端。

        后端答了就用它的（可能带新的备注/端点），没答就用名册。
      */
      const roster: readonly PoolWebChannel[] = channels.length > 0
        ? channels
        : REGISTERED_CHANNELS
            .filter(channel => !REGION_OWNED_CHANNELS.has(channel.id))
            .map(channel => ({
              ...channel,
              loginKind: channel.login,
              ownedByPool: channel.ownedByPool === true,
            }) as PoolWebChannel)
      /*
        和屏幕上已有的数据合并，而不是整份替换。

        第一帧画的是本机缓存（上一次的账号、模型、余额）。第一波读取里余额还没回来
        （第二波才读），冷启动时 pack 也常常还没装好：model.list 答「拒绝」、
        provider.status 把每家都数成 0。原来直接用这份答案整个替换，于是缓存里的
        余额、模型、甚至账号一进来就被抹成「—」，读者看到的还是一排杠在加载。

        规则：
          - 余额 / 签到状态：第一波一律沿用屏幕上的，第二波真读到了再换；
          - 模型：这次读失败（或 pack 冷启动）就沿用上一次的，读成功就用新的；
          - 账号：pack 冷启动（全部数成 0 但上一次明明有号）时沿用上一次，
            并在 2 秒后重读，最多 5 次；之后仍是 0 才算真没有。
          - 名册占位行（id 以 cached- 开头）不算数据，不沿用。
      */
      const previousById = new Map(entriesRef.current.map(entry => [entry.channel.id, entry]))
      const realAccounts = (entry: ChannelEntry | undefined): readonly ChannelAccount[] =>
        (entry?.accounts ?? []).filter(account => !account.id.startsWith('cached-'))
      const realModels = (entry: ChannelEntry | undefined): readonly ChannelModel[] =>
        (entry?.models ?? []).filter(model => !model.id.startsWith('cached-'))
      const packCounted = [...statuses.values()].reduce((sum, row) => sum + (row.accountsTotal ?? 0), 0)
      const hadPackAccounts = entriesRef.current.some(entry =>
        entry.channel.id !== 'doubao' && entry.channel.id !== 'marvis' && realAccounts(entry).length > 0)
      const packCold = hadPackAccounts && (!statusAnswer.ok || packCounted === 0)
      if (packCold) {
        // 冷启动那次的 0 被缓存 30 秒的话，重读也只会拿到同一个 0
        providerStatusCache = undefined
        if (coldRetries.current < 5) {
          coldRetries.current += 1
          window.setTimeout(() => { if (mountedRef.current) void load() }, 2_000)
        }
      } else {
        coldRetries.current = 0
      }
      const next = roster
        .map((channel): ChannelEntry => {
          const fresh = byProvider.get(channel.id)
          const previous = previousById.get(channel.id)
          const status = statuses.get(channel.id) ?? previous?.status
          if (fresh === undefined) {
            if (packCold && previous !== undefined && realAccounts(previous).length > 0) {
              return { ...previous, channel, balancePending: false, status }
            }
            return { channel, ...EMPTY_ENTRY, status } as ChannelEntry
          }
          const keepModels = fresh.models.length === 0
            && (fresh.modelError !== undefined || packCold)
            && realModels(previous).length > 0
          return {
            channel,
            ...fresh,
            models: keepModels ? realModels(previous) : fresh.models,
            modelError: keepModels ? undefined : fresh.modelError,
            facts: previous !== undefined && previous.facts.size > 0 ? previous.facts : fresh.facts,
            balances: previous?.balances ?? fresh.balances,
            statuses: previous?.statuses ?? fresh.statuses,
            status,
          }
        })
      // Wave 1 lands here. The store is written FIRST and unconditionally: this
      // answer is correct whether or not the component is still mounted, and a
      // result discarded because the reader happened to switch tabs mid-flight
      // is a result that has to be fetched again (#102).
      poolSnapshot = { entries: next, error: undefined }
      // Remember the counts so the NEXT LAUNCH paints them on its first frame. Only counts
      // travel — the accounts themselves are re-read, because a cached credential is worse
      // than a stale number.
      writeStoredCounts(next)
      if (!mountedRef.current) return
      const seq = loadSeq.current

      // The fact sweep (`/channels/models`, which resolves every model against
      // the host's adapters) measured 16.5 seconds on a cold host, so the cards
      // land first and the facts merge in when they arrive.
      persistReady.current = true
      setEntries(next)
      setError(undefined)
      setLoading(false)

      if (next.length === 0) {
        // Nothing to enrich, and the empty page would otherwise be silent. A
        // statuses answer that named providers but counted zero accounts is a
        // real "no sign-ins"; an answer that came back refused is not, and must
        // say so or the reader cannot tell the two apart.
        if (!statusAnswer.ok) {
          const message = statusAnswer.error?.message ?? 'provider.status refused'
          poolSnapshot = { entries: next, error: message }
          setError(message)
        }
        return
      }

      // WAVE 2, unawaited on purpose: the credits cells show "…" until it lands.
      // Each channel is filled in on its own, so a slow vendor cannot hold up a
      // fast one, and a failure puts the token back to "—" AND writes the
      // reason, instead of leaving the cell pending forever.
      for (const entry of next) {
        if (entry.channel.credits === undefined) continue
        void refreshBalances(entry.channel.id, false, true, seq)
      }

      const idsByProvider: Record<string, readonly string[]> = {}
      for (const [provider, entry] of perProvider) {
        if (entry.models.length > 0) idsByProvider[provider] = entry.models.map(model => model.id)
      }
      const facts = await fetchChannelModels(next.map(entry => entry.channel.id), idsByProvider)
        .catch((): ReadonlyMap<string, readonly PoolWebChannelModel[]> => new Map())
      if (!mountedRef.current || loadSeq.current !== seq) return
      if (facts.size === 0) return
      setEntries(previous => previous.map(entry => ({
        ...entry,
        facts: new Map((facts.get(entry.channel.id) ?? []).map(model => [model.id, model])),
      })))
    } catch (cause) {
      // A failure is a fact about the machine, so it belongs in the store too:
      // a remount must show the error rather than silently retrying into a
      // second blank page.
      const message = cause instanceof Error ? cause.message : String(cause)
      poolSnapshot = { entries: entriesRef.current, error: message }
      if (!mountedRef.current) return
      setError(message)
      setLoading(false)
    } finally {
      if (mountedRef.current) setRefreshing(false)
    }
  }

  /**
   * Retry-on-mount race: the pack's `/api/channel-pack` route may not be up
   * yet when this section first renders (the login-page plugin mounts the
   * pack asynchronously, and a cold start can take a few seconds). Retry a
   * bounded number of times before showing the empty state, so a slow mount
   * is not misread as "no accounts".
   */
  const loadWithRetry = async (attempt = 0): Promise<void> => {
    await load()
    if (!mountedRef.current) return
    if (entriesRef.current.length > 0) return
    if (attempt >= LOAD_RETRIES) return
    window.setTimeout(() => { if (mountedRef.current) void loadWithRetry(attempt + 1) }, RETRY_INTERVAL_MS)
  }

  useEffect(() => { void loadWithRetry() }, [])

  /* 数据有变化就（防抖）写一次本机快照，下次打开 DSH 第一帧用它 */
  useEffect(() => {
    if (!persistReady.current) return undefined
    const timer = window.setTimeout(() => { writeStoredPool(entries, marvisQuotas) }, 500)
    return () => { window.clearTimeout(timer) }
  }, [entries, marvisQuotas])

  const foldFor = (provider: string): Fold | undefined => folds.get(provider)
  const toggleFold = (provider: string, fold: Fold): void => {
    setFolds(previous => {
      const next = new Map(previous)
      next.set(provider, previous.get(provider) === fold ? undefined : fold)
      return next
    })
  }

  const enabledFor = (provider: string, models: readonly ChannelModel[]): ReadonlySet<string> => {
    const live = enabled.get(provider)
    if (live !== undefined) return live
    /**
     * Doubao remembers its own selection.
     *
     * The pack keeps every other channel's disabled list; this lane has no entry there, so its
     * choice is stored beside the counts it already keeps. `undefined` means "never touched" and
     * the default (all enabled) applies — a channel the user has not configured must not look
     * half-configured.
     */
    if (provider === 'doubao') {
      const saved = readDoubaoSkipped()
      if (saved !== undefined) {
        return new Set(models.filter(model => !saved.has(model.id)).map(model => model.id))
      }
    }
    return new Set(models.filter(model => model.disabled !== true).map(model => model.id))
  }

  const queryFor = (provider: string): string => queries.get(provider) ?? ''

  const setQuery = (provider: string, query: string): void => {
    setQueries(previous => {
      const next = new Map(previous)
      if (query === '') next.delete(provider)
      else next.set(provider, query)
      return next
    })
  }

  /**
   * Narrow one channel's catalogue to whatever the reader typed.
   *
   * Matching on the model *name* and *id* is not enough: the descriptors live
   * in the host catalogue under the same id, and "vision" is exactly the word
   * somebody hunting for an image-capable model reaches for. So the host row
   * is joined in and its description and modalities are searched too.
   */
  const modelsMatching = (entry: ChannelEntry, query: string): readonly ChannelModel[] => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return entry.models
    return entry.models.filter(model => {
      const fact = entry.facts.get(model.id)
      const haystack = [
        model.id,
        model.name ?? '',
        model.description ?? '',
        fact?.description ?? '',
        fact?.contextWindow === undefined ? '' : String(fact.contextWindow),
        ...(fact?.inputModalities ?? []),
      ].join(' ').toLowerCase()
      return haystack.includes(needle)
    })
  }

  /**
   * Flip one model and write it through immediately.
   *
   * `model.setDisabled` is the endpoint that also broadcasts
   * `llm/adapters-updated`; writing only to the blacklist would leave the picker
   * showing the old catalogue until something else happened to refresh it.
   */
  const toggleModel = async (provider: string, modelId: string, on: boolean): Promise<void> => {
    const entry = entries.find(item => item.channel.id === provider)
    if (entry === undefined) return
    const next = new Set(enabledFor(provider, entry.models))
    if (on) next.add(modelId)
    else next.delete(modelId)
    setEnabled(previous => new Map(previous).set(provider, next))
    markBusy(provider, true)
    try {
      /**
       * Doubao's selection is saved HERE, not through the pack.
       *
       * `model.setDisabled` is a pack RPC addressed to the pack's own model record, and Doubao
       * has no entry there — so the call answered "unknown provider", the catch below rolled the
       * local state back, and the checkbox snapped to its old value the moment the panel was
       * reopened. Every other channel persists through the pack because the pack owns its
       * catalogue; this lane owns its own, so it persists its own.
       */
      if (provider === 'doubao') {
        await saveDoubaoSkipped(modelId, !on)
        // Ticking any one model means "not all off" any more.
        saveDoubaoHideAll(false)
        // The localStorage write is only half the save: the host needs the list
        // or the picker keeps publishing the whole roster (issue #196).
        await mirrorDoubaoDisabled()
      } else {
        const envelope = await callPack('model.setDisabled', { provider, modelId, disabled: !on })
        if (!envelope.ok) {
          throw new Error(envelope.error?.message ?? 'model.setDisabled refused')
        }
      }
    } catch (cause) {
      setNotice(t?.('channelpool.saveError', {
        message: cause instanceof Error ? cause.message : String(cause),
      }) ?? `Could not save: ${cause instanceof Error ? cause.message : String(cause)}`)
      setEnabled(previous => {
        const restored = new Map(previous)
        restored.delete(provider)
        return restored
      })
    } finally {
      markBusy(provider, false)
      await load()
    }
  }

  /**
   * Cap one model's advertised window, or take the cap off.
   *
   * The optimistic update writes the number straight onto the row so the radio
   * moves immediately; `load()` re-reads the authoritative table afterwards and
   * corrects it if the pack disagreed.
   */
  const setContextBudget = async (
    provider: string,
    modelId: string,
    budget: number | undefined,
  ): Promise<void> => {
    markBusy(provider, true)
    setEntries(previous => previous.map(entry => entry.channel.id !== provider
      ? entry
      : {
        ...entry,
        models: entry.models.map(model => model.id !== modelId
          ? model
          : {
            ...model,
            /*
              Clearing the cap restores the native window as the ACTIVE one and
              keeps `nativeContextWindow` in place. Dropping the native figure
              too would make the row stop looking cappable mid-click, and the
              radio pair would disappear from under the pointer — the same
              "it cancels itself" symptom from the other side.
            */
            ...budget === undefined
              ? { contextBudget: undefined, contextWindow: model.nativeContextWindow ?? model.contextWindow }
              : { contextBudget: budget, contextWindow: budget, nativeContextWindow: model.nativeContextWindow ?? model.contextWindow },
          }),
      }))
    try {
      const envelope = await setChannelModelContextBudget(provider, modelId, budget)
      if (!envelope.ok) {
        throw new Error(envelope.error?.message ?? 'model.setContextBudget refused')
      }
    } catch (cause) {
      setNotice(t?.('channelpool.saveError', {
        message: cause instanceof Error ? cause.message : String(cause),
      }) ?? `Could not save: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      markBusy(provider, false)
      await load()
    }
  }

  /** Enable every published model, or switch all of them off, in one write. */
  const setAllModels = async (provider: string, on: boolean): Promise<void> => {
    const entry = entries.find(item => item.channel.id === provider)
    if (entry === undefined || entry.models.length === 0) return
    setEnabled(previous => new Map(previous).set(
      provider,
      new Set(on ? entry.models.map(model => model.id) : []),
    ))
    markBusy(provider, true)
    try {
      /**
       * Doubao persists its own all-on / all-off.
       *
       * Same reason as the single toggle: `model.setAllDisabled` is a pack RPC and Doubao has no
       * entry in the pack's model record. Calling it answered "unknown provider", the catch
       * rolled the state back — which is exactly the "I turned them all off, reopened the panel,
       * they were all on again" report.
       */
      if (provider === 'doubao') {
        const skipped = on ? [] : entry.models.map(model => model.id)
        globalThis.localStorage?.setItem(DOUBAO_SKIP_KEY, JSON.stringify(skipped))
        // 全关 also carries an explicit flag: the id list alone cannot say it
        // when the roster was still loading.
        saveDoubaoHideAll(!on)
        /**
         * Mirrored here as well, not left to the `finally { await load() }`.
         *
         * That re-read happens anyway, but it goes through `readDoubaoModels`,
         * which exits early when the listing fetch fails — and 「全关」 is exactly
         * the state a user reaches for when the upstream is misbehaving. Pushing
         * here means the picker stops offering the models even then.
         */
        await mirrorDoubaoDisabled()
      } else {
        await callPack('model.setAllDisabled', { provider, disabled: !on })
      }
      setNotice(t?.('channelpool.modelsSaved') ?? 'Model selection saved.')
    } catch (cause) {
      setNotice(t?.('channelpool.saveError', {
        message: cause instanceof Error ? cause.message : String(cause),
      }) ?? `Could not save: ${cause instanceof Error ? cause.message : String(cause)}`)
      setEnabled(previous => {
        const restored = new Map(previous)
        restored.delete(provider)
        return restored
      })
    } finally {
      markBusy(provider, false)
      await load()
    }
  }

  /**
   * Read one channel's balances and merge them into its card.
   *
   * Wave 2 of the load calls this with `quiet` true: the card is already on
   * screen, so the provider must not be marked busy (that would disable the
   * claim button for a network read the reader did not ask for) and a failure
   * must land in `balanceError` rather than in the section-wide notice.
   *
   * `seq` is the load that asked for this read. A reply from an older load
   * cannot overwrite a newer card, which is what the previous version got wrong
   * when a remount overlapped an in-flight refresh.
   */
  const refreshBalances = async (provider: string, force: boolean, quiet = false, seq?: number): Promise<void> => {
    if (!quiet) markBusy(provider, true)
    setEntries(previous => previous.map(entry =>
      entry.channel.id === provider ? { ...entry, balancePending: true } : entry))
    try {
      /**
       * Doubao reports its own balance, from its quota route.
       *
       * `credits.balances` is a pack RPC with no Doubao adapter, so it answers "unsupported
       * provider" and the card printed "no balance reported" under a signed-in account.
       */
      /*
        Marvis：每个账号一行 token 钱包。余额行只留「可用」给汇总用，
        卡片画的是 marvisQuotas 里的「已用 / 总量 + 重置时间」。
      */
      if (provider === 'marvis') {
        const quotas = await readMarvisQuotas()
        marvisQuotaSnapshot = quotas
        if (!mountedRef.current) return
        setMarvisQuotas(quotas)
        setEntries(previous => previous.map(entry =>
          entry.channel.id === provider
            ? {
                ...entry,
                balancePending: false,
                balanceError: undefined,
                balances: quotas.map(row => ({
                  accountId: row.openid,
                  ...(row.error === undefined ? { balance: { total: row.available } } : { error: row.error }),
                })),
              }
            : entry))
        return
      }
      if (provider === 'doubao') {
        const rows = await readDoubaoBalance()
        setEntries(previous => previous.map(entry =>
          entry.channel.id === provider
            ? { ...entry, balancePending: false, balanceError: undefined, balances: rows }
            : entry))
        return
      }
      /*
        自己带钱包路由的五家（astudio / accio / monkeycode ×2 / baizhi / autoclaw ×2）。

        和 doubao 同一个理由：`credits.balances` 是给二十二家通用厂商的，
        对这些渠道只答 "unsupported"，卡片因此只有账号、没有金额。
      */
      if (OWN_WALLET_ROUTES[provider] !== undefined) {
        const total = await fetchOwnWallet(provider)
        if (mountedRef.current) {
          setEntries(previous => previous.map(entry =>
            entry.channel.id === provider
              ? {
                  ...entry,
                  balancePending: false,
                  balanceError: undefined,
                  balances: total === undefined
                    ? []
                    : [{ accountId: provider, balance: { total } } as never],
                }
              : entry))
        }
        return
      }
      const envelope = await callPack('credits.balances', force ? { provider, force: true } : { provider })
      if (seq !== undefined && loadSeq.current !== seq) return
      if (!mountedRef.current) {
        // Still record the answer for the next mount: the read cost a network
        // round trip and the numbers are true regardless of who is watching.
        if (envelope.ok) {
          const rows = balancesFrom(envelope)
          poolSnapshot = {
            entries: (poolSnapshot?.entries ?? []).map(entry =>
              entry.channel.id === provider ? { ...entry, balancePending: false, balances: rows } : entry),
            error: poolSnapshot?.error,
          }
        }
        return
      }
      if (!envelope.ok) {
        setEntries(previous => previous.map(entry =>
          entry.channel.id === provider
            ? { ...entry, balancePending: false, balanceError: envelope.error?.message ?? 'credits.balances refused' }
            : entry))
        return
      }
      const rows = balancesFrom(envelope)
      setEntries(previous => previous.map(entry =>
        entry.channel.id === provider
          ? { ...entry, balancePending: false, balanceError: undefined, balances: rows }
          : entry))
    } finally {
      if (mountedRef.current && !quiet) markBusy(provider, false)
    }
  }

  const claim = async (provider: string): Promise<void> => {
    markBusy(provider, true)
    try {
      const envelope = await callPack('credits.claimAll', { provider })
      if (!mountedRef.current) return
      const result = claimResultFrom(envelope)
      if (result === undefined) {
        setNotice(envelope.error?.message ?? t?.('channelpool.loadError', { message: 'credits.claimAll refused' }) ?? 'Claim refused.')
      } else if (result.claimed > 0) {
        setNotice(t?.('channelpool.claimResult', {
          claimed: result.claimed,
          total: result.claimed + result.alreadyClaimed + result.inactive + result.failed,
          credit: amount(result.totalCredit),
          unit: result.unit === 'token'
            ? (t?.('channelpool.creditsToken') ?? 'tokens')
            : (t?.('channelpool.creditsUnit') ?? 'credits'),
        }) ?? `Claimed ${result.claimed}: +${result.totalCredit}.`)
      } else {
        setNotice(t?.('channelpool.claimNone', {
          already: result.alreadyClaimed,
          inactive: result.inactive,
        }) ?? 'Nothing to claim today.')
      }
      if (result?.failed !== undefined && result.failed > 0) {
        setNotice(t?.('channelpool.claimFailed', { failed: result.failed }) ?? `${result.failed} failed.`)
      }
      await refreshBalances(provider, true)
    } finally {
      if (mountedRef.current) markBusy(provider, false)
    }
  }

  /**
   * Claim the ONE-OFF rewards a channel hands out per account.
   *
   * Two channels have such a reward and neither is a daily check-in:
   *
   *   - Raccoon (商汤) pays a desktop-login bonus once per account. Its daily
   *     points are credited by the server on their own, which is why
   *     `credits.claimAll` answers "不支持每日签到" for it — that answer is
   *     correct and is not the whole story.
   *   - Loomy (讯飞) has onboarding tasks that pay once each, with the reward
   *     topped up to the maximum rather than granted per task.
   *
   * Both live behind `onboarding.claim`, a SEPARATE endpoint from
   * `credits.claimAll` because the semantics differ in the way that matters: a
   * daily claim may be repeated tomorrow, this one may not be repeated at all. The
   * pack has implemented it for both channels all along; the card simply never
   * called it, so a user with a signed-in Raccoon account saw no way to collect
   * the login bonus the pack's own note told them to look for.
   *
   * Per ACCOUNT, not per channel: the endpoint takes an `accountId`, because one
   * account having claimed does not mean the next one has.
   */
  const claimOnboarding = async (provider: string, accounts: readonly { id: string }[]): Promise<void> => {
    if (accounts.length === 0) {
      setNotice(t?.('channelpool.onboardingNoAccounts') ?? 'No account to claim for.')
      return
    }
    markBusy(provider, true)
    let claimed = 0
    let earned = 0
    let skipped = 0
    let failed = 0
    let firstError = ''
    try {
      for (const account of accounts) {
        const envelope = await callPack('onboarding.claim', { provider, accountId: account.id })
        if (!mountedRef.current) return
        if (envelope.ok === false) {
          failed += 1
          if (firstError === '') firstError = envelope.error?.message ?? ''
          continue
        }
        const value = envelope.value as { claimed?: unknown; skipped?: unknown; earned?: unknown } | undefined
        const got = Array.isArray(value?.claimed) ? value.claimed.length : 0
        const total = typeof value?.earned === 'number' ? value.earned : 0
        claimed += got
        earned += total
        if (got === 0) skipped += 1
      }
      if (!mountedRef.current) return
      // A refusal is worth naming: for Raccoon the common one is "already
      // claimed", and a bare "failed" would send the user looking for a bug in a
      // reward they simply already have.
      if (failed > 0) {
        setNotice(firstError !== ''
          ? firstError
          : (t?.('channelpool.onboardingFailed', { failed }) ?? `${failed} account(s) could not claim.`))
      } else if (claimed === 0) {
        setNotice(t?.('channelpool.onboardingNone') ?? 'Nothing left to claim — already collected.')
      } else {
        setNotice(t?.('channelpool.onboardingResult', { claimed, credit: amount(earned), skipped })
          ?? `Claimed ${claimed} reward(s): +${amount(earned)}.`)
      }
      await refreshBalances(provider, true)
    } finally {
      if (mountedRef.current) markBusy(provider, false)
    }
  }

  /**
   * 把某个账号设为首选。
   *
   * 首选是整个账号池的属性，不是某个渠道的 ——
   * 设了之后，下一次请求优先用它。
   * 后端已经有这个路由，只是界面一直没接上。
   */
  const preferAccount = async (provider: string, accountId: string): Promise<void> => {
    markBusy(provider, true)
    try {
      const res = await fetch(POOL_ACCOUNT_PREFER_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ accountId }),
      })
      if (!res.ok) {
        setNotice(t?.('channelpool.preferFailed') ?? '没能设为首选')
        return
      }
      setNotice(t?.('channelpool.preferDone') ?? '已设为首选')
      /* 重新读一次，让首选标记跟着变 */
      await load()
    } catch {
      setNotice(t?.('channelpool.preferFailed') ?? '没能设为首选')
    } finally {
      markBusy(provider, false)
    }
  }

  /**
   * 就地发起登录 —— 不再把读者扔到登录通道。
   *
   * 三条路，判据在 `login-routes.ts`：
   *   · window  后端开一个独立浏览器窗口，等用户登完才返回（可能几分钟）
   *   · paste   需要用户贴一段凭据，弹一个小框
   *   · pack    pack 自带登录页：拿 loginUrl 开新标签，再轮询 login.poll
   */
  const startLogin = async (channelId: string, channelName: string): Promise<void> => {
    /* 上一次还没跑完就取消它 —— 换渠道连着点时不能两条轮询同时在跑 */
    if (loginAbort.current !== undefined) loginAbort.current.cancelled = true
    const token = { cancelled: false }
    loginAbort.current = token

    const kind = loginKindOf(channelId)
    if (kind === 'paste') {
      setLoginState({ channelId, phase: 'paste' })
      return
    }

    setLoginState({
      channelId,
      phase: 'working',
      message: kind === 'window'
        ? '已打开登录窗口，在里面登完之后会自动接入。'
        : '正在打开登录页…',
    })

    if (kind === 'window') {
      const route = WINDOW_LOGIN_ROUTES[channelId]
      if (route === undefined) {
        setLoginState({ channelId, phase: 'failed', message: '这个渠道没有配置登录路由' })
        return
      }
      try {
        const response = await fetch(route, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          /* Marvis 要选 QQ / 微信，这里默认 QQ；要选就回登录通道 */
          body: JSON.stringify({}),
        })
        const body = await response.json().catch((): undefined => undefined) as
          { ok?: boolean; signedIn?: boolean; reason?: string; message?: string } | undefined
        if (token.cancelled) return
        if (body?.signedIn === true || body?.ok === true) {
          setLoginState(undefined)
          invalidateProviderStatusCache()
          await load()
          setNotice(`${channelName} 已接入`)
          return
        }
        setLoginState({
          channelId,
          phase: 'failed',
          message: body?.reason ?? body?.message ?? '没有等到登录完成，可以再试一次。',
        })
      } catch (cause: unknown) {
        if (token.cancelled) return
        setLoginState({
          channelId,
          phase: 'failed',
          message: cause instanceof Error ? cause.message : String(cause),
        })
      }
      return
    }

    /* pack：拿登录页 → 开标签 → 轮询 */
    let accountId = ''
    try {
      const envelope = await callPack('account.create', { provider: channelId })
      if (token.cancelled) return
      if (!envelope.ok) {
        setLoginState({ channelId, phase: 'failed', message: envelope.error?.message ?? '登录失败' })
        return
      }
      const created = createdFrom(envelope)
      if (created === undefined) {
        setLoginState({ channelId, phase: 'failed', message: '没有拿到登录页' })
        return
      }
      accountId = created.accountId
      window.open(created.loginUrl, '_blank', 'noopener')
      setLoginState({
        channelId,
        phase: 'working',
        message: '已打开登录页，登完之后这里会自动接入。',
      })
    } catch (cause: unknown) {
      if (token.cancelled) return
      setLoginState({
        channelId,
        phase: 'failed',
        message: cause instanceof Error ? cause.message : String(cause),
      })
      return
    }

    /*
      轮询。10 分钟和登录通道那边一致：手机验证码、看条款、输错一次密码都够用，
      再久几乎肯定是人走了 —— 一直挂着会把一个待登录账号留在那儿。
    */
    for (let tick = 0; tick < 300; tick += 1) {
      await new Promise<void>((resolve) => { setTimeout(resolve, 2_000) })
      if (token.cancelled) return
      try {
        const envelope = await callPack('login.poll', { provider: channelId, accountId })
        if (token.cancelled) return
        if (!envelope.ok) continue
        const answer = pollFrom(envelope)
        if (!answer.done) continue
        if (answer.success === false) {
          setLoginState({
            channelId,
            phase: 'failed',
            message: answer.error ?? '登录失败，可以再试一次。',
          })
          return
        }
        setLoginState(undefined)
        invalidateProviderStatusCache()
        await load()
        setNotice(`${channelName} 已接入`)
        return
      } catch {
        /* 单次查询失败不算结束，继续等 */
      }
    }
    setLoginState({ channelId, phase: 'failed', message: '等了 10 分钟还没完成，可以再试一次。' })
  }

  const accountAction = async (
    provider: string,
    accountId: string,
    // `claim` is Doubao's own: its credits come from campaign tasks, which the generic pack
    // actions know nothing about.
    action: 'refresh' | 'test' | 'toggle' | 'delete' | 'claim',
  ): Promise<void> => {
    if (action === 'delete' && typeof window !== 'undefined') {
      const prompt = t?.('channelpool.deleteConfirm') ?? 'Remove this account?'
      if (!window.confirm(prompt)) return
    }
    markBusy(provider, true)
    try {
      /**
       * Doubao's account IS the session, so its actions are the session's.
       *
       * `account.delete` / `test` / `refresh` are pack RPCs addressed to the pack's credential
       * store, and Doubao has no entry there — every one of them answered "unsupported
       * provider", so the buttons did nothing and the row could not be removed.
       */
      if (provider === 'doubao') {
        if (action === 'delete') {
          await fetch(POOL_DOUBAO_SESSION_PATH, { method: 'DELETE', credentials: 'same-origin' })
        } else if (action === 'refresh') {
          await fetch(POOL_DOUBAO_QUOTA_PATH, { credentials: 'same-origin' })
        } else if (action === 'test') {
          await fetch(POOL_DOUBAO_SESSION_PATH, { credentials: 'same-origin' })
        } else if (action === 'claim') {
          /**
           * Collect the account's credit tasks.
           *
           * The claim endpoint takes one item at a time, so the route loops over everything
           * the campaign reports as claimable and answers how many landed. That is what makes
           * this a single button rather than a per-task checklist.
           */
          const response = await fetch(POOL_DOUBAO_CLAIM_PATH, { method: 'POST', credentials: 'same-origin' })
          const body = await response.json().catch(() => undefined) as
            | { claimed?: number; failed?: number; reason?: string }
            | undefined
          if (!mountedRef.current) return
          const claimedCount = typeof body?.claimed === 'number' ? body.claimed : 0
          setNotice(
            claimedCount > 0
              ? `已领取 ${String(claimedCount)} 项积分`
              : (body?.reason ?? '没有可领取的积分'),
          )
          invalidatePoolSnapshot()
          await load()
          return
        }
        if (!mountedRef.current) return
        invalidatePoolSnapshot()
        await load()
        setNotice(action === 'delete' ? '已删除豆包会话' : '已刷新')
        return
      }
      /*
        Marvis 的账号在插件自己的存储里：删除走 session 路由的 DELETE（带 openid，只删这一个），
        刷新就是重读这个渠道的 token 钱包。没有启用/停用开关 —— 存储里没有这个字段，画了也是假的。
      */
      if (provider === 'marvis') {
        if (action === 'delete') {
          const response = await fetch(POOL_MARVIS_SESSION_PATH, {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ openid: accountId }),
          })
          if (!mountedRef.current) return
          if (!response.ok) { setNotice('没能删除这个账号'); return }
          invalidatePoolSnapshot()
          await load()
          setNotice('已删除这个 Marvis 账号')
          return
        }
        await refreshBalances(provider, true, true)
        if (mountedRef.current) setNotice('已刷新 token 用量')
        return
      }
      const entry = entries.find(item => item.channel.id === provider)
      const enabledNow = entry?.accounts.find(account => account.id === accountId)?.enabled !== false
      const method = action === 'refresh' ? 'account.refresh'
        : action === 'test' ? 'account.test'
        : action === 'delete' ? 'account.delete'
        : 'account.update'
      const payload = action === 'toggle'
        ? { accountId, patch: { enabled: !enabledNow } }
        : { accountId }
      const envelope = await callPack(method, payload)
      if (!mountedRef.current) return
      if (!envelope.ok) {
        setNotice(envelope.error?.message ?? `${action} refused`)
        return
      }
      if (action === 'test') setNotice(t?.('channelpool.testOk') ?? 'Reachable.')
      // The account list just changed on disk, so the cross-mount snapshot is
      // stale in a way silence would hide: the user is looking at this exact
      // card, and an unchanged one would read as "the action did nothing".
      invalidatePoolSnapshot()
      await load()
    } finally {
      if (mountedRef.current) markBusy(provider, false)
    }
  }

  // An empty result is NOT worth a block of its own once it is known: the page
  // above already explains what this pool is, and an empty grid that says "add
  // an account on the login page" only repeats the nav row the reader just
  // clicked.
  //
  // But "nothing yet" and "not read yet" are different answers, and rendering
  // both as air is what made the failed-bridge case unfalsifiable (#95): the
  // RPC came back `ok: false`, `provider.status` produced an empty map, and the
  // section returned `<></>` with `error === undefined`, so the user saw a blank
  // half-page that looked exactly like "I have not signed in to these channels".
  //
  // So: while the first read is in flight, say so; when it failed, say why;
  // only a successful read that found nothing stays silent.
  if (entries.length === 0 && error === undefined) {
    /*
      一条渠道都没读到，但插件池账号卡（regionCards）不属于任何渠道：
      账号可能已经存好了、只是渠道还没扫出来，这种情况不能返回空。

      所以这里留一个出口，让「有卡且已读完」的情况落到下面
      chosenEntry === undefined 那条分支 —— 它本来就渲染 {list} + main > mbody，
      列表头显示 0 / 0 / —，读起来是「确实没有渠道」而不是一片空白，
      而不是另写一套 list + main。那条分支在 error 存在时本来就一直在走，是既有代码。
    */
    const keepForRegionCards = regionCards !== undefined && !loading
    if (!keepForRegionCards) {
      if (!loading) return <></>
      return (
        <section className="dsm-xdpool-cpool" aria-label={t?.('channelpool.title') ?? 'Channels'}>
          <p className="note" role="status">
            {t?.('channelpool.loading') ?? 'Reading scan channels…'}
          </p>
        </section>
      )
    }
  }
  /*
    ---------------------------------------------------------------
    以下是渲染。结构逐块对照 xdpool-design/pool.html：

      nav.list   list-head（标题 + 三格汇总）→ list-scroll（已登录 / 未登录两组 .ch）
      main.main  mhead（名字 · 厂商 · 状态 pill · 添加账号）
                 mbody → note → kpis → policies → sec 账号（.accts > .acct）→ sec 模型（.models > .model）

    注意：这里已经在提前 return 之后，不能再调用任何 hook（useState / useEffect）——
    之前「分配策略」的 useState 写在这下面，条目从 0 变成非 0 时 React 会因为
    hook 数量变化直接报错，整页白掉。
    ---------------------------------------------------------------
  */
  const chosenEntry = entries.find(entry => entry.channel.id === chosen) ?? entries[0]

  /* 中栏三格：账号总数 / 已连（启用中的账号）/ 积分（只加「积分」单位的渠道，美元、token、百分比不混进来） */
  const totalAccounts = entries.reduce((sum, entry) => sum + entry.accounts.length, 0)
  const liveAccounts = entries.reduce(
    (sum, entry) => sum + entry.accounts.filter(account => account.enabled !== false).length, 0)
  const totalCredits = entries.reduce((sum, entry) => {
    const credits = entry.channel.credits
    if (credits === undefined || credits.unit !== undefined || credits.quota === true) return sum
    const value = balancesTotal(entry.balances)
    return value === undefined ? sum : sum + value
  }, 0)
  const anyCredits = entries.some(entry => entry.channel.credits !== undefined
    && entry.channel.credits.unit === undefined && entry.channel.credits.quota !== true
    && balancesTotal(entry.balances) !== undefined)
  const bound = entries.filter(entry => entry.accounts.length > 0)
  const unbound = entries.filter(entry => entry.accounts.length === 0)

  /** 中栏一行。未登录的那组去色，点了直接去登录通道（设计稿 href="login.html"）。 */
  const channelRow = (entry: ChannelEntry, isBound: boolean): ReactElement => {
    const icon = channelIcon(entry.channel.id)
    const isOn = chosenEntry !== undefined && entry.channel.id === chosenEntry.channel.id
    return (
      <button
        key={entry.channel.id}
        type="button"
        className="ch"
        title={entry.channel.name}
        data-bound={isBound ? undefined : 'false'}
        aria-current={isOn ? 'true' : undefined}
        onClick={() => {
          if (!isBound && onAddAccount !== undefined) { onAddAccount(); return }
          setOwnActive(entry.channel.id)
        }}
      >
        {icon === undefined
          ? <span className="ch-mark" data-letters={channelInitials(entry.channel.name)}>{channelInitials(entry.channel.name)}</span>
          /* css:--icon-xxx 是「用设计稿的 CSS 变量」，不能包进 url() */
          : <span className="ch-mark" style={{
              backgroundImage: icon.startsWith('css:') ? `var(${icon.slice(4)})` : `url("${icon}")`,
            }} />}
        <span className="ch-name">{entry.channel.name}</span>
        {isBound ? <span className="ch-n num">{String(entry.accounts.length)}</span> : null}
      </button>
    )
  }

  const list = (
    <nav className="list" aria-label={t?.('channelpool.title') ?? 'Channels'}>
      <div className="list-head">
        <div className="list-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {t?.('shell.tabPool') ?? '账号池'}
          {refreshing ? (
            <span className="spinner" role="status" aria-label="正在刷新" title="正在刷新账号和模型"
              style={{ width: 10, height: 10, borderWidth: 1.5 }} />
          ) : null}
        </div>
        <div className="list-stats">
          <div className="ls">
            <span className="ls-v num">{String(totalAccounts)}</span>
            <span className="ls-k">账号总数</span>
          </div>
          <div className="ls">
            <span className="ls-v num">{String(liveAccounts)}</span>
            <span className="ls-k">已连</span>
          </div>
          <div className="ls">
            {anyCredits ? <WanNumber value={totalCredits} /> : <span className="ls-v num">—</span>}
            <span className="ls-k">积分</span>
          </div>
        </div>
      </div>
      <div className="list-scroll">
        {bound.length === 0 ? null : (
          <>
            <div className="list-group">已登录<span className="list-group-n num">{String(bound.length)}</span></div>
            {bound.map(entry => channelRow(entry, true))}
          </>
        )}
        {unbound.length === 0 ? null : (
          <>
            <div className="list-group" data-empty="true">未登录<span className="list-group-n num">{String(unbound.length)}</span></div>
            {unbound.map(entry => channelRow(entry, false))}
          </>
        )}
      </div>
    </nav>
  )

  if (chosenEntry === undefined) {
    return (
      <>
        {list}
        <main className="main dsm-xdpool-cpool dsm-xdpool-regions" aria-label={t?.('channelpool.title') ?? 'Channels'}>
          <div className="mbody" style={{ paddingTop: 'var(--s5)' }}>
            {banner}
            {regionCards}
            {error === undefined ? null : (
              <p className="hint">
                {t?.('channelpool.loadError', { message: error }) ?? `Could not load channels: ${error}`}
                <button type="button" className="tiny" style={{ marginLeft: 'auto' }}
                  onClick={() => { setEnabled(new Map()); void load() }}>
                  {t?.('channelpool.retry') ?? '重试'}
                </button>
              </p>
            )}
          </div>
        </main>
      </>
    )
  }

  const { channel, accounts, models, facts, balances, statuses, status } = chosenEntry
  const enabledIds = enabledFor(channel.id, models)
  const isBusy = busy.has(channel.id)
  const unit = creditUnitLabel(channel, t)
  const chosenBalanceTotal = channel.credits === undefined ? undefined : balancesTotal(balances)
  const chosenCredit = chosenEntry.balancePending && chosenBalanceTotal === undefined
    ? (t?.('channelpool.balanceLoading') ?? '…')
    : chosenBalanceTotal === undefined
      ? '—'
      : amount(chosenBalanceTotal)
  const modelsEnabled = models.filter(model => enabledIds.has(model.id)).length
  const statusOf = (accountId: string): ChannelCreditStatus | undefined =>
    statuses.find(row => row.accountId === accountId)
  const balanceOf = (accountId: string): ChannelBalance | undefined =>
    balances.find(row => row.accountId === accountId)
  const enabledAccounts = accounts.filter(account => account.enabled !== false)
  // An unknown status is treated as "not yet" so the button stays claimable
  // until the first refresh lands; a zero-account channel never reads as
  // "all claimed", because there is nothing to have claimed.
  const allClaimedToday = enabledAccounts.length > 0
    && enabledAccounts.every(account => statusOf(account.id)?.todayCheckedIn === true)
  const claimedToday = enabledAccounts.filter(account => statusOf(account.id)?.todayCheckedIn === true).length
  /* 有签到路径的渠道才画「全部领取」：pack 的 credits.claimAll，或插件自己的签到路由 */
  const canClaim = channel.credits?.claim === true || OWN_CHECKIN_CHANNELS[channel.id] !== undefined
  const query = queryFor(channel.id)
  const visibleModels = modelsMatching(chosenEntry, query)
  const mode = modeOf(channel.id)
  /*
    积分自动化：后台调度器（pack 的 autoCheckin）遍历**所有有账号的渠道**，
    对每一家调 `credits.claimAll` —— 不是只跑 WorkBuddy。

    所以「能签到的渠道」都该有这个开关；判据就是 canClaim
    （pack 声明了 claim，或插件自己有签到路由）。
    原来这里写死 `channel.id === 'buddy'`，是基于「只跑国内版」的旧认知。
  */
  const showAutomation = canClaim && onAutoClaim !== undefined

  /*
    腾讯 Marvis：按 token 计，不是积分（设计稿 marvis.html）。
    banner 代替 note，kpis 换成「账号 / 今日用量 / 今日可用」，账号卡画每个账号自己的 .quota。
    没有 policies：Marvis 的请求由插件自己的适配器发，不走账号池的分配策略。
  */
  const isMarvis = channel.id === 'marvis'
  const quotaOf = (accountId: string): MarvisQuota | undefined =>
    marvisQuotas?.find(row => row.openid === accountId)
  const marvisRows = accounts
    .map(account => quotaOf(account.id))
    .filter((row): row is MarvisQuota => row !== undefined && row.error === undefined)
  const marvisUsed = marvisRows.reduce((sum, row) => sum + row.used, 0)
  const marvisAvailable = marvisRows.reduce((sum, row) => sum + row.available, 0)
  /** 今日总额度：读到的按后端，没读到的账号按每天 1,000 万算 */
  const marvisTotal = accounts.reduce((sum, account) => {
    const row = marvisQuotas?.find(quota => quota.openid === account.id)
    return sum + (row !== undefined && row.error === undefined && row.total > 0 ? row.total : MARVIS_DAILY_TOKENS)
  }, 0)
  const marvisUsedCount = marvisRows.filter(row => row.used > 0).length
  const marvisReset = marvisRows.reduce<number | undefined>((soonest, row) =>
    row.resetAt === undefined ? soonest : soonest === undefined ? row.resetAt : Math.min(soonest, row.resetAt), undefined)
  const marvisPending = marvisQuotas === undefined || (chosenEntry.balancePending && marvisRows.length === 0)
  /** 「全部刷新」：重读每个账号的 token 钱包。 */
  const refreshMarvis = async (): Promise<void> => {
    markBusy('marvis', true)
    try {
      await refreshBalances('marvis', true, true)
      if (mountedRef.current) setNotice('已刷新全部账号的 token 用量')
    } finally {
      if (mountedRef.current) markBusy('marvis', false)
    }
  }

  /** 「全部领取」：自有签到路由的几家走插件路由，其余走 pack。 */
  const claimAllFor = async (provider: string): Promise<void> => {
    if (OWN_CHECKIN_CHANNELS[provider] === undefined) { await claim(provider); return }
    markBusy(provider, true)
    try {
      const said = await ownCheckin(provider)
      if (!mountedRef.current) return
      if (said !== undefined) setNotice(said)
      await refreshBalances(provider, true)
    } finally {
      if (mountedRef.current) markBusy(provider, false)
    }
  }
  /** 「重新检测账号」：丢掉缓存，重读账号与余额。 */
  const recheck = async (provider: string): Promise<void> => {
    invalidatePoolSnapshot()
    setEnabled(new Map())
    await load()
    await refreshBalances(provider, true)
  }

  return (
    <>
    {list}
    <main className="main dsm-xdpool-cpool dsm-xdpool-regions" aria-label={t?.('channelpool.title') ?? 'Channels'}>
      <header className="mhead">
        <div className="mhead-title">
          <span className="mhead-name">{channel.name}</span>
          <span className="mhead-org">
            {channel.domain === undefined || channel.domain === '' ? channel.org : `${channel.org} · ${channel.domain}`}
          </span>
          {accounts.length > 0
            ? <span className="pill" data-tone="ok">{t?.('channelpool.stateReady') ?? '已连接'}</span>
            : <span className="pill">{t?.('channelpool.stateNone') ?? '未登录'}</span>}
        </div>
        {onAddAccount === undefined && !canStartLoginInPlace(channel.id) ? null : (
          <div className="mhead-actions">
            {/*
              就地登录：能自己发起的渠道直接在这里开始，不再跳去登录通道。
              剩下真正做不了的（既没有开窗路由也没有粘贴路由）才回退到跳转。
            */}
            <button
              type="button"
              className="btn btn-primary"
              disabled={loginState?.channelId === channel.id && loginState.phase === 'working'}
              onClick={() => {
                if (canStartLoginInPlace(channel.id)) {
                  void startLogin(channel.id, channel.name)
                  return
                }
                onAddAccount?.()
              }}
            >
              {loginState?.channelId === channel.id && loginState.phase === 'working'
                ? '等待登录…'
                : '添加账号'}
            </button>
          </div>
        )}
      </header>

      <div className="mbody">
        {banner}
        {regionCards}
        {/*
          就地登录的状态条。
          因为不再跳页，读者需要在这一页看到「窗口已经开了 / 还在等 / 失败了为什么」。
        */}
        {loginState !== undefined && loginState.channelId === channel.id && (
          loginState.phase === 'paste' ? (
            <div className="banner">
              <span className="banner-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <rect x="8" y="3" width="12" height="14" rx="2" />
                  <path d="M16 17v2a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2h2" />
                </svg>
              </span>
              <span className="banner-body">
                <span className="banner-t">这个渠道要粘贴凭据</span>
                <span className="banner-d">
                  它的登录要过验证码或桌面流程，这里接不住。去「登录通道」里点这一家的登录即可。
                </span>
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => { setLoginState(undefined); onAddAccount?.() }}
              >
                去登录通道
              </button>
            </div>
          ) : (
            <div className="banner">
              <span className="banner-icon">
                {loginState.phase === 'working'
                  ? <span className="spinner" />
                  : <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16v.01" /></svg>}
              </span>
              <span className="banner-body">
                <span className="banner-t">
                  {loginState.phase === 'working' ? '正在等登录完成' : '这一步没成'}
                </span>
                <span className="banner-d">{loginState.message ?? ''}</span>
              </span>
              {loginState.phase === 'failed' && (
                <button type="button" className="btn" onClick={() => { setLoginState(undefined) }}>
                  知道了
                </button>
              )}
            </div>
          )
        )}
        {error === undefined ? null : (
          <p className="hint">
            {t?.('channelpool.loadError', { message: error }) ?? `Could not load channels: ${error}`}
            <button type="button" className="tiny" style={{ marginLeft: 'auto' }}
              onClick={() => { setEnabled(new Map()); void load() }}>
              {t?.('channelpool.retry') ?? '重试'}
            </button>
          </p>
        )}
        {notice === undefined ? null : <p className="hint" role="status"><b>提示</b><span>{notice}</span></p>}

        {isMarvis ? (
          <div className="banner">
            <span className="banner-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3v12M8 11l4 4 4-4" /><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>
            </span>
            <span className="banner-body">
              <span className="banner-t">这个渠道按 token 计，不是积分</span>
              <span className="banner-d">
                {`每个账号每天 1,000 万 token，${marvisResetText(marvisReset)}。所以卡片上画的是 token 用量条，不是积分数字。`}
              </span>
            </span>
          </div>
        ) : channel.note === '' ? null : <p className="note">{channel.note}</p>}

        {/* kpis：账号 / 模型 / 剩余积分。没有积分的渠道只有两格，列数跟着格数走，不留空格子 */}
        {isMarvis ? (
          <div className="kpis">
            <div className="kpi">
              <span className="kpi-k">账号</span>
              <span className="kpi-v num">{String(accounts.length)}</span>
            </div>
            <div className="kpi">
              <span className="kpi-k">今日用量</span>
              <span className="kpi-v num">
                {marvisPending ? '…' : groupDigits(marvisUsed)}
                <span className="kpi-u">token</span>
              </span>
              {marvisPending ? null : (
                <span className="kpi-sub">
                  {marvisRows.length === 0
                    ? '用量还没读到'
                    : marvisUsedCount === 0
                      ? `${String(marvisRows.length)} 个账号都还没用`
                      : `${String(marvisUsedCount)}/${String(marvisRows.length)} 个账号已用`}
                </span>
              )}
            </div>
            <div className="kpi">
              <span className="kpi-k">今日可用</span>
              <span className="kpi-v num">
                {marvisPending ? '…' : marvisRows.length === 0 ? '—' : wanDigits(marvisAvailable)}
                <span className="kpi-u">{`/ ${wanDigits(marvisTotal)} 万`}</span>
              </span>
              {marvisPending ? null : (
                <span className="kpi-sub" title={marvisResetTitle(marvisReset)}>{marvisResetText(marvisReset)}</span>
              )}
            </div>
          </div>
        ) : (
        <div className="kpis" style={{
          gridTemplateColumns: `repeat(${channel.credits === undefined ? '2' : '3'},minmax(0,1fr))`,
        }}>
          <div className="kpi">
            <span className="kpi-k">{t?.('channelpool.statAccounts') ?? '账号'}</span>
            <span className="kpi-v num">{String(enabledAccounts.length)}</span>
          </div>
          <div className="kpi">
            <span className="kpi-k">{t?.('channelpool.statModels') ?? '模型'}</span>
            <span className="kpi-v num">
              {String(modelsEnabled)}
              <span className="kpi-u">/{String(models.length)}</span>
            </span>
          </div>
          {channel.credits === undefined ? null : (
            <div className="kpi">
              <span className="kpi-k">{t?.('channelpool.statCredit') ?? '剩余积分'}</span>
              <span className="kpi-v num">
                {chosenCredit}
                <span className="kpi-u">{unit}</span>
              </span>
            </div>
          )}
        </div>
        )}

        {/* policies：账号使用方式（真的写进后端 channels/usage）+ 积分自动化 */}
        {isMarvis ? null : (
        <div className="policies">
          <div className="policy">
            <span className="policy-k">
              {t?.('channelpool.usageMode') ?? '账号使用方式'}
              {modeIsOwn(channel.id) ? '' : '（跟随全局）'}
            </span>
            <div className="seg">
              {MODE_ORDER.map(option => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={mode === option}
                  disabled={usageBusy}
                  onClick={() => { void setChannelMode(channel.id, option) }}
                >
                  {MODE_LABEL[option](t)}
                </button>
              ))}
            </div>
            <span className="policy-hint">
              {accounts.length <= 1
                ? '这个渠道只有一个账号，使用方式不影响选号。'
                : modeHint(t, mode)}
            </span>
          </div>
          {!showAutomation ? null : (
            <div className="policy">
              <span className="policy-k">{t?.('channelpool.autoClaim') ?? '积分自动化'}</span>
              <div className="policy-v">
                <button
                  type="button"
                  role="switch"
                  className="sw"
                  aria-checked={autoClaim === true}
                  aria-label={t?.('channelpool.autoClaim') ?? '积分自动化'}
                  disabled={autoClaimBusy === true}
                  onClick={() => { onAutoClaim?.(autoClaim !== true) }}
                />
                <span>
                  {`${t?.('channelpool.claimedToday') ?? '今日已领'} ${String(claimedToday)}/${String(enabledAccounts.length)}`}
                </span>
                {/*
                  「立即执行」—— 自动化开着只是「到点会跑」，用户想马上领的时候没有入口。
                  3.0 重做时 `runAutomationJob` 写好了却没人调用，这里把它接回来：
                  按钮自己转圈到这一轮跑完，结果落在「今日已领」上。
                */}
                <button
                  type="button"
                  className="tiny"
                  disabled={autoClaimRunning === true}
                  title={t?.('channelpool.autoClaimRunHint') ?? '立刻跑一轮领取，不用等到预定时间'}
                  onClick={() => { onAutoClaimRun?.() }}
                >
                  {autoClaimRunning === true
                    ? (t?.('channelpool.autoClaimRunning') ?? '领取中…')
                    : (t?.('channelpool.autoClaimRun') ?? '立即执行')}
                </button>
              </div>
              <span className="policy-hint">
                {t?.('channelpool.autoClaimHint') ?? '开着就会在后台领每天的积分，不用手动点。'}
              </span>
            </div>
          )}
        </div>
        )}

        {/* ---------- 账号（Marvis：每个账号自己的 token 用量） ---------- */}
        {isMarvis ? (
          <section className="sec">
            <div className="sec-head">
              <span className="sec-title">账号</span>
              <span className="sec-n num">{String(accounts.length)}</span>
              <span className="sec-actions">
                <button type="button" className="btn" disabled={isBusy}
                  onClick={() => { void recheck(channel.id) }}>
                  重新检测账号
                </button>
                <button type="button" className="btn" disabled={isBusy}
                  onClick={() => { void refreshMarvis() }}>
                  {isBusy ? '刷新中…' : '刷新用量'}
                </button>
              </span>
            </div>
            {accounts.length === 0 ? (
              <p className="hint">这个渠道还没有登录的账号。</p>
            ) : (
              <div className="accts">
                {accounts.map((account, index) => {
                  const quota = quotaOf(account.id)
                  const shown = accountDisplay(account, channel.name, index)
                  const name = shown.name
                  /* 总量：后端读到就用后端的；没读到按每天 1,000 万，用量条照样画出刻度 */
                  const total = quota !== undefined && quota.error === undefined && quota.total > 0 ? quota.total : MARVIS_DAILY_TOKENS
                  const usedPct = total > 0 && quota !== undefined
                    ? Math.max(0, Math.min(100, Math.round(quota.used / total * 100)))
                    : 0
                  /* 剩不到一成就换警示色：今天快用完了 */
                  const low = quota !== undefined && quota.error === undefined && total > 0
                    && quota.available / total < 0.1
                  return (
                    <article key={account.id} className="acct">
                      <div className="acct-head">
                        <span className="acct-dot" aria-hidden="true"
                          style={quota?.error === undefined ? undefined : { background: 'var(--warn)' }} />
                        <span className="acct-name" title={shown.full}>{name}</span>
                        {shown.tail === undefined ? null : (
                          <span className="num" style={{ fontSize: 'var(--fs-xs)', color: 'var(--faint)', flex: '0 0 auto' }}>
                            {`…${shown.tail}`}
                          </span>
                        )}
                        <span className="login-kind">Marvis 令牌</span>
                      </div>
                      <div className="quota">
                        <div className="quota-bar" data-low={low ? 'true' : undefined}>
                          <span style={{ width: `${String(Math.max(usedPct, 1))}%` }} />
                        </div>
                        <div className="quota-text">
                          {quota?.error !== undefined ? (
                            <span className="acct-k" data-tone="err" title={quota.error}
                              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                              {quota.error}
                            </span>
                          ) : (
                            <>
                              <span className="quota-used" style={{ color: 'var(--text)', fontWeight: 600 }}>
                                {quota === undefined ? (marvisPending ? '…' : '—') : wanDigits(quota.used)}
                              </span>
                              <span className="quota-total">{`/ ${wanDigits(total)} 万 token`}</span>
                            </>
                          )}
                          <span className="quota-reset" title={marvisResetTitle(quota?.resetAt)}>
                            {marvisResetText(quota?.resetAt)}
                          </span>
                        </div>
                      </div>
                      <div className="acct-more">
                        <button type="button" className="tiny" disabled={isBusy}
                          onClick={() => { void accountAction(channel.id, account.id, 'refresh') }}>
                          刷新用量
                        </button>
                        <button type="button" className="tiny" disabled={isBusy}
                          style={{ color: 'var(--danger)' }}
                          onClick={() => { void accountAction(channel.id, account.id, 'delete') }}>
                          删除
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        ) : (
        <section className="sec">
          <div className="sec-head">
            <span className="sec-title">{t?.('channelpool.accountsTitle') ?? '账号'}</span>
            <span className="sec-n num">{String(accounts.length)}</span>
            <span className="sec-actions">
              <button type="button" className="btn" disabled={isBusy}
                onClick={() => { void recheck(channel.id) }}>
                重新检测账号
              </button>
              {/* 一次性奖励（Raccoon 登录奖励 / Loomy 新手任务）有自己的端点，不并进每日签到 */}
              {ONBOARDING_CHANNELS.has(channel.id) && (
                <button type="button" className="btn" disabled={isBusy}
                  title={t?.('channelpool.onboardingHint') ?? '一次性奖励（登录奖励 / 新手任务），每号只能领一次'}
                  onClick={() => { void claimOnboarding(channel.id, enabledAccounts) }}>
                  {t?.('channelpool.onboarding') ?? '领取一次性奖励'}
                </button>
              )}
              {canClaim && (
                <button type="button" className="btn" disabled={isBusy || allClaimedToday}
                  onClick={() => { void claimAllFor(channel.id) }}>
                  {isBusy
                    ? (t?.('channelpool.claiming') ?? '领取中…')
                    : allClaimedToday
                      ? (t?.('channelpool.claimClaimed') ?? '今日已领取')
                      : '全部领取'}
                </button>
              )}
            </span>
          </div>
          {chosenEntry.balanceError === undefined ? null : (
            <p className="hint" role="status">{chosenEntry.balanceError}</p>
          )}
          {accounts.length === 0 ? (
            <p className="hint">
              {t?.('channelpool.accountsEmpty') ?? '这个渠道还没有登录的账号。'}
            </p>
          ) : (
            <div className="accts">
              {accounts.map((account, index) => {
                const shown = accountDisplay(account, channel.name, index)
                const balance = balanceOf(account.id)
                const value = balance === undefined ? undefined : balanceAmount(balance.balance)
                const checkin = statusOf(account.id)
                const buckets = balance === undefined ? [] : balancePackages(balance.balance)
                const disabled = account.enabled === false
                const soon = expiryText(account.expiresAt, t)
                /* 进度条：有分包就用第一包的剩余百分比；没有就不画（不编一个数） */
                const pct = packagePercent(buckets[0])
                return (
                  <article key={account.id} className="acct" data-off={disabled}>
                    <div className="acct-head">
                      <span className="acct-dot" aria-hidden="true"
                        style={disabled ? { background: 'var(--line-3)' } : undefined} />
                      <span className="acct-name" title={shown.full}>{shown.name}</span>
                      {shown.tail === undefined ? null : (
                        <span className="num" style={{ fontSize: 'var(--fs-xs)', color: 'var(--faint)', flex: '0 0 auto' }}>
                          {`…${shown.tail}`}
                        </span>
                      )}
                      <button
                        type="button"
                        role="switch"
                        className="sw"
                        aria-checked={!disabled}
                        aria-label={shown.name}
                        disabled={isBusy}
                        onClick={() => { void accountAction(channel.id, account.id, 'toggle') }}
                      />
                    </div>
                    <div className="acct-total" style={balance?.error !== undefined ? { flexWrap: 'wrap', alignItems: 'flex-start' } : undefined}>
                      {balance?.error !== undefined
                        ? <span className="acct-k" data-tone="err" title={balance.error}
                            style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                              overflow: 'hidden', color: 'var(--warn)', lineHeight: 1.5, minWidth: 0, flex: '1 1 auto' }}>
                            {balanceErrorText(balance.error)}
                          </span>
                        : value !== undefined
                          ? <>
                              <span className="acct-total-v num">{amount(value)}</span>
                              <span className="acct-total-u">{unit}</span>
                            </>
                          : <span className="acct-total-v">{chosenEntry.balancePending ? '…' : '—'}</span>}
                      {soon === undefined ? null : <span className="acct-soon">{soon}</span>}
                    </div>
                    {pct === undefined ? null : (
                      <div className="acct-bar" title={buckets.map(b => `${b.name} ${packageDetailText(b)}`).join(' · ')}>
                        <span style={{ width: `${String(Math.max(0, Math.min(100, Math.round(pct))))}%` }} />
                      </div>
                    )}
                    <details className="acct-detail">
                      <summary>{t?.('channelpool.accountDetail') ?? '积分明细'}</summary>
                      <dl className="facts">
                        {buckets.map((b, i) => (
                          <div className="fact" key={`${b.name}-${String(i)}`}>
                            <dt>{b.name}</dt>
                            {/* 设计稿写的是「398 / 500」—— 剩余 / 总量；只有百分比包才按比例折算 */}
                            <dd>{packageDetailText(b)}</dd>
                          </div>
                        ))}
                        {channel.credits?.status !== true && checkin === undefined ? null : (
                          <div className="fact">
                            <dt>{t?.('channelpool.todayClaimed') ?? '今日签到'}</dt>
                            {checkin?.todayCheckedIn === true
                              ? <dd style={{ color: 'var(--accent)' }}>
                                  已领{typeof checkin.todayCredit === 'number' ? ` +${amount(checkin.todayCredit)}` : ''}
                                </dd>
                              : <dd>{t?.('channelpool.notClaimed') ?? '未领'}</dd>}
                          </div>
                        )}
                      </dl>
                      {/* 单号操作放在「积分明细」展开之后，不摊在卡面上 */}
                      <div className="acct-more">
                        {channel.id === 'doubao' && (
                          <button type="button" className="tiny" disabled={isBusy}
                            onClick={() => { void accountAction(channel.id, account.id, 'claim') }}>
                            {t?.('channelpool.claimCredits') ?? '领取积分'}
                          </button>
                        )}
                        <button type="button" className="tiny" disabled={isBusy}
                          onClick={() => { void accountAction(channel.id, account.id, 'test') }}>
                          {t?.('channelpool.testAccount') ?? '测试'}
                        </button>
                        <button type="button" className="tiny"
                          disabled={isBusy || account.preferred === true}
                          title={t?.('channelpool.preferHint') ?? '优先用这个账号接下一次请求'}
                          onClick={() => { void preferAccount(channel.id, account.id) }}>
                          {account.preferred === true
                            ? (t?.('channelpool.preferred') ?? '首选')
                            : (t?.('channelpool.prefer') ?? '设为首选')}
                        </button>
                        <button type="button" className="tiny" disabled={isBusy}
                          onClick={() => { void accountAction(channel.id, account.id, 'refresh') }}>
                          {t?.('channelpool.refreshAccount') ?? '刷新凭据'}
                        </button>
                        <button type="button" className="tiny" disabled={isBusy}
                          style={{ color: 'var(--danger)' }}
                          onClick={() => { void accountAction(channel.id, account.id, 'delete') }}>
                          {t?.('channelpool.deleteAccount') ?? '删除'}
                        </button>
                      </div>
                    </details>
                  </article>
                )
              })}
            </div>
          )}
        </section>
        )}

        {/* ---------- 模型 ---------- */}
        <section className="sec">
          <div className="sec-head">
            <span className="sec-title">{t?.('channelpool.modelsTitle') ?? '模型'}</span>
            <span className="sec-n num">{`${String(modelsEnabled)}/${String(models.length)}`}</span>
            <span className="sec-actions">
              <button type="button" className="btn"
                disabled={catalogBusy.has(channel.id)}
                title={t?.('channelpool.reloadModelsHint') ?? '从上游重新读取这个渠道的模型列表（含倍率）'}
                onClick={() => { void refreshChannelModels(channel.id) }}>
                {catalogBusy.has(channel.id)
                  ? (t?.('channelpool.reloadModelsBusy') ?? '正在读取…')
                  : '重新获取模型'}
              </button>
              {!isMarvis && models.length < MODEL_SEARCH_THRESHOLD ? null : (
                <input
                  type="search"
                  className="search"
                  value={query}
                  placeholder={t?.('channelpool.searchModels') ?? '搜索模型'}
                  aria-label={t?.('channelpool.searchModels') ?? '搜索模型'}
                  onChange={event => { setQuery(channel.id, event.target.value) }}
                />
              )}
              {/* Marvis 的模型由插件适配器直接发布，没有黑名单可写，「全开 / 全关」画了也不生效 */}
              {isMarvis ? null : (
              <>
              <button type="button" className="btn" disabled={isBusy || models.length === 0}
                onClick={() => { void setAllModels(channel.id, true) }}>
                {t?.('channelpool.allOn') ?? '全开'}
              </button>
              <button type="button" className="btn" disabled={isBusy || models.length === 0}
                onClick={() => { void setAllModels(channel.id, false) }}>
                {t?.('channelpool.allOff') ?? '全关'}
              </button>
              </>
              )}
            </span>
          </div>
          {models.length === 0 ? (
            <p className="hint">
              {chosenEntry.modelError === undefined
                ? (t?.('channelpool.noModels') ?? '这个渠道还没有公布模型。')
                // A refusal and an empty catalogue look identical on the wire,
                // but only one of them is a bug the user can act on.
                : (t?.('channelpool.modelError', { message: chosenEntry.modelError })
                  ?? `Could not list models: ${chosenEntry.modelError}`)}
            </p>
          ) : visibleModels.length === 0 ? (
            <p className="hint">
              {t?.('channelpool.searchNone', { query: query.trim() }) ?? `没有匹配「${query.trim()}」的模型。`}
            </p>
          ) : (
            <div className="models">
              {visibleModels.map(model => {
                const fact = facts.get(model.id)
                const on = enabledIds.has(model.id)
                const modalities = model.inputModalities ?? fact?.inputModalities
                const vision = modalities?.includes('image') === true || modalities?.includes('images') === true
                const mult = multiplierOf(model.name)
                const free = model.isFree === true || (mult !== undefined && multiplierTone(mult) === 'free')
                const description = model.description ?? fact?.description
                /*
                  上下文窗口选择：设计稿是每行右侧一个小下拉。
                  只有原生窗口比默认上限大时才有得选（原生 / 默认上限）；
                  否则就是一个只读的窗口大小。
                */
                const native = model.nativeContextWindow ?? model.contextWindow ?? fact?.contextWindow
                const capped = native !== undefined && native > CONTEXT_BUDGET_DEFAULT
                const budget = model.contextBudget ?? native
                return (
                  <div key={model.id} className="model" data-off={on ? undefined : 'true'}>
                    <button
                      type="button"
                      role="switch"
                      className="sw"
                      aria-checked={isMarvis ? true : on}
                      aria-label={baseName(model.name ?? model.id)}
                      title={isMarvis ? 'Marvis 的模型都由服务端提供，不能单独关闭' : undefined}
                      disabled={isBusy || isMarvis}
                      onClick={() => { if (!isMarvis) void toggleModel(channel.id, model.id, !on) }}
                    />
                    <div className="model-main">
                      <div className="model-top">
                        <span className="model-name"
                          title={description === undefined || description === '' ? model.id : `${model.id}\n${description}`}>
                          {baseName(model.name ?? model.id)}
                        </span>
                        {free ? <span className="badge" data-kind="free">{t?.('channelpool.badgeFree') ?? '免费'}</span> : null}
                        {vision ? <span className="badge" data-kind="vision">{t?.('channelpool.badgeVision') ?? '图像'}</span> : null}
                        {model.dead === true ? <span className="badge">{t?.('channelpool.modelDead') ?? '不可用'}</span> : null}
                      </div>
                      {mult === undefined || /免费/u.test(mult) ? null : (
                        <div className="model-sub">
                          <span className="model-mult num" data-free={free ? 'true' : undefined}>
                            {mult.replace(/x\s*/giu, '×')}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="model-side">
                      {native === undefined ? null : capped ? (
                        <select
                          className="ctx-select"
                          aria-label={`${baseName(model.name ?? model.id)} ${t?.('channelpool.modelBudget') ?? '上下文大小'}`}
                          value={String(budget === CONTEXT_BUDGET_DEFAULT ? CONTEXT_BUDGET_DEFAULT : native)}
                          disabled={isBusy || !on}
                          onChange={event => {
                            const next = Number(event.target.value)
                            void setContextBudget(channel.id, model.id, next === native ? undefined : CONTEXT_BUDGET_DEFAULT)
                          }}
                        >
                          <option value={String(native)}>{formatModelCapacity(native)}</option>
                          <option value={String(CONTEXT_BUDGET_DEFAULT)}>{formatModelCapacity(CONTEXT_BUDGET_DEFAULT)}</option>
                        </select>
                      ) : (
                        <span className="model-mult num">{formatModelCapacity(native)}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {/*
            `closed` is the pack's own word for "this channel has models but
            every one of them is in the blacklist".
          */}
          {status?.closed === true && (
            <p className="note">
              {t?.('channelpool.everyModelOff', { total: status.modelsTotal })
                ?? `All ${status.modelsTotal} models are switched off.`}
            </p>
          )}
          {isMarvis ? null : (
            <div className="hint"><b>提示</b><span>只勾选要用的模型即可。倍率是相对积分消耗，越小越省。</span></div>
          )}
        </section>
      </div>
    </main>
    </>
  )
}

/**
 * 「47.4万」这种写法：上万就按万显示，单位用小一号的字（设计稿的 .ls-u）。
 */
function WanNumber({ value }: { value: number }): ReactElement {
  if (Math.abs(value) >= 10_000) {
    const wan = value / 10_000
    return (
      <span className="ls-v num">
        {wan >= 100 ? String(Math.round(wan)) : wan.toFixed(1)}
        <span className="ls-u">万</span>
      </span>
    )
  }
  return <span className="ls-v num">{amount(Math.round(value))}</span>
}
