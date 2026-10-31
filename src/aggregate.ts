/**
 * Aggregate lane: the 76 declared upstream providers, resolved per request and
 * forwarded to with the user's own key.
 *
 * WHY A SECOND LANE BESIDE THE POOL
 *
 * The pool serves exactly one family of gateways — WorkBuddy, CN and
 * international — from accounts the user already signed in on the desktop app.
 * This module serves the orthogonal case: a provider the user holds a key for,
 * reached at that provider's own endpoint, with no account rotation because
 * there is no account to rotate. Same card, same model picker, different wire.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not invent endpoints. Every URL here comes from the registry record or
 * from a base-URL override the user typed; a provider whose endpoint cannot be
 * composed is reported as such rather than being probed at a guessed URL, because
 * "no listing" and "provider is down" must not read the same to the user.
 *
 * It also does not decide whether a provider is USABLE — that is the settings
 * layer's call (`providerAuthUsable`). This module resolves what a request
 * needs, and refuses with a message naming what is missing.
 *
 * KEYS
 *
 * Every string that can reach a message — a failure, a body snippet, a probe's
 * answer — passes through {@link redactAggregateSecret} first. Providers echo
 * rejected credentials back (a 401 body routinely repeats the key), and this
 * text is folded into messages the host writes to its durable session log.
 *
 * @module dsh-xdpool/aggregate
 */
import {
  chatEndpoint,
  defaultHeaders,
  getProvider,
  modelsEndpoint,
  providerModelId,
  type ProviderFormat,
  type ProviderRecord,
  type ProviderSetting,
} from './providers.ts'
import { combosOf, providerAuthUsable, providerEnabled, type AggregateStore } from './store.ts'
import {
  buildComboCatalog,
  pruneRotation,
  type ComboModelRow,
} from './combos.ts'
import type { WorkBuddyCatalog, WorkBuddyModelInfo } from './catalog.ts'
/** Registry `format` → the wire vocabulary this module speaks. */
export type AggregateWire = 'chat' | 'responses' | 'messages'
const WIRE_BY_FORMAT: Readonly<Record<ProviderFormat, AggregateWire>> = Object.freeze({
  'openai-chat': 'chat',
  'openai-responses': 'responses',
  'anthropic-messages': 'messages',
})
/**
 * Wire suffixes, needed only for the one record the registry gives no base URL
 * to (Azure names its endpoint per deployment, so `chatEndpoint` is null there
 * and there is no registry endpoint to read the suffix off).
 */
const CHAT_SUFFIX: Readonly<Record<ProviderFormat, string>> = Object.freeze({
  'openai-chat': '/chat/completions',
  'openai-responses': '/responses',
  'anthropic-messages': '/messages',
})
/**
 * Capacities for a row the registry describes only by id.
 *
 * Deliberately conservative, and the reason is visible in the number: most
 * registry rows publish no context window at all. Publishing a plausible one
 * would put a fabricated field in front of the user — and unlike a display
 * label, a wrong window is a wrong capability, so DSH would hand the provider a
 * prompt it cannot accept.
 */
const DEFAULT_CONTEXT_WINDOW = 131_072
const DEFAULT_MAX_OUTPUT = 32_768
/** Listing round budget. Generous for a small JSON document, short for a UI. */
const LISTING_TIMEOUT_MS = 15_000
/** One turn's budget, matching the pool shim's idle ceiling. */
const TURN_TIMEOUT_MS = 300_000
/** Sent when the registry does not declare one (kimchi, and most of the roster). */
const USER_AGENT = 'dsh-xdpool/2.1'
/** How much of an upstream body is quoted back in a failure message. */
const BODY_SNIPPET_CHARS = 400
/** A trimmed non-empty string, or ''. */
function text(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : ''
}
/** A positive finite number, or undefined. */
function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
/**
 * One aggregate-lane failure, carrying the class the caller maps onto HTTP.
 *
 * `kind` reuses the pool's vocabulary (`UpstreamErrorKind` in `upstream.ts`) so
 * the shim's existing error→status table serves both lanes: a third-party 429
 * is a `soft_rate`, a 401 is a `session_dead`, and neither needs a second table
 * that could drift from the first.
 */
export class AggregateError extends Error {
  readonly kind: 'hard_credit' | 'soft_rate' | 'session_dead' | 'not_found' | 'server' | 'client'
  readonly status: number
  constructor(kind: AggregateError['kind'], message: string, status = 0) {
    super(message)
    this.name = 'AggregateError'
    this.kind = kind
    this.status = status
  }
}
/** Remove a credential from anything that may reach a message. */
export function redactAggregateSecret(value: unknown, apiKey: string): string {
  let source = typeof value === 'string' ? value : String(value ?? '')
  const key = text(apiKey)
  if (key === '') return source
  // Two spellings, because the text may already be JSON-encoded where it is
  // redacted: a key containing a quote or a backslash appears escaped there, and
  // a raw-substring search would walk straight past it.
  const escaped = JSON.stringify(key).slice(1, -1)
  for (const needle of escaped === key ? [key] : [key, escaped]) {
    if (source.includes(needle)) source = source.split(needle).join('[redacted]')
  }
  return source
}
/** A base URL a request can actually be sent to. */
function hasPlaceholder(baseUrl: string): boolean {
  return /\{[^}]*\}/.test(baseUrl)
}
/** The user's `baseUrl` override when present, else the registry's own. */
function effectiveBaseUrl(provider: ProviderRecord, setting: ProviderSetting): string {
  const override = text(setting.baseUrl)
  const base = override !== '' ? override : text(provider.baseUrl)
  return base.replace(/\/+$/, '')
}
/**
 * The provider's listing URL, moved by a `baseUrl` override when — and only
 * when — the declared listing actually lives under the registry base.
 *
 * Three providers (cohere, deepinfra, ollama_cloud) publish their listing on
 * another path. Rewriting a URL that never pointed at the override would invent
 * one, and a guessed listing is worse than none.
 */
