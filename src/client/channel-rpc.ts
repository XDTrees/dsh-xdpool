/**
 * The pack's management RPC, spoken once for the login page's cards.
 *
 * This used to live inside {@link ./ChannelsPage} as a private function. It
 * stopped being private when the account pool asked the same question the login
 * page already asks — "how many accounts and models does each channel have
 * right now" — because two copies of an envelope parser is one copy too many:
 * they drift, and the drift shows up as a card that reads zero.
 *
 * Everything here is presentation-safe. No method in {@link CHANNEL_PACK_METHODS}
 * returns a credential, and none of these parsers invent a field the pack did not
 * send: an answer we cannot read becomes "not connected", never a guessed zero.
 *
 * @module dsh-xdpool/client/channel-rpc
 */
import { CHANNEL_PACK_RPC_PATH, POOL_CHANNEL_MODELS_PATH, POOL_CHANNELS_PATH } from '../status-paths.ts'
import type { PoolWebChannel, PoolWebChannelModel } from '../status-paths.ts'
import type {
  ChannelAccount,
  ChannelAccountCreated,
  ChannelLoginPoll,
  ChannelRpcEnvelope,
} from '../channels.ts'

/**
 * The client ctx's connection RPC bridge, installed once at plugin startup.
 *
 * The pack's management route sits behind the shell's connection admission:
 * a raw `fetch('/api/channel-pack')` is answered 401 by the host before it
 * ever reaches the pack. The working path (the same one the free-model page
 * uses) is the host connection service's `rpc.call('/api', 'channel-pack', …)`,
 * which carries that admission. `installPackRpc(ctx)` is called from the
 * client `apply` closure; when it has not run (or the shell offers no
 * connection service), {@link callPack} degrades to the raw fetch.
 */
interface PackRpcBridge {
  call(method: string, payload: Record<string, unknown>): Promise<unknown>
}
let packRpcBridge: PackRpcBridge | undefined

/** Capture the client ctx's connection service for {@link callPack}. */
export function installPackRpc(ctx: unknown): void {
  // Keep the ctx even when the connection service is not resolvable yet.
  // `apply()` runs once, at plugin start, and the shell's connection service is
  // provided by a sibling fiber that may not have settled by then — reading it
  // too early yields undefined, and with a one-shot capture the bridge would
  // stay unset for the rest of the session. Every `callPack` after that would
  // fall back to a bare `fetch('/api/channel-pack')`, which the host answers 401
  // because only admitted clients may speak that route. The symptom is not an
  // error but an empty pool, so it is resolved lazily and retried per call.
  packRpcContext = ctx
  packRpcBridge = resolvePackRpcBridge()
}

/** The client ctx captured by {@link installPackRpc}, for late resolution. */
let packRpcContext: unknown

/**
 * Read `connection.rpc.call` off the captured ctx, or `undefined` if the
 * service is still absent.
 *
 * Each step gets its own try. The host hands the client ctx a Proxy that
 * THROWS on direct property access to an undeclared service
 * (cordis-client-runner's dynamic ctx), and that throw also reports the run as
 * failed — so one shared try/catch would let a rejected `ctx.connection` skip
 * the exempt `ctx.get()` below and silently leave the bridge unset. `?.` does
 * not help: it guards null/undefined, not a throwing getter.
 */
function resolvePackRpcBridge(): PackRpcBridge | undefined {
  const ctx = packRpcContext
  if (ctx === undefined || ctx === null) return undefined
  let connection: unknown
  try {
    connection = (ctx as { connection?: unknown }).connection
  } catch {
    connection = undefined
  }
  if (connection === undefined && typeof (ctx as { get?: unknown }).get === 'function') {
    try {
      connection = (ctx as { get(name: string): unknown }).get('connection')
    } catch {
      connection = undefined
    }
  }
  try {
    const call = (connection as { rpc?: { call?: unknown } })?.rpc?.call
    if (typeof call !== 'function') return undefined
    return {
      // `guardedService` applies with `Reflect.apply(value, target, args)`, so
      // binding against the proxy (rather than the ctx) is what keeps this
      // independent of the host's `this` expectations.
      call: async (method: string, payload: Record<string, unknown>): Promise<unknown> => {
        const bound = (call as (target: string, service: string, args: unknown, signal?: AbortSignal) => Promise<unknown>).bind(connection)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 90_000)
        try {
          return await bound('/api', 'channel-pack', { method, payload }, controller.signal)
        } finally {
          clearTimeout(timer)
        }
      },
    }
  } catch {
    return undefined
  }
}

