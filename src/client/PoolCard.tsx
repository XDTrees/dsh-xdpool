/**
 * XD Pool card contributed to DSH Plugin configuration.
 *
 * The card body mirrors the LaoDing plugin family used by dingminhua's
 * `dsh-connect-workbuddy`: a small status row (dot + count + Rescan / Clear
 * cooldowns buttons), then a per-account panel showing label / status tag /
 * token expiry / cooldown info / credit packages, then the model directory
 * with per-model free/limited/night/image badges and context size.
 *
 * Rendered as a full settings page (see `client/index.tsx`): the shell gives it
 * a left-nav row and a scrollable content column, so everything is visible at
 * once — a fold inside the page only hid the pool behind a click.
 *
 * @module dsh-xdpool/client/PoolCard
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createElement as h } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import {
  POOL_ACCOUNT_DISABLE_PATH,
  POOL_ACCOUNT_IGNORE_PATH,
  POOL_ACCOUNT_PREFER_PATH,
  POOL_AUTOMATION_RUN_PATH,
  POOL_CATALOG_REFRESH_PATH,
  POOL_CREDIT_RESERVE_PATH,
  POOL_CHECKIN_PATH,
  POOL_MODELS_SAVE_PATH,
  POOL_MODEL_PROBE_PATH,
  POOL_RESET_COOLDOWN_PATH,
  POOL_RESCAN_PATH,
  POOL_STATUS_PATH,
  POOL_USAGE_PATH,
  type PoolWebAccount,
  type PoolWebAutomationJob,
  type PoolWebChannel,
  type PoolWebModel,
  type PoolWebModelProbeResult,
  type PoolWebStatus,
  type PoolRegion,
  type PoolWebCreditPackage,
  type PoolDistribution,
} from '../status-paths.ts'
import { DEFAULT_AUTOMATION_HOURS } from '../status-paths.ts'
import { POOL_CARD_CSS } from './styles.ts'
import { POOL_CARD_AVATAR } from './avatar.ts'
import { PoolShell, PageHero, initialShellTab, rememberedShellTab } from './shell.tsx'
import { LedgerPage } from './LedgerPage.tsx'
import { AggregatePage } from './AggregatePage.tsx'
import { ChannelsPage } from './ChannelsPage.tsx'
import { RoutingPage } from './RoutingPage.tsx'
import { GatewayPage } from './GatewayPage.tsx'
import { RegionCardPane, RegionCardTile, RegionCardTrigger, regionCardStyle } from './region-card.tsx'
import type { RegionCardState } from './region-card.tsx'
import { REGION_CHANNEL_BY_REGION } from './region-card.tsx'
import { POOL_CHANNELS_PATH } from '../status-paths.ts'
import { isFreeNow, promoStatusFor } from '../promo.ts'
import { badgeLabels, freeBadgeKind } from '../badges.ts'
import { paidAlternativeFor } from '../siblings.ts'
import type { PaidSibling } from '../siblings.ts'
import { ModelFactsRow } from './model-facts-row.tsx'
import type { ModelProbeReading } from './model-facts.ts'
import type { UsageSummary } from '../stats.ts'
import { ChannelPoolSection } from './ChannelPoolSection.tsx'
import { POOL_VERSION } from '../version.ts'
import type { XdPoolSettingsKey } from './locales.ts'
/** Localized copy injected by the browser-plugin registration. */
export interface PoolCardInjected {
  t: (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string
  /**
   * The plugin settings section the card reads and writes. Model selection
   * lives here, which is what makes it apply to the whole pool rather than to
   * whichever account is currently serving.
   */
  settingsScope: PoolCardSettingsScope
}
/** The settings scope the slot hands the card, narrowed to what it uses. */
export interface PoolCardSettingsScope {
  getSnapshot(): { writable?: boolean; value?: unknown }
  subscribe?(listener: () => void): () => void
  /** Write one field of the plugin settings section. */
  set?(field: string, value: unknown): Promise<void> | void
}
/** Props delivered by the Plugin configuration item slot. */
/**
 * Props delivered by the Plugin configuration item slot.
 *
 * `settingsScope` is supplied at runtime by the settings-plugins slot for
 * cards that declare a settings section. `PropsRuntime` does not type it, so
 * it is declared here as optional — every use site guards for its absence and
 * falls back to a read-only card.
 */
export type PoolCardProps = PropsRuntime<'settings.plugin.item'>
  & Partial<PoolCardInjected>
  & { settingsScope?: PoolCardSettingsScope }
/**
 * Default context window the card offers as the "capped" choice, in tokens.
 * Mirrors the host-side DEFAULT_CONTEXT_BUDGET; declared here rather than
 * imported, because the browser bundle must not pull in the host entry.
 */
const DEFAULT_CONTEXT_BUDGET = 200_000
const POLL_INTERVAL_MS = 30_000
/** Inject or refresh the shared card CSS for the current client bundle. */
if (typeof document !== 'undefined') {
  const cssId = 'dsh-xdpool/client.css'
  const existing = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${cssId}"]`)
  if (existing !== null) {
    existing.textContent = POOL_CARD_CSS
  } else {
    const styleTag = document.createElement('style')
    styleTag.dataset.plugin = 'dsh-xdpool'
    styleTag.dataset.pluginCss = cssId
    styleTag.textContent = POOL_CARD_CSS
    document.head.appendChild(styleTag)
  }
}
function formatNumber(value: number | undefined): string {
  if (value === undefined) return '–'
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}
function formatTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}
function formatDateTime(value: string | undefined): string {
  if (value === undefined) return ''
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return value
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(ms))
}
/**
 * The automation jobs, in the order they run.
 *
 * The order is the contract: the report has to land before the task pass, or
 * the task pass reads progress the report would have lit. `hoursOf` reads the
 * matching hour list off the status document so the panel stays in step with
 * whatever schedule the scheduler is actually running on.
 */
/**
 * How long to watch a manual run before giving up on it.
 *
 * A pass runs one upstream call per account per job, so ~30s for a handful of
 * accounts. The bound exists so a wedged run cannot spin the button forever;
 * the run itself keeps going in the background either way.
 */
const AUTOMATION_POLL_MS = 2000
const AUTOMATION_POLL_ATTEMPTS = 90
// The card renders one row per kind, and the list must match the scheduler's
// `AUTOMATION_JOB_KINDS` exactly — they are two hand-written lists that have to
// agree, and a kind missing here is invisible (the job runs, nothing shows it).
export const AUTOMATION_JOBS = ['checkin', 'report', 'tasks', 'streak', 'travel', 'compensation'] as const
export type AutomationJobKind = typeof AUTOMATION_JOBS[number]
/**
 * The hour list to save for one job: what the card holds, or the default.
 *
 * Mirrors the host's own fallback (`hoursOrDefault` in `scheduler.ts`). An
 * empty list must resolve to the default on BOTH sides, or the card would save
 * a schedule the scheduler then refuses to run — the exact silent standstill
 * this pair of fixes exists to remove.
 */
function hoursOrDefault(configured: readonly number[] | undefined, fallback: readonly number[]): number[] {
  return configured !== undefined && configured.length > 0 ? [...configured] : [...fallback]
}
/** Read one job's configured hours off the status document. */
function automationHours(status: PoolWebStatus, kind: AutomationJobKind): readonly number[] {
  const automation = status.automation
  if (automation === undefined) return []
  switch (kind) {
    case 'report': return automation.reportHours
    case 'tasks': return automation.taskHours
    case 'checkin': return automation.checkinHours
    case 'streak': return automation.streakHours
    case 'travel': return automation.travelHours
    case 'compensation': return automation.compensationHours
  }
}
/** Read one job's last-run record off the status document. */
function automationJob(status: PoolWebStatus, kind: AutomationJobKind): PoolWebAutomationJob | undefined {
  return status.automation?.jobs[kind]
}
function dotColor(status: 'ok' | 'error' | 'idle'): string {
  return status === 'ok'
    ? 'var(--dsw-alias-state-success-primary, #22a06b)'
    : status === 'error'
      ? 'var(--dsw-alias-state-error-primary, #ef4444)'
      : 'var(--dsw-alias-label-dimmed, #9aa0a6)'
}
function formatCapacity(value: number | undefined): string {
  if (value === undefined) return ''
  if (value >= 1_000_000 && value % 1_000_000 === 0) return `${value / 1_000_000}M`
  if (value >= 1_000 && value % 1_000 === 0) return `${value / 1_000}K`
  return String(value)
}
/**
 * The five ways the pool can hand out accounts.
 *
 * Order is the reading order of the picker: the recommended mode first, then
 * the two cache-friendly extremes, then the two spreading modes. The row is
 * laid out one chip per mode, so this list length is also the column count.
 */
const DIST_OPTIONS = ['sticky', 'priority', 'balanced', 'round-robin', 'expiry'] as const
/**
 * The two supplier cards, in the order they are shown.
 *
 * Both are always rendered, so an empty side reads as "not signed in here
 * yet" rather than the card appearing only after the user has already signed
 * in. Keeping the list here (rather than a literal pair in the JSX) is what lets
 * the poll loop fetch every card without a second source of truth.
 */
const REGION_CARDS = ['cn', 'global'] as const
/** The settings key holding each region's model selection. */
const MODEL_SELECTION_KEY = { cn: 'modelSelectionCn', global: 'modelSelectionGlobal' } as const
/**
 * Everything one region card renders, derived from that region's own slice.
 *
 * Bundled into one object so a card cannot accidentally read a value belonging
 * to the other lane: every field here is computed from `statusOf(region)`, and
 * the card's markup only ever sees its own bundle.
 */
interface RegionCardModel {
  readonly region: PoolRegion
  readonly status: PoolWebStatus | undefined
  readonly accountCount: number
  readonly cooling: number
  readonly idle: boolean
  readonly hasHealthy: boolean
  readonly state: 'ok' | 'error' | 'idle'
  /** Human name of the lane, used in headings and empty-state copy. */
  readonly regionLabel: string
  /**
   * The vendor's own brand name and where it lives.
   *
   * This used to be the tab label — "CN" / "Global" — which is our word for the
   * lane, not the vendor's. The user compared this card with the login page's
   * card and asked for the same one, and on the login page the name is the
   * vendor's ("WorkBuddy 国内版") with the vendor's own host underneath
   * ("腾讯 · copilot.tencent.com"). Naming the region instead meant the same
   * supplier appeared under two different names on two pages of the same
   * settings dialog, which is the kind of thing that makes a user check whether
   * they signed in twice.
   */
  readonly brandName: string
  readonly brandSub: string
  /**
   * One line of prose about the vendor's free allowance, in Chinese.
   *
   * It replaced a sentence that printed the loopback port this plugin serves
   * the lane on. The port was never actionable for the user, and it crowded out
   * the one line on the card they could act on.
   */
  readonly brandNote: string
  /** The pill text. Distinct from `cardState`, which only carries the colour. */
  readonly stateLabel: string
  readonly models: readonly PoolWebModel[]
  readonly modelState: {
    readonly draft: Record<string, ModelDraftEntry>
    readonly editable: boolean
    readonly dirty: boolean
    readonly enabled: number
  }
  readonly activeAccount: PoolWebAccount | undefined
  /**
   * CN only: the international gateway has no growth system at all, so the
   * automation pane there would be a switch that can never do anything. That is
   * also why the whole field is typed optional — "not applicable" is a real
   * answer here, not a missing value.
   */
  readonly automation?: PoolWebStatus['automation'] | undefined
  readonly automationTotals: AutomationTotals
  readonly cardState: RegionCardState
}
/** Today's automation take, summed across accounts. */
interface AutomationTotals {
  readonly credit: number
  readonly energy: number
  readonly claimed: number
  readonly checkinCredit: number
  readonly bonusCredit: number
  readonly travelCredit: number
  readonly compensationCredit: number
}
/**
 * Sum one region's daily automation earnings.
 *
 * Summed from the per-account counters rather than kept separately, so the
 * panel total and the per-account lines can never disagree. Takes the status
 * document as an argument rather than closing over one, because each card sums
 * its own accounts.
 */
function automationTotalsOf(status: PoolWebStatus | undefined): AutomationTotals {
  return Object.values(status?.automation?.earningsToday ?? {})
    .reduce((sum, entry) => ({
      credit: sum.credit + entry.credit,
      energy: sum.energy + entry.energy,
      claimed: sum.claimed + entry.claimed,
      checkinCredit: sum.checkinCredit + entry.checkinCredit,
      bonusCredit: sum.bonusCredit + entry.bonusCredit,
      travelCredit: sum.travelCredit + entry.travelCredit,
      compensationCredit: sum.compensationCredit + entry.compensationCredit,
    }), { credit: 0, energy: 0, claimed: 0, checkinCredit: 0, bonusCredit: 0, travelCredit: 0, compensationCredit: 0 })
}
/**
 * How much credit is left in this lane, already formatted.
 *
 * Three states, never collapsed into two:
 *  - `undefined` when nothing has reported a balance yet, rendered as an em
 *    dash. A zero here would be a claim nobody made.
 *  - `'0'` when the gateway answered and the answer was zero. That IS a fact.
 *  - a formatted number when a balance came back.
 *
 * The read is best-effort per account: one dead credential must not make the
 * whole lane read as "no credit", so accounts whose balance failed to load are
 * skipped and only the ones that actually answered are summed. When none
 * answered, the result is `undefined` rather than a confident zero.
 */
