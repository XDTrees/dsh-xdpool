/**
 * Aggregate provider lane: the registry, its lookup helpers, and the settings
 * shape.
 *
 * WHY THIS EXISTS
 *
 * The pool used to serve exactly one family of gateways — WorkBuddy, CN and
 * international. That is a small roster, and every user who wanted another free
 * or cheap model had to install a different plugin. This module adds a SECOND
 * lane beside it: 76 upstream providers declared once, each with a wire format,
 * an auth requirement and a model list, resolved per request.
 *
 * The registry is data, not code. `getProvider` / `chatEndpoint` /
 * `defaultHeaders` are pure lookups, and every rule they encode (which header
 * carries a key on which wire) is a property of the upstream, so it belongs
 * beside the upstream's own record rather than in a switch statement somewhere
 * else.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not decide whether a provider is USABLE. These helpers return the
 * pieces a request needs; the caller decides what a missing key means. Keeping
 * the credential policy in one place (the settings layer) is what lets the same
 * registry serve both "configured and on" and "installed but never set up"
 * without two code paths.
 *
 * Nothing here touches Node or HTTP, so the tests exercise the same module the
 * browser bundle imports for the provider list.
 *
 * @module dsh-xdpool/providers
 */
import registry from './providers-registry.json' with { type: 'json' }
/** Wire protocols this lane can speak, as the registry names them. */
export const PROVIDER_FORMATS = ['openai-chat', 'openai-responses', 'anthropic-messages'] as const
export type ProviderFormat = (typeof PROVIDER_FORMATS)[number]
/** How a provider's credential is obtained. */
export type ProviderAuthKind = 'apiKey' | 'none' | 'oauth' | 'adc'
/**
 * What a provider costs to use.
 *
 * `free` means no credential at all. `free-tier` means the provider offers a
 * free allowance but still needs a key — which is the case for the large
 * majority of the roster, and saying so on screen is the difference between a
 * directory users trust and one they have to guess at.
 */
export type ProviderCategory = 'apikey' | 'free' | 'free-tier' | 'local' | 'oauth'
/** Credential requirement, as declared by the registry. */
export interface ProviderAuth {
  kind: ProviderAuthKind
  /** Environment variable the provider documents for its key, when any. */
  env: string | null
  /** Where a user obtains a key, for the settings page. */
  url: string | null
}
/** One model a provider serves. */
export interface ProviderModel {
  id: string
  name: string
  /** Tokens, or null when the provider does not publish one. */
  contextWindow: number | null
  /** Whether the model accepts images. */
  vision: boolean | null
  /** Whether the model exposes a reasoning channel. */
  reasoning: boolean | null
}
/** One upstream provider, exactly as the registry declares it. */
export interface ProviderRecord {
  id: string
  name: string
  category: ProviderCategory
  auth: ProviderAuth
  /** Base URL. Empty for a provider whose endpoint is per-deployment (Azure). */
  baseUrl: string
  format: ProviderFormat
  models: readonly ProviderModel[]
  /**
   * Listing path under {@link ProviderRecord.baseUrl}, or null when the
   * provider publishes none.
   *
   * Declared by the registry rather than derived here: of the 76 records, only
   * a handful publish a listing, and several publish it OUTSIDE their base
   * (cohere, deepinfra, ollama_cloud). Guessing the path would turn "this
   * provider has no listing" into "this provider is down", which is a much worse
   * answer to give a user looking at a model picker.
   */
  modelsUrl?: string | null
  /** Source-declared transport headers, applied before the credential. */
  headers?: Readonly<Record<string, string>>
  notes?: string
  website?: string
  /** True when the endpoint is on this machine. */
  local?: boolean
  /** Provenance tag carried from the registry. */
  source?: string
}
/**
 * The registry, frozen at import so no caller can mutate shared state.
 *
 * The JSON import is typed by inference: TypeScript reads the file and gives the
 * array a structural type. It is then widened to `readonly ProviderRecord[]`
 * through a cast, because the inferred type of `contextWindow: null` is `null`
 * where the interface says `number | null` — a contravariance that no amount of
 * `satisfies` can reconcile without second-guessing the data. The cast is the
 * boundary: after it, every helper in this module sees exactly the interface.
 */
