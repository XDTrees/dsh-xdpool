/**
 * Host-side plugin entry. Registers the `xdpool` provider into the
 * Harness LLM seam once the loopback shim holds its port, plus the HTTP status
 * routes consumed by the CLI.
 *
 * @module dsh-xdpool/index
 */
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { WorkBuddyAccountPool } from './accounts.ts'
import { WorkBuddyCatalog } from './catalog.ts'
import {
  mountChannelPack,
  POOL_OWNED_CHANNELS,
  REGISTERED_CHANNELS,
  type MountedChannelPack,
} from './channels.ts'
import {
  POOL_NAME_BY_REGION,
  POOL_PROVIDER_BY_REGION,
  XDPOOL_AGGREGATE_PROVIDER,
  XDPOOL_FREE_PROVIDER,
  XDPOOL_GLOBAL_PROVIDER,
  XDPOOL_PROVIDER,
  EXTRA_LANE_NAMES,
  createWorkBuddyAdapter,
  type AdapterHandle,
  type WorkBuddyAdapter,
} from './adapter.ts'
import { AggregateCatalog, probeAggregateProvider, type AggregateModelRow } from './aggregate.ts'
import { mountBillionContext, type MountedBillionContext } from './billion-mount.ts'
import { adoptChannelPackAccounts } from './pack-accounts.ts'
import { FreeCatalog } from './free-catalog.ts'
import { createFreeLaneSource } from './free-lane.ts'
import { getProvider } from './providers.ts'
import type { WorkBuddyModelInfo } from './catalog.ts'
import {
  buildComboCatalog,
  comboId,
  COMBO_DEFAULT_CONTEXT_WINDOW,
  type ComboSetting,
} from './combos.ts'
import {
  clearProviderSetting,
  combosOf,
  configuredProviderIds,
  providerAuthUsable,
  providerSettingOf,
  readAggregateSettings,
  readAggregateSettingsSync,
  saveCombos as writeCombos,
  setAggregateEnabled,
  updateProviderSetting,
  updateRelaySetting as writeRelaySetting,
  type AggregateStore,
  type RelaySetting,
} from './store.ts'
import { aggregateStatusOf, registerPoolStatusRoute } from './web-status.ts'
import type {
  PoolWebAggregatePatch,
  PoolWebAggregateProbe,
  PoolWebModelProbeResult,
  PoolWebAggregateStatus,
  PoolWebChannelsStatus,
  PoolWebChannelModel,
  PoolWebCombo,
  PoolWebComboCandidate,
  PoolWebCombosStatus,
  PoolWebRelayPatch,
  PoolWebRelayStatus,
} from './status-paths.ts'
import { readBillionStatus } from './billion.ts'
import { describeError, recordStartupNote } from './diagnostics.ts'
import { probeModelConnectivity } from './model-probe.ts'
/**
 * One aggregate catalog row as the card renders it.
 *
 * A local mapping rather than a cast: the row is the plugin's own type and the
 * document's is the card's, and a cast would let one gain a field the other
 * lacks without anything saying so.
 */
function toWebAggregateModel(row: AggregateModelRow) {
  return {
    id: row.id,
    name: row.name,
    providerId: row.providerId,
    modelId: row.modelId,
    contextWindow: row.contextWindow,
    maxOutputTokens: row.maxOutputTokens,
    supportsImages: row.supportsImages,
    source: row.source,
  }
}
/**
 * The relay's settings, with defaults filled in.
 *
 * A partially-written section reads as the safest interpretation of itself: off,
 * loopback-only, no key. `enabled` in particular is never inferred from the
 * presence of a key or a host — an absent `enabled` means the user never turned
 * this on, and guessing otherwise would expose their account pool to the network
 * because a file happened to have a port in it.
 */
function relaySettingsOf(store: AggregateStore): RelaySettings {
  const saved = store.relay ?? {}
  const host = RELAY_HOSTS.includes(saved.host ?? '') ? saved.host ?? RELAY_HOSTS[0] ?? '127.0.0.1' : RELAY_HOSTS[0] ?? '127.0.0.1'
  return {
    enabled: saved.enabled === true,
    host,
    port: saved.port ?? RELAY_DEFAULT_PORT,
    key: saved.key ?? '',
  }
}
/**
 * The routing document the chain editor draws from.
 *
 * `missing` is reported rather than silently dropped: the user's chain named a
 * model that is gone, and the only honest thing is to show them WHICH one. OFM
 * makes the same choice, for the same reason — a chain that quietly rewrites
 * itself looks like it obeyed, and the user is the only one who can tell that a
 * member they paid for is now a fallback to something free.
 */
function combosStatusOf(
  store: AggregateStore,
  catalog: AggregateCatalog,
  poolRows: readonly WorkBuddyModelInfo[],
): PoolWebCombosStatus {
  const chains = combosOf(store)
  const providerRows = catalog.providerRows()
  const settings = new Map(
    configuredProviderIds(store).map(providerId => [providerId, providerSettingOf(store, providerId)]),
  )
  const candidates: PoolWebComboCandidate[] = [
    ...poolRows.map(row => ({
      id: row.id,
      name: row.name,
      owner: 'workbuddy',
      usable: true,
      contextWindow: row.contextWindow,
      supportsImages: row.supportsImages,
    })),
    ...providerRows.map(row => {
      const setting = settings.get(row.providerId)
      const provider = getProvider(row.providerId)
      return {
        id: row.id,
        name: row.name,
        owner: row.providerId,
        usable: provider === null || setting === undefined
          ? false
          : providerAuthUsable(provider, setting),
        contextWindow: row.contextWindow,
        supportsImages: row.supportsImages,
      }
    }),
  ]
  const known = new Set(candidates.map(candidate => candidate.id))
  return {
    combos: chains.map(chain => {
      const resolved = buildComboCatalog([chain], { pool: poolRows, aggregate: providerRows })[0]
      return {
        id: resolved?.id ?? comboId(chain.name),
        name: chain.name,
        models: resolved?.models ?? [],
        missing: chain.models.filter(modelId => !known.has(modelId)),
        strategy: resolved?.strategy ?? chain.strategy ?? 'fallback',
        stickyLimit: resolved?.stickyLimit ?? chain.stickyLimit ?? 1,
        enabled: chain.enabled !== false,
        contextWindow: resolved?.contextWindow ?? COMBO_DEFAULT_CONTEXT_WINDOW,
        supportsImages: resolved?.supportsImages ?? false,
      }
    }),
    candidates,
  }
}
import { WorkBuddyScheduler, type AutomationJobKind, type AutomationLedger, type AutomationOptions } from './scheduler.ts'
import { channelListableAsRows, createWorkBuddyShim, type WorkBuddyShim } from './shim.ts'
import { createChannelLane, type ChannelLaneLlm } from './channel-lane.ts'
import { createPoolRelay, newRelayKey, relayDocumentOf, RELAY_DEFAULT_PORT, RELAY_HOSTS, type RelaySettings } from './relay.ts'
import { UsageRecorder } from './stats.ts'
import { buildStatus } from './status.ts'
export {
  AUTOMATION_JOB_KINDS, AUTOMATION_TICK_MS, EVENT_SCORE_WAIT_MS, WorkBuddyScheduler, dayKey,
  isAutomationJobKind, isFireHour,
  type AutomationLedger, type AutomationRunSummary, type AutomationStatus, type SchedulerLogger,
} from './scheduler.ts'
import { regionOf, WorkBuddyUpstreamClient, type WorkBuddyRegion } from './upstream.ts'
import {
  ignoreAccount,
  ignoredIdsPath,
  pluginDataDir,
  readIgnoredAccountsSync,
  unignoreAccount,
} from './ignored.ts'
import { adoptLegacyDataDir, describeProviderIdRename } from './migrate.ts'
import { fileURLToPath } from 'node:url'
/**
 * This plugin's install root, the tree its own provider is assembled from.
 *
 * Two directories up from `lib/` — the built bundle sits in `lib/`, so the
 * package root is its parent. Used as one side of the pi-ai generation check.
 */
const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url))
/**
 * The host's own module directory, the tree its `PiAiAdapter` resolves from.
 *
 * Reached from the host package this plugin is loaded by: walking up from a
 * `@deepseek-ai/dsh-llm-pi-ai` import lands in the host's `node_modules`, which
 * is where the HOST generation actually lives. The plugin's own tree is the
 * other side; comparing one tree with itself would always agree.
 */
const HOST_MODULE_ROOT = ((): string => {
  try {
    return fileURLToPath(new URL('../../node_modules/@deepseek-ai/dsh-llm-pi-ai/', import.meta.url))
  } catch {
    return ''
  }
})()
export { XDPOOL_PROVIDER, createWorkBuddyAdapter, type WorkBuddyAdapter } from './adapter.ts'
export { createWorkBuddyShim, type WorkBuddyShim } from './shim.ts'
export {
  WorkBuddyAccountPool,
  candidateAuthDirs,
  defaultDesktopAuthDirs,
  parseWorkBuddyAuth,
  workbuddyAccountId,
  WORKBUDDY_AUTH_FILE_ENV,
  WORKBUDDY_LIVE_FILENAME,
  type WorkBuddyAccount,
  type WorkBuddyCredential,
} from './accounts.ts'
export { WorkBuddyCatalog, FALLBACK_WORKBUDDY_MODELS, type WorkBuddyModelInfo } from './catalog.ts'
import { checkPiAiGeneration, piAiMismatchMessage } from '../pi-ai-generation.ts'
export { WorkBuddyUpstreamClient, buddyAppEvents, classifyUpstreamError, desktopAutomationCreatedEvent, desktopCanvasEvents, desktopChatEvents, parseRateLimitReset, type UpstreamErrorKind } from './upstream.ts'
export {
  APPEARANCE_THEME_KEY, BUDDY_APP_ID, BUDDY_APP_NAME, LIBRARY_DOC_URL, LIGHTHOUSE_EXPERT_ID,
  PLAYBOOK_CASE_ID, PLAYBOOK_CASE_NAME, SKILL_ID, SKILL_NAME, TEMPLATE_PRESETS,
  appearanceChain, automationChain, buddyAppChain, canvasChain, chatChain, expertActualUseEvent,
  expertChatEvents, expertSummonEvents, libraryReadChain, playbookChain, skillChain, templateChain,
  templateChains,
  type ExpertUseMode, type MarketExpert, type TaskEventChain, type TaskEventTransport,
} from './task-events.ts'
export { buildStatus, formatStatus, formatRates, type WorkBuddyStatus, type AccountStatus } from './status.ts'
// The shared automation schedule. Exported so a probe (and any future
// consumer) can assert the host and the card agree on what an empty hour list
// means, rather than hard-coding the numbers a second time.
export { DEFAULT_AUTOMATION_HOURS } from './status-paths.ts'
export {
  POOL_ACCOUNT_IGNORE_PATH,
  POOL_AUTOMATION_RUN_PATH,
  POOL_CREDIT_RESERVE_PATH,
  POOL_CHECKIN_PATH,
  POOL_MODELS_SAVE_PATH,
  POOL_RESET_COOLDOWN_PATH,
  POOL_RESCAN_PATH,
  POOL_STATUS_PATH,
  type PoolWebAccountIgnore,
  type PoolWebCheckin,
  type PoolWebCheckinClaim,
  type PoolWebIgnoredAccount,
  type PoolWebModel,
  type PoolWebModelSelection,
  type PoolWebStatus,
} from './status-paths.ts'
export {
  IGNORED_FILE_NAME,
  PLUGIN_DATA_DIR_NAME,
  dshHome,
  ignoreAccount,
  ignoredIdsPath,
  pluginDataDir,
  readIgnoredAccounts,
  readIgnoredAccountsSync,
  unignoreAccount,
  writeIgnoredAccounts,
  type IgnoredAccount,
} from './ignored.ts'
import {
  preferredIdPath,
  readPreferredId,
  readPreferredIdSync,
  writePreferredId,
} from './preferred.ts'
export { preferredIdPath, readPreferredId, readPreferredIdSync, writePreferredId } from './preferred.ts'
export type { ModelSelection } from './catalog.ts'
// The card half talks to these routes over HTTP; exporting the registrar and
// its option shape lets a probe mount the real table instead of trusting that
// a registration landed outside the teardown closure.
export { poolWebStatus, registerPoolStatusRoute, type PoolStatusRouteOptions } from './web-status.ts'
/** Stable Cordis plugin name. */
export const name = 'llm-xdpool'
/** The model registry required before the provider can register. */
export const inject = ['llm', 'settings']
/**
 * Settings namespace for the XD Pool card. Registering a section here
 * is what makes the provider appear on the Models settings page and causes the
 * Host to mount the plugin's client card under Plugin configuration — exactly
 * the mechanism the single-account connector uses.
 */
