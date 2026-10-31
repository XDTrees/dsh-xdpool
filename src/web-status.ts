/**
 * Same-origin routes backing the XD Pool settings card.
 *
 * These answer loopback browser requests only and never carry token material
 * (no access/refresh tokens, no uin). Read-only by default — the status route
 * is a GET; the card's rescan and cooldown-reset actions are explicit POSTs.
 * The one mutating route is the daily check-in claim, which is guarded by an
 * explicit per-account `accountId` and a pre-claim status re-check.
 *
 * Mounted on the Host's `webServer` (same-origin as the DSH settings UI) via
 * `ctx.inject(['webServer'], ...)` in `apply`. Because `webServer` is an
 * optional service, a headless profile without it simply never mounts these
 * routes and the card degrades to an offline banner — the provider keeps
 * serving models regardless.
 *
 * @module dsh-xdpool/web-status
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { WorkBuddyAccount, WorkBuddyAccountPool } from './accounts.ts'
import type { WorkBuddyCatalog } from './catalog.ts'
import { isGatewayRejectionError, regionOf, type WorkBuddyUpstreamClient } from './upstream.ts'
import type { WorkBuddyShim } from './shim.ts'
import type { UsageSummary } from './stats.ts'
import { isAutomationJobKind, type AutomationRunSummary, type AutomationStatus } from './scheduler.ts'
import { hasModelsListing, isProviderId } from './providers.ts'
import { PROVIDER_NOTES_ZH } from './provider-notes-zh.ts'
import { listProviderStates, providerEnabled, type AggregateStore } from './store.ts'
import { modelChoicesFor } from './aggregate.ts'
import { isFreeLane } from './free-catalog.ts'
import {
  POOL_ACCOUNT_DISABLE_PATH,
  POOL_ACCOUNT_IGNORE_PATH,
  POOL_ACCOUNT_PREFER_PATH,
  POOL_AGGREGATE_DISCOVER_PATH,
  POOL_AGGREGATE_PATH,
  POOL_AGGREGATE_SAVE_PATH,
  POOL_AGGREGATE_TEST_PATH,
  POOL_AUTOMATION_RUN_PATH,
  POOL_CATALOG_REFRESH_PATH,
  POOL_CREDIT_RESERVE_PATH,
  POOL_CHANNELS_PATH,
  POOL_CHANNEL_MODELS_PATH,
  POOL_CHECKIN_PATH,
  POOL_COMBOS_PATH,
  POOL_COMBOS_SAVE_PATH,
  POOL_RELAY_PATH,
  POOL_MODELS_SAVE_PATH,
  POOL_MODEL_PROBE_PATH,
  POOL_RESET_COOLDOWN_PATH,
  POOL_RESCAN_PATH,
  POOL_STATUS_PATH,
  POOL_USAGE_PATH,
  type PoolWebAccount,
  type PoolWebAccountToggle,
  type PoolWebAccountIgnore,
  type PoolWebAccountPrefer,
  type PoolWebAutomationJob,
  type PoolWebCreditReserve,
  type PoolWebAutomationRun,
  type PoolWebCheckin,
  type PoolWebModel,
  type PoolWebModelSelection,
  type PoolWebStatus,
  type PoolWebIgnoredAccount,
  type PoolWebCatalogSource,
  type PoolRegion,
  type PoolWebAggregatePatch,
  type PoolWebAggregateProbe,
  type PoolWebAggregateProvider,
  type PoolWebAggregateStatus,
  type PoolWebChannelModel,
  type PoolWebChannelsStatus,
  type PoolWebCombo,
  type PoolWebComboCandidate,
  type PoolWebCombosStatus,
  type PoolWebModelProbe,
  type PoolWebModelProbeResult,
  type PoolWebRelayPatch,
  type PoolWebRelayStatus,
} from './status-paths.ts'
/**
 * One aggregate model row as the card renders it.
 *
 * A local alias rather than an inline type so `aggregateStatusOf` and the host
 * half that builds the same document cannot drift: both spell the row once, and
 * a new field added to the aggregate row has to appear in one place.
 */