function creditLeftOf(status: PoolWebStatus | undefined): string | undefined {
  const reported = (status?.accounts ?? [])
    .map(account => account.credits?.total)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return reported.length === 0 ? undefined : formatNumber(reported.reduce((sum, value) => sum + value, 0))
}
type DistTranslator = PoolCardInjected['t'] | undefined
/** Localized name of one distribution mode. */
function distLabel(option: PoolDistribution, t: DistTranslator): string {
  if (option === 'sticky') return t?.('row.distSticky') ?? 'Per conversation'
  if (option === 'priority') return t?.('row.distPriority') ?? 'Priority'
  if (option === 'balanced') return t?.('row.distBalanced') ?? 'Balanced'
  if (option === 'expiry') return t?.('row.distExpiry') ?? 'Expiring first'
  return t?.('row.distRoundRobin') ?? 'Round-robin'
}
/** One-line explanation of what a mode does to caching and spend. */
function distHint(option: PoolDistribution, t: DistTranslator): string {
  if (option === 'sticky') return t?.('row.distStickyHint') ?? ''
  if (option === 'priority') return t?.('row.distPriorityHint') ?? ''
  if (option === 'balanced') return t?.('row.distBalancedHint') ?? ''
  if (option === 'expiry') return t?.('row.distExpiryHint') ?? ''
  return t?.('row.distRoundRobinHint') ?? ''
}
/** Pick the right promotion chip for a model. */
/** One model's draft state while the card holds unsaved edits. */
interface ModelDraftEntry {
  enabled: boolean
  images: boolean
  /** Context budget, or undefined to follow the model's native window. */
  budget?: number
}
/** Build the draft from the server's selection + catalog flags. */
function draftFromStatus(status: PoolWebStatus): Record<string, ModelDraftEntry> {
  const selection = status.selection
  const enabled = selection.enabledModelIds
  const images = selection.imageModelIds
  const budgets = selection.contextBudgets
  const out: Record<string, ModelDraftEntry> = {}
  for (const model of status.models) {
    const entry: ModelDraftEntry = {
      enabled: enabled === undefined || enabled.includes(model.id),
      images: images === undefined ? model.supportsImages : images.includes(model.id),
    }
    const budget = budgets?.[model.id]
    if (budget !== undefined) entry.budget = budget
    out[model.id] = entry
  }
  return out
}
/** True when the draft differs from what the server last reported. */
function draftIsDirty(status: PoolWebStatus, draft: Record<string, ModelDraftEntry>): boolean {
  const selection = status.selection
  const enabled = new Set(selection.enabledModelIds ?? status.models.filter(m => m.enabled).map(m => m.id))
  const images = new Set(
    selection.imageModelIds ?? status.models.filter(m => m.supportsImages).map(m => m.id),
  )
  const budgets = selection.contextBudgets ?? {}
  for (const model of status.models) {
    const entry = draft[model.id]
    if (entry === undefined) continue
    if (entry.enabled !== enabled.has(model.id)) return true
    if (entry.images !== images.has(model.id)) return true
    const saved = budgets[model.id] ?? model.nativeContextWindow
    const next = entry.budget ?? model.nativeContextWindow
    if (saved !== next) return true
  }
  return false
}
/** Absolute expiry with the time of day: the upstream grants one-off packages at
 *  arbitrary clock times, so "expires 09/19 15:36" is what the user needs — a
 *  date alone would read as if it lapsed at midnight. */
function formatExpiry(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ms))
}
/** Whole days until `ms`, floored at 0; undefined when there is no deadline. */
function daysUntil(ms: number | undefined): number | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined
  return Math.max(0, Math.floor((ms - Date.now()) / 86_400_000))
}
/** True when a one-off package lapses inside the "expiring soon" window. */
function isExpiringSoon(pack: PoolWebCreditPackage): boolean {
  if (pack.monthly === true) return false
  const days = daysUntil(pack.expiresAtMs)
  return days !== undefined && days <= 3
}
/**
 * The promo badge for one model, or undefined when it has none.
 *
 * Two sources, because the gateway models one of them and not the other:
 *
 *  - `free` comes from the CREDIT MULTIPLIER. Neither gateway ever sends a
 *    literal `free` tag, but it does price its free models at `credits: "x0.00"`
 *    (CN `hy3`), so the multiplier is the honest signal.
 *  - the NIGHT window comes from {@link promoStatusFor}, because the gateway
 *    charges `x0.29` for `hy4-preview` around the clock and has no field for a
 *    time-of-day rule. See that module for why the 14-day newcomer allowance is
 *    deliberately not modelled.
 *
 * `region` is threaded through because the campaigns are REGIONAL: the
 * Hy3 / Hy4-preview extension is a domestic promotion, so a global roster must
 * not pick up a discount that gateway does not offer.
 */
