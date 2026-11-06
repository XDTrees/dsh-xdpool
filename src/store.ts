/**
 * Aggregate-lane settings store: the user's own provider keys, persisted in the
 * plugin's own data directory.
 *
 * WHY A FILE AND NOT THE SETTINGS DOCUMENT
 *
 * Everything else on the card lives in the settings section, and this
 * deliberately does not. Two reasons, in order of weight:
 *
 *   1. The CLI has no settings service. The ignore list already established the
 *      pattern (`src/ignored.ts`): a plugin-owned file, atomically written, read
 *      by both halves. Two write paths for one list is how they drift apart.
 *   2. These strings are CREDENTIALS. The settings document is validated and
 *      echoed to the browser by the host's own form renderer, and every schema
 *      change would become a migration risk for the user's API keys.
 *
 * The file is re-read on EVERY call rather than cached, so a CLI edit made while
 * the card is open is picked up without a reload — the same contract
 * `ignored.ts` documents for the ignore list.
 *
 * @module dsh-xdpool/store
 */
import { readFile, rename } from 'node:fs/promises'
// The sync reader below needs `readFileSync`, and `node:fs/promises` does not
// export one. A second import from `node:fs` is the honest way to get it.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { env } from 'node:process'
import { ensureSecretDir, writeSecretFile } from './file-perms.ts'
import type { AggregateSettings, ProviderRecord, ProviderSetting } from './providers.ts'
import { getProvider, listProviderIds, PROVIDERS } from './providers.ts'
import { normalizeCombos, type ComboSetting } from './combos.ts'
/**
 * The aggregate section as it lives on disk.
 *
 * Combos live in the same file rather than a second one: they only mean
 * anything in terms of the models the providers beside them serve, so a user who
 * clears a key and leaves a chain behind would be editing a dangling reference
 * in a file that no longer explains it. One document, one delete to undo.
 *
 * The LAN relay's settings live here too, for the same "one file to delete"
 * reason and because they hold a shared secret.
 */
export type AggregateStore = AggregateSettings & {
  combos?: readonly ComboSetting[]
  relay?: RelaySetting
}
/** Bumped only if the on-disk shape ever changes incompatibly. */
const STORE_VERSION = 1
/**
 * The LAN relay's own settings.
 *
 * Stored beside the aggregate keys rather than in the settings document for the
 * same reason the keys are: this holds a credential. The relay key is shown to
 * the user once so it can be pasted into another device, and the settings
 * document is echoed to the browser by the host's own form renderer — we would
 * rather that path never carried a shared secret.
 */
export interface RelaySetting {
  enabled?: boolean
  /** Bind address; only `127.0.0.1` and `0.0.0.0` are honoured. */
  host?: string
  port?: number
  /** URL-safe shared secret LAN clients authenticate with. */
  key?: string
  /**
   * Which models the gateway may serve, by gateway id (`buddy:hy3`,
   * `qoder:qfmodel`, `free:…`, `provider/model`).
   *
   * Absent and empty are DIFFERENT answers and the distinction is load-bearing:
   * absent means "no selection has ever been made, serve everything", so
   * upgrading does not silently break a gateway a device is already pointed at;
   * empty means "the user unticked everything", and is honoured as such.
   *
   * This is an allowlist enforced on the request, not just on the listing. A
   * relay key is one value shared by every device on the LAN, so "hidden from
   * /v1/models" would leave every other lane reachable to anything that guessed
   * an id — including the login channels, whose quota is this account's.
   */
  models?: string[]
}
export interface AggregateFile {
  version: number
  enabled?: boolean
  providers?: Record<string, ProviderSetting>
  combos?: unknown
  relay?: unknown
}
/** A trimmed non-empty string, or ''. */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
/** Where the aggregate settings live; undefined when no home directory resolves. */
export function aggregateSettingsPath(): string | undefined {
  const home = env.DSH_HOME ?? homedir()
  if (typeof home !== 'string' || home === '') return undefined
  return join(home, '.xdpool', 'aggregate.json')
}
/** One provider's setting, normalised; an unknown id is dropped on read. */
function normalizeSetting(raw: unknown): ProviderSetting {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const value = raw as Record<string, unknown>
  const setting: ProviderSetting = {}
  if (typeof value.enabled === 'boolean') setting.enabled = value.enabled
  const key = text(value.apiKey)
  if (key !== '') setting.apiKey = key
  const baseUrl = text(value.baseUrl)
  if (baseUrl !== '') setting.baseUrl = baseUrl.replace(/\/+$/, '')
  if (Array.isArray(value.models)) {
    const models = stringList(value.models)
    if (models.length > 0) setting.models = models
  }
  if (Array.isArray(value.discovered)) {
    const discovered = stringList(value.discovered)
    if (discovered.length > 0) setting.discovered = discovered
  }
  const addedAt = text(value.addedAt)
  if (addedAt !== '') setting.addedAt = addedAt
  return setting
}
/** A de-duplicated list of non-empty trimmed strings from an untrusted array. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of value) {
    const id = text(raw)
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}
/**
 * Read the store.
 *
 * Never throws: a missing file is a fresh install, and a corrupt one is a
 * recoverable user mistake. A provider id the registry no longer knows is
 * dropped rather than surfaced — the roster moves, and an unknown key must not
 * become an error the card cannot clear.
 */