type PoolWebAggregateModelRow = PoolWebAggregateStatus['models'][number]
export { POOL_ACCOUNT_DISABLE_PATH, POOL_CHECKIN_PATH, POOL_MODELS_SAVE_PATH, POOL_RESET_COOLDOWN_PATH, POOL_RESCAN_PATH, POOL_STATUS_PATH }
export type { PoolWebStatus }
/** Constructor dependencies — a narrow slice of the pool runtime. */
export interface PoolStatusRouteOptions {
  pool: WorkBuddyAccountPool
  /** One catalog per region; the card reads the one for its active tab. */
  catalogs: Readonly<Record<PoolRegion, WorkBuddyCatalog>>
  client: WorkBuddyUpstreamClient
  /** Lazily resolve the running loopback shim, when it has bound a port. */
  shim?: () => { running: boolean; baseUrl?: string }
  /**
   * The daily-points automation, when the host half has one.
   *
   * Optional so these routes still mount on a profile that assembled a pool
   * without a scheduler (the CLI and the tests do exactly that); the card then
   * reports the automation as off instead of showing a broken panel.
   */
  scheduler?: () => AutomationStatus
  /**
   * Start a manual pass, for the card's "run now" button.
   *
   * Returns whether a run STARTED, not its result: a pass takes tens of
   * seconds, so it runs in the background and the card polls the scheduler
   * status for progress and earnings.
   */
  runAutomation?: (job: string, force: boolean) => boolean
  /**
   * Persist one account's reserved-credit floor. Same settings document as every
   * other card write, so it survives a restart and is re-applied after a scan.
   * Absent without a settings service: the route then answers 503.
   */
  setCreditReserve?: (accountId: string, reserve: number) => Promise<void> | void
  /**
   * Persist the user's model selection. Provided by the host half, which owns
   * the settings section; absent when the plugin runs without a settings
   * service (the save route then reports 503 rather than pretending to work).
   */
  /**
   * Persist one region's selection. The region travels with the payload: the two
   * gateways advertise different rosters, so the domestic tab and the
   * international tab each own their list and must never overwrite each other.
   */
  saveSelection?: (region: PoolRegion, selection: PoolWebModelSelection) => Promise<void> | void
  /**
   * Persist one account switch. Same settings document as every other card
   * write, so it survives a restart and is re-applied after each re-scan.
   * Absent without a settings service: the route then answers 503.
   */
  setAccountDisabled?: (accountId: string, disabled: boolean) => Promise<void> | void
  /**
   * Throw one account out of the pool for good, or take it back.
   *
   * Backed by the plugin's own ignore file rather than the settings document,
   * because the CLI writes the same list and has no settings service. Absent
   * when the host did not wire it: the route then answers 503.
   */
  setAccountIgnored?: (accountId: string, ignored: boolean) => Promise<void> | void
  /**
   * Name the account to try first, or clear the pin with a null id.
   *
   * Backed by the plugin's own preferred-account file rather than the settings
   * document, for the same reason as {@link setAccountIgnored}: the CLI's
   * `prefer` command writes the same file and has no settings service, so a
   * settings-backed pin would only ever be writable from the card.
   *
   * Called by the handler and required to have taken effect in the pool before
   * it resolves: the card re-polls straight after, and a pin that is persisted
   * but not yet visible in the pool would make the next request ignore the
   * choice the user just made. Absent when the host did not wire it: the route
   * then answers 503.
   */
  setPreferredAccount?: (accountId: string | null) => Promise<void> | void
  /**
   * The accounts currently ignored, for the card's "ignored" list.
   *
   * A thunk rather than a snapshot so the document always reflects the file on
   * disk, including edits made by the CLI while the card is open.
   */
  ignoredAccounts?: () => readonly PoolWebIgnoredAccount[]
  /**
   * Re-fetch the model catalog for BOTH regions and report what landed.
   *
   * Absent when the host did not wire it: the route then answers 503 rather
   * than pretending the refresh happened.
   */
  refreshCatalog?: () => Promise<{
    regions: Readonly<Record<PoolRegion, { source: PoolWebCatalogSource; models: number; error?: string }>>
  }>
  /**
   * The usage panel's aggregate, produced by whatever served the calls.
   *
   * A thunk rather than a snapshot so the panel always sees the newest calls,
   * and optional because a profile assembled without a recorder still serves
   * chat normally - it simply has no usage to show, and the route reports that
   * instead of pretending the panel is broken.
   */
  usage?: () => UsageSummary
  /**
   * The aggregate lane's stored settings, for the read route.
   *
   * A thunk rather than a snapshot so the document always reflects the file on
   * disk, including a CLI edit made while the card is open — the same contract
   * `ignoredAccounts` documents for the ignore list.
   */
  aggregateStore?: () => AggregateStore
  /**
   * The whole aggregate document, built host-side.
   *
   * One dep instead of `aggregateStore` plus a model count because the two must
   * be read together: the store says which providers are configured, and the
   * running catalog says which rows that actually produces. Two separate reads
   * could straddle a save and show a provider as configured with no rows.
   */
  aggregateDocument?: () => Promise<PoolWebAggregateStatus> | PoolWebAggregateStatus
  /**
   * Save one aggregate patch and return the document the card should re-read.
   *
   * The HOST half owns the write because it is the only side that also knows how
   * to refresh the running catalog: a key saved on the card has to change the
   * model picker without a DSH restart, which is the whole point of the card.
   */
  saveAggregate?: (patch: PoolWebAggregatePatch) => Promise<PoolWebAggregateStatus>
  /**
   * Verify one provider's key. Never throws: the answer is what the card shows.
   */
  probeAggregate?: (providerId: string) => Promise<PoolWebAggregateProbe>
  /**
   * Send one real streaming call and report whether the model answered.
   *
   * Never throws: the measurement is the answer, and a probe that rejected
   * would leave the button spinning forever instead of telling the user what
   * went wrong.
   *
   * The HOST half owns this because only the host can reach `ctx.llm.stream`,
   * which is the one surface that resolves a provider/model pair through the
   * real adapter registry — the plugin's own lanes do not know which credential
   * a given provider id ends up using.
   */
  probeModel?: (provider: string, model: string, signal?: AbortSignal) => Promise<PoolWebModelProbeResult>
  /**
   * What models each login channel contributes, as the host's catalogue spells it.
   *
   * Optional because a build without a login-channel pack genuinely cannot answer
   * — the route reports that rather than pretending every channel is empty.
   * Providers the host cannot answer for are omitted from the returned record;
   * see {@link PoolWebChannelModels} for why that distinction is load-bearing.
   */
  channelModels?: (
    providers: readonly string[],
    ids?: Readonly<Record<string, readonly string[]>>,
  ) => Promise<Readonly<Record<string, readonly PoolWebChannelModel[]>>>
  /**
   * Fetch one provider's live model list, write it back as its discovered set,
   * and refresh the catalog.
   */
  discoverAggregate?: (providerId: string) => Promise<PoolWebAggregateProbe>
  /**
   * The login-channel list, built host-side.
   *
   * `state` is the load-bearing part: a card that silently rendered an empty
   * channel list would look exactly like "this host has no channels", which is
   * the one conclusion the user cannot verify for themselves.
   */
  channelsDocument?: () => PoolWebChannelsStatus
  /**
   * The chains plus the roster their members are drawn from, built host-side.
   *
   * One dep because the two halves are the same question asked twice — "what can
   * a chain name, and does what it names still exist" — and answering them from
   * two snapshots could show a member that the chains no longer resolve.
   */
  combosDocument?: () => PoolWebCombosStatus
  /**
   * Replace the chain table and refresh the running catalog, then re-answer the
   * document. The catalog refresh is what makes a new chain pickable at once.
   */
  saveCombos?: (raw: unknown) => Promise<PoolWebCombosStatus>
  /**
   * The relay's current state, or undefined when this build has no relay.
   *
   * Reading the key back out of here is deliberate — the card has to show it so
   * the user can paste it into another device — but it is the RELAY key, which
   * the plugin minted for LAN clients. The shim's own per-process secret is never
   * exposed by any route.
   */
  relayDocument?: () => Promise<PoolWebRelayStatus>
  /** Apply a relay patch, re-evaluate the listener, and answer with the new state. */
  saveRelay?: (patch: PoolWebRelayPatch) => Promise<PoolWebRelayStatus>
}
/** Redact token-like content before it crosses to the browser. */
/**
 * A zeroed-out automation job record.
 *
 * Used when no scheduler is wired: the card renders the same shape either way,
 * so an unwired profile shows zeroes rather than a missing panel.
 */
function emptyAutomationJob(): PoolWebAutomationJob {
  return { ok: 0, failed: 0, credit: 0, energy: 0, claimed: 0 }
}
function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[redacted token]')
    .replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, '$1[redacted]')
    .slice(0, 500)
}
function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}
/** Loopback browser origins only; other devices are refused. */
function loopbackOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}
/** Smallest possible POST body reader, capped so a hung or oversized body
 *  cannot pin memory on the Host. Returns `{}` for an empty body. */
function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const LIMIT = 64 * 1024
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > LIMIT) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') {
        resolve({})
        return
      }
      try {
        const parsed: unknown = JSON.parse(text)
        resolve(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : {})
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}
/**
 * Validate an untrusted selection payload.
 *
 * Returns undefined for anything malformed so the route answers 400 instead of
 * writing a partial selection into the settings file. An empty array is
 * meaningful (`enabledModelIds: []` disables every model, and the card blocks
 * saving that state) so it is preserved rather than treated as absent.
 */
function parseSelection(body: Record<string, unknown>): PoolWebModelSelection | undefined {
  const out: { enabledModelIds?: string[]; imageModelIds?: string[]; contextBudgets?: Record<string, number> } = {}
  for (const key of ['enabledModelIds', 'imageModelIds'] as const) {
    const value = body[key]
    if (value === undefined) continue
    if (!Array.isArray(value)) return undefined
    const ids: string[] = []
    for (const entry of value) {
      if (typeof entry !== 'string' || entry === '') return undefined
      ids.push(entry)
    }
    out[key] = ids
  }
  const budgets = body['contextBudgets']
  if (budgets !== undefined) {
    if (typeof budgets !== 'object' || budgets === null || Array.isArray(budgets)) return undefined
    const map: Record<string, number> = {}
    for (const [id, raw] of Object.entries(budgets as Record<string, unknown>)) {
      if (id === '') return undefined
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1000) return undefined
      map[id] = raw
    }
    out.contextBudgets = map
  }
  return out
}
/**
 * Validate the account-toggle body. Returns undefined for anything malformed so
 * the route answers 400 instead of writing a half-applied switch.
 *
 * The id must name a currently known account: accepting an arbitrary string
 * would let a stale tab (or a renamed credential) leave orphan ids in the
 * settings file that no card can ever switch back off.
 */