export const XDPOOL_SETTINGS_NS = 'xdpool' as SettingsNamespace
/** Plugin configuration. */
export interface Config {
  /** Explicit WorkBuddy desktop auth-file path override. */
  authFile?: string
  /** Rate-limit cooldown per account, milliseconds. */
  cooldownMs?: number
  /**
   * How the pool spreads requests across accounts.
   *
   * - `priority` (default) drains one account before moving to the next, which
   *   is what a pool of your own accounts is for.
   * - `round-robin` walks the pool in order, so the spend splits evenly.
   * - `balanced` draws at random, weighting whichever account has been idle
   *   longest. Spend still spreads, but without a fixed order, so one unhealthy
   *   account cannot pin the pool to itself.
   * - `sticky` gives each conversation one account and moves the next new
   *   conversation to the next account in order. Rotating accounts inside a
   *   conversation throws away the upstream prompt cache (it is per tenant), so
   *   this keeps the cache warm while still spreading spend across
   *   conversations.
   * - `expiry` picks the account whose one-off credit packs expire soonest, so
   *   use-it-or-lose-it credits are spent before they die. Accounts with no
   *   known expiry sort last, so an unprobed pool degrades to `priority`.
   *
   * Absent reads as `priority`.
   */
  distribution?: 'priority' | 'round-robin' | 'balanced' | 'sticky' | 'expiry'
  /**
   * Account ids switched off on the card. A disabled account is never picked
   * to serve a request, but it stays in the pool and on the card so it can be
   * switched back on. Ids are the pool's stable per-credential keys, which
   * survive re-scans (see WorkBuddyAccountPool.disabledIds).
   */
  disabledAccountIds?: string[]
  /**
   * Per-account credit floor, keyed by account id. The pool stops picking an
   * account once its last known balance reaches this value, so the reserved
   * credits survive. Absent or 0 spends the account down as before.
   */
  creditReserves?: Record<string, number>
  /**
   * Model ids enabled in the picker. Absent means "every model the catalog
   * advertises" — an unconfigured install should never present an empty model
   * list just because the key is missing.
   */
  enabledModelIds?: string[]
  /**
   * Model ids that additionally accept image input. Absent means "follow the
   * upstream capability flag"; an explicit list is authoritative for the models
   * it mentions and leaves the rest to the catalog.
   */
  imageModelIds?: string[]
  /**
   * Per-model context-window override, keyed by model id. The upstream can
   * advertise more than DSH wants to hand a single turn, so the card lets the
   * user cap a model without touching the catalog.
   */
  contextBudgets?: Record<string, number>
  /**
   * Per-region model selection. The two gateways advertise different rosters, so
   * one shared list would let a save on one tab silently rewrite the other tab's
   * picker. Each region owns its own copy; a region with no entry falls back to
   * the legacy flat keys above, so an upgrade keeps the list already in use.
   */
  modelSelectionCn?: ModelSelectionConfig
  modelSelectionGlobal?: ModelSelectionConfig
  /**
   * Daily-points automation. Absent means off: the scheduler makes upstream
   * calls on the user behalf, so it stays opt-in rather than surprising a
   * fresh install with background traffic.
   */
  automation?: AutomationConfig
  /**
   * The automation's daily earnings ledger, written by the scheduler itself.
   *
   * It lives in settings rather than only in memory so a host restart mid-day
   * does not wipe what the automation already earned.
   */
  automationEarnings?: AutomationLedger
}
/** One region's saved model selection. */
export interface ModelSelectionConfig {
  enabledModelIds?: string[]
  imageModelIds?: string[]
  contextBudgets?: Record<string, number>
}
/**
 * Daily-points automation.
 *
 * Absent means off: the scheduler makes upstream calls on the user behalf, so
 * it stays opt-in rather than surprising a fresh install with background
 * traffic. Each job carries its own hour list so the passes can be spread out
 * (or pushed off-peak) without disabling any of them.
 *
 * Ordering note: the report job must run before the task job. A report is what
 * lights the growth streak and unlocks the `first_buddy` family, so a task pass
 * that ran first would read counters before they could have moved.
 */
export interface AutomationConfig {
  /** Master switch for every automation job. Absent reads as false. */
  enabled?: boolean
  /** Hours (local, 0-23) at which the daily check-in runs. */
  checkinHours?: number[]
  /** Hours at which the activity report runs. Keep ahead of `taskHours`. */
  reportHours?: number[]
  /** Hours at which tasks are enrolled in and claimed. */
  taskHours?: number[]
  /** Hours at which streak redemption runs. */
  streakHours?: number[]
  /** Hours at which the buddy travel loop runs. */
  travelHours?: number[]
  /** Hours at which the outage-compensation claim runs. */
  compensationHours?: number[]
  /** How long an account rests after its credits run out, in milliseconds. */
  exhaustCooldownMs?: number
}
/** Upper bound the card offers as the "default" context window, in tokens. */
export const DEFAULT_CONTEXT_BUDGET = 200_000
/**
 * Fold a saved automation block into scheduler options.
 *
 * Absent means off, stated once here so every caller agrees: the card writes
 * `enabled` as a real boolean, and a config that never touched the section must
 * not accidentally arm background upstream traffic.
 */
export function automationOptions(automation: AutomationConfig | undefined): AutomationOptions {
  return {
    enabled: automation?.enabled === true,
    ...automation?.checkinHours === undefined ? {} : { checkinHours: automation.checkinHours },
    ...automation?.reportHours === undefined ? {} : { reportHours: automation.reportHours },
    ...automation?.taskHours === undefined ? {} : { taskHours: automation.taskHours },
    ...automation?.streakHours === undefined ? {} : { streakHours: automation.streakHours },
    ...automation?.travelHours === undefined ? {} : { travelHours: automation.travelHours },
    ...automation?.compensationHours === undefined ? {} : { compensationHours: automation.compensationHours },
  }
}
/**
 * One region's model-selection schema.
 *
 * Every field is optional on purpose: an absent field keeps its documented
 * meaning ("all enabled" / "follow the upstream image flag" / "no cap"), and a
 * region that has never been saved stays absent so `applyConfigFromSource` can
 * fall back to the legacy flat keys.
 */
function asVolatile<S>(schema: S): S {
  const candidate = schema as unknown as { volatile?: () => S }
  return typeof candidate.volatile === 'function' ? candidate.volatile() : schema
}
/**
 * Peel one live volatile reference.
 *
 * On 0.1.7 a volatile field is handed back as `{ get(): T }` rather than a
 * plain value, so a running instance observes a settings edit without being
 * remounted. Every read of a marked field therefore has to unwrap: passing the
 * reference onward compares an object against a string and reports the field as
 * unset. On 0.1.5 the field is already a plain value, so this is a no-op.
 *
 * The test is duck-typed on purpose — importing `isVolatile` would add a
 * dependency the 0.1.5 line does not carry.
 */
function unwrapVolatile<T>(value: T): T {
  if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    return (value as unknown as { get(): T }).get()
  }
  return value
}
/**
 * Deep copy of a config value with every live `{get(): T}` reference replaced
 * by the value it resolves to.
 *
 * {@link unwrapVolatile} peels only the one level an ordinary read needs. A
 * settings service is different: it validates and `structuredClone`s the WHOLE
 * object, so a reference surviving anywhere inside it fails schema validation
 * with a message that names the field but not the cause —
 * `$.authFile expected string but got [object Object]`. That is what makes the
 * namespace fail to register and the card silently disappear, which is why the
 * object handed to `installSection` goes through this first.
 */
function unwrapVolatileDeep<T>(value: T): T {
  const peeled = unwrapVolatile(value)
  if (Array.isArray(peeled)) return peeled.map(entry => unwrapVolatileDeep(entry)) as T
  if (peeled !== null && typeof peeled === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(peeled)) out[key] = unwrapVolatileDeep(entry)
    return out as T
  }
  return peeled
}
/**
 * One region's model-selection schema.
 *
 * Every field is optional on purpose: an absent field keeps its documented
 * meaning ("all enabled" / "follow the upstream image flag" / "no cap"), and a
 * region that has never been saved stays absent so `applyConfigFromSource` can
 * fall back to the legacy flat keys.
 */
const modelSelectionSchema = z.object({
  enabledModelIds: z.array(z.string()).description('Model ids enabled in this region\'s picker (absent = all)'),
  imageModelIds: z.array(z.string()).description('Model ids accepting image input in this region (absent = follow upstream)'),
  contextBudgets: z.dict(z.number().step(1).min(1)).description('Per-model context-window override for this region'),
})
/**
 * Automation schema.
 *
 * `enabled` carries a real default (false) because the scheduler reads it on
 * every tick and a missing field must mean "off" rather than "undefined".
 * The hour lists fall back in the scheduler itself, so they stay optional here
 * and an absent list keeps the documented schedule.
 *
 * `exhaustCooldownMs` is mirrored from the pool options: the card offers it as
 * part of the automation block, since how long a spent account rests only
 * matters to the automation that has to work around it.
 */
const automationSchema = z.object({
  enabled: z.boolean().default(false).description('Run the daily points automation'),
  checkinHours: z.array(z.number().step(1).min(0).max(23)).description('Local hours for the daily check-in'),
  reportHours: z.array(z.number().step(1).min(0).max(23)).description('Local hours for the activity report (runs before tasks)'),
  taskHours: z.array(z.number().step(1).min(0).max(23)).description('Local hours for task enrolment and claiming'),
  streakHours: z.array(z.number().step(1).min(0).max(23)).description('Local hours for streak redemption'),
  travelHours: z.array(z.number().step(1).min(0).max(23)).description('Local hours for the buddy travel loop'),
  compensationHours: z.array(z.number().step(1).min(0).max(23)).description('Local hours for the outage-compensation claim'),
  exhaustCooldownMs: z.number().step(1).min(1000).description('How long a spent account rests, in milliseconds'),
})
/** Settings key holding one region's saved selection. */
export const modelSelectionKeyFor = (region: 'cn' | 'global'): string =>
  region === 'cn' ? 'modelSelectionCn' : 'modelSelectionGlobal'