/**
 * Call the pack's own management route.
 *
 * The bundle registers `/api/channel-pack` itself and speaks a two-field RPC
 * envelope, so this speaks that envelope rather than inventing a shape and
 * unwrapping it on the way back. Every return is an `ok`/`error` decision the
 * caller must make explicitly: a failed login is a normal outcome here, not an
 * exception, and turning it into a thrown error would lose the pack's own
 * message.
 */
export async function callPack(method: string, payload: Record<string, unknown>): Promise<ChannelRpcEnvelope> {
  if (packRpcBridge === undefined) {
    packRpcBridge = resolvePackRpcBridge()
  }
  if (packRpcBridge !== undefined) {
    try {
      // The connection layer hands back `result.value` with one shell already
      // removed, while every reader here (accountsFrom / createdFrom / pollFrom)
      // expects the full `{ok, value}` envelope. Re-wrap it rather than unwrap
      // again: stripping a second time would turn `{accounts}` into an envelope
      // whose `.value` is missing, which reads as "no accounts".
      const result = await packRpcBridge.call(method, payload) as
        | { ok?: unknown; value?: unknown; error?: { message?: string; code?: string } }
        | null
        | undefined
      if (result !== null && typeof result === 'object') {
        if (result.ok === true) return { ok: true, value: result.value }
        if (result.ok === false) {
          return { ok: false, error: { message: result.error?.message ?? result.error?.code ?? 'rpc-failed' } }
        }
        return result as ChannelRpcEnvelope
      }
      return { ok: false, error: { message: 'rpc-empty' } }
    } catch (cause: unknown) {
      // Clear the bridge so next call can re-resolve; do not replay mutation
      packRpcBridge = undefined
      const message = cause instanceof Error ? cause.message : String(cause)
      return { ok: false, error: { message } }
    }
  }
  const response = await fetch(CHANNEL_PACK_RPC_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `xdpool-${Date.now().toString(36)}`,
      method: 'channel-pack',
      payload: { method, payload },
    }),
  })
  const body: unknown = await response.json().catch(() => undefined)
  if (body === null || typeof body !== 'object') {
    return { ok: false, error: { message: `HTTP ${response.status}` } }
  }
  const message = (body as { result?: unknown }).result
  if (message === null || typeof message !== 'object') {
    return { ok: false, error: { message: `HTTP ${response.status}` } }
  }
  return message as ChannelRpcEnvelope
}