export async function readAggregateSettings(): Promise<AggregateStore> {
  const path = aggregateSettingsPath()
  if (path === undefined) return {}
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  return normalizeStore(parsed)
}
/** Read the store on the synchronous path; same rules, no cache. */
export function readAggregateSettingsSync(): AggregateStore {
  const path = aggregateSettingsPath()
  if (path === undefined) return {}
  try {
    return normalizeStore(JSON.parse(readFileSync(path, 'utf8')) as unknown)
  } catch {
    return {}
  }
}
/** Shape an untrusted document into the settings type, dropping unknown ids. */
export function normalizeStore(parsed: unknown): AggregateStore {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const file = parsed as Partial<AggregateFile> & Record<string, unknown>
  const store: AggregateStore = {}
  if (typeof file.enabled === 'boolean') store.enabled = file.enabled
  const providers: Record<string, ProviderSetting> = {}
  if (file.providers !== null && typeof file.providers === 'object' && !Array.isArray(file.providers)) {
    for (const [id, raw] of Object.entries(file.providers as Record<string, unknown>)) {
      if (!getProvider(id)) continue
      providers[id] = normalizeSetting(raw)
    }
  }
  if (Object.keys(providers).length > 0) store.providers = providers
  // Chains are normalised rather than rejected when malformed: a chain the
  // catalogs can no longer satisfy is a user mistake to be edited, not a reason
  // to also throw away the API keys stored beside it.
  const combos = normalizeCombos(file.combos)
  if (combos.length > 0) store.combos = combos
  const relay = normalizeRelay(file.relay)
  if (relay !== undefined) store.relay = relay
  return store
}
/**
 * The relay setting, normalised; undefined when there is nothing to remember.
 *
 * A half-written section is dropped field by field rather than rejected whole,
 * for the same reason the chains are: the relay shares this file with the API
 * keys, and one bad field must not cost the user both.
 */
function normalizeRelay(raw: unknown): RelaySetting | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  const relay: RelaySetting = {}
  if (typeof value.enabled === 'boolean') relay.enabled = value.enabled
  const host = text(value.host)
  if (host !== '') relay.host = host
  if (typeof value.port === 'number' && Number.isInteger(value.port)) relay.port = value.port
  const key = text(value.key)
  if (key !== '') relay.key = key
  // An EMPTY array is preserved on purpose: it is the user's answer ("nothing"),
  // and collapsing it to "absent" would silently re-open the whole gateway.
  // Non-string entries are dropped rather than rejected, because this file also
  // holds the API keys and one bad entry must not cost the user both.
  if (Array.isArray(value.models)) {
    relay.models = normalizeRelayModels(value.models)
  }
  return Object.keys(relay).length === 0 ? undefined : relay
}
/**
 * A shared-model list, cleaned: trimmed, de-duplicated, non-strings dropped.
 *
 * One helper for both doors into the field — reading the file and merging a
 * patch — so a list saved from the card is stored exactly as a list loaded from
 * disk would be, and the gateway cannot see two spellings of one selection.
 */
function normalizeRelayModels(raw: readonly unknown[]): string[] {
  return [...new Set(
    raw
      .map(entry => text(entry))
      .filter(entry => entry !== ''),
  )]
}
/**
 * Write the store atomically: a sibling `.tmp` first, then a rename.
 *
 * Same discipline as the ignore list. A process killed mid-write must leave
 * either the old file or the new one — half a credential file is a silent
 * credential loss, which is the one outcome worse than a failed save.
 */