function parseAccountToggle(
  body: Record<string, unknown>,
  known: (id: string) => boolean,
): PoolWebAccountToggle | undefined {
  const accountId = typeof body['accountId'] === 'string' ? body['accountId'].trim() : ''
  const disabled = body['disabled']
  if (accountId === '' || typeof disabled !== 'boolean') return undefined
  if (!known(accountId)) return undefined
  return { accountId, disabled }
}
/**
 * Validate an ignore/unignore request.
 *
 * Two different notions of "known" apply, which is why the caller passes both:
 *
 * - ignoring requires the account to be IN THE POOL, because the card can only
 *   name an account it was just shown;
 * - un-ignoring requires the account to be ON THE IGNORE LIST instead — by
 *   definition it is not in the pool any more, so checking the pool would make
 *   the undo button impossible to use.
 */
function parseAccountIgnore(
  body: Record<string, unknown>,
  knownInPool: (id: string) => boolean,
  knownIgnored: (id: string) => boolean,
): PoolWebAccountIgnore | undefined {
  const accountId = typeof body['accountId'] === 'string' ? body['accountId'].trim() : ''
  const ignored = body['ignored']
  if (accountId === '' || typeof ignored !== 'boolean') return undefined
  if (ignored ? !knownInPool(accountId) : !knownIgnored(accountId)) return undefined
  return { accountId, ignored }
}
/**
 * Validate a pin/clear request.
 *
 * Pinning requires the account to be in the pool, for the same reason the
 * disable route checks: an id nothing can show must not end up in the file,
 * where it would silently outlive the account it named and quietly override
 * nothing. Clearing is deliberately NOT checked against anything — there is no
 * state that could make "stop preferring" wrong, and requiring one would leave a
 * user with a stale pin (an account they ignored) unable to clear it from the
 * card, which is the one failure mode a pin must never have.
 *
 * `accountId: null` is the clear request; an empty or whitespace-only string is
 * rejected rather than normalised, because a client that sends `""` almost
 * certainly built the id wrong, and quietly reading it as "clear" would hide
 * that bug behind a button that appears to work.
 */
function parseAccountPrefer(
  body: Record<string, unknown>,
  knownInPool: (id: string) => boolean,
): PoolWebAccountPrefer | undefined {
  const raw = body['accountId']
  if (raw === null) return { accountId: null }
  if (typeof raw !== 'string') return undefined
  const accountId = raw.trim()
  if (accountId === '' || !knownInPool(accountId)) return undefined
  return { accountId }
}
/**
 * Validate a model-probe request.
 *
 * Both ids are checked for emptiness and trimmed, but NOT against a roster.
 * That is a deliberate difference from the account routes above: a probe's
 * whole job is to answer "does this exact pair work", and the pair may well be
 * one the picker has not published yet — a model the user is about to enable,
 * or one a lane fetched after this page loaded. Refusing to test ids we have
 * never heard of would make the button useless exactly when it is most needed,
 * and there is nothing to protect here that a bad id could damage: the call
 * either answers or fails, and it costs what the user chose to spend by
 * clicking.
 */
function parseModelProbe(body: Record<string, unknown>): PoolWebModelProbe | undefined {
  const provider = typeof body['provider'] === 'string' ? body['provider'].trim() : ''
  const model = typeof body['model'] === 'string' ? body['model'].trim() : ''
  if (provider === '' || model === '') return undefined
  return { provider, model }
}
/**
 * Read the provider list out of a channel-models request.
 *
 * Capped at a length a login page can plausibly ask for — thirteen rows — so a
 * loopback caller cannot turn a status read into a thousand-iteration walk of
 * the host's adapter registry. Empty is valid: a page with nothing signed in has
 * no rows to ask about.
 */
/**
 * How many providers one channel-models request may ask about.
 *
 * The roster is thirteen rows; a page that wants more than a dozen is not this
 * page, and the route walks the host's adapter registry once per id.
 */
const MAX_CHANNEL_MODEL_PROVIDERS = 32
/**
 * How many ids one provider may hint at.
 *
 * Cline publishes 492 and is the widest roster here, so this is a ceiling on a
 * runaway body rather than a limit anyone will meet. Over the cap the tail is
 * dropped, not the request: the first N rows still get their figures.
 */
const MAX_CHANNEL_MODEL_IDS = 2_000
function parseProviderList(body: Record<string, unknown>): readonly string[] | undefined {
  const raw = body['providers']
  if (!Array.isArray(raw)) return undefined
  if (raw.length > MAX_CHANNEL_MODEL_PROVIDERS) return undefined
  const out: string[] = []
  for (const entry of raw) {
    // A non-string entry rejects the whole request rather than being skipped.
    // Silently dropping it would answer "these channels have no models" for a
    // body that was never a valid roster, and the page would draw that as
    // "nothing is signed in" -- a state the user cannot get out of.
    if (typeof entry !== 'string') return undefined
    const trimmed = entry.trim()
    // Duplicates are dropped rather than rejected: asking twice about the same
    // provider is harmless, and refusing it would make a caller that merges two
    // lists fail for a reason the user cannot see.
    if (trimmed !== '' && !out.includes(trimmed)) out.push(trimmed)
  }
  return out
}
/**
 * Parse the optional per-provider id hint.
 *
 * Deliberately lenient, unlike {@link parseProviderList}: this field is an
 * optimisation, not the question being asked. A malformed hint has to degrade
 * to "resolve facts the slow way" rather than fail the request, because the
 * caller already has the ids on screen and losing them would take the card's
 * numbers away for a reason that has nothing to do with the numbers.
 */
function parseChannelModelIds(body: Record<string, unknown>): Readonly<Record<string, readonly string[]>> | undefined {
  const raw = body['ids']
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, readonly string[]> = {}
  for (const [provider, listed] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(listed)) continue
    const ids = listed
      .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      .map((id) => id.trim())
      .slice(0, MAX_CHANNEL_MODEL_IDS)
    if (ids.length > 0) out[provider] = ids
  }
  return Object.keys(out).length === 0 ? undefined : out
}

/**
 * Parse a manual-run request.
 *
 * The job name is checked against the real job list rather than passed through:
 * an unknown name would otherwise reach the scheduler and silently do nothing,
 * which reads to the user as a broken button.
 */
/**
 * Parse a reserved-credit update.
 *
 * The account must already be known, for the same reason the disable route
 * checks: an unknown id would sit in the settings file forever, attached to
 * nothing the card can act on. A negative or non-finite floor is rejected
 * rather than coerced.
 */