/** The pack's account id, read defensively — an unidentifiable entry is skipped. */
export function channelIdOf(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

export function createdFrom(envelope: ChannelRpcEnvelope): ChannelAccountCreated | undefined {
  const value = envelope.value
  if (value === null || typeof value !== 'object') return undefined
  const accountId = (value as { accountId?: unknown }).accountId
  const loginUrl = (value as { loginUrl?: unknown }).loginUrl
  // A login URL is mandatory here. `account.create` can legitimately answer
  // without one (some channels poll a device the user is already holding), and
  // inventing a link to show would send them nowhere.
  if (typeof accountId !== 'string' || typeof loginUrl !== 'string' || loginUrl.length === 0) {
    return undefined
  }
  return { accountId, loginUrl }
}

export function pollFrom(envelope: ChannelRpcEnvelope): ChannelLoginPoll {
  const value = envelope.value
  if (value === null || typeof value !== 'object') return { done: false }
  const done = (value as { done?: unknown }).done === true
  const success = (value as { success?: unknown }).success
  const error = (value as { error?: unknown }).error
  return {
    done,
    ...typeof success === 'boolean' ? { success } : {},
    ...typeof error === 'string' && error.length > 0 ? { error } : {},
  }
}

export function accountsFrom(envelope: ChannelRpcEnvelope): ChannelAccount[] {
  const value = envelope.value
  if (value === null || typeof value !== 'object') return []
  const accounts = (value as { accounts?: unknown }).accounts
  if (!Array.isArray(accounts)) return []
  const rows: ChannelAccount[] = []
  for (const entry of accounts) {
    const id = channelIdOf(entry)
    if (id === undefined) continue
    const provider = (entry as { provider?: unknown }).provider
    const expiresAt = (entry as { expiresAt?: unknown }).expiresAt
    const refreshable = (entry as { refreshable?: unknown }).refreshable
    rows.push({
      id,
      provider: typeof provider === 'string' ? provider : '',
      ...(entry as { nickname?: unknown }).nickname !== undefined
        ? { nickname: String((entry as { nickname?: unknown }).nickname) }
        : {},
      ...(entry as { enabled?: unknown }).enabled !== undefined
        ? { enabled: (entry as { enabled?: unknown }).enabled === true }
        : {},
      ...typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > 0 ? { expiresAt } : {},
      ...refreshable === true ? { refreshable: true } : {},
    })
  }
  return rows
}

/**
 * One model as the host's catalogue spells it, narrowed to what this page shows.
 *
 * The window, the ceiling and the modalities are all optional because the host
 * omits any it does not know, and omitting is the honest answer here: a filled-in
 * guess would be a number the user cannot check and we cannot defend.
 */
export interface ChannelModel {
  id: string
  name: string
  /**
   * True when the model sits in the pack's user blacklist, i.e. it is hidden
   * from the conversation picker. Absent = false (the pack only writes the
   * key when it is on).
   */
  disabled?: boolean | undefined
  contextWindow?: number | undefined
  maxTokens?: number | undefined
  /** `'text'` and `'image'` are the host's two modalities. */
  inputModalities?: readonly string[] | undefined
  description?: string | undefined
  /**
   * The vendor marks this model as free, when it says so.
   *
   * Absent means unknown, never `false`: only Cline's catalogue carries the
   * flag upstream, so reading absence as "paid" would invent a price fact for
   * twelve vendors that never published one.
   */
  isFree?: boolean | undefined
  /**
   * The pack has marked this model dead (rate-limited past recovery, usually).
   *
   * The pack's own signal, passed through rather than re-derived here: it knows
   * about windows we do not, and a row we guessed dead would disappear from a
   * picker the user still needs.
   */
  dead?: boolean | undefined
  /**
   * The model's **native** window, present only when the user has narrowed the
   * advertised one.
   *
   * The pack reports both values on the same row so the picker can offer "use my
   * full 1M / cap it at 200K"; without the native value the second option would
   * be indistinguishable from the first.
   */
  nativeContextWindow?: number | undefined
  /** The per-model cap the user picked, when they picked one. */
  contextBudget?: number | undefined
  /**
   * The vendor exposes reasoning efforts for this model.
   *
   * A boolean rather than the effort list: the picker only renders "thinking" as
   * one fact next to the window, and shipping the whole enum over the wire for
   * every row would be noise.
   */
  reasoning?: boolean | undefined
}

function modelFrom(value: unknown): ChannelModel | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const id = (value as { id?: unknown }).id
  if (typeof id !== 'string' || id === '') return undefined
  const name = (value as { name?: unknown }).name
  const contextWindow = (value as { contextWindow?: unknown }).contextWindow
  const nativeContextWindow = (value as { nativeContextWindow?: unknown }).nativeContextWindow
  const contextBudget = (value as { contextBudget?: unknown }).contextBudget
  const maxTokens = (value as { maxTokens?: unknown }).maxTokens
  const modalities = (value as { inputModalities?: unknown }).inputModalities
  const description = (value as { description?: unknown }).description
  const disabled = (value as { disabled?: unknown }).disabled
  const isFree = (value as { isFree?: unknown }).isFree
  const dead = (value as { dead?: unknown }).dead
  const reasoning = (value as { reasoning?: unknown }).reasoning
  return {
    id,
    // A nameless model still has to be clickable, and the id is what the host
    // addresses it by — so the id stands in rather than the row vanishing.
    name: typeof name === 'string' && name !== '' ? name : id,
    ...disabled === true ? { disabled: true } : {},
    ...isFree === true ? { isFree: true } : {},
    ...dead === true ? { dead: true } : {},
    ...reasoning === true ? { reasoning: true } : {},
    ...typeof contextWindow === 'number' && Number.isFinite(contextWindow) && contextWindow > 0
      ? { contextWindow }
      : {},
    ...typeof nativeContextWindow === 'number' && Number.isFinite(nativeContextWindow) && nativeContextWindow > 0
      ? { nativeContextWindow }
      : {},
    ...typeof contextBudget === 'number' && Number.isFinite(contextBudget) && contextBudget > 0
      ? { contextBudget }
      : {},
    ...typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0
      ? { maxTokens }
      : {},
    ...Array.isArray(modalities)
      ? { inputModalities: modalities.filter((item): item is string => typeof item === 'string') }
      : {},
    ...typeof description === 'string' && description !== '' ? { description } : {},
  }
}