/**
 * Plugin configuration schema.
 *
 * Mirrors the shape the settings section stores. Every field carries a default
 * so a config that never touched the card still folds cleanly: a field whose
 * schema declares no default is read as absent by the settings fold. That is
 * also why `contextBudgets` is a real dictionary (`z.dict`) - an open object
 * schema reads as "an object with no fields" and the fold then throws while
 * the provider row is rendered.
 *
 * Every field is wrapped in {@link asVolatile}: on the 0.1.7 line the settings
 * write gate refuses an entry whose schema declares no volatile field at all
 * ("Plugin entry ... has no volatile fields") and `describe()` skips such an
 * entry — so an unmarked schema means the card can neither render nor save. On
 * the 0.1.5 line the wrapper degrades to an identity no-op (see its JSDoc), and
 * the value the running instance reads is a plain value either way once
 * unwrapped.
 */
export const Config: z<Config> = z.object({
  authFile: asVolatile(z.string().description('WorkBuddy desktop auth file (defaults to the app own location)')),
  cooldownMs: asVolatile(z.number().step(1).min(1000).default(60000).description('Rate-limit cooldown per account, in milliseconds')),
  distribution: asVolatile(z.union(['priority', 'round-robin', 'balanced', 'sticky', 'expiry']).default('priority').description('How requests are spread: priority (drain one), round-robin (in order), balanced (idle-weighted random), sticky (one account per conversation, new conversations rotate), or expiry (spend the account whose credit packs expire soonest)')),
  disabledAccountIds: asVolatile(z.array(z.string()).default([]).description('Account ids excluded from the pool (empty = every discovered account participates)')),
  creditReserves: asVolatile(z.dict(z.number().step(1).min(0)).default({}).description('Per-account credit floor: stop using an account once its balance reaches this value')),
  enabledModelIds: asVolatile(z.array(z.string()).default([]).description('Legacy shared model-id list; used by a region that has no per-region selection yet')),
  imageModelIds: asVolatile(z.array(z.string()).default([]).description('Legacy shared image-id list; used by a region that has no per-region selection yet')),
  contextBudgets: asVolatile(z.dict(z.number().step(1).min(1)).default({}).description('Legacy shared context budgets; used by a region with no per-region selection yet')),
  modelSelectionCn: asVolatile(modelSelectionSchema.description('Model selection for the domestic gateway')),
  modelSelectionGlobal: asVolatile(modelSelectionSchema.description('Model selection for the international gateway')),
  automation: asVolatile(automationSchema.description('Daily points automation (activity report, task claiming, check-in)')),
  automationEarnings: asVolatile(z.any().description('Automation earnings ledger (written by the scheduler)'))
})
/** Everything the CLI needs from a live plugin instance. */
export interface WorkBuddyPoolApi {
  pool: WorkBuddyAccountPool
  /** One catalog per region, matching the two registered providers. */
  catalogs: Readonly<Record<WorkBuddyRegion, WorkBuddyCatalog>>
  client: WorkBuddyUpstreamClient
  shim: WorkBuddyShim
  adapter: WorkBuddyAdapter | undefined
  rescan(): Promise<number>
  status(includeCredits?: boolean): Promise<Awaited<ReturnType<typeof buildStatus>>>
  resetCooldowns(): void
  /** Daily-points automation; assembled with the core, inert until started. */
  scheduler: WorkBuddyScheduler
}
/** Live API, published for the CLI. */
let api: WorkBuddyPoolApi | undefined
/** The live API, or undefined when the plugin has not applied yet. */
export function currentApi(): WorkBuddyPoolApi | undefined {
  return api
}
/** Test seam: install an API instance without booting cordis. */
export function setApi(next: WorkBuddyPoolApi | undefined): void {
  api = next
}
/** Assemble the runtime objects without registering anything. */
/**
 * Assemble the runtime objects without registering anything.
 *
 * One catalog per region, mirroring the two shims: the CN and global gateways
 * do not advertise the same roster, and a shared catalog meant the picker showed
 * whichever list happened to be fetched first (always the CN one, since the
 * seeding step read `accounts[0]`).
 */
export function createCore(logger?: { warn(...args: unknown[]): void; info?(...args: unknown[]): void }) {
  const client = new WorkBuddyUpstreamClient()
  // `persistent: true` is the production behaviour: without it the pool's
  // account list is pure memory, and because the desktop app keeps only the
  // CURRENT sign-in's credential file on disk, every account gathered by
  // switching sign-ins evaporated on restart. The store seeds `scan()` from
  // `~/.dsh/.xdpool/accounts.json` and writes the merged list back.
  // The sticky bindings are written beside the plugin's other state so
  // "one account per conversation" survives a restart instead of being a promise
  // that ends at the process boundary.
  const pool = new WorkBuddyAccountPool({
    ...logger === undefined ? {} : { logger },
    client,
    persistent: true,
    affinityPath: join(pluginDataDir(), 'sticky-affinity.json'),
  })
  const catalogs = {
    cn: new WorkBuddyCatalog('cn'),
    global: new WorkBuddyCatalog('global'),
  } as const
  // The scheduler is assembled here but stays inert until `start()`: the CLI and
  // the tests both build a core without wanting background traffic.
  const scheduler = new WorkBuddyScheduler(pool, client, { ...logger === undefined ? {} : { logger } })
  return { pool, catalogs, client, scheduler }
}
/**
 * Log a warning when the plugin and the host resolve different pi-ai
 * generations.
 *
 * Never throws and never blocks startup: the check is a filesystem lookup, and
 * a plugin that refused to load because of a version guess would be worse than
 * one that merely warns. The two directories are THIS plugin's install root and
 * the host's own module directory, so the two resolutions walk different trees —
 * resolving from one place only would compare a copy with itself and always
 * agree.
 */