function effectiveModelsUrl(provider: ProviderRecord, setting: ProviderSetting): string | null {
  const override = text(setting.baseUrl).replace(/\/+$/, '')
  const declared = modelsEndpoint(provider)
  if (declared === null) {
    // A record with no base of its own (`custom`) declares its listing as a
    // path, so only the user's base can make it absolute. This is NOT the
    // "relative path with no base" case `modelsEndpoint` reports as null: there
    // the URL is unusable because nothing will ever supply a host, whereas here
    // the host is precisely what the settings pane is asking for.
    const raw = text(provider.modelsUrl)
    if (raw === '' || override === '') return null
    if (/^[a-z][a-z0-9+.-]*:/iu.test(raw)) return raw
    return `${override}${raw.startsWith('/') ? '' : '/'}${raw}`
  }
  const registryBase = text(provider.baseUrl).replace(/\/+$/, '')
  if (override === '' || registryBase === '' || !declared.startsWith(registryBase)) return declared
  return `${override}${declared.slice(registryBase.length)}`
}
/**
 * The full URL a turn is posted to; null when the provider has no dialable
 * endpoint (Azure without a user base URL, or a base still carrying the
 * registry's `{account_id}`-style placeholder).
 */
function effectiveChatUrl(provider: ProviderRecord, setting: ProviderSetting): string | null {
  const override = text(setting.baseUrl).replace(/\/+$/, '')
  const declared = chatEndpoint(provider)
  if (declared !== null) {
    const registryBase = text(provider.baseUrl).replace(/\/+$/, '')
    const url = override === '' || registryBase === '' ? declared : `${override}${declared.slice(registryBase.length)}`
    return hasPlaceholder(url) ? null : url
  }
  const suffix = CHAT_SUFFIX[provider.format]
  if (override === '' || suffix === undefined || hasPlaceholder(override)) return null
  return `${override}${suffix}`
}
/** One provider fully resolved: everything a request needs, and nothing more. */
export interface ResolvedAggregateProvider {
  providerId: string
  /** Display name, used in failure messages so the user knows which key to fix. */
  providerName: string
  apiKey: string
  baseUrl: string
  format: ProviderFormat
  wire: AggregateWire
  chatUrl: string
  modelsUrl: string | null
  headers: Record<string, string>
}
/** The per-provider settings object, or `{}` when the store names none. */
function settingFor(store: AggregateStore, providerId: string): ProviderSetting {
  return store.providers?.[providerId] ?? {}
}
/**
 * Resolve one provider's effective settings.
 *
 * Throws {@link AggregateError} with a `client` kind for every state the user
 * fixes in the settings page — an unknown id, a missing key, a placeholder base
 * URL. A `client` kind is deliberate: none of these is a transport fault, so
 * none of them should be retried against a different provider.
 *
 * `options.requireEnabled` exists for the DISCOVERY calls. Fetching a provider's
 * model list publishes nothing: it asks "does this endpoint answer, and with
 * what", and writing the answer back is a separate step the user also takes.
 * Gating it on the enable switch made a read-only button report
 * `"OpenCode Free" is not enabled in the aggregate settings` — a failure to
 * LOOK, dressed up as a failure to connect, on rows that carry no key field and
 * so offered no way to answer it. Discovery therefore does not require the
 * switch; publishing still does, in {@link buildAggregateCatalog} and
 * {@link resolveAggregateProvider} as called by the serving paths.
 */