/**
 * Read the models off one `model.list` answer.
 *
 * The pack answers a **flat array** for a single provider — `value: { models:
 * [{id, name, disabled, dead}] }` — not a provider-keyed map. Reading it as a
 * map finds no `models.<provider>` key and yields an empty list, which the page
 * renders as "this channel has published no models". That is indistinguishable
 * from the truth, which is why it survived: the symptom was a plausible
 * sentence, not an error.
 *
 * A provider-keyed map is still accepted, because a single-provider query does
 * not need one and an older shape costs nothing to keep reading. Anything else
 * yields nothing — an empty list here means "nothing was readable", never
 * "this channel is empty".
 */
export function modelsFrom(value: unknown): readonly ChannelModel[] {
  if (value === null || typeof value !== 'object') return []
  const listed = (value as { models?: unknown }).models
  const rows = Array.isArray(listed)
    ? listed
    : listed !== null && typeof listed === 'object'
      // A map form is only meaningful when it holds exactly the one provider
      // asked about; with several keys there is no honest way to say which
      // rows belong to this card.
      ? Object.keys(listed).length === 1
        ? (Object.values(listed)[0] as unknown)
        : undefined
      : undefined
  if (!Array.isArray(rows)) return []
  return rows
    .map(modelFrom)
    .filter((model): model is ChannelModel => model !== undefined)
}

/**
 * Order model rows the way a picker should read: free first, then the widest
 * window, then vision, then name.
 *
 * ## Why sort at all
 *
 * A vendor's catalogue is ordered by whatever the vendor cared about, which for
 * most of them is marketing chronology. The user reading a channel card is
 * answering "which one do I pick?", and the answers rank as: is it free, how much
 * can I put in it, can I show it a picture.
 *
 * ## Why it is a copy
 *
 * `modelsFrom` hands out the array the page keeps in `useState`, and React keys
 * rows by index — reordering the same array in place would make the checkbox the
 * user just clicked appear to belong to a different model on the next render.
 */
