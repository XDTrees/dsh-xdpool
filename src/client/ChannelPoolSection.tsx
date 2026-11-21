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

import { useEffect, useRef, useState, type ReactElement } from 'react'
import { BrandTile } from './brand-tile.tsx'
import { channelIcon, channelInitials } from './channel-icons.ts'
import { ModelFactsRow } from './model-facts-row.tsx'
import { modelFactsFor, formatModelCapacity, type ModelFacts, baseName, multiplierOf, multiplierTone } from './model-facts.ts'
import { recommendUse } from './recommend-use.ts'
import {
  accountsFrom,
  autoCheckinFrom,
  balancesFrom,
  balancesTotal,
  balanceAmount,
  balancePackages,
  callPack,
  claimResultFrom,
  creditStatusesFrom,
  fetchChannelModels,
  fetchChannels,
  modelsFrom,
  providerStatusesFrom,
  setChannelModelContextBudget,
  sortChannelModels,
  type ChannelBalance,
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
} from '../status-paths.ts'

import {
  POOL_CATALOG_REFRESH_PATH,
  POOL_DOUBAO_CLAIM_PATH,
  POOL_DOUBAO_MODELS_PATH,
  POOL_DOUBAO_QUOTA_PATH,
  POOL_DOUBAO_SESSION_PATH,
} from '../status-paths.ts'
// The DATA module, not `doubao-llm.ts`: the latter reaches `node:fs`/`node:child_process`
// through the auth module, and a client bundle containing those does not load at all.
import { doubaoListing } from '../doubao-models.ts'
import { REGISTERED_CHANNELS } from '../channel-roster.ts'
import { DoubaoAutomationPane } from './DoubaoAutomationPane.tsx'
import type { PoolWebChannel, PoolWebChannelModel } from '../status-paths.ts'
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
    return models
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
  if (minutes < 60) return minutes <= 1 ? '<1m' : `${String(minutes)}m`
  const hours = Math.floor(remainingMs / 3_600_000)
  if (hours < 24) return `${String(hours)}h`
  const days = Math.floor(remainingMs / 86_400_000)
  return days === 1 ? '1d' : `${String(days)}d`
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
function amount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
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
export function ChannelPoolSection({ t, active }: {
  readonly t?: Translate | undefined
  /** 中栏选中的渠道 id；空则显示第一家。 */
  readonly active?: string | undefined
}): ReactElement {
  /*
    选中哪一家。外部传了就用外部的（中栏在别的组件里时），
    没传就自己管 —— 这样这一栏可以独立渲染成「列表 + 详情」。
  */
  const [ownActive, setOwnActive] = useState<string>('')
  const chosen = active ?? ownActive
  void setOwnActive
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
    return placeholderEntries()
  })
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
  const [loading, setLoading] = useState<boolean>(() => poolSnapshot === undefined)
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
    try {
      const channels = (await fetchChannels()).filter(channel => !REGION_OWNED_CHANNELS.has(channel.id))
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
      const statusAnswer = await cachedProviderStatus(channels.map(channel => channel.id))
      const statuses = providerStatusesFrom(statusAnswer)
      /**
       * Doubao is added to the scan list by hand.
       *
       * `provider.status` counts accounts by walking the PACK's pools, and Doubao has no pack
       * adapter — so its count is always zero, and a filter keyed on that count drops the
       * channel before anything can be drawn. A signed-in Doubao session would then exist,
       * work, and appear nowhere on this page.
       */
      const doubaoAccount = await readDoubaoAccount()
      const scanProviders = channels
        .map(channel => channel.id)
        .filter(id => (statuses.get(id)?.accountsTotal ?? 0) > 0
          || (id === 'doubao' && doubaoAccount !== undefined))
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
          : callPack('account.list', { provider })
        const modelsPromise = provider === 'doubao'
          ? readDoubaoModels().then(models => ({ ok: true, value: { models } } as ChannelRpcEnvelope))
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
      const next = roster
        .map(channel => ({
          channel,
          ...(byProvider.get(channel.id) ?? EMPTY_ENTRY),
          status: statuses.get(channel.id),
        }))
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
    if (!loading) return <></>
    return (
      <section className="dsm-xdpool-cpool" aria-label={t?.('channelpool.title') ?? 'Channels'}>
        <p className="note" role="status">
          {t?.('channelpool.loading') ?? 'Reading scan channels…'}
        </p>
      </section>
    )
  }
  /*
    两列：条目栏 + 详情。

    设计稿的 .list 是渠道列表（选中项高亮），.main 是选中那一个的详情。
    这两栏必须一起出现在 .app 的网格里 —— 分开渲染的话第三列拿不到元素。

    dsm-xdpool-cpool 保留在 main 上作锚点（几处测试按它定位），不承载样式。
  */
  return (
    <>
    <nav className="list" aria-label={t?.('channelpool.title') ?? 'Channels'}>
      {/*
        汇总三格：账号总数 / 已连 / 积分 —— 设计稿中间栏的第一屏。
      */}
      <div className="list-head">
        <div className="list-title">{t?.('channelpool.title') ?? '渠道'}</div>
        <div className="list-stats">
          <div className="ls">
            <span className="ls-v">{String(entries.length)}</span>
            <span className="ls-k">账号总数</span>
          </div>
          <div className="ls">
            <span className="ls-v">{String(entries.filter(e => e.accounts.length > 0).length)}</span>
            <span className="ls-k">已连</span>
          </div>
          <div className="ls">
            <span className="ls-v">—</span>
            <span className="ls-k">积分</span>
          </div>
        </div>
      </div>
      <div className="list-scroll">
        {(['bound', 'unbound'] as const).map(kind => {
          const group = entries.filter(e => (kind === 'bound') === (e.accounts.length > 0))
          if (group.length === 0) return null
          return (
            <div key={kind}>
              <div className="list-group">
                {kind === 'bound' ? '已登录' : '未登录'}
                <span className="list-group-n">{String(group.length)}</span>
              </div>
              {group.map(entry => {
                const icon = channelIcon(entry.channel.id)
                const isOn = entry.channel.id === chosen
                return (
                  <button
                    key={entry.channel.id}
                    type="button"
                    className="ch"
                    data-active={isOn ? 'true' : false}
                    aria-current={isOn ? 'true' : undefined}
                    onClick={() => { setOwnActive(entry.channel.id) }}
                  >
                    {icon === undefined
                      ? <span className="ch-mark" data-letters={channelInitials(entry.channel.name)}>{channelInitials(entry.channel.name)}</span>
                      : <span className="ch-mark" style={{ backgroundImage: `url("${icon}")` }} />}
                    <span className="ch-name">{entry.channel.name}</span>
                    <span className="ch-n">{entry.accounts.length === 0 ? '' : String(entry.accounts.length)}</span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </nav>

    <main className="main dsm-xdpool-cpool dsm-xdpool-regions" aria-label={t?.('channelpool.title') ?? 'Channels'}>
      {error === undefined ? null
        : <p className="hint">{t?.('channelpool.loadError', { message: error }) ?? `Could not load channels: ${error}`}</p>}
      {notice === undefined ? null : <p className="note">{notice}</p>}
      {/* The switch that brings the unbound channels back, for adding another. */}
      <div className="sec-head">
        <button
          type="button"
          className="btn"
          aria-pressed={showAll}
          onClick={() => { setShowAll(!showAll) }}
        >
          {showAll
            ? (t?.('channelpool.onlyBound') ?? '只显示已绑定')
            : (t?.('channelpool.showAll') ?? `显示全部渠道（${String(entries.length)}）`)}
        </button>
      </div>
      {/*
        页头 —— 设计稿每页的 main 都是 mhead + mbody。
        这里显示选中的那个渠道的名字与厂商，中栏切换时它跟着变。
      */}
      <header className="mhead">
        <div className="mhead-title">
          <span className="mhead-name">
            {entries.find(e => e.channel.id === chosen)?.channel.name ?? (t?.('channelpool.title') ?? '渠道')}
          </span>
          <span className="mhead-org">
            {entries.find(e => e.channel.id === chosen)?.channel.org ?? ''}
          </span>
        </div>
      </header>
      {/*
        正文容器 —— 设计稿每页的 main 都是 mhead + mbody。

        少了这一层，区块之间没有 gap、没有内边距，内容会贴在页头下面。
      */}
      <div className="mbody">
      {/*
        只画选中的那一个渠道。

        设计稿的右栏是一个渠道的详情（mhead + kpis + 账号 + 模型），
        中栏的 .ch 行负责切换。原来这里 map 了全部二十家，平铺成网格 ——
        那不是这个页面的形状。
      */}
      <div className="accts">
        {((): readonly ChannelEntry[] => {
          if (entries.length === 0) return []
          const picked = entries.find(entry => entry.channel.id === chosen)
          // 选中的渠道还没到（或已被移除）时退回第一家，右栏不留空
          return [picked ?? entries[0]].filter((e): e is ChannelEntry => e !== undefined)
        })().map(entry => {
          const { channel, accounts, models, facts, balances, statuses, status } = entry
          const icon = channelIcon(channel.id)
          const tileMark = icon === undefined ? { initials: channelInitials(channel.name) } : { icon }
          const fold = foldFor(channel.id)
          const enabledIds = enabledFor(channel.id, models)
          const isBusy = busy.has(channel.id)
          const unit = creditUnitLabel(channel, t)
          const total = channel.credits === undefined ? undefined : balancesTotal(balances)
          const modelsEnabled = models.filter(model => enabledIds.has(model.id)).length
          const statusOf = (accountId: string): ChannelCreditStatus | undefined =>
            statuses.find(row => row.accountId === accountId)
          // Whether every enabled account on this channel has already claimed
          // its daily credit. An unknown status is treated as "not yet" so the
          // button stays in the claimable state until the first refresh lands;
          // a zero-account channel never reads as "all claimed", because there
          // is nothing to have claimed.
          const enabledAccounts = accounts.filter(account => account.enabled !== false)
          const allClaimedToday = enabledAccounts.length > 0
            && enabledAccounts.every(account => statusOf(account.id)?.todayCheckedIn === true)
          const balanceOf = (accountId: string): ChannelBalance | undefined =>
            balances.find(row => row.accountId === accountId)
          const query = queryFor(channel.id)
          const visibleModels = modelsMatching(entry, query)
          return (
            <article
              key={channel.id}
              className="card"
              /**
               * `ok` / `idle`, matching the WorkBuddy cards.
               *
               * The status pill's colours are selected by the ARTICLE's `data-state`, so a card
               * that said `on` drew a grey pill with a green "connected" label — the same
               * component in two different states depending on which list rendered it.
               */
              data-state={accounts.length > 0 ? 'ok' : 'idle'}
              style={{ '--dsm-xdpool-cpool-accent': channel.accent } as Record<string, string>}
            >
              {/*
                The header and the stat row are the SAME markup the WorkBuddy cards use.
                Two card designs for one job was the reason a channel's layout depended on
                which list it happened to be in, and the reason the model picker carried a
                duplicate group: two renderers owned one account pool.
              */}
              <div className="sec-head">
                <BrandTile accent={channel.accent} glyph="login" {...tileMark} />
                <div className="mhead-title">
                  <h3 className="mhead-name">{channel.name}</h3>
                  <p className="mhead-org">{channel.org}</p>
                </div>
                <span className="pill" data-on={accounts.length > 0}>
                  {accounts.length > 0
                    ? (t?.('channelpool.stateReady') ?? '已接入')
                    : (t?.('channelpool.stateNone') ?? '未接入')}
                </span>
              </div>
              <p className="hint">{channel.note}</p>
              {/*
                三行事实：账号数 / 模型数 / 剩余积分。

                原来是 .kpis —— 那是四列网格，里面每个 .fact 却是一整行，
                于是三行的文字全叠在同一格里（截图里"channelpool.statAccounts"
                和"channelpool.statModels"压在一起就是这个）。
                .facts 是纵向堆叠的事实行，形状对得上。
              */}
              <div className="facts">
                <span className="fact">
                  <span className="td-name">
                    {t?.('channelpool.statAccounts') ?? '账号'}
                  </span>{' '}
                  <b className="td-num">
                    {accounts.length === 0
                      ? '–'
                      : String(accounts.filter(account => account.enabled !== false).length)}
                  </b>
                </span>
                <span className="fact">
                  <span className="td-name">
                    {t?.('channelpool.statModels') ?? '模型'}
                  </span>{' '}
                  <b className="td-num">
                    {models.length === 0 ? '–' : `${String(modelsEnabled)}/${String(models.length)}`}
                  </b>
                </span>
                {channel.credits === undefined ? null : (
                  <span className="fact">
                    <span className="td-name">
                      {t?.('channelpool.statCredit') ?? '剩余积分'}
                    </span>{' '}
                    <b className="td-num" data-tone="quiet">
                      {entry.balancePending && total === undefined
                        ? (t?.('channelpool.balanceLoading') ?? '…')
                        : total === undefined
                          ? (t?.('channelpool.balanceNone') ?? '–')
                          : `${amount(total)} ${unit}`}
                    </b>
                  </span>
                )}
              </div>
              <div className="sec-actions">
                {/* Only rendered when the pack really has a claim path for this
                    vendor. Drawing it for the others would put a button on the
                    card that answers `unsupported provider` every time it is
                    pressed, which reads as a broken feature, not a missing one.
                    The claim button leads and is the only solid one on the row:
                    it is the single action here that pays the reader back, so it
                    should not have to compete with "reload the number". */}
                {/*
                  Re-read the catalogue. Each adapter caches its model list for the life of the
                  process, so a renamed model — and the multiplier is part of the NAME — only
                  reached the card after a restart until this existed.
                */}
                <button
                  type="button"
                  className="btn"
                  disabled={catalogBusy.has(channel.id)}
                  onClick={() => { void refreshChannelModels(channel.id) }}
                  title={t?.('channelpool.reloadModelsHint')
                    ?? '从上游重新读取这个渠道的模型列表（含倍率）'}
                >
                  {catalogBusy.has(channel.id)
                    ? (t?.('channelpool.reloadModelsBusy') ?? '正在读取…')
                    : (t?.('channelpool.reloadModels') ?? '重新加载模型')}
                </button>
                {/* One-off rewards live behind their own endpoint, so they get
                    their own button rather than being folded into the daily claim.
                    Raccoon is the case that made this necessary: its daily points
                    arrive by themselves, so `credits.claimAll` correctly answers
                    "not supported", and the login bonus was therefore unreachable
                    from the card even though the pack has implemented the claim
                    for it all along. */}
                {ONBOARDING_CHANNELS.has(channel.id) && (
                  <button
                    type="button"
                    className="btn"
                    data-tone="primary"
                    disabled={isBusy}
                    onClick={() => { void claimOnboarding(channel.id, enabledAccounts) }}
                    title={t?.('channelpool.onboardingHint')
                      ?? '一次性奖励（登录奖励 / 新手任务），每号只能领一次'}
                  >
                    {isBusy
                      ? (t?.('channelpool.claiming') ?? 'Claiming…')
                      : (t?.('channelpool.onboarding') ?? '领取一次性奖励')}
                  </button>
                )}
                {channel.credits?.claim === true && (
                  <button
                    type="button"
                    className="btn"
                    data-tone={allClaimedToday ? 'claimed' : 'primary'}
                    disabled={isBusy || allClaimedToday}
                    onClick={() => { void claim(channel.id) }}
                  >
                    {isBusy
                      ? (t?.('channelpool.claiming') ?? 'Claiming…')
                      : allClaimedToday
                        ? (t?.('channelpool.claimClaimed') ?? '今日已领取')
                        : (t?.('channelpool.claim') ?? 'Claim credits')}
                  </button>
                )}
                {channel.credits !== undefined && (
                  <button
                    type="button"
                    className="btn"
                    data-tone="quiet"
                    disabled={isBusy}
                    onClick={() => { void refreshBalances(channel.id, true) }}
                  >
                    {t?.('channelpool.refreshBalance') ?? 'Refresh balances'}
                  </button>
                )}
                {/* The two lists are this card's real navigation, so they are
                    pushed to the far edge: reading order runs credit → refresh →
                    accounts → models, and the model list is what most readers
                    came for in the first place. */}
                {/*
                  The same segmented triggers the WorkBuddy cards use: a caret, a word, and
                  the count as its own small chip. The previous `账号 (2)` / `模型 (3/13)` text
                  read as a caption rather than as a control, and it sat at the far edge where
                  the other cards put nothing.
                */}
                <div className="seg">
                  <button
                    type="button"
                    className="seg"
                    aria-expanded={fold === 'accounts'}
                    disabled={accounts.length === 0}
                    onClick={() => toggleFold(channel.id, 'accounts')}
                  >
                    <span className="" aria-hidden="true">▶</span>
                    <span className="seg">
                      {t?.('row.accountsTitle') ?? '池中账号'}
                    </span>
                    {accounts.length === 0 ? null : (
                      <span className="num">{accounts.length}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="seg"
                    aria-expanded={fold === 'models'}
                    disabled={models.length === 0}
                    onClick={() => toggleFold(channel.id, 'models')}
                  >
                    <span className="" aria-hidden="true">▸</span>
                    <span className="seg">
                      {t?.('row.modelsTitle') ?? '模型'}
                    </span>
                    {models.length === 0 ? null : (
                      <span className="num">{models.length}</span>
                    )}
                  </button>
                </div>
              </div>
              {entry.balanceError !== undefined && (
                <p className="hint" role="status">
                  {entry.balanceError}
                </p>
              )}
              {fold === 'accounts' && (
                <ul className="facts">
                  {accounts.map(account => {
                    const balance = balanceOf(account.id)
                    const amount1 = balance === undefined ? undefined : balanceAmount(balance.balance)
                    const checkin = statusOf(account.id)
                    const buckets = balance === undefined ? [] : balancePackages(balance.balance)
                    const disabled = account.enabled === false
                    return (
                      <li key={account.id} className="ch" data-off={disabled}>
                        <span className="ch-name">{account.nickname ?? account.id}</span>
                        <span className="ch-org">
                          {disabled
                            ? (t?.('channelpool.disableAccount') ?? 'disabled')
                            : (t?.('channelpool.enableAccount') ?? 'enabled')}
                          {expiryText(account.expiresAt, t) === undefined ? null : ` · ${expiryText(account.expiresAt, t)}`}
                        </span>
                        {checkin?.todayCheckedIn === true && (
                          <span className="badge">
                            {t?.('channelpool.claim') ?? 'claimed'}
                            {typeof checkin.todayCredit === 'number' ? ` +${amount(checkin.todayCredit)}` : ''}
                          </span>
                        )}
                        {balance?.error !== undefined
                          ? <span className="td-num" data-tone="err">{balance.error}</span>
                          : amount1 !== undefined
                            ? (
                              <span className="td-num">
                                {amount(amount1)} {unit}
                                {buckets.length > 0
                                  ? ` · ${t?.('channelpool.balancePackages', { count: buckets.length }) ?? `${buckets.length} window(s)`}`
                                  : ''}
                              </span>
                            )
                            : null}
                        <span className="sec-actions">
                          {/* Collecting Doubao's campaign credits, beside the other row actions. */}
                          {channel.id === 'doubao' && (
                            <button
                              type="button"
                              className="tiny"
                              disabled={isBusy}
                              onClick={() => { void accountAction(channel.id, account.id, 'claim') }}
                            >
                              {t?.('channelpool.claimCredits') ?? '领取积分'}
                            </button>
                          )}
                          <button
                            type="button"
                            className="tiny"
                            disabled={isBusy}
                            onClick={() => { void accountAction(channel.id, account.id, 'test') }}
                          >
                            {t?.('channelpool.testAccount') ?? 'Test'}
                          </button>
                          <button
                            type="button"
                            className="tiny"
                            disabled={isBusy}
                            onClick={() => { void accountAction(channel.id, account.id, 'refresh') }}
                          >
                            {t?.('channelpool.refreshAccount') ?? 'Refresh'}
                          </button>
                          <button
                            type="button"
                            className="tiny"
                            disabled={isBusy}
                            onClick={() => { void accountAction(channel.id, account.id, 'toggle') }}
                          >
                            {disabled
                              ? (t?.('channelpool.enableAccount') ?? 'Enable')
                              : (t?.('channelpool.disableAccount') ?? 'Disable')}
                          </button>
                          <button
                            type="button"
                            className="tiny"
                            data-tone="danger"
                            disabled={isBusy}
                            onClick={() => { void accountAction(channel.id, account.id, 'delete') }}
                          >
                            {t?.('channelpool.deleteAccount') ?? 'Remove'}
                          </button>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
              {fold === 'models' && (
                <div className="models">
                  <div className="model-top">
                    <span>
                      {t?.('channelpool.metaModels', { enabled: modelsEnabled, total: models.length })
                        ?? `${modelsEnabled}/${models.length}`}
                    </span>
                    <div className="sec-actions">
                      <button
                        type="button"
                        className="tiny"
                        disabled={isBusy || models.length === 0}
                        onClick={() => { void setAllModels(channel.id, true) }}
                      >
                        {t?.('channelpool.allModels') ?? 'Enable all'}
                      </button>
                      <button
                        type="button"
                        className="tiny"
                        disabled={isBusy || models.length === 0}
                        onClick={() => { void setAllModels(channel.id, false) }}
                      >
                        {t?.('channelpool.noModelsAll') ?? 'Disable all'}
                      </button>
                    </div>
                  </div>
                  {/*
                    A catalogue of thirty rows is a wall of checkboxes with no
                    way to find the one model the reader wants. The box only
                    appears once the list is long enough to need it — a search
                    field over two rows is noise, and it costs a keystroke of
                    attention on every card.
                  */}
                  {models.length >= MODEL_SEARCH_THRESHOLD && (
                    <div className="search">
                      <input
                        type="search"
                        className="search"
                        value={query}
                        placeholder={t?.('channelpool.searchModels') ?? 'Search models'}
                        aria-label={t?.('channelpool.searchModels') ?? 'Search models'}
                        onChange={event => { setQuery(channel.id, event.target.value) }}
                      />
                      <span className="hint" role="status">
                        {query === ''
                          ? (t?.('channelpool.searchHint') ?? 'Matches name, id, description and image input')
                          : (t?.('channelpool.searchHit', { count: visibleModels.length })
                            ?? `${visibleModels.length} of ${models.length}`)}
                      </span>
                    </div>
                  )}
                  {visibleModels.length === 0 && models.length > 0 ? (
                    <p className="hint">
                      {t?.('channelpool.searchNone', { query: query.trim() })
                        ?? `No model matches “${query.trim()}”.`}
                    </p>
                  ) : models.length === 0 ? (
                    <p className="hint">
                      {entry.modelError === undefined
                        ? (t?.('channelpool.noModels') ?? 'No models published yet.')
                        // A refusal and an empty catalogue look identical on the
                        // wire (no rows), but only one of them is a bug the user
                        // can act on, so the reason is shown instead of a
                        // plausible-sounding "nothing published yet".
                        : (t?.('channelpool.modelError', { message: entry.modelError })
                          ?? `Could not list models: ${entry.modelError}`)}
                    </p>
                  ) : (
                    <ul className="models">
                      {visibleModels.map(model => {
                        const fact = facts.get(model.id)
                        const on = enabledIds.has(model.id)
                        /*
                          Facts come from two places and are merged rather than
                          chosen between: the pack now answers `model.list` with
                          the adapter's own `resolveModel` result (window, image
                          input, output ceiling, reasoning), and the host
                          catalogue adds a vendor-written description. The pack
                          wins on every figure because it does not pass through
                          the host's "hide models without a valid credential"
                          gate, which is what used to leave eight of nine channels
                          with no numbers at all; the description is taken from
                          the host because the pack does not carry one.
                        */
                        const modalities = model.inputModalities ?? fact?.inputModalities
                        const merged = modelFactsFor({
                          contextWindow: model.contextWindow ?? fact?.contextWindow,
                          maxOutputTokens: model.maxTokens ?? fact?.maxTokens,
                          vision: modalities?.includes('image') === true
                            || modalities?.includes('images') === true,
                          supportedEfforts: model.reasoning === true ? ['thinking'] : undefined,
                          description: model.description ?? fact?.description,
                        })
                        // A recommended-use line, when the merged facts prove
                        // enough to base one on. Free and metered models alike
                        // get it; the helper returns undefined (nothing printed)
                        // when the upstream published no context window, image
                        // input or thinking levels to reason from.
                        const recuse = recommendUse(merged)
                        /*
                          The native window is only ever different from the
                          advertised one when the user already capped this
                          model, and the picker needs both to render "full" next
                          to "cap it".
                        */
                        const native = model.nativeContextWindow ?? model.contextWindow
                        const capped = native !== undefined && native > CONTEXT_BUDGET_DEFAULT
                        /*
                          The APPLIED budget, not the default one.

                          This used to fall back to CONTEXT_BUDGET_DEFAULT
                          whenever the model was merely *eligible* to be capped,
                          which made the radio claim a cap that had never been
                          saved — and worse, made the pair unclickable in one
                          direction: choosing "full" clears the stored budget,
                          after which the fallback computed the capped value
                          again and the selection snapped straight back to the
                          first radio. No stored budget means the native window
                          is what actually applies, so that is what to show.
                        */
                        const budget = model.contextBudget ?? native
                        return (
                          <li key={model.id} className="model" data-off={!on}>
                            <label className="sw">
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={isBusy}
                                onChange={() => { void toggleModel(channel.id, model.id, !on) }}
                              />
                              <span className="model-name" title={model.id}>
                                {baseName(model.name ?? model.id)}
                              </span>
                              {/*
                                The multiplier as its own badge.

                                Every vendor here writes the price INTO the model name —
                                `DeepSeek-V4.1-Flash · x0.11`, `Hy3 · x0.00`, `Qwen3.8-Flash ·
                                免费` — so a reader comparing two channels had to read a sentence
                                to find the number that decides which one they can afford. Split
                                out, the price is the thing the eye lands on.
                              */}
                              {multiplierOf(model.name) === undefined ? null : (
                                <span
                                  className="lane"
                                  data-tone={multiplierTone(multiplierOf(model.name) ?? '')}
                                >
                                  {multiplierOf(model.name)}
                                </span>
                              )}
                              {model.isFree === true && (
                                <span className="lane" data-tone="free">
                                  {t?.('channelpool.modelFree') ?? 'free'}
                                </span>
                              )}
                              {model.dead === true && (
                                <span className="lane" data-tone="dead">
                                  {t?.('channelpool.modelDead') ?? 'dead'}
                                </span>
                              )}
                            </label>
                            {/*
                              ModelFactsRow prints the context window, the output
                              ceiling, the image-input flag and the description,
                              and returns null when the vendor published none —
                              so a thin row stays thin instead of growing dashes.
                            */}
                            <ModelFactsRow facts={merged} className="facts" t={t} />
                            {recuse === undefined ? null : (
                              <p className="hint">
                                <span className="hint">{t?.('recuse.label') ?? '推荐用途'}</span>
                                {recuse}
                              </p>
                            )}
                            {capped && (
                              <fieldset
                                className="badge"
                                aria-label={t?.('channelpool.modelBudget') ?? 'Context window'}
                              >
                                <label>
                                  <input
                                    type="radio"
                                    name={`cpool-budget-${channel.id}-${model.id}`}
                                    checked={budget === CONTEXT_BUDGET_DEFAULT}
                                    disabled={isBusy}
                                    onChange={() => {
                                      void setContextBudget(channel.id, model.id, CONTEXT_BUDGET_DEFAULT)
                                    }}
                                  />
                                  <span>{formatModelCapacity(CONTEXT_BUDGET_DEFAULT)}</span>
                                </label>
                                <label>
                                  <input
                                    type="radio"
                                    name={`cpool-budget-${channel.id}-${model.id}`}
                                    checked={budget === native}
                                    disabled={isBusy}
                                    onChange={() => { void setContextBudget(channel.id, model.id, undefined) }}
                                  />
                                  <span>{formatModelCapacity(native)}</span>
                                </label>
                              </fieldset>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )}
              {/*
                `closed` is the pack's own word for "this channel has models but
                every one of them is in the blacklist" — its status row answers
                a question the per-model list cannot: not "which ones did I pick"
                but "are any of them available at all".
              */}
              {status?.closed === true && (
                <p className="note">
                  {t?.('channelpool.everyModelOff', { total: status.modelsTotal })
                    ?? `All ${status.modelsTotal} models are switched off.`}
                </p>
              )}
              {/* Doubao's credits come from campaign tasks, so its automation pane sits at
                  the bottom of the card — the same place, and the same shape, as WorkBuddy's. */}
              {channel.id === 'doubao' && <DoubaoAutomationPane t={t} />}
            </article>
          )
        })}
        <div className="sec-actions">
          <button
            type="button"
            className="btn"
            onClick={() => { setEnabled(new Map()); void load() }}
          >
            {t?.('channelpool.retry') ?? 'Reload'}
          </button>
        </div>
      </div>
      </div>
    </main>
    </>
  )
}