export async function writeAggregateSettings(settings: AggregateStore): Promise<void> {
  const path = aggregateSettingsPath()
  if (path === undefined) throw new Error('no home directory to store the aggregate settings in')
  // Owner-only: this document holds every third-party `apiKey` the user pasted.
  // The mode goes on the TEMP file so the rename carries it across, which is the
  // whole reason the write is staged.
  await ensureSecretDir(dirname(path))
  const file: AggregateFile = { version: STORE_VERSION, ...settings }
  await writeSecretFile(`${path}.tmp`, `${JSON.stringify(file, null, 2)}\n`)
  await rename(`${path}.tmp`, path)
}
/**
 * Merge one provider's patch into the store and write it back.
 *
 * Read-modify-write, not a full overwrite: the card sends one provider per
 * request, so two tabs editing two providers must not clobber each other. An
 * `apiKey` of '' CLEARS the key rather than storing an empty string — a stored
 * empty key would read as "configured" in any view that only checks presence.
 */
export async function updateProviderSetting(
  providerId: string,
  patch: Partial<ProviderSetting>,
): Promise<AggregateStore> {
  const provider = getProvider(providerId)
  if (provider === null) throw new Error(`unknown provider: ${providerId}`)
  const current = await readAggregateSettings()
  const providers = { ...current.providers }
  const before = providers[providerId] ?? {}
  const after: ProviderSetting = { ...before }
  if (patch.enabled !== undefined) after.enabled = patch.enabled
  if (patch.baseUrl !== undefined) {
    const baseUrl = text(patch.baseUrl).replace(/\/+$/, '')
    if (baseUrl === '') delete after.baseUrl
    else after.baseUrl = baseUrl
  }
  if (patch.apiKey !== undefined) {
    const key = text(patch.apiKey)
    if (key === '') delete after.apiKey
    else after.apiKey = key
  }
  if (patch.models !== undefined) {
    const models = stringList(patch.models)
    if (models.length === 0) delete after.models
    else after.models = models
  }
  if (patch.discovered !== undefined) {
    const discovered = stringList(patch.discovered)
    if (discovered.length === 0) delete after.discovered
    else after.discovered = discovered
  }
  // The first time a provider is touched it is stamped, so the settings page can
  // show when it joined without asking the user to fill in a date.
  if (after.addedAt === undefined) after.addedAt = new Date().toISOString()
  // A provider that ends up carrying nothing but its timestamp is REMOVED
  // instead of stored as a near-empty object. `configuredProviderIds` is what
  // the card's "已接入" list reads, and a key the user cleared would otherwise
  // keep its row on screen forever — the same failure as a removed account
  // staying in the pool.
  const meaningful = Object.keys(after).filter(key => key !== 'addedAt')
  if (meaningful.length === 0) delete providers[providerId]
  else providers[providerId] = after
  const next: AggregateStore = { ...current, providers }
  await writeAggregateSettings(next)
  return next
}
/** Remove one provider's setting entirely (the card's "forget this key"). */
export async function clearProviderSetting(providerId: string): Promise<AggregateStore> {
  const current = await readAggregateSettings()
  const providers = { ...current.providers }
  delete providers[providerId]
  const next: AggregateStore = { ...current, providers }
  if (Object.keys(providers).length === 0) delete next.providers
  await writeAggregateSettings(next)
  return next
}
/** Flip the lane's own master switch. */
export async function setAggregateEnabled(enabled: boolean): Promise<AggregateStore> {
  const current = await readAggregateSettings()
  const next: AggregateStore = { ...current, enabled }
  await writeAggregateSettings(next)
  return next
}
/**
 * Replace the whole chain list.
 *
 * Whole-list replacement rather than per-chain patches, because the card edits
 * chains as units (add a member, flip a strategy, delete the row) and a partial
 * merge would have to invent rules for "the user removed a member" — which is
 * indistinguishable from "the user removed the chain" once the ids are the same.
 * The list is normalised on the way in, so a chain the catalogs can never serve
 * is simply not written back.
 */
export async function saveCombos(raw: unknown): Promise<AggregateStore> {
  const current = await readAggregateSettings()
  const combos = normalizeCombos(raw)
  const next: AggregateStore = { ...current }
  if (combos.length === 0) delete next.combos
  else next.combos = combos
  await writeAggregateSettings(next)
  return next
}
/** The stored chains, normalised; empty when the file has none. */
export function combosOf(store: AggregateStore): ComboSetting[] {
  return normalizeCombos(store.combos)
}
/** The stored relay section, normalised; undefined when unset. */
export function relayOf(store: AggregateStore): RelaySetting | undefined {
  return store.relay
}
/**
 * Merge a relay patch and write it back.
 *
 * `key` of '' CLEARS the key rather than storing an empty string: an empty key
 * reads as "configured" in any view that only checks presence, and a relay with
 * no key must refuse every request rather than accept them.
 */