export function sortChannelModels(models: readonly ChannelModel[]): readonly ChannelModel[] {
  return [...models].sort((a, b) => {
    // Free first. Unknown (`undefined`) sorts with the paid rows: claiming a
    // model is paid would be an invented price fact.
    if ((a.isFree === true) !== (b.isFree === true)) return a.isFree === true ? -1 : 1
    const windowA = a.contextWindow ?? 0
    const windowB = b.contextWindow ?? 0
    if (windowA !== windowB) return windowB - windowA
    const visionA = a.inputModalities?.some((modality) => modality !== 'text') === true
    const visionB = b.inputModalities?.some((modality) => modality !== 'text') === true
    if (visionA !== visionB) return visionA ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * Read the route's per-provider model lists.
 *
 * A provider the host could not answer for is left out of the map rather than
 * mapped to an empty array, so the caller can tell "this channel is not
 * signed in" from "this channel is signed in and contributes nothing". Those are
 * different rows in a user's head and collapsing them would be a lie by layout.
 *
 * Kept for the multi-provider shape only; single-provider callers should use
 * {@link modelsFrom}, which is what the pack actually answers.
 */
export function modelListsFrom(value: unknown): ReadonlyMap<string, readonly ChannelModel[]> {
  const out = new Map<string, ChannelModel[]>()
  if (value === null || typeof value !== 'object') return out
  const lists = (value as { models?: unknown }).models
  if (lists === null || typeof lists !== 'object' || Array.isArray(lists)) return out
  for (const [provider, rows] of Object.entries(lists)) {
    if (!Array.isArray(rows)) continue
    const models = rows
      .map(modelFrom)
      .filter((model): model is ChannelModel => model !== undefined)
    out.set(provider, models)
  }
  return out
}

/**
 * One account's credit balance, as `credits.balances` reports it.
 *
 * The shape is deliberately loose in exactly one place — {@link balanceAmount}
 * — because the pack itself is loose: codearts answers a bare number, cline a
 * `{balance, rawBalance}` pair in dollars, zcode token buckets, and everyone
 * else `{total, packages, expiredTotal}`. Normalising that upstream would mean
 * inventing a currency the vendor does not use.
 */
export interface ChannelBalance {
  accountId: string
  nickname?: string
  /** Whatever the vendor calls a balance: a number, or an object. */
  balance?: unknown
  /** Why this account has no balance, in the pack's own words. */
  error?: string
  /** Vendor extras (gemini's tier, for instance). */
  extra?: Readonly<Record<string, unknown>>
  /** One named quota bucket, when the vendor reports several. */
  packages?: readonly ChannelCreditPackage[]
}

export interface ChannelCreditPackage {
  name: string
  unit?: string
  /** Percent remaining, when the vendor reports it as a percentage. */
  remaining?: number
  total?: number
}

/**
 * The number worth printing for one account, or `undefined` when there is none.
 *
 * Four answers exist in the field and only two of them are totals:
 * - a bare number (codearts) is already the total;
 * - `{total}` is the total (everyone else);
 * - `{balance}` is Cline's dollars — same shape, different key;
 * - `{packages}` with no total is Gemini's percentage windows, where summing
 *   percentages would be meaningless, so this refuses rather than guessing.
 */
export function balanceAmount(balance: unknown): number | undefined {
  if (typeof balance === 'number') return Number.isFinite(balance) ? balance : undefined
  if (balance === null || typeof balance !== 'object') return undefined
  const row = balance as { total?: unknown; balance?: unknown }
  if (typeof row.total === 'number' && Number.isFinite(row.total)) return row.total
  if (typeof row.balance === 'number' && Number.isFinite(row.balance)) return row.balance
  return undefined
}

export function balancePackages(balance: unknown): readonly ChannelCreditPackage[] {
  if (balance === null || typeof balance !== 'object') return []
  const listed = (balance as { packages?: unknown }).packages
  if (!Array.isArray(listed)) return []
  const rows: ChannelCreditPackage[] = []
  for (const entry of listed) {
    if (entry === null || typeof entry !== 'object') continue
    const name = (entry as { name?: unknown }).name
    if (typeof name !== 'string' || name === '') continue
    const remaining = (entry as { remaining?: unknown }).remaining
    const total = (entry as { total?: unknown }).total
    const unit = (entry as { unit?: unknown }).unit
    rows.push({
      name,
      ...typeof remaining === 'number' && Number.isFinite(remaining) ? { remaining } : {},
      ...typeof total === 'number' && Number.isFinite(total) ? { total } : {},
      ...typeof unit === 'string' && unit !== '' ? { unit } : {},
    })
  }
  return rows
}

export function balancesFrom(envelope: ChannelRpcEnvelope): readonly ChannelBalance[] {
  const value = envelope.value
  if (value === null || typeof value !== 'object') return []
  const accounts = (value as { accounts?: unknown }).accounts
  if (!Array.isArray(accounts)) return []
  const rows: ChannelBalance[] = []
  for (const entry of accounts) {
    if (entry === null || typeof entry !== 'object') continue
    const accountId = (entry as { accountId?: unknown }).accountId
    if (typeof accountId !== 'string' || accountId === '') continue
    const nickname = (entry as { nickname?: unknown }).nickname
    const error = (entry as { error?: unknown }).error
    const extra = (entry as { extra?: unknown }).extra
    rows.push({
      accountId,
      ...typeof nickname === 'string' && nickname !== '' ? { nickname } : {},
      ...(entry as { balance?: unknown }).balance === undefined ? {} : { balance: (entry as { balance?: unknown }).balance },
      ...typeof error === 'string' && error !== '' ? { error } : {},
      ...extra !== null && typeof extra === 'object' ? { extra: extra as Readonly<Record<string, unknown>> } : {},
      ...balancePackages((entry as { balance?: unknown }).balance).length > 0
        ? { packages: balancePackages((entry as { balance?: unknown }).balance) }
        : {},
    })
  }
  return rows
}

/** One account's daily-check-in state, from `credits.status`. */
export interface ChannelCreditStatus {
  accountId: string
  nickname?: string
  todayCheckedIn?: boolean
  todayCredit?: number
}

export function creditStatusesFrom(envelope: ChannelRpcEnvelope): readonly ChannelCreditStatus[] {
  const value = envelope.value
  if (value === null || typeof value !== 'object') return []
  const accounts = (value as { accounts?: unknown }).accounts
  if (!Array.isArray(accounts)) return []
  const rows: ChannelCreditStatus[] = []
  for (const entry of accounts) {
    if (entry === null || typeof entry !== 'object') continue
    const accountId = (entry as { accountId?: unknown }).accountId
    if (typeof accountId !== 'string' || accountId === '') continue
    const nickname = (entry as { nickname?: unknown }).nickname
    const status = (entry as { status?: unknown }).status
    const statusRow = status !== null && typeof status === 'object' ? status as Record<string, unknown> : undefined
    const todayCredit = statusRow?.['todayCredit']
    rows.push({
      accountId,
      ...typeof nickname === 'string' && nickname !== '' ? { nickname } : {},
      ...statusRow?.['todayCheckedIn'] === true ? { todayCheckedIn: true } : {},
      ...typeof todayCredit === 'number' && Number.isFinite(todayCredit) ? { todayCredit } : {},
    })
  }
  return rows
}

/**
 * The one global auto-check-in switch, from `usage.autoCheckin`.
 *
 * It is global on purpose — the pack runs it once for every provider that has
 * an account, and offers no per-provider switch — so the UI must not draw one
 * per card and imply it can be turned off individually.
 */
export interface ChannelAutoCheckin {
  enabled: boolean
  /** True when a run already covered today, so a re-run would claim nothing. */
  ranToday: boolean
  running: boolean
  /** Human summary of the last run, in the pack's words. */
  lastResult?: string
  /** Per-provider outcome of the last run: `{provider, text}`. */
  channels: readonly { provider: string; text: string }[]
}

export function autoCheckinFrom(envelope: ChannelRpcEnvelope): ChannelAutoCheckin | undefined {
  const value = envelope.value
  if (value === null || typeof value !== 'object') return undefined
  const raw = (value as { autoCheckin?: unknown }).autoCheckin
  if (raw === null || typeof raw !== 'object') return undefined
  const state = raw as Record<string, unknown>
  const channels = (state['channels'] as unknown[] | undefined)
  return {
    enabled: state['enabled'] !== false,
    ranToday: state['ranToday'] === true,
    running: state['running'] === true,
    ...typeof state['lastResult'] === 'string' && state['lastResult'] !== '' ? { lastResult: state['lastResult'] } : {},
    channels: Array.isArray(channels)
      ? channels
        .filter((entry): entry is { provider: string; text: string } =>
          entry !== null && typeof entry === 'object'
          && typeof (entry as { provider?: unknown }).provider === 'string'
          && typeof (entry as { text?: unknown }).text === 'string')
        .map(entry => ({ provider: entry.provider, text: entry.text }))
      : [],
  }
}

/**
 * The host's channel roster — the thirteen scan-login channels, with their
 * display names, accents and login kinds.
 *
 * Both pages that need to reason per channel ask this first: the login page to
 * know what to render, the pool page to know which provider ids are worth
 * asking the pack about. `provider.status` names its answers by provider id, so
 * without this roster there is nothing to hand it.
 */
export async function fetchChannels(): Promise<PoolWebChannel[]> {
  const response = await fetch(POOL_CHANNELS_PATH, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body: unknown = await response.json().catch(() => undefined)
  const channels = (body as { channels?: unknown } | undefined)?.channels
  return Array.isArray(channels) ? (channels as PoolWebChannel[]) : []
}

/** One channel's counts, as the pack reports them. */
export interface ChannelProviderStatus {
  /** Models the vendor publishes, enabled or not. */
  modelsTotal: number
  /** How many of those the user has switched off. */
  modelsDisabled: number
  /** Accounts connected, enabled or not. */
  accountsTotal: number
  /** How many of those are actually usable. */
  accountsEnabled: number
  /**
   * True when every published model is switched off.
   *
   * The pack reports this rather than letting the card derive it, because a
   * channel with *no* models at all is not closed — it simply has not published
   * yet, and calling that "closed" would tell the user to go and find a setting
   * that does not exist.
   */
  closed: boolean
}
function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}
function statusFrom(value: unknown): ChannelProviderStatus | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const models = (value as { models?: unknown }).models
  const accounts = (value as { accounts?: unknown }).accounts
  if (models === null || typeof models !== 'object' || accounts === null || typeof accounts !== 'object') {
    return undefined
  }
  const modelsTotal = countOf((models as { total?: unknown }).total)
  // `disabled` can never exceed `total` from an honest pack; clamping means a
  // card can never print "18/12 models", which reads as a bug in the plugin.
  const modelsDisabled = Math.min(countOf((models as { disabled?: unknown }).disabled), modelsTotal)
  return {
    modelsTotal,
    modelsDisabled,
    accountsTotal: countOf((accounts as { total?: unknown }).total),
    accountsEnabled: countOf((accounts as { enabled?: unknown }).enabled),
    closed: (value as { closed?: unknown }).closed === true,
  }
}

/**
 * Read every channel's counts in one round trip.
 *
 * `provider.status` takes a list and answers a map, so the account pool asks
 * about all thirteen at once rather than thirteen times. A channel the pack
 * omits from the answer is simply absent from the map — the caller then has to
 * decide what "absent" means, and for counts it must not mean zero.
 */
export function providerStatusesFrom(
  envelope: ChannelRpcEnvelope,
): ReadonlyMap<string, ChannelProviderStatus> {
  const statuses = new Map<string, ChannelProviderStatus>()
  if (!envelope.ok) return statuses
  const value = envelope.value
  if (value === null || typeof value !== 'object') return statuses
  const table = (value as { statuses?: unknown }).statuses
  if (table === null || typeof table !== 'object') return statuses
  for (const [provider, raw] of Object.entries(table)) {
    const status = statusFrom(raw)
    if (status !== undefined) statuses.set(provider, status)
  }
  return statuses
}

/**
 * The host's own model catalogue for the named providers, keyed by provider id.
 *
 * This is the one place a model *description* can come from. The pack's
 * `model.list` keeps only `id`, `name` and two flags — its adapter catalogues
 * carry descriptions and windows internally and `listAllModels()` drops them on
 * the way out — so a card that wants to explain a model has to ask the host,
 * whose catalogue is the same one the model picker reads.
 *
 * A provider missing from the answer was not answered for at all (no adapter
 * under that id, or the host refused). That is deliberately distinct from a
 * provider that answered with an empty list, and the card shows them
 * differently rather than printing "no models" for a provider it never asked
 * about successfully.
 */
export async function fetchChannelModels(
  providers: readonly string[],
  ids?: Readonly<Record<string, readonly string[]>>,
): Promise<ReadonlyMap<string, readonly PoolWebChannelModel[]>> {
  const models = new Map<string, readonly PoolWebChannelModel[]>()
  if (providers.length === 0) return models
  const response = await fetch(POOL_CHANNEL_MODELS_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    credentials: 'same-origin',
    // The ids ride along because the host cannot otherwise learn them for a
    // channel its own listing gate hides — see `PoolWebChannelModelsRequest`.
    body: JSON.stringify(ids === undefined ? { providers } : { providers, ids }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body: unknown = await response.json().catch(() => undefined)
  const table = (body as { models?: unknown } | undefined)?.models
  if (table === null || typeof table !== 'object') return models
  for (const [provider, rows] of Object.entries(table as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue
    models.set(provider, rows as readonly PoolWebChannelModel[])
  }
  return models
}

/** One `credits.claimAll` run, summarised the way the card reports it. */
export interface ChannelClaimResult {
  /** Accounts that gained credits. */
  claimed: number
  /** The credit they gained, in the vendor's own unit. */
  totalCredit: number
  /** Accounts that had already claimed today. */
  alreadyClaimed: number
  /** Accounts with nothing to claim. */
  inactive: number
  /** Accounts whose claim errored. */
  failed: number
  /** `token` when the vendor pays in tokens, `credit` when it pays in credits. */
  unit: 'token' | 'credit'
}

/**
 * Read a `credits.claimAll` answer, or `undefined` when the pack refused.
 *
 * A refusal is kept as a refusal rather than as zeroes: "claimed 0 of 3" and
 * "this vendor has no check-in" are different sentences and the user acts on
 * them differently. The pack computes this summary itself (`computeClaimSummary`)
 * and also returns per-account `results`; only the summary is read here, so the
 * card cannot disagree with the pack about what a run did.
 */
export function claimResultFrom(envelope: ChannelRpcEnvelope): ChannelClaimResult | undefined {
  if (!envelope.ok) return undefined
  const value = envelope.value
  if (value === null || typeof value !== 'object') return undefined
  const summary = (value as { summary?: unknown }).summary
  if (summary === null || typeof summary !== 'object') return undefined
  const row = summary as Record<string, unknown>
  const count = (key: string): number => {
    const raw = row[key]
    return typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 0
  }
  const byUnit = (row['totalByUnit'] ?? {}) as Record<string, unknown>
  const token = byUnit['token']
  return {
    claimed: count('claimed'),
    totalCredit: count('totalCredit'),
    alreadyClaimed: count('alreadyClaimed'),
    inactive: count('inactive'),
    failed: count('failed'),
    // The pack sums per-unit totals because ZCode pays in tokens and everyone
    // else in credits. When both are non-zero the card prints the token figure,
    // since that is the only vendor whose currency is not "credits".
    unit: typeof token === 'number' && Number.isFinite(token) && token > 0 ? 'token' : 'credit',
  }
}

/** Sum the balances the pack could actually read for one channel. */
export function balancesTotal(balances: readonly ChannelBalance[]): number | undefined {
  let total = 0
  let any = false
  for (const row of balances) {
    const amount = balanceAmount(row.balance)
    if (amount === undefined) continue
    total += amount
    any = true
  }
  return any ? total : undefined
}

/**
 * Narrow or restore one model's advertised window.
 *
 * `budget === undefined` clears the cap: the pack deletes the key rather than
 * writing 0, so "no cap" keeps exactly one representation in the state file.
 *
 * Rejects a budget at or above the native window instead of sending it. That is
 * not a preference — it would be a silent no-op, and the picker would then show
 * a cap that does nothing. The caller can only offer the two options the pack
 * reports (`nativeContextWindow` and a real cap), so this is a guard, not a
 * policy.
 */
export async function setChannelModelContextBudget(
  provider: string,
  modelId: string,
  budget: number | undefined,
): Promise<ChannelRpcEnvelope> {
  const envelope = await callPack('model.setContextBudget', {
    provider,
    modelId,
    ...budget === undefined ? { budget: null } : { budget },
  })
  if (!envelope.ok) return envelope
  // The pack answers with the whole table; only the one row matters here.
  const budgets = (envelope.value as { contextBudgets?: unknown } | undefined)?.contextBudgets
  const applied =
    budgets !== null && typeof budgets === 'object'
      ? (budgets as Record<string, unknown>)[modelId]
      : undefined
  return {
    ok: true,
    value: {
      ...envelope.value as object,
      contextBudget: typeof applied === 'number' && Number.isFinite(applied) && applied > 0 ? applied : undefined,
    },
  }
}