function parseCreditReserve(
  body: Record<string, unknown>,
  known: (id: string) => boolean,
): PoolWebCreditReserve | undefined {
  const accountId = typeof body['accountId'] === 'string' ? body['accountId'].trim() : ''
  const raw = body['reserve']
  if (accountId === '' || typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return undefined
  if (!known(accountId)) return undefined
  return { accountId, reserve: Math.floor(raw) }
}
function parseAutomationRun(body: Record<string, unknown>): PoolWebAutomationRun | undefined {
  const job = typeof body['job'] === 'string' ? body['job'].trim() : ''
  // 'all' runs the whole ordered pass, which is what the single button means.
  if (job !== 'all' && !isAutomationJobKind(job)) return undefined
  const force = body['force']
  if (force !== undefined && typeof force !== 'boolean') return undefined
  return { job, ...force === undefined ? {} : { force } }
}
/**
 * One aggregate save payload, or null when the body says nothing this lane
 * understands.
 *
 * Deliberately narrow: an id the registry does not know, a patch carrying no
 * field at all, and a lane switch without a boolean are all rejected rather than
 * coerced. A card that cannot name a provider must not be able to create one.
 */
function parseAggregatePatch(body: Record<string, unknown>): PoolWebAggregatePatch | undefined {
  const kind = trimmed(body['kind'])
  if (kind === 'lane') {
    if (typeof body['enabled'] !== 'boolean') return undefined
    return { kind: 'lane', enabled: body['enabled'] }
  }
  if (kind === 'clear') {
    const providerId = trimmed(body['providerId'])
    return isProviderId(providerId) ? { kind: 'clear', providerId } : undefined
  }
  if (kind !== 'provider') return undefined
  const providerId = trimmed(body['providerId'])
  if (!isProviderId(providerId)) return undefined
  const patch: { kind: 'provider'; providerId: string; enabled?: boolean; apiKey?: string; baseUrl?: string; models?: readonly string[] } = {
    kind: 'provider',
    providerId,
  }
  if (typeof body['enabled'] === 'boolean') patch.enabled = body['enabled']
  // An empty key is a CLEARING action, not an empty value — see
  // `updateProviderSetting`, which drops the field rather than storing `''`.
  if (typeof body['apiKey'] === 'string') patch.apiKey = body['apiKey']
  if (typeof body['baseUrl'] === 'string') patch.baseUrl = body['baseUrl']
  // The chosen model set. It is accepted as an array of strings and normalised
  // here — trimmed, de-duplicated, empties dropped — because this body arrives
  // from the browser and a stored roster with blank entries would later be
  // rendered as a row that cannot be selected. An empty array survives as an
  // empty array: it means "fall back to the discovered listing", which is a real
  // choice the card offers, so it must not be confused with "field absent".
  if (Array.isArray(body['models'])) {
    const seen = new Set<string>()
    const models: string[] = []
    for (const raw of body['models']) {
      if (typeof raw !== 'string') continue
      const id = raw.trim()
      if (id === '' || seen.has(id)) continue
      seen.add(id)
      models.push(id)
    }
    patch.models = models
  }
  // A patch that changes nothing would still write a timestamp, which is how a
  // provider ends up listed as "configured" with no key. Require one real field.
  if (patch.enabled === undefined && patch.apiKey === undefined && patch.baseUrl === undefined && patch.models === undefined) return undefined
  return patch
}
/** A trimmed non-empty string, or ''. */
function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
/** One provider id from a probe or discover body, or undefined. */
function parseProviderId(body: Record<string, unknown>): string | undefined {
  const providerId = trimmed(body['providerId'])
  return isProviderId(providerId) ? providerId : undefined
}
/**
 * Build the document the aggregate card renders from one store read.
 *
 * The provider rows NEVER carry the key — only whether one is present. That is
 * what lets the whole registry travel to the browser without turning the status
 * route into a credential endpoint, and it is why this function reads the store
 * rather than serialising it.
 *
 * Host-side rather than shared with the card, because building it needs the
 * running catalog's rows, which the browser half has no way to see.
 */
export function aggregateStatusOf(
  store: AggregateStore,
  models: readonly PoolWebAggregateModelRow[],
): PoolWebAggregateStatus {
  const providers: PoolWebAggregateProvider[] = []
  let configured = 0
  for (const { provider, setting, usable } of listProviderStates(store)) {
    const universe = modelChoicesFor(provider, setting)
    // The keyless free vendors — OpenCode's free pool and the plugin's own免密
    // lane — advertise far more than they serve for free, so a brand-new
    // connection must NOT default to the entire universe ticked. They start
    // unselected; the user ticks the free models they actually want, which is the
    // same default the account pool already uses.
    const freeByDefault = isFreeLane(provider.id) || provider.id === 'opencode'
    const exposed = (setting.models ?? (freeByDefault ? [] : universe)).filter(id => universe.includes(id))
    if (Object.keys(setting).length > 0) configured += 1
    providers.push({
      id: provider.id,
      name: provider.name,
      category: provider.category,
      authKind: provider.auth.kind,
      format: provider.format,
      ...provider.auth.url === null ? {} : { authUrl: provider.auth.url },
      ...provider.website === undefined ? {} : { website: provider.website },
      // `usable` is the registry's own verdict, not the switch: a provider whose
      // credential flow this lane cannot drive is listed and explained rather
      // than hidden, because "why is my provider missing" is the question the
      // card has to answer.
      supported: provider.auth.kind !== 'oauth' && provider.auth.kind !== 'adc',
      configured: usable,
      // The same predicate the catalog uses to decide whether this vendor
      // contributes rows, so the switch the card draws cannot disagree with the
      // picker. It is NOT `setting.enabled !== false`: an absent flag means off
      // for every vendor the user has not configured, which is the whole point
      // of the roster reading as a directory.
      enabled: providerEnabled(provider, setting),
      // The vendor's own one-line description, straight from the registry. It is
      // the only prose in the whole document — there is no per-model blurb to
      // travel with, so the row's small print is the vendor's, not a model's.
      ...provider.notes === undefined ? {} : { notes: PROVIDER_NOTES_ZH[provider.id] ?? provider.notes },
      ...trimmed(setting.baseUrl) === '' ? {} : { baseUrl: trimmed(setting.baseUrl) },
      hasListing: hasModelsListing(provider),
      // A record that declares no models (`custom`, Azure, the local servers)
      // cannot offer a chooser: the card draws one over `availableModels`, and
      // that list is empty until the user names an id. This is the flag that
      // says the ids are the user's.
      manualModels: provider.models.length === 0,
      models: exposed,
      // The whole roster, so the card can offer a checkbox for every id the
      // provider offers rather than only the exposed ones. Without this the
      // chooser could only ever narrow the selection, never widen it back.
      availableModels: universe,
      // True when the exposed set came from a live listing rather than the
      // registry — i.e. the user narrowed a fetched roster, or never narrowed at
      // all and is simply serving what the fetch returned.
      discovered: (setting.discovered?.length ?? 0) > 0,
      ...setting.addedAt === undefined ? {} : { addedAt: setting.addedAt },
    })
  }
  return {
    enabled: store.enabled !== false,
    configured,
    // The lane-wide model count is read from the running catalog's rows, not
    // from the provider rows summed here: the catalog is what the picker
    // actually serves, and a provider whose credential is missing contributes
    // nothing even though its row is on screen.
    modelCount: models.length,
    models,
    providers,
  }
}
function toWebAccount(account: WorkBuddyAccount, disabled: boolean, preferred: boolean, reserve: number, reserved: boolean): PoolWebAccount {
  const now = Date.now()
  const cooling = account.cooldownUntilMs > now
  const deadUntil = account.credentialDeadUntilMs ?? 0
  const credentialDead = deadUntil > now
  const modelCooldowns = Object.entries(account.modelCooldowns)
    .filter(([, until]) => until > now)
    .sort((a, b) => a[1] - b[1])
    .map(([modelId, until]) => ({ modelId, until: new Date(until).toISOString() }))
  return {
    id: account.id,
    label: account.label,
    ...account.credential.nickname === undefined ? {} : { nickname: account.credential.nickname },
    domain: account.credential.domain,
    ...account.credential.expiresAtMs === 0
      ? {}
      : { expiresAt: new Date(account.credential.expiresAtMs).toISOString() },
    cooling,
    ...cooling ? { cooldownUntil: new Date(account.cooldownUntilMs).toISOString() } : {},
    credentialDead,
    ...credentialDead ? { credentialDeadUntil: new Date(deadUntil).toISOString() } : {},
    ...modelCooldowns.length === 0 ? {} : { modelCooldowns },
    disabled,
    preferred,
    creditReserve: reserve,
    reserved,
    rateLimitHits: account.rateLimitHits,
  }
}
function toWebModel(
  model: {
    id: string
    name: string
    contextWindow: number
    maxOutputTokens: number
    nativeContextWindow: number
    multiplier?: number
    supportsImages: boolean
    tags?: readonly string[]
    supportedEfforts?: readonly string[]
  },
  selection: PoolWebModelSelection,
): PoolWebModel {
  const enabled = selection.enabledModelIds
  const budget = selection.contextBudgets?.[model.id]
  const capped = budget !== undefined && budget > 0 && budget < model.nativeContextWindow
  return {
    id: model.id,
    name: model.name,
    ...model.multiplier === undefined ? {} : { multiplier: model.multiplier },
    ...model.tags === undefined ? {} : { tags: model.tags },
    ...model.supportedEfforts === undefined || model.supportedEfforts.length === 0
      ? {}
      : { supportedEfforts: model.supportedEfforts },
    supportsImages: model.supportsImages,
    contextWindow: capped ? budget : model.nativeContextWindow,
    nativeContextWindow: model.nativeContextWindow,
    maxOutputTokens: model.maxOutputTokens,
    enabled: enabled === undefined || enabled.includes(model.id),
  }
}
/**
 * Assemble the card's status document. Per-account credits and check-in state
 * are queried live; a failing query degrades to `creditsError` / `checkinError`
 * rather than failing the whole document. Never throws.
 */
export async function poolWebStatus(
  deps: PoolStatusRouteOptions,
  region: PoolRegion = 'cn',
): Promise<PoolWebStatus> {
  // Only this region's accounts: the two gateways are separate providers, and
  // a card tab must never show the other region's credits or accounts.
  const accounts = deps.pool.list(region)
  // The tab strip always offers both gateways, matching how the plugin
  // registers its two providers: an empty region reads as "no accounts signed
  // in here yet", which is information the user wants, rather than a tab that
  // only appears after they have already done the work.
  const regions: readonly PoolRegion[] = ['cn', 'global']
  // The pin, reported at document level and only when it is still live. A pin
  // naming an account that is not in THIS region (the two gateways never share
  // an account) or that has been ignored entirely is omitted rather than
  // reported with an empty list, so the card cannot offer "stop preferring it"
  // for an account it cannot show.
  const pinnedId = deps.pool.preferredId()
  const preferredAccountId = pinnedId === undefined
    || !accounts.some(account => account.id === pinnedId)
    ? undefined
    : pinnedId
  // The selection the card diffs its draft against. Sourced from the
  // catalog, which is where the settings section pushes it.
  const selection: PoolWebModelSelection = deps.catalogs[region].currentSelection()
  const rows: PoolWebAccount[] = []
  const now = Date.now()
  for (const account of accounts) {
    const row = toWebAccount(
      account,
      deps.pool.isDisabled(account.id),
      deps.pool.preferredId() === account.id,
      deps.pool.creditReserveOf(account.id),
      deps.pool.isReserved(account.id),
    )
    // Today's automation take for this account, when the host wired a scheduler.
    // Absent means "earned nothing today", which the card renders as silence.
    const earned = deps.scheduler?.().earningsToday[account.id]
    if (earned !== undefined) Object.assign(row, { automationToday: earned })
    // Dead sign-ins are skipped outright: the upstream already said no, so
    // re-probing them on every card refresh only adds two guaranteed 401s per
    // account (and a wall of red text the user cannot act on beyond signing in).
    if (!row.cooling && row.credentialDead !== true) {
      // Tracked locally as well as on the row: TypeScript keeps `row.credentialDead`
      // narrowed to false here, and the check-in probe below must see the mark
      // this iteration just made.
      let deadNow = false
      try {
        const credits = await deps.client.fetchCredits(account.credential)
        // Feed the pool too: the reserve check reads the last known balance, and
        // the card refresh is the most frequent place we learn it. The expiry
        // travels with it, because `expiry` mode sorts on it.
        deps.pool.noteCredits(account.id, credits.total, credits.nearestExpiryMs)
        // A live read is proof the sign-in works, so undo any earlier dead mark
        // the same way a successful token refresh does.
        deps.pool.clearCredentialDead(account.id)
        Object.assign(row, { credits: {
          total: credits.total,
          packages: credits.packages,
          ...credits.expiringSoon === undefined ? {} : { expiringSoon: credits.expiringSoon },
          ...credits.nearestExpiryMs === undefined ? {} : { nearestExpiryMs: credits.nearestExpiryMs },
        } })
      } catch (error: unknown) {
        // The gateway answering HTML 401/403 is not a transient hiccup: it is
        // the same proof of a stale sign-in that a revoked refresh token is. Mark
        // the account dead here so the mark survives past the next refresh (which
        // never sees this error when the token has not expired yet), the row goes
        // red instead of printing a paragraph, and later refreshes skip the
        // account entirely instead of earning the same 401 again.
        if (isGatewayRejectionError(error)) {
          deps.pool.penalizeCredentialDead(account.id)
          deadNow = true
          Object.assign(row, { credentialDead: true })
        }
        Object.assign(row, { creditsError: safeMessage(error) })
      }
      // A dead sign-in cannot check in either, and probing it is another
      // guaranteed 401 — so the second probe is skipped, not just folded.
      if (!deadNow) {
        try {
          const checkin = await deps.client.fetchCheckinStatus(account.credential)
          const web: PoolWebCheckin = {
            active: checkin.active,
            todayCheckedIn: checkin.todayCheckedIn,
            streakDays: checkin.streakDays,
            dailyCredit: checkin.dailyCredit,
            todayCredit: checkin.todayCredit,
            isStreakDay: checkin.isStreakDay,
            nextStreakDay: checkin.nextStreakDay,
            streakBonusCredit: checkin.streakBonusCredit,
          }
          Object.assign(row, { checkin: web })
        } catch (error: unknown) {
          Object.assign(row, { checkinError: safeMessage(error) })
        }
      }
    }
    rows.push(row)
  }
  const cooling = rows.filter(row => row.cooling).length
    // "In use now" is what actually served last, not what would serve next:
    // under `balanced` the next pick is a weighted draw, so there is no fixed
    // "next account" to report. Falls back to the head of the usable list before
    // the first request of the process, when nothing has served yet.
    const lastServed = deps.pool.lastServedId()
    const firstUsable = lastServed !== undefined
      ? accounts.find(account => account.id === lastServed)
      : accounts.find(account => account.cooldownUntilMs <= now)
  let shim: { running: boolean; baseUrl?: string }
  if (deps.shim === undefined) {
    shim = { running: false }
  } else {
    try {
      shim = deps.shim()
    } catch {
      shim = { running: false }
    }
  }
  // The automation panel reads the scheduler when one is wired, and reports the
  // feature as off otherwise: a card showing an invented schedule would be worse
  // than one that says it is not running.
  const automation: AutomationStatus = deps.scheduler?.() ?? {
    enabled: false,
    running: false,
    checkinHours: [],
    reportHours: [],
    taskHours: [],
    streakHours: [],
    travelHours: [],
    compensationHours: [],
    jobs: {
      checkin: emptyAutomationJob(),
      report: emptyAutomationJob(),
      tasks: emptyAutomationJob(),
      streak: emptyAutomationJob(),
      travel: emptyAutomationJob(),
      compensation: emptyAutomationJob(),
    },
    claimableSeen: 0,
    earningsToday: {},
    runInProgress: false,
  }
  return {
    ok: accounts.length > 0 && cooling < accounts.length,
    accounts: rows,
    ...firstUsable === undefined ? {} : { activeAccountId: firstUsable.id },
    ...preferredAccountId === undefined ? {} : { preferredAccountId },
    cooling,
    // The card edits the *user-visible* list, so it gets the selection-applied
    // view: disabled models arrive flagged rather than dropped, which is what
    // lets the row render a checkbox in its real state.
    models: deps.catalogs[region].current().map(model => toWebModel({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      nativeContextWindow: model.contextWindow,
      ...model.multiplier === undefined ? {} : { multiplier: model.multiplier },
      ...model.tags === undefined ? {} : { tags: model.tags },
      ...model.supportedEfforts === undefined ? {} : { supportedEfforts: model.supportedEfforts },
      supportsImages: model.supportsImages,
    }, selection)),
    selection,
    region,
    distribution: deps.pool.currentDistribution(),
    regions,
    shim,
    automation,
    creditReserves: deps.pool.creditReservesInOrder(),
    // The accounts thrown out of the pool. Reported on every region's document
    // (not just the one they came from) because the list is a property of the
    // machine, and the user has to be able to find an ignored account no matter
    // which tab they happen to be looking at.
    ignored: deps.ignoredAccounts?.() ?? [],
    // Where this region's list came from. The card shows a "built-in list
    // (offline)" note plus a retry when it is the static table, so a failed
    // startup fetch stops looking like the plugin deleted the user's models.
    catalogSource: deps.catalogs[region].currentSource(),
    ...deps.catalogs[region].catalogUpdatedAt() === undefined
      ? {}
      : { catalogUpdatedAt: deps.catalogs[region].catalogUpdatedAt() },
    ...deps.catalogs[region].lastFetchError() === undefined
      ? {}
      : { catalogError: safeMessage(deps.catalogs[region].lastFetchError()) },
    // Files that were on disk but did not become accounts. Reported on every
    // region's document for the same reason the ignore list is: it is a property
    // of the machine, and a short account list must be explainable from any tab.
    ...deps.pool.skippedFilesInOrder().length === 0
      ? {}
      : {
          skippedFiles: deps.pool.skippedFilesInOrder().map(entry => ({
            file: basename(entry.path),
            reason: entry.reason,
          })),
        },
  }
}
/**
 * Mount the read-only routes on a context where `webServer` is available. The
 * caller uses `ctx.inject(['webServer'], ...)` so Desktop startup order cannot
 * make this registration disappear.
 */
export function registerPoolStatusRoute(ctx: Context, deps: PoolStatusRouteOptions): void {
  ctx.effect(() => {
    const disposeStatus = ctx.webServer.register({
      kind: 'exact',
      path: POOL_STATUS_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        try {
          // The card asks for one region at a time; an unknown value falls back
          // to cn rather than 400-ing, because the tab strip is not the source
          // of truth and a typo should not blank the card.
          const requested = new URL(req.url ?? '/', 'http://localhost').searchParams.get('region')
          const region: PoolRegion = requested === 'global' ? 'global' : 'cn'
          json(res, 200, await poolWebStatus(deps, region))
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    /**
     * Read the usage panel's aggregate.
     *
     * GET only and loopback origin only. It never carries a prompt: the
     * recorder holds counts and timings only, so this document is safe to hand
     * the browser by construction rather than by scrubbing something out of it.
     */
    const disposeUsage = ctx.webServer.register({
      kind: 'exact',
      path: POOL_USAGE_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.usage === undefined) {
          return json(res, 503, { error: 'usage accounting is not available in this build' })
        }
        try {
          json(res, 200, deps.usage())
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    /**
     * Re-fetch the upstream model catalog.
     *
     * Its own route, distinct from the account rescan, because that is the
     * distinction users were missing: a model list that had fallen back to the
     * static table could not be recovered from the card AT ALL — "detect
     * accounts again" only re-read the desktop snapshots, so the only way back
     * to the full roster was restarting DSH.
     *
     * POST only, loopback origin only. Returns the resulting roster size per
     * region so the card can confirm the refresh actually changed something.
     */
    const disposeCatalogRefresh = ctx.webServer.register({
      kind: 'exact',
      path: POOL_CATALOG_REFRESH_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.refreshCatalog === undefined) {
          return json(res, 503, { error: 'catalog refresh is not available in this build' })
        }
        try {
          const result = await deps.refreshCatalog()
          json(res, 200, { ok: true, ...result })
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    const disposeRescan = ctx.webServer.register({
      kind: 'exact',
      path: POOL_RESCAN_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        try {
          const accounts = await deps.pool.scan()
          json(res, 200, { accounts: accounts.length })
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    const disposeReset = ctx.webServer.register({
      kind: 'exact',
      path: POOL_RESET_COOLDOWN_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        deps.pool.resetCooldowns()
        json(res, 200, { ok: true })
      },
    })
    // The only mutating route: it collects a daily reward, so it is guarded on
    // three axes — POST only, loopback origin only, and an explicit `accountId`
    // body field. An ambiguous request can never claim on the wrong account
    // (and never on every account at once).
    const disposeCheckin = ctx.webServer.register({
      kind: 'exact',
      path: POOL_CHECKIN_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        try {
          const body = await readJsonBody(req)
          const accountId = typeof body['accountId'] === 'string' ? body['accountId'] : ''
          if (accountId === '') return json(res, 400, { error: 'accountId is required' })
          const account = deps.pool.list().find(item => item.id === accountId)
          if (account === undefined) return json(res, 404, { error: 'unknown account' })
          const before = await deps.client.fetchCheckinStatus(account.credential)
          // Second guard: never re-claim a reward the status already reports as
          // collected. Protects against a double-click or a stale card.
          if (!before.active) return json(res, 409, { error: 'check-in activity is not active' })
          if (before.todayCheckedIn) {
            return json(res, 200, { ok: true, alreadyCheckedIn: true, claim: { credit: 0, streakDays: before.streakDays, isStreakDay: before.isStreakDay } })
          }
          const claim = await deps.client.claimDailyCheckin(account.credential)
          json(res, 200, { ok: true, claim })
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    // Model selection is the second mutating route. It only ever writes the
    // plugin's own settings namespace, and it validates the shape here rather
    // than trusting the browser: ids must be strings and budgets must be
    // positive integers, so a malformed body cannot poison the settings file.
    const disposeModelsSave = ctx.webServer.register({
      kind: 'exact',
      path: POOL_MODELS_SAVE_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.saveSelection === undefined) {
          return json(res, 503, { error: 'settings service unavailable; model selection cannot be saved' })
        }
        try {
          const body = await readJsonBody(req)
          const selection = parseSelection(body)
          if (selection === undefined) return json(res, 400, { error: 'invalid selection payload' })
          // The region travels with the payload: one tab's save must not
          // touch the other tab's list. An unknown value falls back to cn.
          const region: PoolRegion = body['region'] === 'global' ? 'global' : 'cn'
          await deps.saveSelection(region, selection)
          json(res, 200, { ok: true, region, selection })
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    // Flip one account in or out of rotation. POST only, loopback origin only,
    // and the id must already be a known account — the card cannot invent one.
    const disposeAccountDisable = ctx.webServer.register({
      kind: 'exact',
      path: POOL_ACCOUNT_DISABLE_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.setAccountDisabled === undefined) {
          return json(res, 503, { error: 'settings service unavailable; the account switch cannot be saved' })
        }
        try {
          const body = await readJsonBody(req)
          const known = new Set(deps.pool.list().map(account => account.id))
          const toggle = parseAccountToggle(body, id => known.has(id))
          if (toggle === undefined) return json(res, 400, { error: 'invalid account toggle payload' })
          await deps.setAccountDisabled(toggle.accountId, toggle.disabled)
          json(res, 200, { ok: true, ...toggle })
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    /**
     * Throw one account out of the pool for good, or take it back.
     *
     * Same three guards as the disable route — POST only, loopback origin only,
     * and an explicit `accountId` — plus the semantic split in
     * {@link parseAccountIgnore}: ignoring checks the pool, un-ignoring checks
     * the ignore list.
     *
     * The credential FILE is deliberately left alone. Deleting it would sign the
     * desktop app out (the live file IS the app's current session) and would not
     * even stick, since the app rewrites it on the next sign-in. Ignoring is
     * enforced on the read side instead, which is both reversible and durable.
     */
    const disposeAccountIgnore = ctx.webServer.register({
      kind: 'exact',
      path: POOL_ACCOUNT_IGNORE_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.setAccountIgnored === undefined) {
          return json(res, 503, { error: 'settings service unavailable; the ignore list cannot be saved' })
        }
        try {
          const body = await readJsonBody(req)
          const knownInPool = new Set(deps.pool.list().map(account => account.id))
          const knownIgnored = new Set((deps.ignoredAccounts?.() ?? []).map(entry => entry.id))
          const parsed = parseAccountIgnore(
            body,
            id => knownInPool.has(id),
            id => knownIgnored.has(id),
          )
          if (parsed === undefined) return json(res, 400, { error: 'invalid account ignore payload' })
          await deps.setAccountIgnored(parsed.accountId, parsed.ignored)
          json(res, 200, { ok: true, ...parsed })
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    const disposeAccountPrefer = ctx.webServer.register({
      kind: 'exact',
      path: POOL_ACCOUNT_PREFER_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.setPreferredAccount === undefined) {
          return json(res, 503, { error: 'the preferred account cannot be saved in this build' })
        }
        try {
          const body = await readJsonBody(req)
          // Known across BOTH regions, not this one: the pin is a property of the
          // whole pool, so a card tab for the other gateway must be able to move
          // it. A pin that only the other region's document reports would leave
          // the user unable to see what they chose.
          const known = new Set(deps.pool.list().map(account => account.id))
          const parsed = parseAccountPrefer(body, id => known.has(id))
          if (parsed === undefined) return json(res, 400, { error: 'invalid account prefer payload' })
          await deps.setPreferredAccount(parsed.accountId)
          json(res, 200, { ok: true, ...parsed })
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    /**
     * Run one automation job on demand.
     *
     * POST only, loopback origin only, and the job name must be one of the four
     * real jobs, so the card cannot name an arbitrary job. This exists so the
     * automation is verifiable without waiting for its scheduled hour.
     */
    const disposeAutomationRun = ctx.webServer.register({
      kind: 'exact',
      path: POOL_AUTOMATION_RUN_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.runAutomation === undefined) {
          return json(res, 503, { error: 'automation is not available in this build' })
        }
        try {
          const body = await readJsonBody(req)
          const run = parseAutomationRun(body)
          if (run === undefined) return json(res, 400, { error: 'invalid automation run payload' })
          // Start, do not await: the pass runs for tens of seconds and the card
          // polls the status document for progress and earnings. Holding this
          // request open would time out and read as a hung button.
          const started = deps.runAutomation(run.job, run.force === true)
          json(res, 200, { ok: true, job: run.job, started })
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    /**
     * Set or clear one account's reserved-credit floor.
     *
     * POST only, loopback origin only, and the id must already be a known
     * account: the card cannot invent an id, and a stale tab must not leave
     * orphan keys in the settings file.
     */
    const disposeCreditReserve = ctx.webServer.register({
      kind: 'exact',
      path: POOL_CREDIT_RESERVE_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.setCreditReserve === undefined) {
          return json(res, 503, { error: 'settings service unavailable; the reserve cannot be saved' })
        }
        try {
          const body = await readJsonBody(req)
          const known = new Set(deps.pool.list().map(account => account.id))
          const parsed = parseCreditReserve(body, id => known.has(id))
          if (parsed === undefined) return json(res, 400, { error: 'invalid credit reserve payload' })
          await deps.setCreditReserve(parsed.accountId, parsed.reserve)
          json(res, 200, { ok: true, ...parsed })
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    /**
     * Read the aggregate lane: the whole registry, each provider's state, and the
     * model rows the lane currently offers.
     *
     * GET only, loopback origin only, and token-free by CONSTRUCTION rather than
     * by scrubbing: `aggregateStatusOf` builds each provider row field by field
     * and never copies the key, so there is nothing to redact and a future field
     * cannot accidentally leak one.
     *
     * Not folded into the status document: that one is polled every 30 seconds,
     * and carrying 76 provider records on every poll would make the pool card's
     * refresh cost proportional to a directory nobody is looking at.
     */
    const disposeAggregate = ctx.webServer.register({
      kind: 'exact',
      path: POOL_AGGREGATE_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.aggregateDocument === undefined) {
          return json(res, 503, { error: 'the aggregate lane is not available in this build' })
        }
        try {
          json(res, 200, await deps.aggregateDocument())
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    /**
     * Save one aggregate provider's setting, or flip the lane's own switch.
     *
     * POST only, loopback origin only, and one provider per request — the host
     * side does read-modify-write, so two tabs editing two providers cannot
     * clobber each other.
     *
     * The answer is the WHOLE document rather than `{ok:true}`: the card has to
     * re-read the roster anyway (a new key changes which models the picker
     * offers), and returning it here is what makes a save visible without a
     * second round trip.
     */
    const disposeAggregateSave = ctx.webServer.register({
      kind: 'exact',
      path: POOL_AGGREGATE_SAVE_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.saveAggregate === undefined) {
          return json(res, 503, { error: 'the aggregate lane is not available in this build' })
        }
        try {
          const body = await readJsonBody(req)
          const patch = parseAggregatePatch(body)
          if (patch === undefined) return json(res, 400, { error: 'invalid aggregate patch payload' })
          json(res, 200, { ok: true, ...(await deps.saveAggregate(patch)) })
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    /**
     * Verify one provider's key with a cheap non-generating call.
     *
     * Its own route, not a side effect of saving, because this is the ONLY
     * aggregate action that talks to the network. Folding it into "save" would
     * mean every keystroke-confirm spends the provider's rate limit behind the
     * user's back — and a probe that fails would be indistinguishable from a
     * save that failed.
     *
     * The answer never carries the key: `probeAggregateProvider` redacts it out
     * of the provider's own message, because a 401 body routinely echoes the
     * rejected key back.
     */
    const disposeAggregateTest = ctx.webServer.register({
      kind: 'exact',
      path: POOL_AGGREGATE_TEST_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.probeAggregate === undefined) {
          return json(res, 503, { error: 'the aggregate lane is not available in this build' })
        }
        try {
          const body = await readJsonBody(req)
          const providerId = parseProviderId(body)
          if (providerId === undefined) return json(res, 400, { error: 'invalid aggregate provider payload' })
          json(res, 200, await deps.probeAggregate(providerId))
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    /**
     * Send one real streaming call to one model.
     *
     * This is the plugin's only route that spends the user's credits, which is
     * why it is POST-only and loopback-only and why it exists as its own route
     * rather than as a flag on the status document: a status read happens every
     * time the settings card opens, and a probe hidden inside it would bill the
     * user for looking at their own configuration.
     *
     * The abort signal is threaded from the request so that closing the settings
     * card stops a probe mid-flight instead of leaving it streaming against a
     * model the user has already stopped looking at.
     */
    const disposeModelProbe = ctx.webServer.register({
      kind: 'exact',
      path: POOL_MODEL_PROBE_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.probeModel === undefined) {
          return json(res, 503, { error: 'the connectivity probe is not available in this build' })
        }
        const controller = new AbortController()
        req.on('aborted', () => { controller.abort() })
        try {
          const body = await readJsonBody(req)
          const probe = parseModelProbe(body)
          if (probe === undefined) return json(res, 400, { error: 'invalid model probe payload' })
          json(res, 200, await deps.probeModel(probe.provider, probe.model, controller.signal))
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        } finally {
          controller.abort()
        }
      },
    })
    /**
     * Fetch one provider's live model list and write it back as its discovered
     * set.
     *
     * Separate from the probe because it COMMITS: it changes what the provider
     * contributes to the model picker. A failed round keeps the previous roster
     * — the asymmetry is deliberate, because a flaky listing that emptied the
     * roster would delete models the user configured on purpose.
     *
     * An authoritative EMPTY listing is a real answer and does commit: the
     * provider serves nothing under this key, and reporting `committed: 0`
     * rather than an error is what tells the user which of the two happened.
     */
    /**
     * Read what models several login channels contribute right now.
     *
     * Cheap and side-effect free, unlike the probe above: this only asks the
     * host's registry what it already knows, so it can be a plain POST without
     * the billing argument. POST rather than GET because the provider list is
     * genuinely a body — a GET would mean either a long query string or a
     * hard-coded roster, and the roster changes when the plugin does.
     *
     * A provider the host cannot answer for is omitted from the map rather than
     * reported empty, because "no adapter" and "publishes nothing" are different
     * things to say to a user staring at a channel card.
     */
    const disposeChannelModels = ctx.webServer.register({
      kind: 'exact',
      path: POOL_CHANNEL_MODELS_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.channelModels === undefined) {
          return json(res, 503, { error: 'the login channels are not available in this build' })
        }
        try {
          const body = await readJsonBody(req)
          const providers = parseProviderList(body)
          if (providers === undefined) return json(res, 400, { error: 'invalid channel models payload' })
          json(res, 200, { models: await deps.channelModels(providers, parseChannelModelIds(body)) })
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    const disposeAggregateDiscover = ctx.webServer.register({
      kind: 'exact',
      path: POOL_AGGREGATE_DISCOVER_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.discoverAggregate === undefined) {
          return json(res, 503, { error: 'the aggregate lane is not available in this build' })
        }
        try {
          const body = await readJsonBody(req)
          const providerId = parseProviderId(body)
          if (providerId === undefined) return json(res, 400, { error: 'invalid aggregate provider payload' })
          json(res, 200, await deps.discoverAggregate(providerId))
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    // The login-channel list. GET only, and answered even when the pack failed
    // to mount: an `unavailable` state plus its reason is far more actionable than
    // a 503, because the card can then say what went wrong instead of guessing.
    const disposeChannels = ctx.webServer.register({
      kind: 'exact',
      path: POOL_CHANNELS_PATH,
      handler: (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.channelsDocument === undefined) {
          return json(res, 503, { error: 'the login channels are not available in this build' })
        }
        try {
          json(res, 200, deps.channelsDocument())
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    /**
     * The chain list plus the roster its members are drawn from.
     *
     * GET only. Deliberately not part of the pool status document: chains change
     * only when the user edits them, while the pool card polls every 30 seconds,
     * and rebuilding the chain catalog on every one of those polls would resolve
     * members nobody is looking at.
     */
    const disposeCombos = ctx.webServer.register({
      kind: 'exact',
      path: POOL_COMBOS_PATH,
      handler: (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.combosDocument === undefined) {
          return json(res, 503, { error: 'the routing chains are not available in this build' })
        }
        try {
          json(res, 200, deps.combosDocument())
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    /**
     * Replace the whole chain table.
     *
     * POST only, one table per request (see `POOL_COMBOS_SAVE_PATH`). The write
     * refreshes the running catalog before answering, so a chain saved here is
     * pickable in the same breath — the same reason the aggregate save does it.
     */
    const disposeCombosSave = ctx.webServer.register({
      kind: 'exact',
      path: POOL_COMBOS_SAVE_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.saveCombos === undefined) {
          return json(res, 503, { error: 'the routing chains are not available in this build' })
        }
        try {
          const body = await readJsonBody(req)
          const raw = body['combos']
          json(res, 200, await deps.saveCombos(Array.isArray(raw) ? raw : []))
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    /**
     * The relay's state, and the only way to change it.
     *
     * Deliberately one route for both verbs rather than a relay setting added to
     * the settings schema: the relay is a network listener, and the one action
     * that must always be reachable is turning it off. A switch buried in a
     * settings form the host renders is a worse place to look for "stop exposing
     * my account pool to the office Wi-Fi".
     */
    const disposeRelay = ctx.webServer.register({
      kind: 'exact',
      path: POOL_RELAY_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET' && req.method !== 'POST') {
          return json(res, 405, { error: 'method not allowed' })
        }
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.relayDocument === undefined || deps.saveRelay === undefined) {
          return json(res, 503, { error: 'the LAN relay is not available in this build' })
        }
        try {
          if (req.method === 'GET') {
            json(res, 200, await deps.relayDocument())
            return
          }
          const body = await readJsonBody(req)
          json(res, 200, await deps.saveRelay(body))
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    return () => {
      disposeRelay()
      disposeCombosSave()
      disposeCombos()
      disposeChannels()
      disposeAggregate()
      disposeAggregateDiscover()
      disposeAggregateSave()
      disposeAggregateTest()
      disposeModelProbe()
      disposeChannelModels()
      disposeAutomationRun()
      disposeCreditReserve()
      disposeAccountIgnore()
      disposeAccountPrefer()
      disposeCatalogRefresh()
      disposeCheckin()
      disposeAccountDisable()
      disposeModelsSave()
      disposeReset()
      disposeRescan()
      disposeStatus()
      disposeUsage()
    }
  }, 'dsh-xdpool: Web status route')
}