export function resolveAggregateProvider(
  store: AggregateStore,
  providerId: string,
  options: { requireEnabled?: boolean } = {},
): ResolvedAggregateProvider {
  const id = text(providerId)
  const provider = id === '' ? null : getProvider(id)
  if (provider === null) {
    throw new AggregateError('client', `the aggregate lane has no provider "${id === '' ? String(providerId) : id}"`)
  }
  const setting = settingFor(store, provider.id)
  // The explicit switch first, so its message is the precise one. A provider
  // that is off merely because nothing was configured for it falls through to
  // the credential checks below, which say what is actually missing.
  if (setting.enabled === false) {
    throw new AggregateError('client', `"${provider.name}" is switched off in the aggregate settings`)
  }
  if (!providerAuthUsable(provider, setting)) {
    if (provider.auth.kind === 'oauth' || provider.auth.kind === 'adc') {
      throw new AggregateError(
        'session_dead',
        `"${provider.name}" signs in with ${provider.auth.kind}, not with an API key, so the aggregate lane does not serve it`,
      )
    }
    const where = text(provider.auth.url) === '' ? '' : ` (the provider issues keys at ${provider.auth.url})`
    throw new AggregateError('client', `"${provider.name}" needs an API key: paste one in the aggregate settings${where}`)
  }
  // Reached only by a keyless vendor the user never switched on: it has nothing
  // missing, so the honest answer is that it was not chosen. Skipped for
  // discovery — see the `requireEnabled` note above.
  if (options.requireEnabled !== false && !providerEnabled(provider, setting)) {
    throw new AggregateError('client', `"${provider.name}" is not enabled in the aggregate settings`)
  }
  const baseUrl = effectiveBaseUrl(provider, setting)
  if (baseUrl === '') {
    throw new AggregateError('client', `"${provider.name}" has no base URL of its own — set one in the aggregate settings`)
  }
  if (hasPlaceholder(baseUrl)) {
    throw new AggregateError(
      'client',
      `"${provider.name}"'s base URL still carries a registry placeholder — set the real URL in the aggregate settings`,
    )
  }
  const chatUrl = effectiveChatUrl(provider, setting)
  if (chatUrl === null) {
    throw new AggregateError('client', `"${provider.name}" has no usable ${provider.format} endpoint`)
  }
  const apiKey = text(setting.apiKey)
  // The provider's own declared headers first, credential last: a provider that
  // ships a `user-agent` or an `anthropic-beta` keeps it.
  const headers = defaultHeaders(provider, apiKey)
  if (headers['user-agent'] === undefined) headers['user-agent'] = USER_AGENT
  return {
    providerId: provider.id,
    providerName: provider.name,
    apiKey,
    baseUrl,
    format: provider.format,
    wire: WIRE_BY_FORMAT[provider.format],
    chatUrl,
    modelsUrl: effectiveModelsUrl(provider, setting),
    headers,
  }
}
/** One model the aggregate lane offers. */
export interface AggregateModelRow {
  /** Composite id: `providerId/modelId`, which is also the picker id. */
  id: string
  /** Display name: the provider's own name plus the row's label. */
  name: string
  providerId: string
  modelId: string
  contextWindow: number
  maxOutputTokens: number
  supportsImages: boolean
  wire: AggregateWire
  /** `static` from the registry, `discovered` from a live listing. */
  source: 'static' | 'discovered'
}
/**
 * The ids a provider should be served with, and where that list came from.
 *
 * `discovered` is the roster a fetch returned, `models` is the subset the user
 * kept, and the choice is applied LAST so it wins over both — otherwise pressing
 * "Fetch models" would silently undo the narrowing the card just saved.
 */
function modelIdsFor(provider: ProviderRecord, setting: ProviderSetting): {
  ids: string[]
  source: 'static' | 'discovered'
} {
  const universe = modelChoicesFor(provider, setting)
  const source: 'static' | 'discovered' = rosterIsDiscovered(provider, setting) ? 'discovered' : 'static'
  const override = stringList(setting.models)
  if (override.length === 0) return { ids: universe, source }
  // Intersect rather than trust the choice outright: an id the provider dropped
  // must not linger in the picker because an old save still names it. A choice
  // that names nothing yields nothing, which is how "expose none of this
  // vendor" stays expressible.
  const available = new Set(universe)
  return { ids: override.filter(id => available.has(id)), source }
}
/**
 * Whether the roster came from a live fetch rather than the registry.
 *
 * A pre-split install has `models` and no `discovered`, because until the
 * chooser existed the only writer of `models` WAS the fetch button. Those ids
 * are a roster, not a choice, and treating them as one would shrink the vendor
 * to whatever handful the registry happens to declare.
 */
function rosterIsDiscovered(provider: ProviderRecord, setting: ProviderSetting): boolean {
  if ((setting.discovered?.length ?? 0) > 0) return true
  return stringList(setting.models).length > provider.models.length
}
/** Every id a provider could offer: its roster, for the card's chooser. */
export function modelChoicesFor(provider: ProviderRecord, setting: ProviderSetting): string[] {
  const discovered = stringList(setting.discovered)
  // A legacy `models`-only install is its own roster, kept until the next fetch
  // rewrites it into `discovered`.
  if (discovered.length === 0 && rosterIsDiscovered(provider, setting)) return stringList(setting.models)
  return discovered.length > 0 ? discovered : provider.models.map(model => model.id)
}
/** A de-duplicated list of non-empty trimmed strings from an untrusted array. */
function stringList(value: readonly string[] | undefined): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const raw of value) {
    const id = text(raw)
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}
/**
 * One catalog row.
 *
 * Capacities come from the registry's model row where it has them, and fall back
 * to this module's own defaults where it does not (most rows carry no context
 * window, and none carries an output ceiling — the registry records ids and
 * published capacities, not a serving contract).
 */
function rowOf(provider: ProviderRecord, modelId: string, source: 'static' | 'discovered'): AggregateModelRow {
  const declared = provider.models.find(model => model.id === modelId)
  const contextWindow = number(declared?.contextWindow) ?? DEFAULT_CONTEXT_WINDOW
  const label = text(declared?.name) !== '' ? text(declared?.name) : modelId
  return {
    id: providerModelId(provider.id, modelId),
    name: `${provider.name} ${label}`,
    providerId: provider.id,
    modelId,
    contextWindow,
    maxOutputTokens: Math.min(DEFAULT_MAX_OUTPUT, contextWindow),
    supportsImages: declared?.vision === true,
    wire: WIRE_BY_FORMAT[provider.format],
    source,
  }
}
/**
 * Every model row the lane should offer, given the stored settings.
 *
 * A provider is skipped when it is switched off, when its credential flow this
 * lane cannot drive, or when its endpoint cannot be composed — a picker row that
 * can never answer is worse than no row, because it reads as "this provider is
 * broken" rather than "not set up yet".
 */