export async function updateRelaySetting(patch: Partial<RelaySetting>): Promise<AggregateStore> {
  const current = await readAggregateSettings()
  const before = current.relay ?? {}
  const after: RelaySetting = { ...before }
  if (patch.enabled !== undefined) after.enabled = patch.enabled
  if (patch.host !== undefined) {
    const host = text(patch.host)
    if (host === '') delete after.host
    else after.host = host
  }
  if (patch.port !== undefined) {
    const port = patch.port
    // Three distinct cases, deliberately not one range check. A port out of
    // range is a typo and is IGNORED, so one bad field cannot move the listener
    // away from the address the user configured; `0` is not a typo but the card's
    // "forget my settings" value and CLEARS the field, which drops back to the
    // default rather than to whatever it happened to be before.
    if (Number.isInteger(port) && port > 0 && port < 65_536) after.port = port
    else if (port === 0) delete after.port
  }
  if (patch.key !== undefined) {
    const key = text(patch.key)
    if (key === '') delete after.key
    else after.key = key
  }
  if (patch.models !== undefined) {
    // Stored as written, INCLUDING `[]`: an empty list is the user unticking
    // everything, and the gateway reads the same absent-vs-empty rule back. An
    // absent field leaves the stored list alone, so a save of the address or the
    // key never reopens a closed gateway.
    after.models = normalizeRelayModels(patch.models)
  }
  const next: AggregateStore = { ...current }
  // A section that carries nothing is removed instead of saved as `{}`: the card
  // reads presence to decide whether the relay has ever been configured, and an
  // empty object would leave that row on screen forever.
  if (Object.keys(after).length === 0) delete next.relay
  else next.relay = after
  await writeAggregateSettings(next)
  return next
}
/** One provider's saved setting, or `{}`. */
export function providerSettingOf(store: AggregateStore, providerId: string): ProviderSetting {
  const setting = store.providers?.[providerId]
  return setting ?? {}
}
/**
 * Whether a provider could serve a model right now.
 *
 * Keyless and local providers are usable with nothing configured; `oauth` and
 * `adc` never are, because their tokens are minted by a sign-in flow this lane
 * does not drive — and `defaultHeaders` would not even attach a pasted key, so
 * the row would be a guaranteed 401.
 */
export function providerAuthUsable(provider: ProviderRecord, setting: ProviderSetting): boolean {
  if (provider.auth.kind === 'oauth' || provider.auth.kind === 'adc') return false
  if (provider.auth.kind === 'apiKey') return text(setting.apiKey) !== ''
  return true
}
/**
 * Whether a provider contributes models right now.
 *
 * An explicit flag always wins — that is the user's own decision and nothing
 * overrides it. With no flag the answer is NO, for every vendor, with one
 * deliberate exception: pasting a key IS the act of opting in, so a provider
 * holding a usable key counts as on.
 *
 * This replaced "absent means on", which drew the whole seventy-six-vendor
 * roster with every switch already flipped. The user asked for the opposite:
 * the rows are a directory of vendors to CHOOSE from, and a page where
 * everything looks enabled says nothing about what is actually configured —
 * the one vendor that was set up looked exactly like the seventy-five that
 * were not. A keyless vendor stays off too, because "needs no credential" is
 * not the same as "belongs in my pool"; `opencode` alone would otherwise drop
 * seventy-four models into the picker for someone who never asked for them.
 */
export function providerEnabled(provider: ProviderRecord, setting: ProviderSetting): boolean {
  if (setting.enabled !== undefined) return setting.enabled
  return provider.auth.kind === 'apiKey' && providerAuthUsable(provider, setting)
}
/** Every provider with its state, in registry order; the settings page's list. */
export function listProviderStates(store: AggregateStore): {
  provider: ProviderRecord
  setting: ProviderSetting
  usable: boolean
}[] {
  const out: { provider: ProviderRecord; setting: ProviderSetting; usable: boolean }[] = []
  for (const provider of PROVIDERS) {
    const setting = providerSettingOf(store, provider.id)
    out.push({ provider, setting, usable: providerAuthUsable(provider, setting) })
  }
  return out
}
/** Provider ids the user has actually configured, in registry order. */
export function configuredProviderIds(store: AggregateStore): string[] {
  const known = new Set<string>(store.providers ? Object.keys(store.providers) : [])
  const out: string[] = []
  for (const id of listProviderIds()) if (known.has(id)) out.push(id)
  return out
}