export const PROVIDERS: readonly ProviderRecord[] = Object.freeze(
  (registry as unknown as readonly ProviderRecord[]).map(
    entry => Object.freeze({ ...entry, models: Object.freeze([...(entry.models ?? [])]) }),
  ),
)
const PROVIDERS_BY_ID: ReadonlyMap<string, ProviderRecord> = new Map(
  PROVIDERS.map(provider => [provider.id, provider]),
)
/** True when the string names a provider this lane knows. */
export function isProviderId(value: string): boolean {
  return PROVIDERS_BY_ID.has(value)
}
/** One provider by id, or null. */
export function getProvider(id: string): ProviderRecord | null {
  if (typeof id !== 'string') return null
  return PROVIDERS_BY_ID.get(id) ?? null
}
/** Provider ids, in registry order. */
export function listProviderIds(): readonly string[] {
  return Object.freeze(PROVIDERS.map(provider => provider.id))
}
/** Providers, filtered by the facets the settings page offers. */
export function listProviders(filter: {
  category?: ProviderCategory
  format?: ProviderFormat
  authKind?: ProviderAuthKind
  search?: string
} = {}): readonly ProviderRecord[] {
  const needle = (filter.search ?? '').trim().toLowerCase()
  const out: ProviderRecord[] = []
  for (const provider of PROVIDERS) {
    if (filter.category !== undefined && provider.category !== filter.category) continue
    if (filter.format !== undefined && provider.format !== filter.format) continue
    if (filter.authKind !== undefined && provider.auth.kind !== filter.authKind) continue
    if (needle !== '') {
      const haystack = `${provider.id} ${provider.name} ${provider.website ?? ''}`.toLowerCase()
      if (!haystack.includes(needle)) continue
    }
    out.push(provider)
  }
  return Object.freeze(out)
}
/** The composite id this lane advertises a model under: `providerId/modelId`. */
export function providerModelId(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`
}
/** Split a composite id back into its two halves, or null. */
export function parseProviderModelId(composite: string): { providerId: string; modelId: string } | null {
  if (typeof composite !== 'string') return null
  const text = composite.trim()
  const slash = text.indexOf('/')
  if (slash <= 0) return null
  const providerId = text.slice(0, slash)
  const modelId = text.slice(slash + 1).trim()
  if (modelId === '') return null
  return { providerId, modelId }
}
/** Wire suffixes, so a URL is never assembled from a guess. */
const CHAT_PATHS: Readonly<Record<ProviderFormat, string>> = Object.freeze({
  'openai-chat': '/chat/completions',
  'openai-responses': '/responses',
  'anthropic-messages': '/messages',
})
/**
 * Headers one provider needs, with the credential attached last.
 *
 * Source-declared headers come first so the credential always wins a collision:
 * a provider that ships its own `user-agent` or an `anthropic-beta` keeps it,
 * and a key can never be overwritten by a registry typo.
 *
 * A key is only attached for `apiKey` providers. A `none` provider must NOT
 * send an authorization header (OpenCode Free rejects one), and `oauth` / `adc`
 * credentials are minted by their own flow and injected by the caller.
 */
export function defaultHeaders(provider: ProviderRecord, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(provider.headers ?? {})) headers[name.toLowerCase()] = value
  if (provider.format === 'anthropic-messages') headers['anthropic-version'] = '2023-06-01'
  headers['content-type'] = 'application/json'
  const key = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (key !== '' && provider.auth.kind === 'apiKey') {
    if (provider.format === 'anthropic-messages') headers['x-api-key'] = key
    else headers.authorization = `Bearer ${key}`
  }
  return headers
}
/** Where a completion is posted, or null when the base URL is unusable. */
export function chatEndpoint(provider: ProviderRecord): string | null {
  const base = typeof provider.baseUrl === 'string' ? provider.baseUrl.trim().replace(/\/+$/, '') : ''
  const suffix = CHAT_PATHS[provider.format]
  if (base === '' || suffix === undefined) return null
  return `${base}${suffix}`
}
/**
 * Where a provider's model listing lives, or null when it declares none.
 *
 * Only listings the registry actually names are returned. A guessed URL is
 * worse than none: the caller can always ask the provider for nothing, but
 * asking the wrong host produces a failure that reads like the provider is down.
 *
 * ABSOLUTE FIRST, RELATIVE SECOND. The registry spells `modelsUrl` as a full
 * URL (`https://opencode.ai/zen/v1/models`), not as a path under `baseUrl`
 * (`/models`). Concatenating anyway produced
 * `https://opencode.ai/zen/v1https://opencode.ai/zen/v1/models`, which is not
 * a URL at all: the host answers it from its catch-all route with 200 and an
 * HTML page, so the caller sees a successful response that will not parse and
 * reports "the listing answered HTTP 200 but its shape was not recognised".
 * A doubled URL looks exactly like a broken provider, which is why this could
 * hide behind thirty correct registry entries and still break every one of
 * them. A relative spelling is still resolved against the base, so a registry
 * that writes `/models` keeps working.
 */
export function modelsEndpoint(provider: ProviderRecord): string | null {
  const declared = typeof provider.modelsUrl === 'string' ? provider.modelsUrl.trim() : ''
  if (declared === '') return null
  // A scheme of its own: absolute, and the registry's word for where the
  // listing is. Anchored so a path like `/v1/models` is never mistaken for a
  // protocol-relative URL.
  if (/^[a-z][a-z0-9+.-]*:/iu.test(declared)) return declared
  const base = typeof provider.baseUrl === 'string' ? provider.baseUrl.trim().replace(/\/+$/, '') : ''
  if (base === '') return null
  // The relative branch is a fallback: the registry currently spells every
  // listing as an absolute URL. It joins with exactly one slash, because
  // `https://host/v1` + `models` must be `https://host/v1/models` and not
  // `https://host/v1models`.
  return `${base}${declared.startsWith('/') ? '' : '/'}${declared}`
}
/** True when the registry record declares a models endpoint. */
export function hasModelsListing(provider: ProviderRecord): boolean {
  return typeof provider.modelsUrl === 'string' && provider.modelsUrl.trim() !== ''
}
/** One provider's saved settings: on/off, its key, and any discovered models. */
export interface ProviderSetting {
  /**
   * The explicit switch. Absent means "follow the credential": a provider the
   * user has actually configured is on, and the seventy-five they have never
   * touched are off.
   *
   * The card used to draw every one of the seventy-six vendors with its switch
   * already on, which read as "everything is already in the pool" and made the
   * one vendor that WAS configured indistinguishable from the rest.
   */
  enabled?: boolean
  /**
   * The FIRST usable key, kept as the single-key spelling.
   *
   * Almost every provider needs one key, and a user pasting one must not have to
   * learn an array to do it. This field and {@link apiKeys} are kept in step by
   * `updateProviderSetting`: writing `apiKey` sets a one-entry list, and writing
   * `apiKeys` mirrors its first entry back here. Readers therefore do not have to
   * know which spelling a config file happens to hold.
   */
  apiKey?: string
  /**
   * Every key this provider may rotate through.
   *
   * The pool has always rotated accounts, but a third-party vendor could only
   * ever hold ONE key, so "account usage" (priority / round-robin / balanced …)
   * had nothing to distribute over and was not offered on those cards. A vendor
   * with several keys on one account — which is how most rate limits are actually
   * dodged — could not express that at all.
   *
   * The first entry is the preferred one; the rest are alternates in order.
   * Absent or empty means "no key configured", which is the same state `apiKey`
   * has always described.
   */
  apiKeys?: readonly string[]
  /**
   * How requests spread across those keys.
   *
   * The same five strategies the pool lane offers, and deliberately the same
   * vocabulary rather than a second set of names for one idea. Absent means
   * `priority`: use the preferred key until the vendor refuses it, then move on.
   *
   * Only meaningful when {@link apiKeys} holds more than one entry — with a single
   * key there is nothing to distribute over, which is why the card hides the row
   * in that case.
   */
  distribution?: string
  /** User override for the base URL, for providers whose host is per-deployment. */
  baseUrl?: string
  /**
   * Model ids the user chose to expose, when narrower than the whole roster.
   *
   * This is the CHOICE and nothing else. It deliberately does not hold what a
   * listing round returned: a vendor that advertises eighty-five models and whose
   * user ticks two must be able to press "Fetch models" again next month and
   * still be choosing from eighty-five, not from the two they kept. Keeping both
   * in one field made the fetch overwrite the choice and left no way back.
   *
   * An empty or absent value means "expose everything the provider offers" — see
   * `modelIdsFor`.
   */
  models?: readonly string[]
  /**
   * The full roster a listing round last returned, kept as the universe the
   * choice is drawn from.
   *
   * Never surfaced as the exposed set on its own; it exists so the card can show
   * "2 of 85 chosen" and re-widen a narrowed set after a refetch.
   */
  discovered?: readonly string[]
  addedAt?: string
}
/** The whole aggregate section of the plugin settings. */
export interface AggregateSettings {
  /** Master switch: off contributes no model rows at all. */
  enabled?: boolean
  providers?: Readonly<Record<string, ProviderSetting>>
}
/** A provider the user can configure: the record plus its saved setting. */
export interface ConfiguredProvider {
  provider: ProviderRecord
  setting: ProviderSetting
}