function tagFor(
  model: PoolWebModel,
  now: Date,
  region: 'cn' | 'global',
): 'free' | 'limited' | 'night' | 'badge' | undefined {
  const tags = model.tags ?? []
  const promo = promoStatusFor(model, now, region)
  // A currently-active window outranks a bare multiplier: "free until 08:00" is
  // the more useful fact, and it is the one that expires.
  if (promo?.kind === 'night') return 'night'
  // Free-ness is decided in ONE place (`freeBadgeKind`) because the adapter
  // builds the same judgement for the model picker, and the two used to drift:
  // the picker read `hasFreeBadge` and collapsed the gateway's
  // `badge:限时免费` into a flat `row.free`, throwing away the half that expires.
  // Sorting is unaffected — `promoStatusFor` reads the same badge and reports it
  // as free-right-now.
  const freeKind = freeBadgeKind(model)
  if (freeKind === 'badge') return 'badge'
  if (freeKind === 'generic') return 'free'
  if (tags.includes('limited-free')) return 'limited'
  if (tags.includes('night-discount')) return 'night'
  // Any OTHER gateway badge: show ITS text, because it knows about promotions
  // this plugin has no rule for (`badge:夜间折扣` on `glm-5.2`). Deliberately
  // AFTER the free checks — a discount still costs credits, so it must not read
  // as free, yet the upstream already wrote the label a user should see.
  if (badgeLabels(tags).length > 0) return 'badge'
  return undefined
}
/** Render pool health, per-account credits/cooldown, and the model directory. */
export function PoolCard({ t, settingsScope }: PoolCardProps) {
  // The slot tells us whether the settings document is writable; a
  // read-only scope (locked profile) renders the model rows disabled.
  const settingsWritable = settingsScope?.getSnapshot().writable === true
  /** Which region tab is showing. A CN-only install never leaves this. */
  const [activeRegion, setActiveRegion] = useState<'cn' | 'global'>('cn')
  /**
   * Last-known status per region. Kept per region (not a single slot) so
   * switching tabs shows the other side's last answer immediately instead of
   * a blank frame, and the tab dots stay meaningful while a tab is hidden.
   */
  const [statusByRegion, setStatusByRegion] = useState<
    Partial<Record<PoolRegion, PoolWebStatus>>
  >({})
  /**
   * Which disclosure panes are open, keyed by pane id.
   *
   * A map rather than one boolean per pane because there are four per lane and
   * they are independent: opening the domestic account list must not close the
   * international model list, and the ids are already unique per lane.
   *
   * All panes start closed. A card that arrives with a 200-row account list
   * already expanded is a wall of text where the user asked for a summary, and
   * the disclosure is one click away.
   */
  const [openedPanes, setOpenedPanes] = useState<Record<string, boolean>>({})
  const setPane = (paneId: string, open: boolean): void => {
    setOpenedPanes(prev => (prev[paneId] === open ? prev : { ...prev, [paneId]: open }))
  }
  const [error, setError] = useState<string | undefined>(undefined)
  /**
   * The scan-login roster, read only for the two lanes' own branding.
   *
   * Both pool lanes ARE two of the thirteen scan-login channels, so the pool
   * page asks the login page's roster who its vendors are instead of keeping a
   * second copy of their names. Nothing else is read from it: the user removed
   * the mirrored channel list ("在扫码登录页登录过什么，这里就同步显示什么，这个不需要"),
   * and a roster with no per-account state behind it could only ever have shown
   * thirteen rows of zero. What a channel actually has stays where it is
   * earned — on the login page, and in the counts the pack reports there.
   */
  const [channels, setChannels] = useState<PoolWebChannel[]>([])
  /**
   * Which page is showing.
   *
   * `pool` is the WorkBuddy account pool this page has always shown.
   * `aggregate` and `channels` are sibling views, not sections inside the pool
   * body: they read different documents and have their own fetch lifecycles, so
   * switching pages must not leave the pool's poll feeding a hidden view, and
   * neither may be re-mounted by a pool refresh.
   *
   * The initial value comes from `localStorage`. Reading it during the initial
   * render (rather than in an effect) means the card never paints the pool
   * page and then swaps to another one, which on a slow paint is a visible
   * flash of the wrong page's content.
   */
  const shellTabs = [
    { id: 'pool', label: t?.('shell.tabPool') ?? 'Account pool' },
    { id: 'channels', label: t?.('shell.tabChannels') ?? 'Login channels' },
    { id: 'aggregate', label: t?.('shell.tabAggregate') ?? 'Providers' },
    { id: 'ledger', label: t?.('shell.tabLedger') ?? 'Dashboard' },
    { id: 'routing', label: t?.('shell.tabRouting') ?? 'Routing' },
    { id: 'gateway', label: t?.('shell.tabGateway') ?? 'Gateway' },
  ] as const
  const [page, setPage] = useState<string>(
    () => initialShellTab(rememberedShellTab(), shellTabs),
  )
  /**
   * Which side an in-flight action belongs to.
   *
   * Both region cards are on screen at once now, so a single boolean would let
   * a click on the CN card paint "Detecting…" on the international card too.
   * The flag carries the region it belongs to: the pane that owns it shows the
   * progress wording, and BOTH panes stay disabled while it runs so a second
   * click cannot fire the same request twice.
   */
  const [busyRegion, setBusyRegion] = useState<PoolRegion | undefined>(undefined)
  const [cooldownBusyRegion, setCooldownBusyRegion] = useState<PoolRegion | undefined>(undefined)
  /** Model-catalog refresh in flight (separate from the account rescan). */
  const [catalogBusyRegion, setCatalogBusyRegion] = useState<PoolRegion | undefined>(undefined)
  const [automationBusyRegion, setAutomationBusyRegion] = useState<PoolRegion | undefined>(undefined)
  /** The automation job currently running from the card, if any. */
  const [automationRun, setAutomationRun] = useState<AutomationJobKind | 'all' | undefined>(undefined)
  /** The region whose automation run was started, so only that card spins. */
  const [automationRunRegion, setAutomationRunRegion] = useState<PoolRegion | undefined>(undefined)
  /** Region whose model draft is being written, for the same reason. */
  const [savingModelsRegion, setSavingModelsRegion] = useState<PoolRegion | undefined>(undefined)
  /** Account id whose reserved-credit floor is being saved, if any. */
  const [reserveBusy, setReserveBusy] = useState<string | undefined>(undefined)
  const [flash, setFlash] = useState<string | undefined>(undefined)
  /** Account id whose daily claim is currently in flight. */
  const [checkinBusyId, setCheckinBusyId] = useState<string | undefined>(undefined)
  /** Account id whose enable/disable switch is in flight, if any. */
  const [accountBusyId, setAccountBusyId] = useState<string | undefined>(undefined)
  /**
   * The usage aggregate, or undefined until its first answer.
   *
   * Deliberately NOT filed per region, unlike `statusByRegion`: one recorder
   * backs both gateways and every row carries its own region, so filtering
   * here would hide half the calls and leave the panel total disagreeing with
   * the number the recorder actually reports.
   */
  const [usage, setUsage] = useState<UsageSummary | undefined>(undefined)
  /**
   * Draft model selection. `undefined` means "no local edits"; once a checkbox
   * is touched the draft takes over and is what the Save button posts. Discard
   * drops it back to the copy the server last reported.
   */
  const [draftByRegion, setDraftByRegion] = useState<Partial<Record<PoolRegion, Record<string, ModelDraftEntry>>>>({})
  /**
   * The draft one region card is holding, if it holds any.
   *
   * Keyed by region rather than "whatever tab is in front": the two gateways
   * have different rosters, so edits made on the CN card must not leak into
   * the international list when the user works on both at once.
   */
  const setDraftFor = (region: PoolRegion, next: Record<string, ModelDraftEntry> | undefined): void => {
    setDraftByRegion(prev => ({ ...prev, [region]: next }))
  }
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  /**
   * Connectivity readings, keyed by the row's model id.
   *
   * Kept as a map rather than one slot because the user will click a second row
   * while the first answer is still arriving, and a single slot would make the
   * first row's result vanish behind the second row's.
   *
   * A reading is NEVER recomputed by the 5-second poll. That poll exists to keep
   * account state fresh; if it also refreshed probe results, a model that had
   * stopped answering would keep showing its last good answer forever, and the
   * button would read as broken. Measurements therefore live until the user
   * clicks again — which is also the only honest lifetime for a number that
   * describes a moment in time.
   */
  const [probes, setProbes] = useState<Readonly<Record<string, ModelProbeReading>>>({})
  /** The model whose probe is in flight, if any. */
  const [probingModel, setProbingModel] = useState<string | undefined>(undefined)
  /**
   * Send one real request to one model and record what came back.
   *
   * One probe at a time on purpose. Every call spends the user's credits, so a
   * user holding down a row must not be able to queue ten of them by accident;
   * and a single in-flight marker keeps the button disabled exactly where the
   * user is looking instead of greying out the whole list.
   */
  const testModel = useCallback(async (provider: string, model: string): Promise<void> => {
    if (probingModel !== undefined) return
    setProbingModel(model)
    try {
      const response = await fetch(POOL_MODEL_PROBE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ provider, model }),
      })
      const body = await response.json() as PoolWebModelProbeResult | { error?: unknown }
      // A non-200 is reported as a failed probe carrying the route's own
      // message, not as a thrown error: the button's job is to say what is
      // wrong, and an exception would say "this build is broken" instead.
      const reading: ModelProbeReading = 'ok' in body
        ? {
            ok: body.ok,
            outputChars: typeof body.outputChars === 'number' ? body.outputChars : 0,
            ...typeof body.firstFrameMs === 'number' ? { firstFrameMs: body.firstFrameMs } : {},
            ...typeof body.error === 'string' ? { error: body.error } : {},
          }
        : {
            ok: false,
            outputChars: 0,
            error: typeof (body as { error?: unknown }).error === 'string'
              ? (body as { error: string }).error
              : `HTTP ${response.status}`,
          }
      setProbes(prev => ({ ...prev, [model]: reading }))
    } catch (error: unknown) {
      setProbes(prev => ({
        ...prev,
        [model]: {
          ok: false,
          outputChars: 0,
          error: error instanceof Error && error.message !== '' ? error.message : 'the probe could not be sent',
        },
      }))
    } finally {
      setProbingModel(undefined)
    }
  }, [probingModel])
  /**
   * Fetch one region's status. `region` is a parameter rather than a closure
   * read so the callback identity does not change with the tab: the polling
   * effect can key off it without restarting on every switch, and each region's
   * last answer stays in its own slot (see `statusByRegion`).
   */
  const refresh = useCallback(async (region: PoolRegion, signal?: AbortSignal): Promise<PoolWebStatus | undefined> => {
    try {
      const response = await fetch(`${POOL_STATUS_PATH}?region=${region}`, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        ...signal === undefined ? {} : { signal },
      })
      const value: unknown = await response.json().catch(() => undefined)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      if (mounted.current && signal?.aborted !== true) {
        setStatusByRegion(prev => ({ ...prev, [region]: value as PoolWebStatus }))
        setError(undefined)
      }
      // Returned so a caller that needs to poll a field (the automation run
      // state) can read the fresh value instead of a stale render.
      return value as PoolWebStatus
    } catch (cause: unknown) {
      if (mounted.current && signal?.aborted !== true) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
      return undefined
    }
  }, [])
  /**
   * Read the scan-login roster, for the two lanes' vendor names and nothing else.
   *
   * Called once on mount rather than on the poll timer: the roster this plugin
   * publishes is static for the life of the process, so a timer would only
   * re-read a document that cannot have changed. A failure is swallowed for the
   * same reason the usage panel's is — `brandOf` falls back to the tab label,
   * which is thin but true, and a lane that refuses to draw because a second
   * document did not arrive would be a worse answer than the one it has.
   */
  const refreshChannels = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const response = await fetch(POOL_CHANNELS_PATH, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        ...signal === undefined ? {} : { signal },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body: unknown = await response.json().catch(() => undefined)
      const roster = (body as { channels?: unknown } | undefined)?.channels
      if (mounted.current && signal?.aborted !== true && Array.isArray(roster)) {
        setChannels(roster as PoolWebChannel[])
      }
    } catch {
      // Kept quiet; see above.
    }
  }, [])
  /**
   * Poll every region card that is on screen.
   *
   * Both cards render at once now, so the old single-region tick would have
   * left the other card's numbers frozen while the user read them. The card
   * the user is looking at is fetched first so a slow second answer cannot
   * delay it.
   *
   * `activeRegion` stays in the dependency list on purpose: it is what orders
   * the fetch, so switching which card is in front re-issues immediately
   * instead of waiting for the next tick.
   */
  useEffect(() => {
    const controller = new AbortController()
    const poll = (): void => {
      for (const region of [activeRegion, ...REGION_CARDS.filter(other => other !== activeRegion)]) {
        void refresh(region, controller.signal)
      }
    }
    poll()
    const timer = window.setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
      controller.abort()
    }
  }, [refresh, activeRegion])
  /**
   * Read the scan-login roster once, and again whenever the user comes back to
   * this page.
   *
   * Re-reading on return is cheap and keeps the lane's vendor name honest. The
   * roster is a local document that cannot change while the process lives, so
   * this is about the user coming BACK to a card they had left on another page —
   * not about polling something that moves.
   */
  useEffect(() => {
    if (page !== 'pool') return
    const controller = new AbortController()
    void refreshChannels(controller.signal)
    return () => { controller.abort() }
  }, [page, refreshChannels])
  /**
   * Fetch the usage aggregate.
   *
   * A failure is swallowed on purpose. The panel failing to read its numbers
   * must not blank the card or raise the shared error banner: the pool still
   * serves conversations perfectly well, and the next poll tries again. Keeping
   * the previous answer is also the honest rendering of "I could not refresh
   * this", where clearing would claim "there has been no usage at all".
   */
  const refreshUsage = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const response = await fetch(POOL_USAGE_PATH, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        ...signal === undefined ? {} : { signal },
      })
      const value: unknown = await response.json().catch(() => undefined)
      // 503 means this build has no recorder; that is an absence of a panel,
      // not an error worth showing, so leave the state undefined and stop.
      if (!response.ok) return
      if (mounted.current && signal?.aborted !== true) setUsage(value as UsageSummary)
    } catch {
      // Kept quiet; see above.
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void refreshUsage(controller.signal)
    const timer = window.setInterval(() => { void refreshUsage(controller.signal) }, POLL_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
      controller.abort()
    }
  }, [refreshUsage])
  /**
   * Re-scan the credential folders for one region.
   *
   * Takes the region explicitly now that both cards are on screen: a click on
   * the CN card must re-read the CN folders, and the flash it reports belongs to
   * that card. The button beside it ("clear all cooldowns") stays available on
   * both sides, so the argument is what tells them apart.
   */
  const rescan = async (region: PoolRegion): Promise<void> => {
    setBusyRegion(region)
    setFlash(undefined)
    try {
      const response = await fetch(POOL_RESCAN_PATH, {
        method: 'POST', headers: { accept: 'application/json' }, credentials: 'same-origin',
      })
      const body = await response.json() as { accounts?: number; error?: string }
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
      await refresh(region)
      if (mounted.current) setFlash(t?.('row.accountsRescanned', { count: body.accounts ?? 0 }) ?? '')
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setBusyRegion(undefined)
    }
  }
  /**
   * Re-fetch the upstream model catalog for both regions.
   *
   * Its own action, and its own BUTTON, because the account rescan beside it
   * could not do this job: when the startup fetch failed, the picker held the
   * shorter built-in list and "detect accounts again" left it untouched, so the
   * only recovery was restarting DSH. Users reasonably assumed the button
   * covered both.
   *
   * The route itself still refreshes BOTH regions (that is the recovery being
   * offered), but the report and the flash are filed under the region whose
   * button was pressed, so the number quoted is the one that card is showing.
   */
  const refreshCatalog = async (region: PoolRegion): Promise<void> => {
    setCatalogBusyRegion(region)
    setFlash(undefined)
    try {
      const response = await fetch(POOL_CATALOG_REFRESH_PATH, {
        method: 'POST', headers: { accept: 'application/json' }, credentials: 'same-origin',
      })
      const body = await response.json() as {
        regions?: Record<string, { source?: string; models?: number }>
        error?: string
      }
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
      for (const other of REGION_CARDS) await refresh(other)
      const here = body.regions?.[region]
      if (mounted.current) {
        setFlash(here?.source === 'live'
          ? (t?.('row.catalogRefreshed', { count: here.models ?? 0 }) ?? '')
          : (t?.('row.catalogRefreshOffline') ?? ''))
      }
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setCatalogBusyRegion(undefined)
    }
  }
  const resetCooldowns = async (region: PoolRegion): Promise<void> => {
    setCooldownBusyRegion(region)
    setFlash(undefined)
    try {
      const response = await fetch(POOL_RESET_COOLDOWN_PATH, {
        method: 'POST', headers: { accept: 'application/json' }, credentials: 'same-origin',
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await refresh(region)
      if (mounted.current) setFlash(t?.('row.resetCooldownsDone') ?? '')
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setCooldownBusyRegion(undefined)
    }
  }
  /**
   * Claim one account's daily check-in. The account id travels in the body so
   * the Host can never guess: a click on account B's button can only ever
   * collect account B's reward. The status is re-read afterwards so the card
   * reflects the new streak / total without waiting for the next poll.
   */
  const claimCheckin = async (region: PoolRegion, accountId: string): Promise<void> => {
    setCheckinBusyId(accountId)
    setFlash(undefined)
    try {
      const response = await fetch(POOL_CHECKIN_PATH, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ accountId }),
      })
      const body = await response.json().catch(() => undefined) as
        | { claim?: { credit?: number }; error?: string }
        | undefined
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`)
      await refresh(region)
      const credit = body?.claim?.credit ?? 0
      if (mounted.current) {
        setFlash(t?.('row.checkinClaimedReward', { credit: formatNumber(credit) })
          ?? `Claimed +${formatNumber(credit)} credits`)
      }
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setCheckinBusyId(undefined)
    }
  }
  /**
   * Switch one account in or out of the pool.
   *
   * The id travels in the body and the host validates it against the accounts it
   * really knows, so a stale tab cannot write an orphan id. Disabling only stops
   * the account from being picked — it stays listed so it can be turned back on —
   * and the change is saved through the settings section, so it survives a
   * restart and is re-applied after every re-scan.
   */
  /**
   * The status of one region, or undefined until its first answer.
   *
   * Per region because both cards render at once: a click on the CN card must
   * read CN accounts, and a write derived from "the accounts this card shows"
   * has to come from the same slice or it would file a CN account id into the
   * international list.
   */
  const statusOf = (region: PoolRegion): PoolWebStatus | undefined => statusByRegion[region]
  const toggleAccountDisabled = async (region: PoolRegion, accountId: string, disabled: boolean): Promise<void> => {
    const write = settingsScope?.set
    if (write === undefined) {
      setError(t?.('row.modelsSaveError', { message: 'settings scope is read-only' })
        ?? 'settings scope is read-only')
      return
    }
    setAccountBusyId(accountId)
    setFlash(undefined)
    try {
      // Derived from the status THIS card holds, so the write is a
      // read-modify-write of the full list and two clicks cannot clobber.
      const current = (statusOf(region)?.accounts ?? [])
        .filter(account => account.disabled === true)
        .map(account => account.id)
      const next = disabled
        ? (current.includes(accountId) ? current : [...current, accountId])
        : current.filter(id => id !== accountId)
      await write.call(settingsScope, 'disabledAccountIds', next)
      await refresh(region)
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (mounted.current) {
        setError(t?.('row.accountToggleError', { message }) ?? 'Could not switch the account: ' + message)
      }
    } finally {
      if (mounted.current) setAccountBusyId(undefined)
    }
  }
  /**
   * Throw one account out of the pool for good, or take it back.
   *
   * The host owns the ignore file, so this is a plain route call: no settings
   * scope is involved, which is also why it keeps working on a profile whose
   * settings section is read-only.
   */
  const setAccountIgnored = async (region: PoolRegion, accountId: string, ignored: boolean): Promise<void> => {
    setAccountBusyId(accountId)
    setFlash(undefined)
    try {
      const response = await fetch(POOL_ACCOUNT_IGNORE_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, ignored }),
      })
      if (!response.ok) {
        const detail = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(detail.error ?? `HTTP ${response.status}`)
      }
      await refresh(region)
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (mounted.current) {
        setError(t?.('row.accountIgnoreError', { message }) ?? 'Could not change the ignore list: ' + message)
      }
    } finally {
      if (mounted.current) setAccountBusyId(undefined)
    }
  }
  /**
   * Pin one account to be tried first, or clear the pin.
   *
   * A plain route call, for the same reason as {@link setAccountIgnored}: the pin
   * lives in a plugin-owned file the CLI also writes, so there is no settings
   * section to write and the button keeps working on a read-only profile.
   *
   * `null` clears rather than naming a sentinel: "no preference" is a real state
   * the user has to be able to return to, and the host owns the decision about
   * whether a given id is still usable — the card cannot see accounts that a
   * scan has not returned yet.
   */
  const setPreferredAccount = async (region: PoolRegion, accountId: string | null): Promise<void> => {
    setAccountBusyId(accountId ?? 'none')
    setFlash(undefined)
    try {
      const response = await fetch(POOL_ACCOUNT_PREFER_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      })
      if (!response.ok) {
        const detail = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(detail.error ?? `HTTP ${response.status}`)
      }
      // Both cards re-read: the pin is one global choice, so leaving the other
      // region's rows showing a stale "preferred" mark would be a lie.
      await Promise.all(REGION_CARDS.map(other => refresh(other)))
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (mounted.current) {
        setError(t?.('row.accountPreferError', { message }) ?? 'Could not set the preferred account: ' + message)
      }
    } finally {
      if (mounted.current) setAccountBusyId(undefined)
    }
  }
  /**
   * The model rows one region card shows, plus whether they can be edited.
   *
   * Derived per region instead of once for the focused tab: both cards list
   * models at the same time now, and their rosters differ, so a single
   * `modelDraft` would have made the CN card render the international model
   * list the moment the user clicked a checkbox on the other side.
   */
  const modelStateOf = (region: PoolRegion): {
    draft: Record<string, ModelDraftEntry>
    editable: boolean
    dirty: boolean
    enabled: number
  } => {
    const here = statusOf(region)
    const local = draftByRegion[region]
    const rows = local ?? (here === undefined ? {} : draftFromStatus(here))
    return {
      draft: rows,
      editable: settingsWritable,
      dirty: local !== undefined && here !== undefined && draftIsDirty(here, local),
      enabled: Object.values(rows).filter(entry => entry.enabled).length,
    }
  }
  /**
   * One clock reading per render, shared by every card's sort and rows.
   *
   * Taken once so a list cannot disagree with itself: calling `new Date()`
   * per row would let a model be "free" for the badge and "not free" for the
   * sort if the window boundary happened to fall between two rows.
   *
   * A promotion boundary is not a re-render trigger — the card refreshes on its
   * own poll, which is frequent enough for a badge that changes twice a day.
   */
  const now = new Date()
  const toggleModel = (region: PoolRegion, id: string): void => {
    const here = statusOf(region)
    if (here === undefined) return
    const local = draftByRegion[region]
    const base = local ?? draftFromStatus(here)
    const entry = base[id]
    if (entry === undefined) return
    setDraftFor(region, { ...base, [id]: { ...entry, enabled: !entry.enabled } })
  }
  const toggleModelImage = (region: PoolRegion, id: string): void => {
    const here = statusOf(region)
    if (here === undefined) return
    const local = draftByRegion[region]
    const base = local ?? draftFromStatus(here)
    const entry = base[id]
    if (entry === undefined) return
    setDraftFor(region, { ...base, [id]: { ...entry, images: !entry.images } })
  }
  const setModelBudget = (region: PoolRegion, id: string, budget: number): void => {
    const here = statusOf(region)
    if (here === undefined) return
    const local = draftByRegion[region]
    const base = local ?? draftFromStatus(here)
    const entry = base[id]
    if (entry === undefined) return
    setDraftFor(region, { ...base, [id]: { ...entry, budget } })
  }
  /**
   * Throw one region's model edits away.
   *
   * Scoped to that card: discarding the international draft while looking at the
   * CN card would silently undo work the user did on the other side.
   */
  const discardModels = (region: PoolRegion): void => {
    setDraftFor(region, undefined)
    setFlash(undefined)
  }
  /**
   * Persist one region's model draft.
   *
   * The write goes through `settingsScope` rather than a bespoke route: that is
   * the same document the model picker reads, so one save covers every account
   * and survives account rotation — the selection is a property of the pool,
   * not of whichever account happens to be serving right now.
   *
   * One settings key per region (`MODEL_SELECTION_KEY`) because the two
   * gateways publish different rosters: saving the CN list must never rewrite
   * the international one. The card refuses an empty enable-list, because
   * saving one would leave the picker with nothing to offer and no obvious way
   * back.
   */
  const saveModels = async (region: PoolRegion): Promise<void> => {
    const local = draftByRegion[region]
    if (local === undefined || statusOf(region) === undefined) return
    if (Object.values(local).every(entry => !entry.enabled)) {
      setError(t?.('row.modelsEmpty') ?? 'No model enabled')
      return
    }
    const write = settingsScope?.set
    if (write === undefined) {
      setError(t?.('row.modelsSaveError', { message: 'settings scope is read-only' })
        ?? 'settings scope is read-only')
      return
    }
    setSavingModelsRegion(region)
    setFlash(undefined)
    try {
      // Every id the catalog knows about, so a model added upstream while the
      // card sat open is not silently dropped by an unrelated save.
      const enabledModelIds = Object.entries(local).filter(([, e]) => e.enabled).map(([id]) => id)
      const imageModelIds = Object.entries(local).filter(([, e]) => e.images).map(([id]) => id)
      const contextBudgets: Record<string, number> = {}
      for (const [id, entry] of Object.entries(local)) {
        if (entry.budget !== undefined) contextBudgets[id] = entry.budget
      }
      await write.call(settingsScope, MODEL_SELECTION_KEY[region], { enabledModelIds, imageModelIds, contextBudgets })
      setDraftFor(region, undefined)
      if (mounted.current) setFlash(t?.('row.modelsSaved') ?? 'Saved')
    } catch (cause: unknown) {
      if (mounted.current) {
        setError(t?.('row.modelsSaveError', { message: cause instanceof Error ? cause.message : String(cause) })
          ?? String(cause))
      }
    } finally {
      if (mounted.current) setSavingModelsRegion(undefined)
    }
  }
  /**
   * Choose how the pool spends its accounts.
   *
   * Not per region, and that is a host fact rather than a shortcut: the
   * settings schema holds ONE `distribution` key, `applyConfigFromSource` reads
   * it into the single pool instance, and both region providers draw accounts
   * from that one pool. A `distributionCn` / `distributionGlobal` pair would
   * have looked tidier and been silently dropped by the schema, so the mode
   * stays shared and the choice is written from the card that shows it.
   *
   * Both regions are refreshed afterwards so the mode is echoed in both cards
   * at once rather than one updating and the other going quietly stale.
   */
  const setDistribution = async (region: PoolRegion, next: PoolDistribution): Promise<void> => {
    const write = settingsScope?.set
    if (write === undefined) {
      setError(t?.('row.modelsSaveError', { message: 'settings scope is read-only' })
        ?? 'settings scope is read-only')
      return
    }
    setFlash(undefined)
    try {
      await write.call(settingsScope, 'distribution', next)
      for (const other of REGION_CARDS) await refresh(other)
    } catch (cause: unknown) {
      if (mounted.current) setError(String(cause))
    }
  }
  /**
   * Switch the daily-points automation on or off.
   *
   * The whole `automation` object is written as one key, because that is how the
   * settings document stores it: the schedule fields must be carried along, or a
   * save would drop the hour lists the scheduler is running on.
   *
   * The schedule is CN-only (the international gateway has no growth system at
   * all), so this is written from the CN card and both keys are refreshed: the
   * scheduler is one shared process, and a stale CN number showing under the
   * international card would be a lie.
   */
  const setAutomationEnabled = async (region: PoolRegion, enabled: boolean): Promise<void> => {
    const write = settingsScope?.set
    if (write === undefined) {
      setError(t?.('row.modelsSaveError', { message: 'settings scope is read-only' })
        ?? 'settings scope is read-only')
      return
    }
    const existing = statusOf(region)?.automation
    setAutomationBusyRegion(region)
    setFlash(undefined)
    try {
      // Every schedule field is carried along, `travelHours` included: it used
      // to be missing from this list, so toggling the switch silently DROPPED
      // the travel schedule from the saved document — and because the host then
      // read the key as absent, the card could never write it back either.
      //
      // Each list also falls back to the same defaults the host uses when it is
      // empty, so a document already holding `[]` (the shape the schema
      // materializes for "never configured") is healed by the next toggle
      // rather than written back as an unrunnable schedule.
      await write.call(settingsScope, 'automation', {
        checkinHours: hoursOrDefault(existing?.checkinHours, DEFAULT_AUTOMATION_HOURS.checkin),
        reportHours: hoursOrDefault(existing?.reportHours, DEFAULT_AUTOMATION_HOURS.report),
        taskHours: hoursOrDefault(existing?.taskHours, DEFAULT_AUTOMATION_HOURS.tasks),
        streakHours: hoursOrDefault(existing?.streakHours, DEFAULT_AUTOMATION_HOURS.streak),
        travelHours: hoursOrDefault(existing?.travelHours, DEFAULT_AUTOMATION_HOURS.travel),
        compensationHours: hoursOrDefault(existing?.compensationHours, DEFAULT_AUTOMATION_HOURS.compensation),
        enabled,
      })
      for (const other of REGION_CARDS) await refresh(other)
    } catch (cause: unknown) {
      if (mounted.current) setError(String(cause))
    } finally {
      if (mounted.current) setAutomationBusyRegion(undefined)
    }
  }
  /**
   * Run the whole automation pass now.
   *
   * The route only STARTS the pass: a full run takes tens of seconds, which is
   * far too long to hold a request open. This watches the scheduler status until
   * the run settles, so the panel can show "running" honestly and report the
   * result when it lands.
   */
  const runAutomationJob = async (region: PoolRegion): Promise<void> => {
    setAutomationRun('all')
    setAutomationRunRegion(region)
    setFlash(undefined)
    try {
      const response = await fetch(POOL_AUTOMATION_RUN_PATH, {
        method: 'POST',
        headers: { 'accept': 'application/json', 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ job: 'all' }),
      })
      const body = await response.json() as { error?: string; started?: boolean }
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
      if (body.started === false) {
        // A run is already going; the status poll below reports its outcome.
        if (mounted.current) setFlash(t?.('row.autoAlreadyRunning') ?? 'A run is already in progress')
      }
      // Poll until the scheduler reports the run finished. Bounded so a wedged
      // run cannot leave the button spinning forever. One scheduler serves both
      // regions, so its state is read from the CN slice — the only one that
      // carries an automation block at all.
      let settled = false
      for (let attempt = 0; attempt < AUTOMATION_POLL_ATTEMPTS; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, AUTOMATION_POLL_MS))
        if (!mounted.current) return
        const fresh = await refresh(region)
        if (fresh?.automation?.runInProgress === false) { settled = true; break }
      }
      await refresh(region)
      if (mounted.current) {
        setFlash(settled
          ? (t?.('row.autoRunDone') ?? 'Automation pass finished')
          : (t?.('row.autoRunTimeout') ?? 'Still running; check back in a moment'))
      }
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) {
        setAutomationRun(undefined)
        setAutomationRunRegion(undefined)
      }
    }
  }
  /**
   * Save one account reserved-credit floor.
   *
   * A reserve only protects credits if the pool knows the balance, so this
   * also refreshes the account list afterwards: the reserve badge appears
   * as soon as the reading crosses the floor.
   *
   * The key is NOT per region, and does not need to be: `creditReserves` is a
   * flat document keyed by account id, and account ids are unique across both
   * gateways, so the write cannot land in the wrong place. The region argument
   * only decides which card re-reads itself.
   *
   * Returns whether the host CONFIRMED the write. The card keys its inline
   * "saved / not saved" note off this, so a failure is shown where the user is
   * looking instead of only in the card-level notice line.
   */
  const saveCreditReserve = async (region: PoolRegion, accountId: string, reserve: number): Promise<boolean> => {
    setReserveBusy(accountId)
    setFlash(undefined)
    try {
      const response = await fetch(POOL_CREDIT_RESERVE_PATH, {
        method: 'POST',
        headers: { 'accept': 'application/json', 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ accountId, reserve }),
      })
      const body = await response.json() as { error?: string }
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
      await refresh(region)
      if (mounted.current) {
        setFlash(reserve > 0
          ? (t?.('row.reserveSaved', { credits: reserve }) ?? `Keeping ${reserve} credits`)
          : (t?.('row.reserveCleared') ?? 'Reserve cleared'))
      }
      return true
    } catch (cause: unknown) {
      // Reported to the caller (inline note) AND to the card-level error line:
      // the inline note says what failed, the line says why.
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      if (mounted.current) setReserveBusy(undefined)
    }
  }
  const title = t?.('row.title') ?? 'XD Pool'
  const description = t?.('row.desc') ?? ''
  /**
   * The vendor behind one lane, as the login page describes it.
   *
   * Both pool lanes ARE two of the thirteen scan-login channels — the pack
   * registers adapters for `buddy` and `workbuddy` too, and this plugin wins
   * that registration. So the pool page does not need its own copy of the
   * vendor's name: it reads the same roster the login page reads and looks the
   * lane up by its channel id.
   *
   * Falling back to the tab label is honest rather than decorative. Before the
   * roster has loaded — or if the channels document could not be read — the lane
   * still has to be nameable, and "国内版" is true while it is thin.
   */
  const brandOf = (region: PoolRegion): {
    name: string
    sub: string
    note: string
  } => {
    const fallbackName = region === 'cn'
      ? (t?.('row.tabCn') ?? 'CN')
      : (t?.('row.tabGlobal') ?? 'Global')
    const found = channels.find(channel => channel.id === REGION_CHANNEL_BY_REGION[region])
    if (found === undefined) {
      return { name: fallbackName, sub: '', note: t?.('row.regionWaiting') ?? '' }
    }
    return {
      name: found.name,
      sub: found.domain === undefined ? found.org : `${found.org} · ${found.domain}`,
      note: found.note,
    }
  }
  /**
   * Per-card derived state, computed once per card from its own slice of the
   * status document.
   *
   * Every one of these used to be a single value read from the focused tab,
   * which was fine when only one card existed. With both cards on screen a
   * shared `accountCount` would have let the international card render the
   * domestic account total, so each of them is now computed from the card's own
   * region and the card reads only its own.
   */
  const cardOf = (region: PoolRegion): RegionCardModel => {
    const here = statusOf(region)
    const accountCount = here?.accounts.length ?? 0
    const cooling = here?.cooling ?? 0
    const idle = here === undefined && error === undefined
    const hasHealthy = accountCount > 0 && cooling < accountCount
    const state: 'ok' | 'error' | 'idle' = error !== undefined
      ? 'error'
      : (idle ? 'idle' : (hasHealthy ? 'ok' : 'idle'))
    const models = here?.models ?? []
    const modelState = modelStateOf(region)
    const brand = brandOf(region)
    const activeAccount = here?.activeAccountId === undefined
      ? undefined
      : (here.accounts.find(account => account.id === here.activeAccountId))
    return {
      region,
      status: here,
      accountCount,
      cooling,
      idle,
      hasHealthy,
      state,
      regionLabel: region === 'cn'
        ? (t?.('row.tabCn') ?? 'CN')
        : (t?.('row.tabGlobal') ?? 'Global'),
      brandName: brand.name,
      brandSub: brand.sub,
      brandNote: brand.note,
      stateLabel: error !== undefined
        ? (t?.('row.requestFailed') ?? 'Request failed')
        : accountCount === 0
          ? (t?.('row.regionEmpty') ?? t?.('row.poolEmpty') ?? 'No account yet')
          : state === 'ok'
            ? (t?.('row.ok') ?? 'Healthy')
            : (t?.('row.allCooling') ?? 'All cooling'),
      models,
      modelState,
      activeAccount,
      automation: region === 'cn' ? here?.automation : undefined,      automationTotals: automationTotalsOf(here),
      /** 'ok' also covers "no accounts yet": a lane with nothing to serve is
          healthy as a lane, it simply has no roster. Only an unreadable
          document is an error, so the pill never claims a fault that is really
          just an empty sign-in list. */
      cardState: error !== undefined
        ? 'error'
        : (accountCount > 0 && cooling < accountCount ? 'ok' : 'cooling'),
    }
  }
  /*
   * The pool page's own header. The pages that read a different document
   * (channels, providers) render theirs, because each has its own actions and
   * its own reason to be empty.
   *
   * The per-region actions moved DOWN into the region cards: a page-level
   * rescan button cannot say which lane it will scan, and with both cards on
   * screen "Detect accounts again" at the top of the page was a question with
   * no answer. Every action here targets exactly one lane, so the header is
   * left without buttons rather than given one that has to guess.
   */
  const poolHero = (
    <PageHero title={title} sub={description} />
  )
  return (
    <PoolShell
      t={t}
      version={POOL_VERSION}
      avatar={POOL_CARD_AVATAR}
      tabs={shellTabs}
      active={page}
      onSelect={setPage}
      hero={page === 'pool' ? poolHero : undefined}
    >
      {page === 'aggregate' ? <AggregatePage t={t} />
        : page === 'channels' ? <ChannelsPage t={t} />
          : page === 'ledger' ? <LedgerPage t={t} usage={usage} />
                  : page === 'routing' ? <RoutingPage t={t} />
                : page === 'gateway' ? <GatewayPage t={t} />
                  : <>
              <style>{POOL_CARD_CSS}</style>
              {usage === undefined
                ? null
                : <section className="dsm-xdpool-card dsm-xdpool-usage" aria-label={t?.('row.usageTitle') ?? 'Usage'}>
                    <div className="dsm-xdpool-usage-head">
                      <h3 className="dsm-xdpool-usage-title">
                        {t?.('row.usageTitle') ?? 'Usage'}
                      </h3>
                      {/* Turns and calls are printed as two numbers, never as
                          one. A turn that rotated three accounts is ONE thing
                          the user asked for and THREE upstream round trips;
                          collapsing them is what makes a panel disagree with
                          the person reading it. */}
                      <p className="dsm-xdpool-usage-summary">
                        {t?.('row.usageTurns', {
                          turns: usage.turns,
                          calls: usage.calls,
                          failed: usage.failedTurns,
                          recovered: usage.recoveredTurns,
                        }) ?? `${usage.turns} turn(s) / ${usage.calls} call(s)`}
                      </p>
                    </div>
                    {usage.calls === 0
                      ? <p className="dsm-xdpool-usage-note">{t?.('row.usageEmpty') ?? 'No calls recorded yet.'}</p>
                      : null}
                    {/* "Reported no tokens" and "used no tokens" are different
                        facts, and only `usageReported` tells them apart. Printing
                        a confident zero about a gateway that simply declined to
                        answer would be the one number a usage panel must never
                        invent. */}
                    {usage.usageReported
                      ? null
                      : <p className="dsm-xdpool-usage-note">{t?.('row.usageNotReported') ?? 'The gateway reported no token counts.'}</p>}
                    <div className="dsm-xdpool-usage-rows">
                      {usage.rows.map(row => (
                        <div className="dsm-xdpool-usage-row" key={`${row.region}:${row.model}`}>
                          <span className="dsm-xdpool-usage-model">{row.model}</span>
                          <span className="dsm-xdpool-usage-numbers">
                            {t?.('row.usageTokens', {
                              input: formatNumber(row.inputTokens),
                              output: formatNumber(row.outputTokens),
                            }) ?? `${formatNumber(row.inputTokens)} in / ${formatNumber(row.outputTokens)} out`}
                            {row.cachedTokens > 0
                              ? ` · ${t?.('row.usageCached', { count: formatNumber(row.cachedTokens) }) ?? `${formatNumber(row.cachedTokens)} cached`}`
                              : ''}
                            {row.tps === null
                              ? ''
                              : ` · ${t?.('row.usageSpeed', { tps: formatNumber(row.tps) }) ?? `${formatNumber(row.tps)} tok/s`}`}
                            {row.avgTtftMs === null
                              ? ''
                              : ` · ${t?.('row.usageTtft', { ms: formatNumber(row.avgTtftMs) }) ?? `ttft ${formatNumber(row.avgTtftMs)}ms`}`}
                            {row.failed > 0
                              ? ` · ${t?.('row.usageRowFailed', { count: row.failed }) ?? `${row.failed} failed`}`
                              : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Stated rather than hidden: the window lives in memory, so
                        a restart empties it. A user who reads these as a
                        permanent record will one day be wrong about them. */}
                    <p className="dsm-xdpool-usage-note">
                      {t?.('row.usageWindow', { samples: usage.samples }) ?? 'Last {samples} call(s) held in memory; restarting clears them.'}
                    </p>
                  </section>}
              
              {/* Two region cards side by side, one per supplier lane.
                  Both are always rendered, so a lane with no accounts reads as
                  "not signed in here yet" rather than a tab that only appears
                  after the user has already signed in somewhere else. */}
              <section className="dsm-xdpool-regions">
              <div className="dsm-xdpool-region-grid">
                {REGION_CARDS.map(region => {
                  const card = cardOf(region)
                  const accountsPaneId = `dsm-xdpool-${region}-accounts`
                  const modelsPaneId = `dsm-xdpool-${region}-models`
                  const distPaneId = `dsm-xdpool-${region}-dist`
                  const autoPaneId = `dsm-xdpool-${region}-auto`
                  const accountsOpen = openedPanes[accountsPaneId] === true
                  const modelsOpen = openedPanes[modelsPaneId] === true
                  const distOpen = openedPanes[distPaneId] === true
                  const autoOpen = openedPanes[autoPaneId] === true
                  const models = card.models
                  const creditLeft = creditLeftOf(card.status)
                  /*
                   * Narrowed into locals instead of read off `card` in the JSX
                   * below. TypeScript's control-flow analysis tracks a `const`
                   * but forgets a property, so `card.automation.enabled` inside
                   * an onClick closure would still be "possibly undefined" even
                   * three levels below a guard that proved it.
                   */
                  const automation = card.automation
                  const here = card.status
                  return (
                    <article
                      key={region}
                      className="dsm-xdpool-region dsm-xdpool-region-in"
                      data-region={region}
                      data-state={card.cardState}
                      style={regionCardStyle(region) as Record<string, string>}
                    >
                      <div className="dsm-xdpool-region-head">
                        <RegionCardTile region={region} />
                        <div className="dsm-xdpool-region-titles">
                          <h3 className="dsm-xdpool-region-title">{card.brandName}</h3>
                          <p className="dsm-xdpool-region-sub">{card.brandSub}</p>
                        </div>
                        <span className="dsm-xdpool-region-state">{card.stateLabel}</span>
                      </div>
                      <p className="dsm-xdpool-region-note">{card.brandNote}</p>
                      {/*
                        * Numbers first, label after — the order the reference
                        * build reads them in, and the order a user compares two
                        * lanes in. These were three sunken tiles until this row
                        * went inline: three boxes to say three numbers made the
                        * card taller than the thing it was describing, and the
                        * numbers were the smallest text on it.
                        */}
                      <div className="dsm-xdpool-region-stats">
                        <span className="dsm-xdpool-region-stat">
                          <span className="dsm-xdpool-region-label">
                            {t?.('row.regionStatAccounts') ?? 'accounts'}
                          </span>{' '}
                          <b className="dsm-xdpool-region-num">{card.accountCount === 0 ? '–' : String(card.accountCount)}</b>
                        </span>
                        <span className="dsm-xdpool-region-stat">
                          <span className="dsm-xdpool-region-label">
                            {t?.('row.regionStatModels') ?? 'models'}
                          </span>{' '}
                          <b className="dsm-xdpool-region-num">{models.length === 0 ? '–' : `${card.modelState.enabled}/${models.length}`}</b>
                        </span>
                        <span className="dsm-xdpool-region-stat">
                          <span className="dsm-xdpool-region-label">
                            {t?.('row.regionStatCredit') ?? 'credit left'}
                          </span>{' '}
                          <b className="dsm-xdpool-region-num" data-tone="quiet">
                            {creditLeft ?? '–'}
                          </b>
                        </span>
                      </div>
                      <div className="dsm-xdpool-region-actions">
                        <div className="dsm-xdpool-region-btns">
                          <button
                            type="button"
                            className="dsm-btn dsm-btn-outline dsm-xdpool-region-btn"
                            disabled={busyRegion !== undefined}
                            aria-busy={busyRegion === region}
                            onClick={() => { void rescan(region) }}
                          >
                            {busyRegion === region
                              ? (t?.('row.accountsScanning') ?? 'Detecting…')
                              : (t?.('row.accountsRescan') ?? 'Detect accounts again')}
                          </button>
                          <button
                            type="button"
                            className="dsm-btn dsm-btn-outline dsm-xdpool-region-btn"
                            disabled={cooldownBusyRegion !== undefined || card.cooling === 0}
                            aria-busy={cooldownBusyRegion === region}
                            onClick={() => { void resetCooldowns(region) }}
                          >
                            {cooldownBusyRegion === region
                              ? (t?.('row.resetCooldownsBusy') ?? 'Clearing…')
                              : (t?.('row.resetCooldowns') ?? 'Clear all cooldowns')}
                          </button>
                          <button
                            type="button"
                            className="dsm-btn dsm-btn-outline dsm-xdpool-region-btn"
                            disabled={catalogBusyRegion !== undefined}
                            aria-busy={catalogBusyRegion === region}
                            onClick={() => { void refreshCatalog(region) }}
                            title={t?.('row.catalogRefreshHint') ?? 'Fetch the model list again from WorkBuddy'}
                          >
                            {catalogBusyRegion === region
                              ? (t?.('row.catalogRefreshing') ?? 'Fetching…')
                              : (t?.('row.catalogRefresh') ?? 'Refresh models')}
                          </button>
                        </div>
                        <div className="dsm-xdpool-region-seg">
                          <RegionCardTrigger
                            controls={accountsPaneId}
                            open={accountsOpen}
                            label={t?.('row.regionOpenAccounts') ?? `Open the ${card.regionLabel} account list`}
                            glyph="▶"
                            text={t?.('row.accountsTitle') ?? 'Accounts'}
                            count={card.accountCount === 0 ? undefined : String(card.accountCount)}
                            onToggle={() => { setPane(accountsPaneId, !accountsOpen) }}
                          />
                          <RegionCardTrigger
                            controls={modelsPaneId}
                            open={modelsOpen}
                            label={t?.('row.regionOpenModels') ?? `Open the ${card.regionLabel} model list`}
                            glyph="▸"
                            text={t?.('row.modelsTitle') ?? 'Models'}
                            count={models.length === 0 ? undefined : String(models.length)}
                            onToggle={() => { setPane(modelsPaneId, !modelsOpen) }}
                          />
                        </div>
                      </div>
                      {region === 'cn'
                        ? <div className="dsm-xdpool-region-cntools">
                            <button
                              type="button"
                              className="dsm-xdpool-region-tool"
                              aria-expanded={distOpen}
                              aria-controls={distPaneId}
                              onClick={() => { setPane(distPaneId, !distOpen) }}
                            >
                              <span className="dsm-xdpool-region-tool-caret" aria-hidden="true">▸</span>
                              <span>{t?.('row.distTitle') ?? 'Account usage'}</span>
                              <span className="dsm-xdpool-region-tool-value">
                                {distLabel(card.status?.distribution ?? 'priority', t)}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="dsm-xdpool-region-tool"
                              aria-expanded={autoOpen}
                              aria-controls={autoPaneId}
                              onClick={() => { setPane(autoPaneId, !autoOpen) }}
                            >
                              <span className="dsm-xdpool-region-tool-caret" aria-hidden="true">▸</span>
                              <span>{t?.('row.autoTitle') ?? 'Automation'}</span>
                              <span className="dsm-xdpool-region-tool-value">
                                {card.automation === undefined
                                  ? '–'
                                  : card.automation.enabled
                                    ? (t?.('row.autoOn') ?? 'On')
                                    : (t?.('row.autoOff') ?? 'Off')}
                              </span>
                            </button>
                          </div>
                        : null}
                      <RegionCardPane id={accountsPaneId} open={accountsOpen}>
                        {card.accountCount === 0 && card.status !== undefined
                          ? <div className="dsm-xdpool-region-empty">
                              <p className="dsm-xdpool-empty-title">
                                {t?.('row.regionEmptyTitle', { region: card.regionLabel })
                                  ?? t?.('row.regionEmpty') ?? 'No account yet'}
                              </p>
                              <div className="dsm-xdpool-empty-steps">
                                <p className="dsm-xdpool-empty-steps-title">
                                  {t?.('row.regionHowToTitle', { region: card.regionLabel })
                                    ?? `How to sign in to the ${card.regionLabel} version`}
                                </p>
                                <ol className="dsm-xdpool-empty-list">
                                  <li>{t?.('row.regionHowTo1') ?? ''}</li>
                                  <li>{t?.('row.regionHowTo2') ?? ''}</li>
                                  <li>{t?.('row.regionHowTo3') ?? ''}</li>
                                  <li>{t?.('row.regionHowTo4') ?? ''}</li>
                                </ol>
                              </div>
                              <p className="dsm-xdpool-empty-note">
                                {t?.('row.regionHowToNote') ?? ''}
                              </p>
                            </div>
                          : card.accountCount === 0
                            ? null
                            : <>
                                {/*
                                  Which account is serving used to be its own green
                                  strip above the list — a fact about one row, drawn
                                  where a summary of all of them would go, so the
                                  eye had to hunt for the row it belonged to. The
                                  marker now sits on the serving row itself.
                                */}
                                {card.status?.accounts.map(account => (
                                  <AccountBlock
                                    key={account.id}
                                    account={account}
                                    serving={card.activeAccount?.id === account.id}
                                    models={card.models}
                                    {...checkinBusyId === undefined ? {} : { checkinBusyId }}
                                    onClaimCheckin={(accountId) => { void claimCheckin(region, accountId) }}
                                    onSaveCreditReserve={(accountId, reserve) => saveCreditReserve(region, accountId, reserve)}
                                    onToggleDisabled={(accountId, disabled) => { void toggleAccountDisabled(region, accountId, disabled) }}
                                    onIgnoreAccount={(accountId) => { void setAccountIgnored(region, accountId, true) }}
                                    onPreferAccount={(accountId) => { void setPreferredAccount(region, accountId) }}
                                    {...accountBusyId === undefined ? {} : { accountBusyId }}
                                    t={t}
                                  />
                                ))}
                              </>}
                        {card.status?.skippedFiles === undefined || card.status.skippedFiles.length === 0
                          ? null
                          : <div className="dsm-xdpool-skipped">
                              <p className="dsm-xdpool-skipped-summary">
                                {t?.('row.skippedFiles', { count: card.status.skippedFiles.length })
                                  ?? `${card.status.skippedFiles.length} credential file(s) could not be read`}
                              </p>
                              {card.status.skippedFiles.slice(0, 4).map(entry => (
                                <p key={entry.file} className="dsm-xdpool-skipped-row">
                                  <span className="dsm-xdpool-skipped-file">{entry.file}</span>
                                  <span className="dsm-xdpool-skipped-reason">
                                    {entry.reason === 'encrypted'
                                      ? (t?.('row.skippedEncrypted') ?? 'encrypted — start WorkBuddy once')
                                      : entry.reason === 'unreadable'
                                        ? (t?.('row.skippedUnreadable') ?? 'file could not be read')
                                        : (t?.('row.skippedMalformed') ?? 'not a credential file')}
                                  </span>
                                </p>
                              ))}
                            </div>}
                        {(card.status?.ignored.length ?? 0) > 0
                          ? <div className="dsm-xdpool-ignored">
                              <p className="dsm-xdpool-ignored-summary">
                                {t?.('row.ignoredSummary', { count: card.status?.ignored.length ?? 0 })
                                  ?? `${card.status?.ignored.length ?? 0} account(s) no longer in the pool`}
                              </p>
                              {card.status?.ignored.map(entry => (
                                <div key={entry.id} className="dsm-xdpool-ignored-row">
                                  <span className="dsm-xdpool-ignored-label">{entry.label}</span>
                                  <button
                                    type="button"
                                    className="dsm-xdpool-ignored-restore"
                                    title={t?.('row.ignoredRestoreHint') ?? 'Put this account back into the pool'}
                                    disabled={accountBusyId === entry.id}
                                    onClick={() => { void setAccountIgnored(region, entry.id, false) }}
                                  >
                                    {t?.('row.ignoredRestore') ?? 'Restore'}
                                  </button>
                                </div>
                              ))}
                            </div>
                          : null}
                      </RegionCardPane>
                      <RegionCardPane id={modelsPaneId} open={modelsOpen}>
                        {models.length === 0
                          ? <p className="dsm-xdpool-region-empty">
                              {t?.('row.regionNoModels') ?? 'No model published by this gateway yet.'}
                            </p>
                          : <>
                              <div className="dsm-xdpool-region-pane-head">
                                <span className="dsm-xdpool-region-pane-title">
                                  {t?.('row.modelsEnabledCount', {
                                    enabled: card.modelState.enabled,
                                    total: models.length,
                                  }) ?? `${card.modelState.enabled} / ${models.length} enabled`}
                                </span>
                                <div className="dsm-xdpool-models-actions">
                                  {card.status?.catalogSource !== 'fallback'
                                    ? null
                                    : <span
                                        className="dsm-xdpool-catalog-offline"
                                        title={card.status.catalogError ?? undefined}
                                      >
                                        {t?.('row.catalogOffline') ?? 'built-in list (offline)'}
                                      </span>}
                                  <button
                                    type="button"
                                    className="dsm-btn dsm-btn-outline"
                                    disabled={!card.modelState.dirty}
                                    onClick={() => { discardModels(region) }}
                                  >
                                    {t?.('row.modelsDiscard') ?? 'Discard'}
                                  </button>
                                  <button
                                    type="button"
                                    className="dsm-btn dsm-btn-primary"
                                    disabled={!card.modelState.dirty || card.modelState.enabled === 0}
                                    onClick={() => { void saveModels(region) }}
                                  >
                                    {savingModelsRegion === region
                                      ? (t?.('row.modelsSaving') ?? 'Saving…')
                                      : (t?.('row.modelsSave') ?? 'Save')}
                                  </button>
                                </div>
                              </div>
                              <div className="dsm-xdpool-model-list">
                                {[...models]
                                  .sort((a, b) => Number(isFreeNow(b, now, region)) - Number(isFreeNow(a, now, region)))
                                  .map(model => (
                                    <ModelRow
                                      key={model.id}
                                      model={model}
                                      region={region}
                                      paidTwin={paidAlternativeFor(model, models)}
                                      t={t}
                                      draft={card.modelState.draft[model.id] ?? { enabled: model.enabled, images: model.supportsImages }}
                                      editable={card.modelState.editable}
                                      onToggle={(id) => { toggleModel(region, id) }}
                                      onToggleImage={(id) => { toggleModelImage(region, id) }}
                                      onBudget={(id, budget) => { setModelBudget(region, id, budget) }}
                                      onTest={() => { void testModel(XDPOOL_REGION_PROVIDER[region], model.id) }}
                                      probe={probes[model.id]}
                                      probing={probingModel === model.id}
                                    />
                                  ))}
                              </div>
                            </>}
                      </RegionCardPane>
                      <RegionCardPane id={distPaneId} open={distOpen}>
                        {card.status === undefined ? null
                          : <div className="dsm-xdpool-dist" role="radiogroup"
                              aria-label={t?.('row.distTitle') ?? 'Account usage'}>
                              <div className="dsm-xdpool-dist-head">
                                <span className="dsm-xdpool-dist-title">
                                  {t?.('row.distTitle') ?? 'Account usage'}
                                </span>
                                <span className="dsm-xdpool-dist-now">
                                  {distLabel(card.status.distribution ?? 'priority', t)}
                                </span>
                              </div>
                              <div className="dsm-xdpool-dist-options">
                                {DIST_OPTIONS.map(option => {
                                  const active = (card.status?.distribution ?? 'priority') === option
                                  const cls = 'dsm-xdpool-dist-option'
                                    + (active ? ' dsm-xdpool-dist-option-active' : '')
                                  return (
                                    <button
                                      key={option}
                                      type="button"
                                      role="radio"
                                      aria-checked={active}
                                      title={distHint(option, t)}
                                      disabled={!card.modelState.editable}
                                      className={cls}
                                      onClick={() => { void setDistribution(region, option) }}
                                    >
                                      <span className="dsm-xdpool-dist-option-top">
                                        <span className="dsm-xdpool-dist-option-name">{distLabel(option, t)}</span>
                                        {option === 'sticky'
                                          ? <span className="dsm-xdpool-dist-option-badge">
                                              {t?.('row.distRecommended') ?? 'Recommended'}
                                            </span>
                                          : null}
                                      </span>
                                    </button>
                                  )
                                })}
                              </div>
                              <p className="dsm-xdpool-dist-hint">
                                {distHint(card.status?.distribution ?? 'priority', t)}
                              </p>
                            </div>}
                      </RegionCardPane>
                      <RegionCardPane id={autoPaneId} open={autoOpen}>
                        {automation === undefined
                          ? <p className="dsm-xdpool-region-empty">
                              {t?.('row.autoUnavailable') ?? 'This lane has no daily-points system.'}
                            </p>
                          : here === undefined
                            ? null
                            : <div className="dsm-xdpool-auto">
                              <div className="dsm-xdpool-auto-head">
                                <span className="dsm-xdpool-auto-title">
                                  {t?.('row.autoTitle') ?? 'Automation'}
                                </span>
                                {automation.enabled
                                  ? <button
                                      type="button"
                                      className="dsm-btn dsm-btn-outline dsm-xdpool-auto-run"
                                      disabled={automationRun !== undefined}
                                      onClick={() => { void runAutomationJob(region) }}
                                    >
                                      {automationRun !== undefined
                                        ? (t?.('row.autoRunning') ?? 'Running…')
                                        : (t?.('row.autoRunAll') ?? 'Run all now')}
                                    </button>
                                  : null}
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={automation.enabled}
                                  disabled={!settingsWritable || automationBusyRegion !== undefined}
                                  className={`dsm-xdpool-auto-switch${automation.enabled ? ' dsm-xdpool-auto-switch-on' : ''}`}
                                  onClick={() => { void setAutomationEnabled(region, !automation.enabled) }}
                                >
                                  {automationBusyRegion === region
                                    ? (t?.('row.autoBusy') ?? 'Saving…')
                                    : automation.enabled
                                      ? (t?.('row.autoOn') ?? 'On')
                                      : (t?.('row.autoOff') ?? 'Off')}
                                </button>
                              </div>
                              <p className="dsm-xdpool-auto-hint">
                                {automation.enabled
                                  ? (t?.('row.autoHintOn') ?? 'Reports activity, claims task rewards and checks in once a day.')
                                  : (t?.('row.autoHintOff') ?? 'Off: no background requests are made for you.')}
                              </p>
                              {card.automationTotals.credit === 0 && card.automationTotals.checkinCredit === 0
                                && card.automationTotals.bonusCredit === 0 && card.automationTotals.travelCredit === 0
                                && card.automationTotals.compensationCredit === 0
                                ? null
                                : <div className="dsm-xdpool-auto-total">
                                    <span className="dsm-xdpool-auto-total-label">
                                      {t?.('row.autoToday') ?? 'Today'}
                                    </span>
                                    <span className="dsm-xdpool-auto-total-list">
                                      {card.automationTotals.credit > 0
                                        ? <span className="dsm-xdpool-auto-total-row">
                                            {t?.('row.autoFromTasks', {
                                              credit: card.automationTotals.credit,
                                              energy: card.automationTotals.energy,
                                              count: card.automationTotals.claimed,
                                            }) ?? `Tasks +${card.automationTotals.credit}`}
                                          </span>
                                        : null}
                                      {card.automationTotals.checkinCredit > 0
                                        ? <span className="dsm-xdpool-auto-total-row">
                                            {t?.('row.autoFromCheckin', { credit: card.automationTotals.checkinCredit })
                                              ?? `Check-in +${card.automationTotals.checkinCredit}`}
                                          </span>
                                        : null}
                                      {card.automationTotals.bonusCredit > 0
                                        ? <span className="dsm-xdpool-auto-total-row">
                                            {t?.('row.autoFromBonus', { credit: card.automationTotals.bonusCredit })
                                              ?? `Streak +${card.automationTotals.bonusCredit}`}
                                          </span>
                                        : null}
                                      {card.automationTotals.travelCredit > 0
                                        ? <span className="dsm-xdpool-auto-total-row">
                                            {t?.('row.autoFromTravel', { credit: card.automationTotals.travelCredit })
                                              ?? `Buddy +${card.automationTotals.travelCredit}`}
                                          </span>
                                        : null}
                                      {card.automationTotals.compensationCredit > 0
                                        ? <span className="dsm-xdpool-auto-total-row">
                                            {t?.('row.autoFromCompensation', { credit: card.automationTotals.compensationCredit })
                                              ?? `Compensation +${card.automationTotals.compensationCredit}`}
                                          </span>
                                        : null}
                                    </span>
                                  </div>}
                              {automation.enabled
                                ? <div className="dsm-xdpool-auto-jobs">
                                    {AUTOMATION_JOBS.map(kind => {
                                      const job = automationJob(here, kind)
                                      const hours = automationHours(here, kind)
                                      const label = t?.(`row.autoJob_${kind}`) ?? kind
                                      return (
                                        <div key={kind} className="dsm-xdpool-auto-job">
                                          <span className="dsm-xdpool-auto-job-name">{label}</span>
                                          <span className="dsm-xdpool-auto-job-when">
                                            {hours.length === 0
                                              ? (t?.('row.autoHourNone') ?? 'not scheduled')
                                              : hours.map(hour => `${String(hour).padStart(2, '0')}:00`).join(' · ')}
                                          </span>
                                          <span className="dsm-xdpool-auto-job-last">
                                            {job?.lastRunAtMs === undefined
                                              ? (t?.('row.autoNever') ?? 'not run yet')
                                              : `${formatTime(job.lastRunAtMs)} · ${job.ok}${job.failed > 0 ? `/${job.failed}` : ''}`}
                                          </span>
                                          {job?.progress === undefined
                                            ? null
                                            : <span className="dsm-xdpool-auto-job-note">{job.progress}</span>}
                                          {job?.detail === undefined || job.detail.length === 0
                                            ? null
                                            : <span className="dsm-xdpool-auto-job-detail">
                                                {job.detail.join(' · ')}
                                              </span>}
                                        </div>
                                      )
                                    })}
                                  </div>
                                : null}
                            </div>}
                      </RegionCardPane>
                    </article>
                  )
                })}
              </div>
              </section>
              <ChannelPoolSection t={t} />
              {flash === undefined ? null
                : <p className="dsm-xdpool-note">{flash}</p>}
              {error === undefined ? null
                : <p className="dsm-xdpool-error">
                    {t?.('row.error', { message: error }) ?? `Pool status unavailable: ${error}`}
                  </p>}
          </>
      }
    </PoolShell>
  )
}
/** One account block: label + status tag + meta + optional credit panels. */
function AccountBlock({
  account,
  models,
  t,
  checkinBusyId,
  onClaimCheckin,
  accountBusyId,
  onToggleDisabled,
  onIgnoreAccount,
  onPreferAccount,
  onSaveCreditReserve,
  reserveBusyId,
  serving,
}: {
  account: PoolWebAccount
  /**
   * The current catalog, so a per-model cooldown can name the paid row of the
   * cooling model. Same roster the model list above is drawn from — a hint
   * built from a different list could name an id this gateway does not serve.
   */
  models: readonly PoolWebModel[]
  t?: PoolCardProps['t']
  /** Account id whose claim is in flight, if any. */
  checkinBusyId?: string
  onClaimCheckin: (accountId: string) => void
  /** Account id whose switch is in flight, if any. */
  accountBusyId?: string
  onToggleDisabled: (accountId: string, disabled: boolean) => void
  /** Throw this account out of the pool for good. */
  onIgnoreAccount: (accountId: string) => void
  /**
   * Pin this account to be tried first, or clear the pin with `null`.
   *
   * Not "make this the only account": the pool falls back to the distribution
   * strategy whenever the pinned account fails a gate, which is what makes the
   * control safe to leave set.
   */
  onPreferAccount: (accountId: string | null) => void
  onSaveCreditReserve: (accountId: string, reserve: number) => Promise<boolean>
  /** Account id whose reserve is being saved, if any. */
  reserveBusyId?: string
  /**
   * Is this the account the pool served its last request with?
   *
   * Deliberately drawn ON this row instead of in a banner above the list. Which
   * account is "current" is a property of one row: under `balanced` the next
   * request may not even use it, and under `round-robin` the answer changes every
   * turn. A strip above the list claimed more than the pool knows.
   */
  serving?: boolean
}) {
  const isDisabled = account.disabled === true
  const isPreferred = account.preferred === true
  const isCooling = account.cooling === true
  const isDead = account.credentialDead === true
  const cooldownUntil = account.cooldownUntil !== undefined ? Date.parse(account.cooldownUntil) : undefined
  const modelCooldowns = account.modelCooldowns ?? []
  // Only a whole-account cooldown gets a tag. Per-model cooldowns do NOT mark
  // the account cooling (its other models still serve) — they render as
  // per-model chips below instead, e.g. "hy4-preview cooling to 10:14".
  //
  // There is deliberately no "Next up" tag: which account serves next is not
  // knowable from here. `balanced` draws at random, `round-robin` walks a
  // cursor, and the old flag only ever meant "highest-priority eligible" —
  // which is not the same thing, and did not account for disabled accounts.
  //
  // A rejected sign-in outranks "cooling": a cooldown lifts on its own, this
  // one needs the user to sign in again, so it is the more useful thing to say.
  const tag = isDead
    ? { text: t?.('row.credentialDeadTag') ?? 'Sign-in rejected', cls: 'dsm-xdpool-account-tag dsm-xdpool-account-tag-dead' }
    : isCooling
      ? { text: t?.('row.cooling') ?? 'Cooling', cls: 'dsm-xdpool-account-tag dsm-xdpool-account-tag-cooling' }
      : null
  return (
    <div className={isDisabled ? 'dsm-xdpool-account dsm-xdpool-account-off' : 'dsm-xdpool-account'}
         data-serving={serving === true ? 'true' : undefined}
    >
      <div className="dsm-xdpool-account-head">
        <span className="dsm-xdpool-account-label">{account.label}</span>
        {serving === true
          ? <span className="dsm-xdpool-current">
              <span className="dsm-xdpool-current-dot" />
              <span className="dsm-xdpool-current-label">
                {t?.('row.currentAccount') ?? 'In use now'}
              </span>
            </span>
          : null}
        {tag === null ? null : <span className={tag.cls}>{tag.text}</span>}
        {/* Pin this account to be tried first. A third control, not a fourth
            state of the switch above: "use this one first" and "only use this
            one" are different promises, and the pool only ever makes the first.
            Clicking it again clears the pin, which is why the pinned state is
            its own label rather than a pressed look — a user who cannot see
            how to undo a choice will simply pin a different account instead. */}
        <button
          type="button"
          className={isPreferred
            ? 'dsm-xdpool-account-prefer dsm-xdpool-account-prefer-on'
            : 'dsm-xdpool-account-prefer'}
          aria-pressed={isPreferred}
          title={isPreferred
            ? (t?.('row.accountPreferClearHint') ?? 'Stop preferring this account; the distribution strategy decides again')
            : (t?.('row.accountPreferHint') ?? 'Try this account first while it stays healthy')}
          disabled={accountBusyId === account.id || accountBusyId === 'none'}
          onClick={() => { onPreferAccount(isPreferred ? null : account.id) }}
        >
          <span className="dsm-xdpool-account-prefer-star" aria-hidden="true">★</span>
          {isPreferred ? (t?.('row.accountPreferOn') ?? 'Preferred') : (t?.('row.accountPrefer') ?? 'Prefer')}
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={!isDisabled}
          className={isDisabled
            ? 'dsm-xdpool-account-toggle'
            : 'dsm-xdpool-account-toggle dsm-xdpool-account-toggle-on'}
          title={t?.('row.accountToggleHint') ?? 'Enable this account (uncheck to keep it out of the pool)'}
          disabled={accountBusyId === account.id}
          onClick={() => { onToggleDisabled(account.id, !isDisabled) }}
        >
          <span className="dsm-xdpool-account-toggle-dot" />
          {isDisabled ? (t?.('row.accountOff') ?? 'Disabled') : (t?.('row.accountInRotation') ?? 'Enabled')}
        </button>
        {/* Throwing the account away for good. Deliberately a separate, plainly
            labelled button rather than a third state of the switch above:
            "stop using this for now" and "this account is not mine any more"
            are different decisions, and merging them into one control is how a
            user permanently drops an account by accident. */}
        <button
          type="button"
          className="dsm-xdpool-account-ignore"
          title={t?.('row.accountIgnoreHint') ?? 'Remove this account from the pool for good'}
          disabled={accountBusyId === account.id}
          onClick={() => { onIgnoreAccount(account.id) }}
        >
          {t?.('row.accountIgnore') ?? 'Remove'}
        </button>
      </div>
      <div className="dsm-xdpool-account-body">
        <div className="dsm-xdpool-account-copy">
          {account.expiresAt !== undefined
            ? <span className="dsm-xdpool-account-meta">
                {t?.('row.tokenExpiry', { time: formatDateTime(account.expiresAt) })
                  ?? `token ${formatDateTime(account.expiresAt)}`}
              </span>
            : null}
          {isCooling && cooldownUntil !== undefined && !Number.isNaN(cooldownUntil)
            ? <span className="dsm-xdpool-account-meta">
                {t?.('row.cooldownUntil', { time: formatTime(cooldownUntil) }) ?? `until ${formatTime(cooldownUntil)}`}
                {' · '}
                {t?.('row.cooldownHits', { hits: account.rateLimitHits ?? 0 })
                  ?? `${account.rateLimitHits ?? 0} hit(s)`}
              </span>
            : null}
          {isDead
            ? <span className="dsm-xdpool-account-meta dsm-xdpool-account-meta-dead">
                {t?.('row.credentialDeadHint') ?? 'Sign in again in the WorkBuddy desktop app to restore it'}
              </span>
            : null}
          {modelCooldowns.length > 0
            ? <div className="dsm-xdpool-account-modelcool">
                {modelCooldowns.map(mc => {
                  // Each row of a product line is rate-limited on its own, so a
                  // cooling free row usually has a paid twin that still serves.
                  // Saying so here turns "wait until 10:14" into a choice.
                  const coolingModel = models.find(model => model.id === mc.modelId)
                  const twin = coolingModel === undefined
                    ? undefined
                    : paidAlternativeFor(coolingModel, models)
                  return (
                    <span key={mc.modelId} className="dsm-xdpool-account-modelcool-chip">
                      {t?.('row.modelCooling', { model: mc.modelId, time: formatDateTime(mc.until) })
                        ?? `${mc.modelId} cooling to ${formatDateTime(mc.until)}`}
                      {twin === undefined ? null
                        : <span className="dsm-xdpool-account-modelcool-twin" title={t?.('row.paidTwinHint') ?? 'Same model, paid row'}>
                            {t?.('row.rateLimitedPaidTwin', { id: twin.id, rate: twin.multiplier.toFixed(2) })
                              ?? `→ ${twin.id} (${twin.multiplier.toFixed(2)}x) still works`}
                          </span>}
                    </span>
                  )
                })}
              </div>
            : null}
        </div>
        <AccountStats
          account={account}
          t={t}
          checkinBusy={checkinBusyId === account.id}
          onClaim={onClaimCheckin}
        />
        {/* Reserved credits: keep the last N credits of an account rather than
            spending it to zero. The pool stops picking the account once its
            balance reaches the floor. */}
        <CreditReserveRow
          account={account}
          t={t}
          busy={reserveBusyId === account.id}
          onSave={onSaveCreditReserve}
        />
        {/* What the automation got this account today, one line per source.
            Nothing is rendered when the automation earned nothing, rather than a
            row of zeroes that reads like a failure. */}
        {account.automationToday === undefined
          ? null
          : <div className="dsm-xdpool-earned">
              <span className="dsm-xdpool-earned-label">
                {t?.('row.autoEarned') ?? 'Automation today'}
              </span>
              <span className="dsm-xdpool-earned-list">
                {account.automationToday.credit > 0
                  ? <span className="dsm-xdpool-earned-row">
                      {t?.('row.autoFromTasks', { credit: account.automationToday.credit, energy: account.automationToday.energy, count: account.automationToday.claimed })
                        ?? `Tasks +${account.automationToday.credit}`}
                    </span>
                  : null}
                {account.automationToday.checkinCredit > 0
                  ? <span className="dsm-xdpool-earned-row">
                      {t?.('row.autoFromCheckin', { credit: account.automationToday.checkinCredit })
                        ?? `Check-in +${account.automationToday.checkinCredit}`}
                    </span>
                  : null}
                {account.automationToday.bonusCredit > 0
                  ? <span className="dsm-xdpool-earned-row">
                      {t?.('row.autoFromBonus', { credit: account.automationToday.bonusCredit })
                        ?? `Streak +${account.automationToday.bonusCredit}`}
                    </span>
                  : null}
                {account.automationToday.travelCredit > 0
                  ? <span className="dsm-xdpool-earned-row">
                      {t?.('row.autoFromTravel', { credit: account.automationToday.travelCredit })
                        ?? `Buddy +${account.automationToday.travelCredit}`}
                    </span>
                  : null}
                {account.automationToday.compensationCredit > 0
                  ? <span className="dsm-xdpool-earned-row">
                      {t?.('row.autoFromCompensation', { credit: account.automationToday.compensationCredit })
                        ?? `Compensation +${account.automationToday.compensationCredit}`}
                    </span>
                  : null}
              </span>
            </div>}
      </div>
    </div>
  )
}
/**
 * Daily check-in block: streak summary plus one claim button for this account.
 * Every account in the pool gets its own button, so a multi-account user can
 * collect each reward without switching the pool's preferred account first.
 */
/**
 * Credit panels: package breakdown on the left, the big total on the right with
 * the daily check-in action docked beneath it. Mirrors the two-column credit
 * layout the LaoDing plugin family uses, so the numbers stay scannable and the
 * claim button sits where the eye already is.
 */
/**
 * Reserved-credit control for one account.
 *
 * The value is committed on blur or Enter rather than on every keystroke:
 * each save is a settings write plus a status refresh, and a per-character
 * save would hammer both.
 */
/**
 * The reserved-credit floor for one account.
 *
 * Saving is an EXPLICIT action, not a blur side effect. The old version
 * committed `onBlur`, which meant a value could be written without the user
 * asking for it — and when the write silently failed, the only trace was a
 * notice line at the top of the card that is easy to miss. That is how
 * "I typed a number, reopened, and it says 0 again" happened with no visible
 * error to explain it.
 *
 * Now: the field is a draft, Save is enabled only when the draft differs from
 * what the host last reported, and the outcome (saving / saved / failed) is
 * shown inline next to the button. Enter also saves, so keyboard flow is not
 * lost.
 */
function CreditReserveRow({
  account,
  t,
  busy,
  onSave,
}: {
  account: PoolWebAccount
  t?: PoolCardProps['t']
  busy: boolean
  /** Resolves true when the host confirmed the write, false otherwise. */
  onSave: (accountId: string, reserve: number) => Promise<boolean>
}) {
  const saved = account.creditReserve ?? 0
  const [draft, setDraft] = useState<string>(String(saved))
  // Track the last successful write so the field can settle on it without
  // waiting for the next poll: a save that worked must be visibly reflected.
  const [settled, setSettled] = useState<number>(saved)
  const [note, setNote] = useState<'saved' | 'failed' | undefined>(undefined)
  // Follow the host document when it changes underneath us (another tab, or a
  // refresh after this card saved). Never during an edit: that would overwrite
  // what the user is typing.
  useEffect(() => {
    setSettled(saved)
    setDraft(current => (current === String(saved) ? current : String(saved)))
  }, [saved])
  const parsed = Number.parseInt(draft, 10)
  const next = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
  // "Dirty" compares against the settled value, not the possibly-stale prop, so
  // the button stays disabled right after a successful save.
  const dirty = next !== settled
  const commit = async (): Promise<void> => {
    if (busy || !dirty) return
    setNote(undefined)
    const ok = await onSave(account.id, next)
    if (ok) {
      setSettled(next)
      setDraft(String(next))
      setNote('saved')
    } else {
      setNote('failed')
    }
  }
  return (
    <div className="dsm-xdpool-reserve">
      <span className="dsm-xdpool-reserve-label">
        {t?.('row.reserveTitle') ?? 'Keep at least'}
      </span>
      <input
        type="number"
        min={0}
        step={1}
        value={draft}
        disabled={busy}
        className="dsm-xdpool-reserve-input"
        aria-label={t?.('row.reserveTitle') ?? 'Keep at least'}
        onChange={(event) => {
          setDraft(event.target.value)
          setNote(undefined)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void commit()
        }}
      />
      <span className="dsm-xdpool-reserve-unit">
        {t?.('row.reserveUnit') ?? 'credits'}
      </span>
      <button
        type="button"
        className="dsm-xdpool-reserve-save"
        disabled={busy || !dirty}
        onClick={() => { void commit() }}
      >
        {busy
          ? (t?.('row.reserveSaving') ?? 'Saving…')
          : (t?.('row.reserveSave') ?? 'Save')}
      </button>
      {note === 'saved'
        ? <span className="dsm-xdpool-reserve-note dsm-xdpool-reserve-note-ok">
            {next > 0
              ? (t?.('row.reserveSaved', { credits: next }) ?? `Keeping ${next} credits`)
              : (t?.('row.reserveCleared') ?? 'Reserve cleared')}
          </span>
        : null}
      {note === 'failed'
        ? <span className="dsm-xdpool-reserve-note dsm-xdpool-reserve-note-bad">
            {t?.('row.reserveFailed') ?? 'Not saved — try again'}
          </span>
        : null}
      {account.reserved === true
        ? <span className="dsm-xdpool-reserve-badge">
            {t?.('row.reserveHolding') ?? 'Reserved: skipped'}
          </span>
        : null}
    </div>
  )
}
function AccountStats({
  account,
  t,
  checkinBusy,
  onClaim,
}: {
  account: PoolWebAccount
  t?: PoolCardProps['t']
  checkinBusy: boolean
  onClaim: (accountId: string) => void
}) {
  const credits = account.credits
  const checkin = account.checkin
  const hasCredits = credits !== undefined || account.creditsError !== undefined
  const hasCheckin = checkin !== undefined || account.checkinError !== undefined
  if (!hasCredits && !hasCheckin) return null
  const packages = (credits?.packages ?? [])
    .filter(p => (p.size ?? 0) > 0)
    .slice(0, 6)
  return (
    /*
     * One line of figures, in the order the eye should read them: what this
     * account is worth, then the one thing it can still be made to earn today,
     * then the breakdown behind the number.
     *
     * It used to be a two-column grid — packages on the left, a boxed total with
     * the check-in button underneath it on the right — inside a card that the
     * lane's own width already forces down to a single column. So the grid never
     * did its job: the "right" column dropped below the packages and each half
     * ended up a tall box holding one number. One wrapping line of figures keeps
     * the balance, the action and the breakdown in reading order at any width,
     * and stops a routine balance from being set in 28px type.
     */
    <div className="dsm-xdpool-stats">
      <span className="dsm-xdpool-panel dsm-xdpool-panel-total">
        <span className="dsm-xdpool-panel-title">
          {t?.('row.creditsTotal') ?? 'Total'}
        </span>
        <span className="dsm-xdpool-total-value">
          {formatNumber(credits?.total)}
        </span>
      </span>
      {hasCheckin
        ? <div className="dsm-xdpool-checkin">
            {account.checkinError !== undefined
              /* Folded to a marker with the full text in the tooltip. A gateway
                 rejection is a whole paragraph; printed inline it buries the
                 figures it belongs to. */
              ? <span className="dsm-xdpool-checkin-error" title={account.checkinError}>
                  {t?.('row.checkinUnavailable') ?? 'check-in unavailable'}
                </span>
              : checkin === undefined
                ? null
                : <>
                    <div className="dsm-xdpool-checkin-meta">
                      <span className="dsm-xdpool-checkin-streak">
                        {t?.('row.checkinStreak', { days: checkin.streakDays })
                          ?? `${checkin.streakDays}-day streak`}
                      </span>
                      {checkin.dailyCredit > 0
                        ? <span className="dsm-xdpool-checkin-daily">
                            {t?.('row.checkinDaily', { credit: formatNumber(checkin.dailyCredit) })
                              ?? `+${formatNumber(checkin.dailyCredit)}/day`}
                          </span>
                        : null}
                    </div>
                    {checkin.isStreakDay && checkin.streakBonusCredit > 0
                      ? <span className="dsm-xdpool-checkin-bonus">
                          {t?.('row.checkinStreakBonus', {
                            days: formatNumber(checkin.nextStreakDay),
                            credit: formatNumber(checkin.streakBonusCredit),
                          }) ?? `bonus +${formatNumber(checkin.streakBonusCredit)}`}
                        </span>
                      : null}
                    <button
                      type="button"
                      className="dsm-xdpool-checkin-btn"
                      disabled={!checkin.active || checkin.todayCheckedIn || checkinBusy}
                      onClick={() => { onClaim(account.id) }}
                    >
                      {!checkin.active
                        ? (t?.('row.checkinInactive') ?? 'Unavailable')
                        : checkin.todayCheckedIn
                          ? (t?.('row.checkinClaimed') ?? 'Checked in')
                          : checkinBusy
                            ? (t?.('row.checkinClaiming') ?? 'Checking in…')
                            : (t?.('row.checkinClaim') ?? 'Check in')}
                    </button>
                  </>}
          </div>
        : null}
      {hasCredits
        ? <ul className="dsm-xdpool-panel-packages dsm-xdpool-packages">
            {account.creditsError !== undefined
              // The upstream error is a full English paragraph (it explains HOW
              // to recover). Printed inline it would blow the line up to several
              // lines, so it becomes a short marker with the text in the tooltip.
              ? <li>
                  <span
                    className={`dsm-xdpool-panel-error${account.credentialDead === true ? ' dsm-xdpool-panel-error-dead' : ''}`}
                    title={account.creditsError}
                  >
                    {account.credentialDead === true
                      ? t?.('row.credentialDead') ?? 'Sign-in rejected'
                      : t?.('row.creditsError') ?? 'credits unavailable'}
                  </span>
                </li>
              : packages.length === 0
                ? <li className="dsm-xdpool-panel-empty">–</li>
                : packages.map((pack, index) => {
                  const expiry = formatExpiry(pack.expiresAtMs)
                  const refresh = formatExpiry(pack.cycleRefreshMs)
                  const soon = isExpiringSoon(pack)
                  // Monthly packs refresh on a cycle; one-off packs expire. Either
                  // way the deadline is what the user needs, and a pack that
                  // declares neither simply omits it.
                  const when = pack.monthly === true
                    ? (refresh === '' ? null : (t?.('row.creditsRefreshAt', { time: refresh }) ?? `Refreshes ${refresh}`))
                    : (expiry === '' ? null : (t?.('row.creditsExpiresAt', { time: expiry }) ?? `Expires ${expiry}`))
                  return (
                    <li key={`${pack.packageName}-${String(index)}`}>
                      <span className="dsm-xdpool-packages-name">{pack.packageName}</span>
                      <span className="dsm-xdpool-packages-value">
                        {t?.('row.creditsPackage', { remain: formatNumber(pack.remain), size: formatNumber(pack.size) })
                          ?? `${formatNumber(pack.remain)} / ${formatNumber(pack.size)}`}
                      </span>
                      {when === null ? null
                        : <span
                            className={`dsm-xdpool-packages-when${soon ? ' dsm-xdpool-packages-when-soon' : ''}`}
                            title={t?.('row.creditsExpiresSoonTitle') ?? 'Expiring within 3 days'}
                          >
                            {when}
                          </span>}
                    </li>
                  )
                })}
            {credits?.expiringSoon !== undefined && credits.expiringSoon > 0
              ? <li className="dsm-xdpool-packages-when">
                  {t?.('row.creditsSoon') ?? 'Expiring in 3 days'}
                  {' '}
                  {formatNumber(credits.expiringSoon)}
                </li>
              : null}
          </ul>
        : null}
    </div>
  )
}
/**
 * One model row.
 *
 * Read-only when the card has no writable settings scope: the checkbox and the
 * context radios stay disabled rather than pretending an edit took hold. The
 * draft lives in the parent, so this component only ever reports intent.
 */
/**
 * The provider id a probe must name for each region's pool lane.
 *
 * These strings are duplicated from `src/adapter.ts` rather than imported,
 * because that module pulls in the Node-only catalog and shim code the browser
 * bundle must never touch. The values are what the host resolves
 * `ctx.llm.stream` against, so a drift here would make the button probe a
 * provider that does not exist — which the host answers as an unknown-model
 * error rather than as a connectivity failure.
 */
const XDPOOL_REGION_PROVIDER = { cn: 'xdpool', global: 'xdpool-global' } as const

function ModelRow({
  model,
  region,
  paidTwin,
  t,
  draft,
  editable,
  onToggle,
  onToggleImage,
  onBudget,
  onTest,
  probe,
  probing,
}: {
  model: PoolWebModel
  /** Which gateway this row belongs to; the promo campaigns are regional. */
  region: 'cn' | 'global'
  /**
   * The cheapest priced row sharing this model's display name, when this row
   * itself is free. Undefined for paid rows and for lone models — see
   * {@link paidAlternativeFor} for why the guard matters.
   */
  paidTwin: PaidSibling | undefined
  t?: PoolCardProps['t']
  draft: ModelDraftEntry
  editable: boolean
  onToggle: (id: string) => void
  onToggleImage: (id: string) => void
  onBudget: (id: string, budget: number) => void
  /** Send one real request to this row's model and record the reading. */
  onTest?: () => void
  /** The last reading for this row, if the user has run one. */
  probe?: ModelProbeReading | undefined
  /** True while this row's probe is in flight. */
  probing?: boolean
}) {
  /**
   * A per-MOUNTED-ROW scope for the two budget radios.
   *
   * HTML groups radios by `name`, and React renders both region cards at once —
   * the collapsible panes stay in the DOM with `hidden`, they are not unmounted.
   * A `name` built from the model id alone is therefore the SAME name in the
   * cn card and the global card, so the two rows joined one radio group: the
   * browser keeps only the last checked member, and whichever card renders
   * later (global) silently un-checks the cn row's "1M". Adding the region
   * would not be enough either — the settings page and the sidebar pane can
   * both mount the same region — so the scope has to name the row instance,
   * which is what `useId` is for.
   */
  const radioScope = useId()
  const now = new Date()
  const tag = tagFor(model, now, region)
  const promo = promoStatusFor(model, now, region)
  const tagText = tag === 'free'
    ? (t?.('row.free') ?? 'free')
    : tag === 'limited'
      ? (t?.('row.limitedFree') ?? 'limited free')
      : tag === 'night'
        ? (t?.('row.nightFreeNow', { time: `${String(promo?.kind === 'night' ? promo.untilHour : 0).padStart(2, '0')}:00` })
            ?? 'free until 08:00')
        : tag === 'badge'
          // Upstream text, not a translated label: the gateway authored it, and
          // these badges are already written in the user's language.
          ? (badgeLabels(model.tags).join(' · ') || null)
          : null
  /**
   * The "cheaper later" hint: the model is on a promotion but the window is
   * closed. Deliberately NOT a "free" badge — it costs credits at this moment,
   * and telling the user otherwise would change what they spend.
   */
  const laterHint = promo?.kind === 'night-later'
    ? (t?.('row.nightFreeLater', { time: `${String(promo.nextHour).padStart(2, '0')}:00` })
        ?? `free from ${String(promo.nextHour).padStart(2, '0')}:00`)
    : null
  /**
   * How long the campaign itself runs, e.g. "活动至 10-31".
   *
   * Shown on both the free and the not-yet-free row, because the useful question
   * is not only "is it free now" but "until when is this offer good at all" —
   * an extension changes that date, and a user planning around the promotion
   * needs it visible rather than buried in a changelog.
   */
  const promoUntil = promo === undefined || promo.kind === 'free'
    ? null
    : (t?.('row.promoUntil', { date: promo.promoUntil.slice(5).replace('-', '-') })
        ?? `promo until ${promo.promoUntil}`)
  const native = model.nativeContextWindow
  const capped = native > DEFAULT_CONTEXT_BUDGET
  const currentBudget = draft.budget ?? native
  /**
   * The provider id a probe must name, per region.
   *
   * Read from the same table the adapter registers under, so a lane rename
   * cannot leave this button probing a provider the host does not know. Declared
   * here rather than imported from the adapter module because that module pulls
   * in Node-only catalog code the browser bundle must not touch.
   */
  const probeProvider = XDPOOL_REGION_PROVIDER[region]
  return (
    <div className={`dsm-xdpool-model${draft.enabled ? '' : ' dsm-xdpool-model-off'}`}>
      <div className="dsm-xdpool-model-head">
        <label className="dsm-xdpool-model-check">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={!editable}
            onChange={() => { onToggle(model.id) }}
          />
          <span className="dsm-xdpool-model-copy">
            <span className="dsm-xdpool-model-name">
              <span>{model.name}</span>
              {/* A zero multiplier IS the upstream's way of saying "free"
                  (`credits: "x0.00"`), so printing "x0.00 积分" next to a
                  model that costs nothing is worse than printing nothing.
                  The badge below already carries the free/free-tier label. */}
              {model.multiplier === undefined || model.multiplier === 0 ? null
                : <span className="dsm-xdpool-model-name-rate">
                    {t?.('row.rate', { rate: model.multiplier.toFixed(2) }) ?? `${model.multiplier.toFixed(2)}x`}
                  </span>}
            </span>
            <span className="dsm-xdpool-model-id">{model.id}</span>
          </span>
        </label>
        <div className="dsm-xdpool-model-controls">
          <label className="dsm-xdpool-model-image" title={t?.('row.modelImage') ?? 'Image input'}>
            <input
              type="checkbox"
              checked={draft.images}
              disabled={!editable}
              onChange={() => { onToggleImage(model.id) }}
            />
            <span>{t?.('row.modelImage') ?? 'Image'}</span>
          </label>
          {capped
            ? <fieldset className="dsm-xdpool-model-budget" aria-label={t?.('row.modelContextBudget') ?? 'Context'}>
                <label>
                  <input
                    type="radio"
                    name={`budget-${radioScope}`}
                    checked={currentBudget === DEFAULT_CONTEXT_BUDGET}
                    disabled={!editable}
                    onChange={() => { onBudget(model.id, DEFAULT_CONTEXT_BUDGET) }}
                  />
                  <span>{formatCapacity(DEFAULT_CONTEXT_BUDGET)}</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name={`budget-${radioScope}`}
                    checked={currentBudget === native}
                    disabled={!editable}
                    onChange={() => { onBudget(model.id, native) }}
                  />
                  <span>{formatCapacity(native)}</span>
                </label>
              </fieldset>
            : null}
        </div>
      </div>
      <div className="dsm-xdpool-model-meta">
        {tagText === null ? null
          : <span className="dsm-xdpool-model-meta-tag">{tagText}</span>}
        {laterHint === null ? null
          : <span className="dsm-xdpool-model-meta-later">{laterHint}</span>}
        {promoUntil === null ? null
          : <span className="dsm-xdpool-model-meta-promo">{promoUntil}</span>}
        {paidTwin === undefined ? null
          : <span className="dsm-xdpool-model-meta-twin" title={t?.('row.paidTwinHint') ?? 'Same model, paid row'}>
              {t?.('row.paidTwin', { id: paidTwin.id, rate: paidTwin.multiplier.toFixed(2) })
                ?? `paid twin ${paidTwin.id} (${paidTwin.multiplier.toFixed(2)}x)`}
            </span>}
        <span className="dsm-xdpool-model-cap">
          {t?.('row.modelOutput', { size: formatCapacity(model.maxOutputTokens) })
            ?? `out ${formatCapacity(model.maxOutputTokens)}`}
        </span>
        {model.supportedEfforts === undefined || model.supportedEfforts.length === 0 ? null
          : <span className="dsm-xdpool-model-cap">
              {t?.('row.modelReasoning', { efforts: model.supportedEfforts.join(' / ') })
                ?? model.supportedEfforts.join(' / ')}
            </span>}
      </div>
      {/* The per-model facts and the connectivity test, from the one
          component all three model pages share.

          The output ceiling and the thinking levels that already sit in
          -model-meta above are NOT repeated here: this component prints
          exactly the same two facts from exactly the same fields, and
          printing them twice is how the same model came to show a
          different window on two pages. */}
        <ModelFactsRow
          t={t}
          {...onTest === undefined ? {} : { onTest }}
          {...probe === undefined ? {} : { probe }}
          {...probing === undefined ? {} : { probing }}
          row={{
            contextWindow: model.contextWindow,
            maxOutputTokens: model.maxOutputTokens,
            supportsImages: model.supportsImages,
            supportedEfforts: model.supportedEfforts,
          }}
        />
    </div>
  )
}