export function buildAggregateCatalog(store: AggregateStore): AggregateModelRow[] {
  // The lane's own switch: off contributes no rows at all, whatever the
  // per-provider flags say.
  if (store.enabled === false) return []
  const rows: AggregateModelRow[] = []
  for (const [providerId, setting] of Object.entries(store.providers ?? {})) {
    if (setting === undefined || setting === null) continue
    const provider = getProvider(providerId)
    if (provider === null) continue
    // Order matters only for readability: `providerEnabled` already answers
    // false for anything `providerAuthUsable` rejects, but keeping the
    // credential test first means the cheaper predicate short-circuits.
    if (!providerAuthUsable(provider, setting)) continue
    if (!providerEnabled(provider, setting)) continue
    if (effectiveChatUrl(provider, setting) === null) continue
    const { ids, source } = modelIdsFor(provider, setting)
    for (const modelId of ids) rows.push(rowOf(provider, modelId, source))
  }
  return rows
}
/** One stored aggregate row set, refreshed on change, for the shim and adapter. */
export class AggregateCatalog {
  private rows: readonly AggregateModelRow[] = []
  private chainRows: readonly ComboModelRow[] = []
  /**
   * @param read    The settings document.
   * @param poolRows The pool's own rows, needed only to resolve a chain member
   *   that names a WorkBuddy model. A chain may mix pool models with aggregate
   *   ones, so without this a perfectly valid chain would lose its pool half.
   */
  constructor(
    private readonly read: () => AggregateStore | Promise<AggregateStore>,
    private readonly poolRows: () => readonly WorkBuddyModelInfo[] = () => [],
  ) {}
  /**
   * Every row this catalog offers: third-party rows first, then chain rows.
   *
   * Chains come last so a picker listing stays readable — a chain is a
   * convenience over models the user already has listed, not a new vendor.
   */
  current(): readonly (AggregateModelRow | ComboModelRow)[] {
    return [...this.rows, ...this.chainRows]
  }
  /** Only the third-party rows, which is what the aggregate resolver needs. */
  providerRows(): readonly AggregateModelRow[] {
    return this.rows
  }
  /** Only the chain rows. */
  comboRows(): readonly ComboModelRow[] {
    return this.chainRows
  }
  /** Re-read the store and notify listeners when the roster actually changed. */
  async refresh(): Promise<readonly (AggregateModelRow | ComboModelRow)[]> {
    const store = await this.read()
    const next = buildAggregateCatalog(store)
    const chains = buildComboCatalog(combosOf(store), {
      pool: this.poolRows(),
      aggregate: next,
    })
    pruneRotation(combosOf(store))
    const same = next.length === this.rows.length
      && chains.length === this.chainRows.length
      && next.every((row, index) => row.id === this.rows[index]?.id)
      && chains.every((row, index) => row.id === this.chainRows[index]?.id)
    if (same) return this.current()
    this.rows = next
    this.chainRows = chains
    for (const listener of this.listeners) listener()
    return this.current()
  }
  private listeners = new Set<() => void>()
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  /** One third-party row by composite id, or undefined. */
  find(id: string): AggregateModelRow | undefined {
    return this.rows.find(row => row.id === id)
  }
  /** One chain row by combo id, or undefined. */
  findCombo(id: string): ComboModelRow | undefined {
    return this.chainRows.find(row => row.id === id)
  }
  /** Whether any provider or chain is serving anything right now. */
  hasRows(): boolean {
    return this.rows.length > 0 || this.chainRows.length > 0
  }
}
/**
 * Narrow a catalog to the aggregate flavour.
 *
 * Probed by CAPABILITY, never by data. The previous shape check read
 * `catalog.current()[0]` and asked whether the row carried a `providerId` — which
 * is false for an aggregate catalog that has not been written to yet, because
 * `current()` is then an empty array. A fresh install therefore classified its own
 * aggregate catalog as a pool catalog, `createWorkBuddyAdapter` called
 * `catalog.visible()` on it, and `AggregateCatalog` has no such method:
 *
 *   TypeError: catalog.visible is not a function
 *
 * That throw happens while the adapters are being BUILT — before any
 * `registerAdapter` call — so it escaped to the outermost catch in `apply` and
 * every provider went unregistered. The user's only symptom was "the model
 * picker does not list xdpool", and nothing on screen said why.
 *
 * `providerRows()` exists on `AggregateCatalog` and on no pool catalog, in every
 * state including empty, so the answer no longer depends on what happens to be
 * in the store at boot.
 */
export function isAggregateCatalog(catalog: WorkBuddyCatalog | AggregateCatalog): catalog is AggregateCatalog {
  return typeof (catalog as Partial<AggregateCatalog>).providerRows === 'function'
}
/**
 * `Retry-After` seconds → milliseconds, the conversion every poster applies.
 *
 * Exported because the co-paid lane's poster converts the same header the same
 * way; a second conversion is a second chance to disagree about milliseconds.
 */
export function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds > 0 ? Math.trunc(seconds * 1000) : undefined
}
/**
 * Read a refusal into an {@link AggregateError}.
 *
 * The body is redacted BEFORE it is truncated: slicing first could cut a key in
 * half and leave its front in the snippet. The provider's own message is
 * preferred when the body carries one — "Incorrect API key provided" is
 * actionable, "http 401" is not.
 *
 * Exported for the co-paid lane, which classifies the same six classes through
 * the same table. The credential argument is what gets scrubbed out of the
 * message; the co-paid lane passes an empty string because its secret never
 * enters the request body or the reply in the first place.
 */