function warnOnPiAiGenerationMismatch(ctx: Context): void {
  try {
    const check = checkPiAiGeneration(PLUGIN_ROOT, HOST_MODULE_ROOT)
    const message = piAiMismatchMessage(check)
    if (message !== undefined) ctx.logger.warn(message)
  } catch {
    // A generation check that breaks startup would be a worse bug than the
    // mismatch it looks for.
  }
}
/**
 * Start the loopback endpoint, register the `xdpool` provider, and
 * discover accounts. The provider registers only after `shim.ready` resolves,
 * because its models read the shim origin at construction time.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const core = createCore(ctx.logger)
  // Cross-generation guard, checked ONCE at load.
  //
  // Two copies of @earendil-works/pi-ai on one call chain — the plugin's and the
  // host adapter's — throw a TypeError at the adapter seam, which the host
  // reports as a non-retryable PI_AI_ERROR: every turn fails with no content and
  // no useful error. A package.json range cannot prevent it (the old peer range
  // excluded the host generation entirely, making the mix a valid install), so
  // the resolved reality is compared here instead. Warn only: the plugin still
  // runs, because a mismatch may be benign and a hard failure on a guess would
  // be worse.
  warnOnPiAiGenerationMismatch(ctx)
  // Adopt state written under the plugin's pre-rename directory, BEFORE anything
  // reads it.
  //
  // This has to happen first, and synchronously: the ignore list, the preferred
  // account and the aggregate API keys are all read out of the data directory a
  // few lines below, so an adoption that ran later would leave this boot running
  // against an empty directory and the user would see their keys as "gone" until
  // the next restart. Copying (not moving) keeps the old directory intact for a
  // rollback or a side-by-side install; see `src/migrate.ts`.
  //
  // Best-effort by construction: `adoptLegacyDataDir` never throws, because a
  // failed adoption must not stop the plugin from starting.
  const migration = adoptLegacyDataDir()
  if (migration.adopted) {
    recordStartupNote(
      `adopted pre-rename state from ${migration.from ?? '(unknown)'} -> ${migration.to} `
      + `(${migration.files.length} file(s): ${migration.files.join(', ')})`,
    )
  } else if (migration.skipped === 'failed') {
    recordStartupNote(`could not adopt pre-rename state into ${migration.to}; continuing with current data`)
  }
  // The permanent ignore list, read ONCE here (synchronously) and kept live.
  //
  // Loaded at apply time rather than on the first scan because `apply()` is
  // synchronous and a later async load could resolve after accounts were already
  // discovered — an ignored account would then sit in the pool until the next
  // scan. A few hundred bytes of blocking read at startup removes that window
  // entirely.
  const ignoredPath = ignoredIdsPath()
  let ignoredAccounts = readIgnoredAccountsSync(ignoredPath)
  core.pool.applyIgnored(ignoredAccounts.map(entry => entry.id))
  /** Re-read the ignore file and push it into the pool. */
  const refreshIgnored = (): void => {
    ignoredAccounts = readIgnoredAccountsSync(ignoredPath)
    core.pool.applyIgnored(ignoredAccounts.map(entry => entry.id))
  }
  // The pinned account, read the same way and for the same reason.
  //
  // A stale pin is harmless by construction — `acquire()` falls back to the
  // distribution strategy whenever the pinned account fails a gate — so this
  // cannot pin an account that no longer exists. It just must be read
  // synchronously, or the first request of the process would be served by
  // whichever account the strategy picked rather than the one the user chose.
  const preferredPath = preferredIdPath()
  const applyPreferred = (accountId: string | undefined): void => {
    core.pool.prefer(accountId)
  }
  applyPreferred(readPreferredIdSync(preferredPath))
  /**
   * Fetch and install the model catalog for both regions.
   *
   * Each region is isolated AND independently retried: they are separate
   * gateways on separate hosts, so one being unreachable must not degrade the
   * other. The failure this exists for is a startup network hiccup — several
   * components reporting `fetch failed` inside the same second, with the next
   * request succeeding 0.7s later — which used to cost the user their model
   * list for the whole session, with no way back short of a DSH restart.
   *
   * Returns what each region ended up with, so the card can confirm a manual
   * refresh actually changed something.
   */
  const seedCatalog = async (): Promise<{
    regions: Record<WorkBuddyRegion, { source: 'live' | 'fallback'; models: number; error?: string }>
  }> => {
    const accounts = await core.pool.scan()
    const regions = {} as Record<WorkBuddyRegion, { source: 'live' | 'fallback'; models: number; error?: string }>
    for (const region of ['cn', 'global'] as const) {
      try {
        const credential = accounts.find(account => regionOf(account.credential.domain) === region)?.credential
        if (credential === undefined) {
          ctx.logger.info?.(`dsh-xdpool: no ${region} account yet; keeping the static ${region} catalog`)
          regions[region] = { source: 'fallback', models: core.catalogs[region].current().length }
          continue
        }
        const models = await core.client.fetchModels(credential)
        core.catalogs[region].updateFromUpstream(models)
        ctx.logger.info?.(`dsh-xdpool: ${region} catalog seeded with ${models.length} model(s)`)
        regions[region] = { source: 'live', models: models.length }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        core.catalogs[region].noteFetchFailure(message)
        ctx.logger.warn(`dsh-xdpool: ${region} model catalog unavailable; using static fallback`, error)
        regions[region] = {
          source: core.catalogs[region].currentSource(),
          models: core.catalogs[region].current().length,
          error: message,
        }
      }
    }
    return { regions }
  }
  /**
   * Invalidate the provider snapshot so the picker re-reads the catalog.
   *
   * Seeded with a no-op and reassigned once the adapters exist. The settings
   * section calls its `onChange` hook SYNCHRONOUSLY from `installSection`,
   * before registration has run, so a plain `let builtAdapter` declared later
   * would be read from its temporal dead zone ("Cannot access `builtAdapter`
   * before initialization") and abort the whole apply — which in turn leaves the
   * providers undeclared and the settings page unable to render them.
   */
  /** The domestic adapter, published for the CLI after registration. */
  let builtAdapter: WorkBuddyAdapter | undefined
  let invalidateCatalog = (): void => {}
  // Effective config: the plugin config, then the settings-scope value once
  // the XD Pool settings section joins (so edits made on the card's
  // Models settings page stay authoritative). A dedicated section is also what
  // tells the Host to mount the plugin's client card under Plugin config.
  /**
   * The effective config with every live volatile reference peeled.
   *
   * On 0.1.7 a field marked volatile is handed to the plugin as `{get(): T}` so
   * a settings edit is observed without a remount, and the loader keeps the
   * reference live. Every read below therefore goes through this view: a raw
   * reference compared against a string reports the field as unset, which is
   * how a saved reserve would read back as "0" while the file holds the value.
   * On 0.1.5 there is nothing to peel and this is the identity.
   */
  let rawCurrent: () => Config = () => config
  const current = (): Config => unwrapVolatileDeep(rawCurrent())
  const sectionHooks = {
    setSource(source: () => Config) { rawCurrent = source },
    onChange() { applyConfigFromSource() },
  }
  const applyConfigFromSource = (): void => {
    const { authFile, cooldownMs, distribution, disabledAccountIds, creditReserves, enabledModelIds, imageModelIds, contextBudgets, modelSelectionCn, modelSelectionGlobal, automation } = current()
    core.pool.applyConfig({
      ...authFile === undefined
        ? {}
        : { authDirs: [dirname(authFile)] },
      ...cooldownMs === undefined ? {} : { cooldownMs },
      // Absent reads as priority, so an install that never opened the card
      // drains one account at a time rather than splitting the spend.
      distribution: distribution ?? 'priority',
      ...disabledAccountIds === undefined ? {} : { disabledAccountIds },
      // Reserves travel with every other pool option, so a save on the card is
      // in force without a host restart.
      ...creditReserves === undefined ? {} : { creditReserves },
      // How long a spent account rests also shapes the automation: the task pass
      // skips a cooling account, so a short window means fewer accounts are
      // excluded when a job runs.
      ...automation?.exhaustCooldownMs === undefined ? {} : { exhaustCooldownMs: automation.exhaustCooldownMs },
    })
    // The model selection travels the same settings path as the pool options:
    // the card writes it through the settings section and each catalog filters
    // its own picker from it. Invalidating the adapter here is what makes a save
    // take effect without a host restart.
    //
    // Every region reads its OWN key. A region that has never been saved falls
    // back to the legacy flat keys, so an upgrade keeps the list the user was
    // already using instead of resetting one side to "everything".
    const legacySelection = {
      ...enabledModelIds === undefined ? {} : { enabledModelIds },
      ...imageModelIds === undefined ? {} : { imageModelIds },
      ...contextBudgets === undefined ? {} : { contextBudgets },
    }
    // When NEITHER the region key NOR the legacy keys name anything, keep the
    // selection already in force instead of applying an empty one.
    //
    // An absent `enabledModelIds` means "all enabled", which is right for a
    // fresh install but catastrophic as a fallback: a region key that goes
    // missing (hand-edited config, a profile or entry id that changed, a
    // marketplace install) used to fall back to `{}` and thereby WIDEN the
    // user's curated few models to the entire catalog. Losing a selection must
    // degrade to "unchanged", never to "everything".
    const fallbackSelection = (region: 'cn' | 'global') => {
      const legacyEmpty = legacySelection.enabledModelIds === undefined
        && legacySelection.imageModelIds === undefined
        && legacySelection.contextBudgets === undefined
      return legacyEmpty ? core.catalogs[region].currentSelection() : legacySelection
    }
    core.catalogs.cn.applySelection(modelSelectionCn ?? fallbackSelection('cn'))
    core.catalogs.global.applySelection(modelSelectionGlobal ?? fallbackSelection('global'))
    // The automation reads the same settings document, so a save on the card
    // re-arms it without a host restart. An absent block means off, which is why
    // this passes `enabled: false` explicitly rather than leaving it undefined.
    core.scheduler.applyConfig(automationOptions(automation))
  }
  // ---------------------------------------------------------------------
  // Settings registration, on whichever host line is running.
  //
  // The two lines do not share a settings API:
  //
  //   0.1.5  SettingsProvider.installSection(owner, ns, schema, entry, hooks)
  //          registers a NAMESPACE the plugin picks, and pushes changes back
  //          through the `hooks.onChange` callback.
  //   0.1.7  SettingsForms.configure({auto}, owner) registers the plugin
  //          INSTANCE and lets the host derive the form from the entry id;
  //          there is no `installSection` at all, and edits are announced as
  //          `loader/volatile-update` on the fiber context.
  //
  // Calling the wrong one unconditionally is what took the whole plugin down:
  // `ctx.settings.installSection(...)` on 0.1.7 throws "is not a function" from
  // inside `apply`, which cordis reports as a failed entry rather than a
  // degraded card. So the branch below is capability-probed, never assumed.
  //
  // `settings` is declared in this plugin top-level `inject`, so the service is
  // available synchronously here. Declaring it is also what keeps the host from
  // rendering this namespace with no settings view and reading `undefined`
  // while it builds the provider list (the "Cannot read properties of
  // undefined (reading get)" failure).
  // ---------------------------------------------------------------------
  const settingsService = ctx.settings as unknown as {
    installSection?: (
      owner: Context,
      ns: SettingsNamespace,
      schema: typeof Config,
      entry: Config,
      hooks: typeof sectionHooks,
    ) => void
    /**
     * 0.1.7 presentation policy for this plugin instance. `auto: true` lets the
     * host derive the form from the entry schema; the returned disposer must be
     * registered with this plugin effects or the policy outlives disposal.
     */
    configure?: (presentation: { auto?: boolean }, owner?: unknown) => () => void
    /**
     * Write paths. This service exposes NAMESPACE-scoped writers, not a bare
     * `set(key, value)`:
     *
     *   update(ns, patch)   merge a plain-object patch into the user section
     *   replace(ns, sect)   replace the user section wholesale
     *   mutate(ns, ops)     path-addressed edits
     *
     * Calling a non-existent `set` is what produced
     * "settings service unavailable; creditReserves was not saved" for every
     * save, on a machine where the service was present the whole time.
     */
    update?: (ns: SettingsNamespace, patch: Record<string, unknown>, expectedRevision?: unknown) => Promise<void> | void
  }
  if (typeof settingsService.installSection === 'function') {
    // 0.1.5: hand over the namespace and let the provider own the document.
    //
    // The config goes through `unwrapVolatileDeep` first: a volatile field is a
    // live `{get(): T}` reference on the lines that support the marker, and the
    // provider validates and structuredClones the whole object — a surviving
    // reference fails validation with a message naming the field but not the
    // cause, the namespace never registers, and the card silently disappears.
    // (On 0.1.5 the marker is a no-op, so this is the identity there.)
    settingsService.installSection(
      ctx,
      XDPOOL_SETTINGS_NS,
      Config,
      unwrapVolatileDeep(config),
      sectionHooks,
    )
  }
  if (typeof settingsService.configure === 'function') {
    // 0.1.7: the host derives the form from this entry and persists edits to
    // the profile patch itself. Registering the policy through `ctx.effect`
    // keeps the disposer wired to this plugin lifetime.
    ctx.effect(() => settingsService.configure?.({ auto: true }, ctx.fiber) ?? (() => {}))
  }
  if (typeof settingsService.installSection !== 'function' && typeof settingsService.configure !== 'function') {
    ctx.logger.warn?.('dsh-xdpool: settings service exposes neither installSection nor configure; the card will not mount')
  }
  // On 0.1.7 a saved edit lands in the profile patch and is announced as
  // `loader/volatile-update`; the loader then hands the plugin a fresh live
  // reference. Re-applying here is what makes a save on the card take effect
  // without a host restart. The event does not exist on 0.1.5, which pushes
  // changes through `hooks.onChange` instead — so on that line this listener
  // simply never fires.
  ;(ctx as unknown as { on(name: string, listener: () => void): unknown })
    .on('loader/volatile-update', () => { applyConfigFromSource() })
  // Apply the SAVED configuration once at startup, not only when it changes.
  //
  // On 0.1.7 `configure({auto})` registers the presentation policy and nothing
  // else: it reads no value and applies no value, and edits are announced as
  // `loader/volatile-update` (a listener, so it does not fire at boot). The
  // 0.1.5 line pushed the initial document through `installSection` →
  // `hooks.onChange`, which is why this only ever broke on the newer line.
  //
  // Without this call the pool, BOTH catalogs and the scheduler stay at their
  // constructor defaults until the user touches the card, so every restart
  // silently reverts the distribution, the automation switch and the model
  // selection even though the settings file still holds them. The read path was
  // never broken — `current()` resolves the loader's config — which is exactly
  // why the symptom looked like "the values are saved but ignored".
  applyConfigFromSource()
  // Written before anything below can throw, so the trace distinguishes "the
  // plugin never got as far as registering" from "registration was reached and
  // rejected" — the two look identical from the outside (a card with no models).
  recordStartupNote(
    `apply entered host=${typeof ctx.llm?.registerAdapter} settings=${typeof settingsService.installSection}/${typeof settingsService.configure}`,
  )
  /**
   * Write one key of the plugin's own settings section. Only ever called with
   * the three model-selection keys, so the settings file cannot be steered from
   * the browser; the catalog re-reads through `onChange` either way.
   */
  /**
   * Persist one settings key, then VERIFY it landed.
   *
   * The settings service resolves `set()` even when the write did not stick, so a
   * fire-and-forget call reports success while the file keeps the old value — and
   * the card then shows a value that silently reverts on the next read. That is
   * exactly the "I typed a reserve, reopened, and it still says 0" report: the
   * write was reported as saved but never reached the document. Every write now
   * awaits the setter and re-reads the document; a mismatch throws so the caller
   * surfaces a real error instead of claiming success.
   *
   * `expected` is what the caller believes it just wrote. Comparison goes through
   * a JSON round-trip so key order cannot cause a false mismatch.
   */
/**
 * Deep equality that ignores key order, used to verify a settings write.
 *
 * `JSON.stringify` is key-order sensitive, so comparing two equal objects whose
 * keys were inserted in a different order would report a false "not persisted"
 * failure — and a false failure on a write that DID land is as harmful as a
 * false success: it sends the user chasing a bug that is not there.
 */
function stableJsonEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}
  /**
   * The namespace `settings.update` expects on the running line.
   *
   * 0.1.5 resolves writers by the NAMESPACE the plugin registered through
   * `installSection`, so the plugin picks it. 0.1.7 resolves them by the HOST
   * PLUGIN ENTRY ID instead (`configEditor.entries().find(row => row.options.id
   * === ns)`), and the profile patch chooses that id — the live Desktop host
   * mounts this plugin as `llm-xdpool`, but a marketplace install can
   * wrap it (`mkt-...`) or mount it through an `include` row. Asking the fiber
   * for its own entry id is therefore the only correct answer there; guessing
   * our own namespace makes every save throw `No configurable plugin entry`.
   */
  const settingsWriteNs: SettingsNamespace = typeof settingsService.installSection === 'function'
    ? XDPOOL_SETTINGS_NS
    : (() => {
        try {
          const entryId = (ctx.fiber as unknown as { entry?: { options?: { id?: string } } })?.entry?.options?.id
          return (entryId === undefined || entryId === '' ? XDPOOL_SETTINGS_NS : entryId) as SettingsNamespace
        } catch {
          // No fiber entry (a programmatic probe): fall back to the declared id.
          return XDPOOL_SETTINGS_NS
        }
      })()
  const setSetting = async (key: string, value: unknown, expected?: unknown): Promise<void> => {
    if (value === undefined) return
    const update = settingsService?.update
    if (update === undefined) {
      throw new Error(`settings service has no update(); ${key} was not saved`)
    }
    // The service writes PER NAMESPACE (or per entry id on 0.1.7), so the key
    // becomes a one-field patch. Await it: a rejection must reach the caller
    // instead of only the log.
    await update.call(settingsService, settingsWriteNs, { [key]: value })
    // A resolved write is NOT proof the document changed — the provider can
    // accept and drop. Re-read and compare; mismatching is a real failure and
    // must surface, because a silently-reverting value is worse than an error.
    if (expected !== undefined) {
      const stored = (current() as Record<string, unknown>)[key]
      if (!stableJsonEqual(stored, expected)) {
        throw new Error(`settings field "${key}" was not persisted`)
      }
    }
  }
  // Persist the automation's daily earnings ledger through the same settings
  // path everything else uses. Without this the ledger lives only in memory, so
  // a host restart mid-day would show nothing for rewards the automation had
  // genuinely collected.
  //
  // The scheduler restores it in its own constructor, which runs before the
  // settings source is installed, so the read here re-primes it: a ledger saved
  // earlier today is folded back in as soon as the document is available.
  core.scheduler.setEarningsPersistence(async (ledger) => {
    await setSetting('automationEarnings', ledger, ledger)
  })
  const storedLedger = current().automationEarnings
  if (storedLedger !== undefined) core.scheduler.applyEarningsLedger(storedLedger)
  // One shim per region. Each carries its own ephemeral port and secret, and
  // each is scoped to its gateway's accounts, so the two providers are fully
  // independent: a failing region cannot take the other one down with it.
  // One recorder for BOTH regions on purpose. The panel answers "how much did
  // I call today", and two recorders would make that total a sum of two
  // unrelated half-tables - a number that looks authoritative and is wrong.
  const usageRecorder = new UsageRecorder()
  // A chain may name a pool model as well as a third-party one, so the catalog
  // is handed the CN roster: without it a chain pointing at `hy3` would drop
  // that member and advertise only the aggregate half. The CN rows are the
  // ones the CN shim can actually serve, which is where chains are answered.
  const aggregateCatalog = new AggregateCatalog(
    () => readAggregateSettingsSync(),
    () => core.catalogs.cn.current(),
  )
  void aggregateCatalog.refresh()
  // The免密 free lane. It owns its own roster behind its own provider id, so it
  // shares neither the pool's cooldown table nor its usage panel.
  //
  // Constructed with its static fallback already in place: a lane whose first
  // listing has not landed must still answer the picker, because an empty group
  // is the one thing a user reads as "the plugin is broken".
  const freeCatalog = new FreeCatalog()
  const freeLane = createFreeLaneSource(freeCatalog, ctx.logger, usageRecorder)
  /**
   * The login channels, for the LAN gateway.
   *
   * Reached through `ctx.llm` rather than a socket: the pack registers each
   * channel as a host adapter, so the host is the only thing that knows the
   * credential, the endpoint and the wire dialect.
   *
   * The two pool-owned ids are left out on purpose. `buddy` and `workbuddy` ARE
   * account pools this plugin already serves, so listing them again as channels
   * would offer the same models twice under two routes — and `buddy:` is already
   * the prefix the pool lane's own rows carry.
   */
  const channelLane = createChannelLane({
    llm: ctx.llm as unknown as ChannelLaneLlm,
    providers: () => REGISTERED_CHANNELS
      .map(channel => channel.id)
      .filter(id => channelListableAsRows(id, POOL_OWNED_CHANNELS)),
    toId: (channel, modelId) => `${channel}:${modelId}`,
    // An OpenAI `image_url` cannot reach a channel model as a URL: the host's
    // typed `ImageBlock` names a durable attachment, so the bytes go to the
    // store first and the block carries the reference it hands back. Same service
    // the pool's own image path uses (`adapter.ts` `resolveAttachments`).
    attachments: () => ctx.get('attachments') as
      | { saveImage: (input: { data: Uint8Array; mediaType: string; name?: string }) => Promise<unknown> }
      | undefined,
    logger: ctx.logger,
  })
  /**
   * The gateway allowlist, re-read per request.
   *
   * `undefined` and `[]` are deliberately NOT collapsed: the first means the
   * user has never opened the picker, and the second means they unticked
   * everything. Reading the stored field directly rather than through
   * `relaySettingsOf` is what preserves that, since the relay's own settings
   * object has no reason to carry a list it never consults.
   */
  const lanModelsOf = (): readonly string[] | undefined => readAggregateSettingsSync().relay?.models
  const shims = {
    cn: createWorkBuddyShim({
      pool: core.pool,
      client: core.client,
      catalog: core.catalogs.cn,
      logger: ctx.logger,
      region: 'cn',
      usageRecorder,
      // The aggregate lane rides on the CN shim and nowhere else: it has no
      // gateway to be scoped to, so mounting it twice would list the same
      // third-party models under two providers the user cannot tell apart.
      aggregate: { catalog: aggregateCatalog, readStore: () => readAggregateSettingsSync() },
      // The free lane rides on the CN shim as well: its model ids carry the
      // lane's own prefix, which is what selects the upstream, so it needs no
      // gateway of its own and no second loopback listener.
      extra: { free: freeLane },
      // The login channels ride on the CN shim too, for the same reason the
      // aggregate and free lanes do: their ids carry their own channel prefix, so
      // the shim selects the upstream from the id and needs no listener of its
      // own. It is also the shim the LAN relay forwards to, which makes this the
      // one place those models become reachable over OpenAI wire.
      channels: channelLane,
      // The card's Gateway checkboxes. Enforced only on relay-originated
      // requests, so DSH's own picker is never narrowed by a list meant for
      // other machines.
      lanModels: lanModelsOf,
    }),
    global: createWorkBuddyShim({ pool: core.pool, client: core.client, catalog: core.catalogs.global, logger: ctx.logger, region: 'global', usageRecorder }),
  } as const
  const shim = shims.cn
  /** Resolve a region's loopback origin once it has bound a port. */
  const shimInfo = (which: 'cn' | 'global'): { running: boolean; baseUrl?: string } => {
    try {
      const baseUrl = shims[which].baseUrl()
      return { running: true, baseUrl }
    } catch {
      return { running: false }
    }
  }
  let stopped = false
  /**
   * The LAN relay, mounted on the CN shim only.
   *
   * It is not folded into the shim's own listener on purpose — see
   * `src/relay.ts`: the shim secret is per-process, and handing it to every
   * device on the network would break every client on the next DSH restart.
   * The relay holds that secret and authenticates clients with a key of its own.
   */
  const relay = createPoolRelay({
    shim: shims.cn,
    read: () => relaySettingsOf(readAggregateSettingsSync()),
    logger: ctx.logger,
  })
  ctx.effect(() => () => {
    stopped = true
    // Before the shim it points at: a relay must not outlive the listener it
    // forwards to, or it keeps accepting requests it can only answer with 502.
    void relay.close()
    void shims.cn.close()
    void shims.global.close()
    // The scheduler holds a timer; stop it before the shims so a tick in flight
    // cannot reach an upstream client whose base has already gone.
    core.scheduler.stop()
  })
  void relay.ready.catch((error: unknown) => {
    ctx.logger.warn(`xdpool relay: startup failed — ${String(error)}`)
  })
  /**
   * The relay document the Gateway card reads.
   *
   * One loader for BOTH routes rather than a per-route assembly: the card takes
   * the write response as the new state, so a save that answered with only the
   * listener status dropped the picker's roster off the card until the next poll.
   */
  const relayDocument = () => relayDocumentOf({
    status: () => relay.status(),
    shared: () => readAggregateSettingsSync().relay?.models,
    roster: () => shim.roster(),
    warn: error => ctx.logger.warn('dsh-xdpool: gateway roster failed', error),
  })
  // Same-origin routes backing the XD Pool settings card. `webServer`
  // is an optional service: on a headless profile without it, no card routes
  // mount and the card shows an offline banner — the provider still works.
  ctx.inject(['webServer'], (webCtx) => registerPoolStatusRoute(webCtx, {
    pool: core.pool,
    catalogs: core.catalogs,
    client: core.client,
    // The usage panel reads the SAME recorder both shims write to, so its totals
    // cover every gateway rather than one half of them.
    usage: () => usageRecorder.summary(),
    shim: () => shimInfo('cn'),
    // The automation is pool-wide, not per region, so both routes read the same
    // scheduler snapshot.
    scheduler: () => core.scheduler.status(),
    // Starts the pass in the background and returns immediately: a full run takes
    // tens of seconds, and the card polls the status document for the result.
    runAutomation: (_job: string, _force: boolean) => core.scheduler.startRunAll(),
    // The settings section owns the model selection; this is the write half of
    // the card's save round-trip. It goes through `settingsScope.set` (below)
    // so the change lands in the same document the model picker reads.
    //
    // The region is written to its own key: saving the domestic tab must never
    // rewrite the international picker, because the two gateways advertise
    // different rosters and the user curates them separately.
    saveSelection: async (region, selection) => {
      const payload = {
        ...selection.enabledModelIds === undefined ? {} : { enabledModelIds: [...selection.enabledModelIds] },
        ...selection.imageModelIds === undefined ? {} : { imageModelIds: [...selection.imageModelIds] },
        ...selection.contextBudgets === undefined ? {} : { contextBudgets: { ...selection.contextBudgets } },
      }
      await setSetting(modelSelectionKeyFor(region), payload, payload)
    },
    // Flip one account in or out of the pool. Read-modify-write rather than a
    // full overwrite: the card sends one account per request, so two tabs
    // toggling different accounts cannot clobber each other.
    setAccountDisabled: async (accountId, disabled) => {
      const currentIds = current().disabledAccountIds ?? []
      const next = disabled
        ? currentIds.includes(accountId) ? currentIds : [...currentIds, accountId]
        : currentIds.filter(id => id !== accountId)
      await setSetting('disabledAccountIds', next, next)
    },
      // Set one account's reserved-credit floor. Also a read-modify-write:
      // the card sends a single account, so two tabs editing different
      // accounts cannot overwrite each other. A zero clears the entry rather
      // than storing it, so the settings file only names real reserves.
      setCreditReserve: async (accountId, reserve) => {
        const next = { ...current().creditReserves ?? {} }
        if (reserve > 0) next[accountId] = reserve
        else delete next[accountId]
        await setSetting('creditReserves', next, next)
      },
    // Throw one account out of the pool for good, or take it back.
    //
    // The ignore list is NOT a settings key: the CLI has no settings service, so
    // a settings-only list could be written by the card and never by the
    // terminal. Both halves read and write this one plugin-owned file instead,
    // which is what keeps `ignore` from the CLI and the card's button in step.
    //
    // The account's label is captured at ignore time so the card can list it
    // without re-reading a credential it has deliberately stopped reading.
    setAccountIgnored: async (accountId, ignored) => {
      if (ignored) {
        const known = core.pool.list().find(account => account.id === accountId)
        await ignoreAccount({ id: accountId, ...known === undefined ? {} : { label: known.label } }, ignoredPath)
      } else {
        await unignoreAccount(accountId, ignoredPath)
      }
      refreshIgnored()
      // A newly ignored account must leave the pool immediately, and a
      // restored one must come back without waiting for the next tick.
      if (!ignored) await core.pool.scan()
    },
    ignoredAccounts: () => ignoredAccounts,
    // Pin one account to be tried first, or clear the pin with null.
    //
    // Same file-backed reasoning as the ignore list: `dsh-xdpool prefer`
    // writes this file from a terminal with no host running, and a pin that only
    // the card could set would make the CLI command a lie.
    //
    // Order matters and is the whole point: the file is written FIRST, so a
    // failure leaves the pin unchanged rather than applied-but-unremembered (the
    // mirror image of the ignore list's own hazard), and the pool is updated
    // BEFORE the handler resolves, so the card's next poll and the very next
    // request both already agree with what the user just pressed.
    setPreferredAccount: async (accountId) => {
      await writePreferredId(accountId ?? undefined, preferredPath)
      applyPreferred(accountId ?? undefined)
    },
    // Re-fetch both regions' catalogs on demand. This is what the card's
    // "refresh models" button calls; before it existed, a startup fetch failure
    // left the static (shorter) roster in place until DSH was restarted.
    refreshCatalog: async () => {
      const result = await seedCatalog()
      invalidateCatalog()
      return result
    },
    // One read for the card's aggregate document: the store says which
    // providers are configured, and the RUNNING catalog says which rows that
    // actually produces. Reading them separately could straddle a save and show
    // a provider as configured while contributing nothing.
    aggregateDocument: (): PoolWebAggregateStatus => aggregateStatusOf(
      readAggregateSettingsSync(),
      // Provider rows only: this document is the aggregate lane's provider
      // table, and a chain is a route over models, not a vendor with a key.
      // Chain rows are answered by the `/combos` document instead.
      aggregateCatalog.providerRows().map(toWebAggregateModel),
    ),
    saveAggregate: async (patch: PoolWebAggregatePatch): Promise<PoolWebAggregateStatus> => {
      if (patch.kind === 'lane') await setAggregateEnabled(patch.enabled)
      else if (patch.kind === 'clear') await clearProviderSetting(patch.providerId)
      else {
        await updateProviderSetting(patch.providerId, {
          ...patch.enabled === undefined ? {} : { enabled: patch.enabled },
          ...patch.apiKey === undefined ? {} : { apiKey: patch.apiKey },
          ...patch.baseUrl === undefined ? {} : { baseUrl: patch.baseUrl },
          ...patch.models === undefined ? {} : { models: patch.models },
        })
      }
      // Refreshing here is what makes a new key appear in the model picker
      // without a DSH restart — the reason the whole panel exists.
      await aggregateCatalog.refresh()
      return aggregateStatusOf(readAggregateSettingsSync(), aggregateCatalog.providerRows().map(toWebAggregateModel))
    },
    // Probe and discover share one implementation; the route decides whether the
    // answer is displayed or written back, so the two cannot drift.
    probeAggregate: async (providerId: string): Promise<PoolWebAggregateProbe> => {
      const probe = await probeAggregateProvider(readAggregateSettingsSync(), providerId)
      return { ok: probe.ok, status: probe.status, message: probe.message, ...probe.modelCount === undefined ? {} : { modelCount: probe.modelCount }, ...probe.modelIds === undefined ? {} : { modelIds: probe.modelIds } }
    },
    /**
     * One real streaming call, for the card's per-model "test connection" button.
     *
     * Routed through `ctx.llm.stream` rather than through any of this plugin's
     * own lanes, and that is the whole point: `ctx.llm` is the host's adapter
     * registry, so it resolves the provider/model pair to whichever credential
     * and endpoint actually serve it — including lanes this plugin knows nothing
     * about. Asking our own shims instead would make the button report on the
     * plumbing rather than on the model the user clicked.
     *
     * Never throws (see {@link probeModelConnectivity}): the measurement is the
     * answer, and a rejection here would show as a bare route failure that reads
     * like a wrong key.
     */
    probeModel: async (provider: string, model: string, signal?: AbortSignal): Promise<PoolWebModelProbeResult> => {
      // The host types `ctx.llm` itself; the cast is to this module's minimal
      // structural slice rather than to `any`, so a change in the host's stream
      // signature that breaks the fields we actually read is still caught here.
      return probeModelConnectivity(
        ctx.llm as unknown as Parameters<typeof probeModelConnectivity>[0],
        provider,
        model,
        { signal },
      )
    },
    /**
     * What each login channel contributes, read from the host's own catalogue.
     *
     * Not from the pack, on purpose. The pack's `model.list` keeps the id, the
     * name and two flags and drops the rest, and the rest is exactly what the
     * login page is asked to show. The host's `listModels` is also the same
     * catalogue the model picker builds from, so a row's window here is the
     * window the picker will enforce.
     *
     * `listModels` is a LISTING, though: the host's own answer carries only the
     * id, the name, a description and the input modalities, and the host drops
     * the context window out of it on the way out (its listing mapper keeps
     * four fields). The window lives one call deeper, on
     * `resolveModelInfo(provider, model)` — which is where the model picker and
     * the compaction planner read it from — so a second pass over each row is
     * the only way to show a context size that matches what will actually be
     * enforced.
     *
     * That second pass is bounded and per-row isolated: adapters resolve a model
     * from their own cache in the common case, a row that cannot be resolved
     * simply prints no window, and a channel's answer is never held up by one
     * model it could not describe.
     *
     * A provider with no adapter registered under it is left out of the record
     * instead of being reported empty: "not signed in" and "signed in with
     * nothing to offer" would otherwise be drawn identically, and the user has
     * no way to tell which one they are looking at.
     */
    channelModels: async (
      providers: readonly string[],
      hints?: Readonly<Record<string, readonly string[]>>,
    ): Promise<Readonly<Record<string, readonly PoolWebChannelModel[]>>> => {
      const models: Record<string, readonly PoolWebChannelModel[]> = {}
      // Six at a time rather than all at once: some adapters resolve a model by
      // asking their upstream, and a channel publishing thirty models would
      // otherwise open thirty sockets to answer a card nobody is looking at yet.
      const resolveConcurrency = 6
      for (const provider of providers) {
        try {
          /*
            The id list comes from the caller when it has one.
            
            `llm.listModels` is the obvious source and it is the wrong one here:
            it sits behind the pack's credential gate, so a channel the host
            considers invisible answers `[]` even while its card is on screen
            showing nine models. That is exactly how every channel row ended up
            with no window and "text only" — the facts were resolvable, there was
            simply nothing to resolve them for. The caller has just rendered the
            ids from `model.list` (which does not pass that gate), so its list is
            authoritative about *which* models exist; this route only adds what
            each one is.
          */
          const hinted = hints?.[provider]
          const rows: readonly { id: string, name: string, description?: string, inputModalities?: readonly string[] }[] =
            hinted !== undefined && hinted.length > 0
              ? hinted.map(id => ({ id, name: id }))
              : await ctx.llm.listModels(provider)
          const resolved = new Map<string, PoolWebChannelModel>()
          let next = 0
          const workers = Array.from({ length: Math.min(resolveConcurrency, rows.length) }, async () => {
            while (next < rows.length) {
              const row = rows[next++]
              // Read the id out first: a shared cursor under
              // `noUncheckedIndexedAccess` is typed as possibly absent even
              // though the bound check above proves it, and every later use of
              // the row would carry that doubt.
              if (row === undefined) continue
              let extra: Partial<PoolWebChannelModel> = {}
              try {
                const info = await ctx.llm.resolveModelInfo(provider, row.id)
                extra = {
                  ...info.context?.contextWindow === undefined
                    ? {}
                    : { contextWindow: info.context.contextWindow },
                  ...info.defaultMaxTokens === undefined ? {} : { maxTokens: info.defaultMaxTokens },
                  ...info.inputModalities === undefined ? {} : { inputModalities: info.inputModalities },
                }
              } catch (cause: unknown) {
                // An adapter that cannot describe one exact model is the norm
                // for the channels whose catalogue is a bare id list, and the
                // row stays printable without it — the host's own model picker
                // renders the same row with no figures.
                void cause
              }
              resolved.set(row.id, {
                id: row.id,
                // A hinted row has no name of its own; the caller keeps the one
                // it rendered, and the id is the honest stand-in here.
                name: row.name,
                ...row.description === undefined ? {} : { description: row.description },
                ...row.inputModalities === undefined ? {} : { inputModalities: row.inputModalities },
                ...extra,
              })
            }
          })
          await Promise.all(workers)
          models[provider] = rows
            .map(row => resolved.get(row.id))
            .filter((row): row is PoolWebChannelModel => row !== undefined)
        } catch {
          // No adapter, or the adapter refused to list. Either way the answer is
          // "nothing to show for this one", and the page draws no model row for
          // it — which is what an unsignable channel looks like anyway.
        }
      }
      return models
    },
    discoverAggregate: async (providerId: string): Promise<PoolWebAggregateProbe> => {
      const store = readAggregateSettingsSync()
      const probe = await probeAggregateProvider(store, providerId)
      if (!probe.ok || probe.modelIds === undefined) {
        return { ok: probe.ok, status: probe.status, message: probe.message, ...probe.modelCount === undefined ? {} : { modelCount: probe.modelCount } }
      }
      // An authoritative EMPTY listing is a real answer and DOES commit: the
      // provider serves nothing under this key, and reporting `committed: 0`
      // rather than an error is what tells the user which of the two happened.
      // A failed round keeps the previous roster instead — an empty one would
      // delete models the user configured on purpose.
      //
      // The listing lands in `discovered` and NEVER in `models`: `models` is the
      // user's choice, and writing a fetch into it would silently re-enable
      // every model they had just unticked and leave them no way back. A vendor
      // whose roster shrinks therefore keeps exposing the ids it still offers
      // and drops the ones that went away, because `modelIdsFor` intersects the
      // choice with the roster rather than trusting the stored list.
      await updateProviderSetting(providerId, { discovered: probe.modelIds })
      await aggregateCatalog.refresh()
      return {
        ok: true,
        status: probe.status,
        message: probe.message,
        ...probe.modelCount === undefined ? {} : { modelCount: probe.modelCount },
        modelIds: probe.modelIds,
        committed: probe.modelIds.length,
      }
    },
    // The login-channel list is a pure read of what mounted. It answers
    // `pending` until the pack's dynamic import settles, which is the honest
    // answer — the card shows a loading line rather than an empty grid that
    // would read as "this host supports no channels at all".
    channelsDocument: (): PoolWebChannelsStatus => {
      const state = channels.state()
      return {
        state: state.state,
        // `reason` is omitted rather than set for a pending mount: "not ready yet"
        // is not a failure and must not be rendered as one.
        ...state.state === 'unavailable' ? { reason: state.reason } : {},
        channels: REGISTERED_CHANNELS.map((channel) => ({
          id: channel.id,
          name: channel.name,
          org: channel.org,
          // `...channel.domain === undefined ? {} : { domain: channel.domain }`
          // rather than `domain: channel.domain` because
          // `exactOptionalPropertyTypes` is on: assigning `undefined` to an
          // optional property is a type error, and the wire contract is
          // "absent means the vendor publishes no host".
          ...channel.domain === undefined ? {} : { domain: channel.domain },
          accent: channel.accent,
          note: channel.note,
          loginKind: channel.login,
          ownedByPool: POOL_OWNED_CHANNELS.has(channel.id),
          ...channel.smsHint === true ? { smsHint: true } : {},
          // Forwarded only when the pack actually has a branch for this
          // provider: an absent `credits` is what tells the card "there is
          // nothing to read here", and sending `{claim:false,status:false}`
          // for all thirteen would turn a missing feature into a broken one.
          ...channel.credits === undefined ? {} : { credits: channel.credits },
        })),
      }
    },
    // One read for the whole routing document. The pool roster is passed in
    // rather than read here because the catalog already holds a reference to it:
    // two sources for the same list could disagree, and a chain that resolved
    // against a different roster than the one displayed is exactly the kind of
    // self-contradiction this panel must not have.
    combosDocument: (): PoolWebCombosStatus =>
      combosStatusOf(readAggregateSettingsSync(), aggregateCatalog, core.catalogs.cn.current()),
    saveCombos: async (raw: unknown): Promise<PoolWebCombosStatus> => {
      await writeCombos(raw)
      // Refresh before answering, so a chain written here is pickable in the
      // same breath instead of after a restart. `writeCombos` normalises on the
      // way in, so what comes back out is what will actually be served.
      await aggregateCatalog.refresh()
      return combosStatusOf(readAggregateSettingsSync(), aggregateCatalog, core.catalogs.cn.current())
    },
    // A read-only relay to a separately installed billion-context proxy. It
    // resolves "is one running, where, and what is it holding" and returns a
    // `missing` state rather than an error when there is none — which is the
    // normal case on a machine that has not installed it.
    billionDocument: readBillionStatus,
    /**
     * Relay state plus the gateway's model picker.
     *
     * The candidates come from the shim's own roster rather than a parallel
     * assembly here, so the card cannot offer a model the gateway would then
     * refuse — the exact drift the picker exists to prevent.
     */
    relayDocument,
    /**
     * Apply one patch from the card and answer with the fresh document.
     *
     * The write path mints a key when the card asks for a rotation and the user
     * has never had one: an enabled relay with no key would have to either refuse
     * everyone (so the switch silently does nothing) or accept everyone. Minting
     * one keeps "enabled" honest, and the card shows it so it can be pasted into
     * the other device.
     */
    saveRelay: async (patch: PoolWebRelayPatch): Promise<PoolWebRelayStatus> => {
      const current = readAggregateSettingsSync()
      const before = current.relay ?? {}
      // Rotation is `key: ''` — an empty key CLEARS in the store, so the new one
      // has to be minted here rather than passed through as an empty string.
      const key = patch.key === '' ? newRelayKey() : patch.key
      const wanted: Partial<RelaySetting> = {
        ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
        ...(patch.host === undefined ? {} : { host: patch.host }),
        ...(patch.port === undefined ? {} : { port: patch.port }),
        // Falling back to the stored key means a first-time enable does not
        // accidentally rotate and lock out a device the user already set up.
        key: key ?? before.key ?? newRelayKey(),
        // Passed through as written: an empty array is "share nothing", a
        // decision, not an absence. The store trims and de-duplicates on the way in.
        ...(patch.models === undefined ? {} : { models: patch.models }),
      }
      await writeRelaySetting(wanted)
      // Re-evaluate the listener from what was actually persisted, not from the
      // patch: a port the store refused (out of range) must not leave the
      // relay listening where the user asked when the file says otherwise.
      await relay.sync()
      // The SAME document the GET answers with, not the bare listener status: the
      // card renders the write response as the new state, so an answer without the
      // roster blanked the model picker on every save — switch, address, key, or
      // the share list itself.
      return relayDocument()
    },
  }))
  api = {
    ...core,
    shim,
    get adapter() { return builtAdapter },
    async rescan() {
      const accounts = await core.pool.scan()
      ctx.logger.info?.(`dsh-xdpool: discovered ${accounts.length} account(s)`)
      // Also re-fetch the catalog. "Detect accounts again" is the button users
      // reach for when the model list looks wrong, and re-scanning accounts
      // alone could never fix a list that had fallen back to the static table —
      // so the obvious remedy silently did nothing.
      await seedCatalog()
      invalidateCatalog()
      return accounts.length
    },
    async status(includeCredits = false) {
      return buildStatus({
        pool: core.pool,
        catalog: core.catalogs.cn,
        client: core.client,
        shim: shimInfo('cn'),
        includeCredits,
      })
    },
    resetCooldowns() {
      core.pool.resetCooldowns()
    },
  }
  // Start the automation last, once every runtime object exists: a tick firing
  // immediately must not find a half-applied core. The scheduler no-ops while
  // `enabled` is false, so this is safe on an install that never opened the card.
  core.scheduler.start()
  // The vendored free-channel pack (thirteen login channels).
  //
  // Mounted on a fiber of its own, gated on the three services its exported
  // `inject` declares. Passing our ctx straight through would register the pack
  // eagerly on services we already hold but which the host may not have provided
  // by the time we run, and a throw here would take the account pool down with
  // it. Cordis resolves the gate, so the mount happens exactly when
  // `credentials`, `commands` and `llm` are all live, and a composition that
  // never provides `commands` simply loses the channels — the same trade every
  // optional service in this plugin already makes.
  //
  // `stopped` is captured rather than read: the pack's `apply` is synchronous and
  // installs its own effects on the scoped fiber, so mounting one after this
  // plugin has been torn down would leave it running with nothing to unhook it.
  let channels: MountedChannelPack = { state: () => ({ state: 'pending' }) }
  ctx.inject(['credentials', 'commands'], (scoped) => {
    // The `llm` gate is the plugin's own, already resolved before `apply` was
    // called — so only the two the pack adds are requested here. A composition
    // that never provides `commands` simply never runs this fiber, and the
    // channels stay `pending` rather than reporting a failure the host cannot act
    // on.
    //
    // `stopped` gates the mount itself, not just the log: the pack's `apply` is
    // synchronous and installs its own effects on the fiber, so mounting after
    // teardown would leave thirteen adapters running with nothing to unhook them.
    const mount = async (): Promise<void> => {
      const mounted = await mountChannelPack(scoped, ctx.logger)
      if (stopped) return
      channels = mounted
    }
    void mount()
      .catch((error: unknown) => {
        if (stopped) return
        ctx.logger.warn(`[xdpool] free-channel pack unavailable (${error instanceof Error ? error.message : String(error)})`)
        channels = {
          state: () => ({
            state: 'unavailable',
            reason: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
          }),
        }
      })
      .finally(() => {
        // Whether this copy won the mount race or lost it, the accounts the user
        // signed in through the scan-login page live in the SAME pool — the two
        // plugins vendor one identical pack, and whichever registered the cordis
        // service first owns it. So the wiring is attempted either way, and a
        // loss is not an error: it is just another reader of the same object.
        if (stopped) return
        void adoptChannelPackAccounts(ctx, core.pool, ctx.logger)
      })
  })
  // The compressor behind the billion card. Mounted from its own fiber, off the
  // critical path and outside every try block below: a proxy that will not start
  // is a card that says so, and the account pool has no reason to care.
  //
  // The outcome is recorded rather than merely attempted, because the card's
  // "missing" state has two very different causes — the package never got
  // installed, or the host refused to mount it — and this line is where a user
  // reporting a blank billion page sends us.
  void mountBillionContext(ctx, ctx.logger).then((outcome: MountedBillionContext) => {
    recordStartupNote(`billion-context ${outcome.state}`)
    if (outcome.state === 'unavailable') {
      ctx.logger.warn(`[xdpool] billion-context not mounted — ${outcome.reason}`)
    }
  }, (error: unknown) => {
    recordStartupNote(`billion-context mount failed: ${describeError(error)}`)
  })
  // Register once BOTH loopback listeners hold a port: each adapter reads its
  // shim origin at construction time, so neither can be built any earlier.
  void Promise.all([shims.cn.ready, shims.global.ready])
    .then(async () => {
      if (stopped) return
      recordStartupNote(`both shims ready cn=${shims.cn.baseUrl()} global=${shims.global.baseUrl()}; entering registration`)
      try {
        // One adapter per region. Each provider is bound to its own account
        // slice of the pool (see the `region` argument on `pool.acquire`), so a
        // CN request can never be served by a global account and vice versa —
        // the two gateways are not interchangeable.
        const adaptersByRegion = {
          cn: createWorkBuddyAdapter({
            ctx,
            shim: shims.cn,
            catalog: core.catalogs.cn,
            providerId: POOL_PROVIDER_BY_REGION.cn,
            displayName: POOL_NAME_BY_REGION.cn,
          }),
          global: createWorkBuddyAdapter({
            ctx,
            shim: shims.global,
            catalog: core.catalogs.global,
            providerId: POOL_PROVIDER_BY_REGION.global,
            displayName: POOL_NAME_BY_REGION.global,
          }),
          // The third lane: providers the user holds a key for. It reuses the CN
          // shim's loopback (the composite model id in the request is what
          // selects an upstream) but keeps its OWN catalog and its own provider
          // id, so a third-party failure never touches the pool's cooldown table.
          aggregate: createWorkBuddyAdapter({
            ctx,
            shim: shims.cn,
            catalog: aggregateCatalog,
            providerId: XDPOOL_AGGREGATE_PROVIDER,
            displayName: '聚合渠道',
          }),
          // The免密 lane: a pooled gateway credential with a per-session quota.
          // Its own provider id keeps that shared quota out of the pool's cooldown
          // table and its tokens out of the pool's usage panel.
          free: createWorkBuddyAdapter({
            ctx,
            shim: shims.cn,
            catalog: core.catalogs.cn,
            providerId: XDPOOL_FREE_PROVIDER,
            displayName: EXTRA_LANE_NAMES.free,
            extraRows: () => freeCatalog.current(),
          }),
        } as const
        // The disposer the host hands back from `registerAdapter` also carries
        // `replace(routes)`. That is the ONLY way a plugin can make the host
        // publish `llm/adapters-updated`: the event is emitted from the host's
        // own `commitRoutes`, which no plugin can reach. Re-registering under
        // the same identities is the documented shape of "these routes are now
        // served by a rebuilt adapter".
        let releaseAdapterCn: AdapterHandle | undefined
        let releaseAdapterGlobal: AdapterHandle | undefined
        let releaseAdapterAggregate: AdapterHandle | undefined
        let releaseAdapterFree: AdapterHandle | undefined
        let releaseDirectory: (() => void) | undefined
        // Adapters first, in a try of their own, and ONLY THEN the directory.
        //
        // `registerConfigurableProviders` is all-or-nothing: the host validates
        // the whole array inside one `commit` loop and throws on the first entry
        // that fails (`dsh-llm/lib/index.js`, `registerConfigurableProviders`),
        // so one rejected entry costs all five providers their picker entry.
        // Doing this in a single try made the release `finally` unwind the
        // adapters along with it — a rejected directory left the card mounted and
        // every model gone. Registering the adapters separately means a
        // directory rejection now costs the settings entry alone and the models
        // keep being served.
        try {
          releaseAdapterCn = ctx.llm.registerAdapter(
            [POOL_PROVIDER_BY_REGION.cn, 'buddy'],
            adaptersByRegion.cn.adapter,
          )
          releaseAdapterGlobal = ctx.llm.registerAdapter(
            [POOL_PROVIDER_BY_REGION.global, 'workbuddy'],
            adaptersByRegion.global.adapter,
          )
          releaseAdapterAggregate = ctx.llm.registerAdapter(
            [XDPOOL_AGGREGATE_PROVIDER],
            adaptersByRegion.aggregate.adapter,
          )
          // The free lane registers in the SAME try as the three pool adapters,
          // deliberately. It is the same kind of thing — a pi-ai provider over
          // the same loopback shim — so if it cannot be created the plugin is no
          // longer in a state it should advertise at all, and letting three
          // through would only hide that.
          releaseAdapterFree = ctx.llm.registerAdapter(
            [XDPOOL_FREE_PROVIDER],
            adaptersByRegion.free.adapter,
          )
        } catch (error: unknown) {
          // An adapter that cannot be created is not survivable — the picker
          // would advertise a provider with nothing behind it — so this is the
          // one path that still unwinds everything and gives up.
          ctx.logger.error('dsh-xdpool: adapter registration failed', error)
          recordStartupNote(`adapters REJECTED: ${describeError(error)}`)
          releaseAdapterCn?.()
          releaseAdapterGlobal?.()
          releaseAdapterAggregate?.()
          releaseAdapterFree?.()
          return
        }
        try {
          // Both entries go in ONE call: the host mounts a single configuration
          // form for the pair, sharing the plugin settings section. Registering
          // them one at a time left the second call reading a registry entry the
          // first had not finished creating (the `reading 'get'` failure).
          releaseDirectory = ctx.llm.registerConfigurableProviders([
            {
              provider: POOL_PROVIDER_BY_REGION.cn,
              displayName: POOL_NAME_BY_REGION.cn,
              settingsNs: XDPOOL_SETTINGS_NS,
              settingsPath: [],
              declared: false,
            },
            {
              provider: POOL_PROVIDER_BY_REGION.global,
              displayName: POOL_NAME_BY_REGION.global,
              settingsNs: XDPOOL_SETTINGS_NS,
              settingsPath: [],
              declared: false,
            },
            {
              // No settings form: every aggregate provider's key lives in the
              // plugin's own store file, so the host has nothing to render and
              // mounting an empty form would only invite the user to look for it.
              provider: XDPOOL_AGGREGATE_PROVIDER,
              displayName: '聚合渠道',
              settingsNs: XDPOOL_SETTINGS_NS,
              settingsPath: [],
              declared: false,
            },
            {
              // Grouped so the picker shows the免密 lane beside the pool rather
              // than folding it in: the rows come from a different gateway and
              // spend a different quota, and a user who cannot tell them apart
              // cannot tell which one answered.
              provider: XDPOOL_FREE_PROVIDER,
              displayName: EXTRA_LANE_NAMES.free,
              settingsNs: XDPOOL_SETTINGS_NS,
              settingsPath: [],
              declared: false,
            },
          ])
        } catch (error: unknown) {
          // Recoverable on purpose. The adapters above are already live and the
          // catalog answer below is installed independently, so the plugin keeps
          // serving models with no settings form to mount — the user sees a
          // working provider in the picker and can fix the settings entry later,
          // instead of a mounted card with an empty picker.
          ctx.logger.error('dsh-xdpool: configurable-provider directory rejected; models will still be served', error)
          recordStartupNote(`directory REJECTED: ${describeError(error)}`)
        }
        // The rename note goes in the trace, not the log.
        //
        // The only thing a rename can break that the plugin cannot fix itself is
        // a default model pinned to a pre-rename provider id — that pin lives in
        // the host profile's own settings, which this plugin must not edit. The
        // picker would simply show the old id as unavailable, and nothing else
        // in the running system would say why. One line in the trace file turns
        // that into a named file and a named replacement.
        recordStartupNote(describeProviderIdRename())
        builtAdapter = adaptersByRegion.cn
        // From here on a settings change can rebuild the picker. Until this line
        // runs, `invalidateCatalog` is the no-op seeded at the top of apply.
        invalidateCatalog = () => {
          adaptersByRegion.cn.invalidate()
          adaptersByRegion.global.invalidate()
          adaptersByRegion.aggregate.invalidate()
          adaptersByRegion.free.invalidate()
          // `invalidate()` only swaps the adapter's own snapshot. The host keeps
          // a second snapshot keyed by the identity of our `profiles` map, and
          // it is the host's copy the picker reads — so rebuilding here without
          // re-committing the routes leaves the visible list untouched. Asking
          // the handle to replace its (unchanged) route set is what makes the
          // host drop that cache and publish `llm/adapters-updated`, which is
          // also what refreshes every open client view.
          for (const [handle, routes] of [
            [releaseAdapterCn, [POOL_PROVIDER_BY_REGION.cn]],
            [releaseAdapterGlobal, [POOL_PROVIDER_BY_REGION.global]],
            [releaseAdapterAggregate, [XDPOOL_AGGREGATE_PROVIDER]],
            [releaseAdapterFree, [XDPOOL_FREE_PROVIDER]],
          ] as const) {
            if (handle === undefined) continue
            try {
              handle.replace([...routes])
            } catch (error: unknown) {
              // A released registration throws REGISTRATION_DISPOSED. Reload
              // during teardown is ordinary, so this must not take the settings
              // apply down with it.
              ctx.logger.warn('dsh-xdpool: could not re-announce adapter routes', error)
            }
          }
        }
        // A stored provider (key added, provider switched off, model list pinned)
        // rewrites the aggregate roster. Without this the picker's three-region
        // count would only move on restart — the one failure mode the whole
        // stored-file design was chosen to avoid.
        void aggregateCatalog.onChange(() => {
          invalidateCatalog()
        })
        // The same for the free lane: its roster is read live, so a
        // listing that lands after startup has to be able to move the picker
        // without a restart. This is also what makes a failed refresh honest —
        // the rows are kept, so the picker keeps them.
        void freeCatalog.onChange(() => {
          invalidateCatalog()
        })
        /** Release everything the providers registered, once. */
        const releaseProviders = (): void => {
          releaseAdapterCn?.()
          releaseAdapterGlobal?.()
          releaseAdapterAggregate?.()
          releaseAdapterFree?.()
          releaseDirectory?.()
        }
        try {
          ctx.effect(() => releaseProviders)
        } catch {
          // The plugin was disposed while registering; release immediately.
          releaseProviders()
        }
        // The model picker asks the host for a provider's catalog; answering
        // here (rather than only from the adapter's static snapshot) is what
        // makes a saved selection visible without a restart. Each region answers
        // from its own catalog — the two gateways do not advertise the same
        // roster, so one shared list would serve the wrong models to one of them.
        ctx.llm.registerModelDiscovery(XDPOOL_SETTINGS_NS, async (request: { provider?: string }) => {
          // The free lane's mapper: the picker asks for a flat shape and the
          // roster already carries the fields it wants. Narrowed rather than cast
          // so a new field on the row has to be accounted for.
          if (request.provider === XDPOOL_FREE_PROVIDER) {
            return freeCatalog.current().map(row => ({
              id: row.modelId,
              name: row.name,
              contextWindow: row.contextWindow,
              maxTokens: row.maxOutput,
              inputModalities: row.vision ? ['text', 'image'] : ['text'],
            }))
          }
          if (request.provider === XDPOOL_AGGREGATE_PROVIDER) {
            // Both row kinds answer here: a chain is a route the user can pick
            // directly, so hiding it from the picker would make it reachable only
            // by typing its id. The shared fields are read off a union rather than
            // cast, so a new field on either kind has to be accounted for.
            return aggregateCatalog.current().map(row => ({
              id: row.id,
              name: row.name,
              contextWindow: row.contextWindow,
              maxTokens: row.maxOutputTokens,
              inputModalities: row.supportsImages ? ['text', 'image'] : ['text'],
            }))
          }
          if (request.provider !== XDPOOL_PROVIDER
            && request.provider !== XDPOOL_GLOBAL_PROVIDER) return []
          const region = request.provider === XDPOOL_GLOBAL_PROVIDER ? 'global' : 'cn'
          return core.catalogs[region].visible().map(model => ({
            id: model.id,
            name: model.name,
            contextWindow: model.contextWindow,
            maxTokens: model.maxOutputTokens,
            inputModalities: model.supportsImages ? ['text', 'image'] : ['text'],
          }))
        })
        ctx.logger.info?.(
          `dsh-xdpool: providers registered at cn=${shims.cn.baseUrl()} global=${shims.global.baseUrl()} aggregate=${aggregateCatalog.current().length} free=${freeCatalog.current().length} model(s)`,
        )
        recordStartupNote(
          `providers registered cn=${shims.cn.baseUrl()} global=${shims.global.baseUrl()} aggregate=${aggregateCatalog.current().length} free=${freeCatalog.current().length} model(s) directory=${releaseDirectory === undefined ? 'rejected' : 'mounted'}`,
        )
        // Refresh the live roster now that the picker can be rebuilt, so a listing
        // that lands replaces the static fallback without a restart.
        //
        // It needs its own rejection handler, for the reason the catalog seed
        // below documents: the host installs `installFailLoud`, which turns an
        // unhandled rejection into `exit(1)`. A free gateway that is simply
        // unreachable from this network must cost the免密 rows their freshness,
        // never the whole desktop.
        void freeCatalog.refresh().then(
          rows => {
            invalidateCatalog()
            ctx.logger.info?.(`dsh-xdpool: free lane serves ${rows.length} model(s)`)
            recordStartupNote(`free lane ready rows=${rows.length} live=${freeCatalog.updatedAt() !== undefined}`)
          },
          (error: unknown) => {
            ctx.logger.warn('dsh-xdpool: free lane listing failed', error)
            recordStartupNote(`free lane listing failed: ${describeError(error)}`)
          },
        )
      } catch (error: unknown) {
        ctx.logger.error('dsh-xdpool: provider registration failed', error)
        recordStartupNote(`registration FAILED: ${describeError(error)}`)
        return
      }
      // Discover accounts; the fallback catalog already serves models meanwhile.
      if (stopped) return
      void core.pool.scan().then(
        accounts => {
          ctx.logger.info?.(`dsh-xdpool: ${accounts.length} WorkBuddy account(s) in rotation`)
        },
        (error: unknown) => {
          ctx.logger.warn('dsh-xdpool: account discovery failed', error)
        },
      )
      // Seed the live model catalog (with per-model credit multipliers and
      // reasoning levels) from the upstream; the static fallback covers an
      // offline upstream so the provider is never empty.
      //
      // The trailing `catch` is load-bearing, not tidiness: `scan()` rejects
      // whenever the WorkBuddy app cannot be located to open the credential
      // (`ENCRYPTED_CREDENTIAL`), and the `try` below covers only the per-region
      // loop. An unguarded rejection here is FATAL — the DSH host installs
      // `installFailLoud`, which turns any unhandled rejection into `exit(1)`,
      // so a missing app took the whole desktop down instead of degrading to
      // the static catalog. The sibling `void core.pool.scan().then(…)` above
      // already has a rejection handler; this one needs its own.
      void (async () => {
        // Seed each region from its OWN account and endpoint: the two gateways
        // advertise different rosters, so seeding both from accounts[0] gave the
        // global provider the CN model list (and vice versa). A region with no
        // signed-in account keeps its static fallback.
        await seedCatalog()
        invalidateCatalog()
      })().catch((error: unknown) => {
        ctx.logger.warn('dsh-xdpool: account catalog seed failed', error)
      })
    }, (error: unknown) => {
      ctx.logger.error('dsh-xdpool: shim failed to listen', error)
    })
}
void ({} as unknown as Context | undefined)
export type { Context }