export function classifyUpstream(status: number, bodyText: string, retryAfter: number | undefined, apiKey: string): AggregateError {
  const safe = redactAggregateSecret(bodyText, apiKey)
  let message = ''
  try {
    const payload = JSON.parse(safe) as unknown
    const envelope = isRecord(payload) && isRecord(payload.error) ? payload.error : isRecord(payload) ? payload : undefined
    const detail = envelope === undefined ? '' : text(envelope.message) !== '' ? text(envelope.message) : text(envelope.type)
    if (detail !== '') message = detail
  } catch {
    // A body that is not JSON is a proxy speaking for the provider; the snippet
    // below is the best available answer.
  }
  // A free-tier refusal arrives as 403, which the table below would file under
  // `session_dead` — the class every caller reads as "this credential is spent,
  // stop using it". Nothing here is spent: the request was well-formed and the
  // lane simply does not serve it from this client. Filing it as a dead session
  // makes the pool penalize a credential that is fine, so it is separated out
  // and answered as what it is, with the provider's own sentence kept.
  if (status === 403 && /FreeTierError/u.test(safe)) {
    const why = message === '' ? 'the free tier is locked to this client' : message
    return new AggregateError('client', `the provider locked its free tier to its own client: ${why}`, status)
  }
  const suffix = message === '' ? safe.slice(0, BODY_SNIPPET_CHARS) : message
  const kind: AggregateError['kind'] = status === 401 || status === 403
    ? 'session_dead'
    : status === 402 || status === 429
      ? status === 402 ? 'hard_credit' : 'soft_rate'
      : status === 404 || status === 501
        ? 'not_found'
        : status >= 500
          ? 'server'
          : 'client'
  const retryNote = kind === 'soft_rate' && retryAfter !== undefined
    ? `; the provider asked to wait ${Math.ceil(retryAfter / 1000)}s`
    : ''
  return new AggregateError(kind, `the provider answered HTTP ${status}${retryNote}: ${suffix}`, status)
}
/**
 * Read a model-listing document into ids, or null when the shape is not a
 * listing at all.
 *
 * Tolerant on purpose: the registry's endpoints speak several dialects — the
 * OpenAI `{data:[{id}]}`, Cohere's `{models:[{name}]}`, Ollama's
 * `{models:[{name}]}`, DeepInfra's `[{model_name}]` — and a row's id is the
 * first of those fields it actually carries.
 */
function modelIdsFrom(payload: unknown): string[] | null {
  const rows = Array.isArray(payload) ? payload
    : isRecord(payload) && Array.isArray(payload.data) ? payload.data
      : isRecord(payload) && Array.isArray(payload.models) ? payload.models
        : null
  if (rows === null) return null
  const seen = new Set<string>()
  const ids: string[] = []
  for (const row of rows) {
    let id = ''
    if (typeof row === 'string') id = text(row)
    else if (isRecord(row)) {
      for (const field of ['id', 'name', 'model', 'model_name']) {
        id = text(row[field])
        if (id !== '') break
      }
    }
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}
/** One listing round's answer, and how to read it. */
export interface AggregateListing {
  resolved: ResolvedAggregateProvider
  /** Aborts the round on timeout, and follows the caller's own signal. */
  signal: AbortSignal
  /** The request as sent, for the wire-level failure message. */
  url: string
}
/**
 * Fetch a provider's live model list.
 *
 * Returns the ids, `[]` for an AUTHORITATIVE empty listing (the caller may then
 * clear a stale roster), and `null` for every failure — unknown or unconfigured
 * provider, no declared listing, an unreadable answer. The split matters: a
 * failed round must KEEP what it had, or a flaky listing silently deletes models
 * the user configured on purpose.
 */
export async function fetchAggregateModels(
  store: AggregateStore,
  providerId: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string[] | null> {
  let resolved: ResolvedAggregateProvider
  try {
    resolved = resolveAggregateProvider(store, providerId)
  } catch {
    return null
  }
  if (resolved.modelsUrl === null) return null
  const url = resolved.modelsUrl
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? LISTING_TIMEOUT_MS)
  const onCallerAbort = (): void => controller.abort()
  options.signal?.addEventListener('abort', onCallerAbort, { once: true })
  try {
    const response = await fetch(url, {
      headers: { ...resolved.headers, accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) return null
    const payload = JSON.parse(
      redactAggregateSecret(await response.text(), resolved.apiKey),
    ) as unknown
    return modelIdsFrom(payload)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onCallerAbort)
  }
}
/** What a key probe found. Never throws: the settings page shows the answer. */
export interface AggregateProbe {
  ok: boolean
  status: number
  message: string
  /** Model count, when the listing was readable. */
  modelCount?: number
  /** Ids, when the listing was readable. A probe that answers with names is
   *  also what the "discover models" button writes back. */
  modelIds?: string[]
}
/**
 * Verify a key with a cheap NON-GENERATING call: the provider's own listing.
 *
 * A provider that declares no listing (Anthropic, OpenAI, …) cannot be verified
 * without spending a generation, and this lane does not spend the user's money
 * behind their back — the answer says so rather than guessing at a URL.
 */
export async function probeAggregateProvider(
  store: AggregateStore,
  providerId: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<AggregateProbe> {
  let resolved: ResolvedAggregateProvider
  try {
    // `requireEnabled: false` — this is the diagnostic. It asks whether the key
    // and endpoint answer, and it publishes nothing; gating it on the enable
    // switch reported "not enabled" as if the connection had failed.
    resolved = resolveAggregateProvider(store, providerId, { requireEnabled: false })
  } catch (error: unknown) {
    return { ok: false, status: 0, message: error instanceof Error ? error.message : String(error) }
  }
  if (resolved.modelsUrl === null) {
    return {
      ok: false,
      status: 0,
      message: `"${resolved.providerName}" declares no model listing, so its key cannot be verified without spending a generation`,
    }
  }
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? LISTING_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onCallerAbort = (): void => controller.abort()
  options.signal?.addEventListener('abort', onCallerAbort, { once: true })
  try {
    const response = await fetch(resolved.modelsUrl, {
      headers: { ...resolved.headers, accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    })
    const body = await response.text().catch(() => '')
    if (!response.ok) {
      const failure = classifyUpstream(response.status, body, retryAfterMs(response), resolved.apiKey)
      return { ok: false, status: response.status, message: failure.message }
    }
    let payload: unknown
    try {
      payload = JSON.parse(redactAggregateSecret(body, resolved.apiKey)) as unknown
    } catch {
      payload = undefined
    }
    const ids = modelIdsFrom(payload)
    if (ids === null) {
      return {
        ok: false,
        status: response.status,
        message: `the listing answered HTTP ${response.status} but its shape was not recognised`,
      }
    }
    return {
      ok: true,
      status: response.status,
      message: `the key is accepted; ${ids.length} model(s) listed`,
      modelCount: ids.length,
      modelIds: ids,
    }
  } catch (error: unknown) {
    if (options.signal?.aborted === true) return { ok: false, status: 0, message: 'request aborted' }
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, status: 0, message: `the provider did not answer within ${timeoutMs}ms` }
    }
    const cause = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      status: 0,
      message: redactAggregateSecret(`the provider could not be reached: ${cause}`, resolved.apiKey),
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onCallerAbort)
  }
}
/** One turn's outcome: either the upstream status, or a classified failure. */
export interface AggregateForwardResult {
  status: number
}
/**
 * POST one streaming completion to the provider.
 *
 * `onData` receives one SSE `data:` payload per provider frame, in order, and
 * the caller owns the response framing. The body is posted as given — a plain
 * object gets `stream:true` forced, because a caller that forgot the flag would
 * otherwise collect a JSON document where frames were expected.
 *
 * The shape of the ANSWER decides how it is read, never its Content-Type: a
 * front proxy that mislabels a JSON body as an event stream is common enough
 * that believing the header truncates real answers.
 *
 * A JSON answer to a streamed request is normalised into the frame sequence the
 * row's wire decodes — chat chunks, Anthropic events, or Responses events. Each
 * sequence ends with its terminal frame, always: a decoder that sees no terminal
 * event reads a finished turn as a stream the provider cut, which the host
 * answers with a retry.
 */
export async function forwardAggregateStreamed(
  resolved: ResolvedAggregateProvider,
  modelId: string,
  body: unknown,
  options: {
    signal?: AbortSignal
    onData: (payload: string) => void
    timeoutMs?: number
  },
): Promise<AggregateForwardResult> {
  const model = text(modelId)
  const bodyText = typeof body === 'string' ? body : JSON.stringify({ ...(body as Record<string, unknown>), stream: true })
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? TURN_TIMEOUT_MS
  const onCallerAbort = (): void => controller.abort()
  options.signal?.addEventListener('abort', onCallerAbort, { once: true })
  try {
    const response = await fetch(resolved.chatUrl, {
      method: 'POST',
      headers: { ...resolved.headers, accept: 'text/event-stream' },
      body: bodyText,
      redirect: 'error',
      signal: controller.signal,
    })
    const retryAfter = retryAfterMs(response)
    if (!response.ok) {
      const refusal = await response.text().catch(() => '')
      throw classifyUpstream(response.status, refusal, retryAfter, resolved.apiKey)
    }
    if (response.body === null) throw new AggregateError('server', 'the provider returned no body', response.status)
    const head = await readSseHead(response.body, controller.signal, timeoutMs)
    if (head.shape === 'empty') throw new AggregateError('server', 'the provider returned no body', response.status)
    if (head.shape === 'sse') {
      // Raw payloads, straight through: the wire's own decoder reads them, so
      // nothing is rewritten between the provider and the host.
      for (const payload of head.payloads) options.onData(payload)
      return { status: response.status }
    }
    let raw = head.text
    if (!head.done) {
      try {
        while (true) {
          const chunk = await head.reader.read()
          if (chunk.done) break
          if (chunk.value !== undefined) raw += head.decoder.decode(chunk.value, { stream: true })
        }
      } catch (error: unknown) {
        await head.reader.cancel().catch(() => {})
        throw new AggregateError('server', `the provider stream broke: ${error instanceof Error ? error.message : String(error)}`, response.status)
      }
    }
    raw += head.decoder.decode()
    let payload: unknown
    try {
      payload = JSON.parse(redactAggregateSecret(raw, resolved.apiKey)) as unknown
    } catch {
      // A 200 that is not JSON is a hop speaking for the provider: markup is a
      // front proxy (a WAF page, a CDN error), and replaying the identical body
      // draws it again, so this is NOT a retryable server error.
      if (/^\s*<(!doctype|html[\s>])/i.test(raw)) {
        throw new AggregateError(
          'client',
          `the provider's front proxy answered HTTP ${response.status} with an HTML error page`,
          response.status,
        )
      }
      throw new AggregateError(
        'server',
        `unexpected non-stream response: ${redactAggregateSecret(raw, resolved.apiKey).slice(0, 200)}`,
        response.status,
      )
    }
    if (isRecord(payload) && (payload.error !== undefined || payload.type === 'error')) {
      throw classifyUpstream(response.status, raw, retryAfter, resolved.apiKey)
    }
    for (const frame of synthesisedFrames(resolved.wire, payload, model)) options.onData(frame)
    return { status: response.status }
  } catch (error: unknown) {
    if (error instanceof AggregateError) throw error
    if (options.signal?.aborted === true) throw new AggregateError('client', 'request aborted')
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AggregateError('server', `the provider did not answer within ${timeoutMs}ms`)
    }
    const cause = error instanceof Error ? error.message : String(error)
    throw new AggregateError(
      'server',
      `the request to ${resolved.providerName} failed: ${redactAggregateSecret(cause, resolved.apiKey)}`,
    )
  } finally {
    options.signal?.removeEventListener('abort', onCallerAbort)
  }
}
/**
 * How much of the head is read before the shape is decided.
 *
 * Large enough that a real SSE stream always shows its `data:` opener, small
 * enough that a JSON document's opening bytes are usually enough to rule SSE
 * out. A JSON answer is then drained in full.
 */
const SNIFF_BYTES = 4096
/**
 * What the head read found, and what to do with the rest of the body.
 *
 * Exported because the co-paid lane reads its answers the same way and neither
 * lane should own a second opinion about what a body is: the shape is decided
 * from the bytes, never from a Content-Type header, and one implementation of
 * that rule cannot drift from another.
 */
export type SniffedHead =
  | { shape: 'empty'; text: string; done: boolean; decoder: TextDecoder; reader: ReadableStreamDefaultReader<Uint8Array> }
  | { shape: 'sse'; payloads: string[]; text: string; done: boolean; decoder: TextDecoder; reader: ReadableStreamDefaultReader<Uint8Array> }
  | { shape: 'json'; text: string; done: boolean; decoder: TextDecoder; reader: ReadableStreamDefaultReader<Uint8Array> }
/**
 * Read the head, decide the shape, and — for SSE — collect every frame.
 *
 * SSE is collected here rather than piped straight through so the caller gets
 * one ordered list of payloads and owns the response framing. That costs a
 * buffer on a long answer, and it is the right trade: the alternative re-encodes
 * every frame, and one replacement character at a split boundary is a bug the
 * user reads but the logs cannot explain.
 *
 * Exported for the co-paid lane's poster; see {@link SniffedHead}.
 */
export async function readSseHead(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<SniffedHead> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let head: SniffedHead | undefined
  try {
    const first = await reader.read()
    if (first.done || first.value === undefined || first.value.length === 0) {
      return { shape: 'empty', text, done: true, decoder, reader }
    }
    text = decoder.decode(first.value, { stream: true })
    const shape = sniffBodyShape(text)
    if (shape === 'sse') {
      // The head already carries whole frames; drain the remainder into the
      // same collector so frame order is preserved across the boundary.
      const payloads = extractSsePayloads(text)
      // Only the head's UNTERMINATED line may be replayed into the collector.
      // Re-seeding the collector with the whole head would push the head's own
      // payloads a second time the moment the loop appends anything, which
      // duplicates the first frame of every streamed answer.
      const cut = text.lastIndexOf('\n')
      let pending = cut === -1 ? text : text.slice(cut + 1)
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done || chunk.value === undefined) break
        pending += decoder.decode(chunk.value, { stream: true })
        const end = pending.lastIndexOf('\n')
        if (end === -1) continue
        const settled = pending.slice(0, end)
        pending = pending.slice(end + 1)
        payloads.push(...extractSsePayloads(settled))
      }
      pending += decoder.decode()
      payloads.push(...extractSsePayloads(pending))
      return { shape: 'sse', payloads, text, done: true, decoder, reader }
    }
    head = { shape: 'json', text, done: first.done, decoder, reader }
    if (first.done) return { ...head, text: text + decoder.decode(), done: true }
    return head
  } finally {
    if (signal.aborted) await reader.cancel().catch(() => {})
  }
}
/**
 * Classify what the head read found.
 *
 * SSE is recognised by a `data:` or event opener, not by the content type: a
 * front proxy that mislabels a JSON body as `text/event-stream` is common, and
 * believing the header truncates real answers at the first frame boundary.
 */
export function sniffBodyShape(text: string): 'empty' | 'sse' | 'json' {
  const head = text.trimStart()
  if (head === '') return 'empty'
  return /^(?:data|event|id|retry|:\s)/u.test(head) || head.startsWith(':') ? 'sse' : 'json'
}
/** Every non-comment `data:` payload in an SSE chunk, in order. */
function extractSsePayloads(chunk: string): string[] {
  const out: string[] = []
  for (const rawLine of chunk.split(/\r?\n/u)) {
    const line = rawLine.trimEnd()
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trimStart()
    // `[DONE]` is the OpenAI terminator, not a payload; forwarding it would
    // hand the decoder a frame it cannot parse.
    if (payload === '[DONE]') continue
    if (payload === '') continue
    out.push(payload)
  }
  return out
}
/**
 * The frames one JSON answer turns into, in the vocabulary of the row's wire.
 *
 * Exported for the co-paid lane, whose relay answers a streamed request with one
 * JSON document on occasion and needs the same folding rather than a second one.
 */
export function synthesisedFrames(wire: AggregateWire, payload: unknown, model: string): string[] {
  if (wire === 'messages') return anthropicFrames(payload, model)
  if (wire === 'responses') return responsesFrames(payload, model)
  return chatFrames(payload, model)
}
/** One `chat.completion.chunk` per field the chat decoder reads. */
function chatFrames(payload: unknown, model: string): string[] {
  const root = isRecord(payload) ? payload : {}
  const choices = Array.isArray(root.choices) ? root.choices : []
  const choice = isRecord(choices[0]) ? choices[0] : {}
  const message = isRecord(choice.message) ? choice.message : {}
  const head = {
    id: text(root.id) === '' ? 'aggregate' : text(root.id),
    object: 'chat.completion.chunk',
    created: number(root.created) ?? Math.floor(Date.now() / 1000),
    model,
  }
  const frames: string[] = []
  const reasoning = typeof message.reasoning_content === 'string'
    ? message.reasoning_content
    : typeof message.reasoning === 'string' ? message.reasoning : ''
  if (reasoning !== '') {
    frames.push(JSON.stringify({
      ...head,
      choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: reasoning }, finish_reason: null }],
    }))
  }
  const content = typeof message.content === 'string'
    ? message.content
    : Array.isArray(message.content)
      ? message.content.map(part => (isRecord(part) && typeof part.text === 'string' ? part.text : '')).join('')
      : ''
  if (content !== '') {
    frames.push(JSON.stringify({
      ...head,
      choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
    }))
  }
  let index = 0
  for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
    const entry = isRecord(call) ? call : {}
    const fn = isRecord(entry.function) ? entry.function : {}
    frames.push(JSON.stringify({
      ...head,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index,
            id: text(entry.id) === '' ? `call_${index}` : text(entry.id),
            type: 'function',
            function: {
              name: text(fn.name),
              arguments: typeof fn.arguments === 'string' ? fn.arguments : '',
            },
          }],
        },
        finish_reason: null,
      }],
    }))
    index += 1
  }
  frames.push(JSON.stringify({
    ...head,
    choices: [{ index: 0, delta: {}, finish_reason: text(choice.finish_reason) === '' ? 'stop' : text(choice.finish_reason) }],
    ...root.usage === undefined ? {} : { usage: root.usage },
  }))
  return frames
}
/** One Anthropic event sequence per block, plus the terminal pair. */
function anthropicFrames(payload: unknown, model: string): string[] {
  const root = isRecord(payload) ? payload : {}
  const usage = isRecord(root.usage) ? root.usage : undefined
  const frames: string[] = [JSON.stringify({
    type: 'message_start',
    message: {
      id: text(root.id) === '' ? 'aggregate' : text(root.id),
      type: 'message',
      role: 'assistant',
      model,
      ...usage === undefined ? {} : { usage },
    },
  })]
  const blocks = Array.isArray(root.content) ? root.content : []
  blocks.forEach((raw, index) => {
    const block = isRecord(raw) ? raw : {}
    const type = text(block.type)
    if (type === 'tool_use') {
      frames.push(JSON.stringify({
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: text(block.id) === '' ? `toolu_${index}` : text(block.id), name: text(block.name) },
      }))
      frames.push(JSON.stringify({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) },
      }))
    } else if (type === 'thinking' || type === 'redacted_thinking') {
      frames.push(JSON.stringify({ type: 'content_block_start', index, content_block: { type } }))
      const thinking = typeof block.thinking === 'string' ? block.thinking : ''
      if (thinking !== '') {
        frames.push(JSON.stringify({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking } }))
      }
    } else {
      frames.push(JSON.stringify({
        type: 'content_block_start',
        index,
        content_block: { type: type === '' ? 'text' : type },
      }))
      const value = typeof block.text === 'string' ? block.text : ''
      if (value !== '') {
        frames.push(JSON.stringify({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: value } }))
      }
    }
    frames.push(JSON.stringify({ type: 'content_block_stop', index }))
  })
  frames.push(JSON.stringify({
    type: 'message_delta',
    delta: {
      stop_reason: text(root.stop_reason) === '' ? 'end_turn' : text(root.stop_reason),
      stop_sequence: root.stop_sequence ?? null,
    },
    ...usage === undefined ? {} : { usage: { output_tokens: number(usage.output_tokens) ?? 0 } },
  }))
  frames.push(JSON.stringify({ type: 'message_stop' }))
  return frames
}
/** One Responses event sequence per output item, then the terminal frame. */
function responsesFrames(payload: unknown, model: string): string[] {
  const root = isRecord(payload) ? payload : {}
  const frames: string[] = []
  const output = Array.isArray(root.output) ? root.output : []
  output.forEach((raw, outputIndex) => {
    const item = isRecord(raw) ? raw : {}
    const type = text(item.type)
    if (type === 'reasoning') {
      const summary = Array.isArray(item.summary) ? item.summary : []
      const delta = summary.map(part => (isRecord(part) && typeof part.text === 'string' ? part.text : '')).join('')
      if (delta !== '') {
        frames.push(JSON.stringify({
          type: 'response.reasoning_summary_text.delta',
          item_id: text(item.id),
          output_index: outputIndex,
          delta,
        }))
      }
      return
    }
    if (type === 'message') {
      const content = Array.isArray(item.content) ? item.content : []
      const delta = content.map(part => (isRecord(part) && typeof part.text === 'string' ? part.text : '')).join('')
      if (delta !== '') {
        frames.push(JSON.stringify({
          type: 'response.output_text.delta',
          item_id: text(item.id),
          output_index: outputIndex,
          delta,
        }))
      }
      return
    }
    if (type === 'function_call') {
      frames.push(JSON.stringify({ type: 'response.output_item.added', output_index: outputIndex, item }))
      frames.push(JSON.stringify({
        type: 'response.function_call_arguments.delta',
        item_id: text(item.id),
        output_index: outputIndex,
        delta: typeof item.arguments === 'string' ? item.arguments : '',
      }))
    }
  })
  frames.push(JSON.stringify({
    type: 'response.completed',
    response: { ...root, model: text(root.model) === '' ? model : text(root.model) },
  }))
  return frames
}