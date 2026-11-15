/**
 * Doubao quota.
 *
 * Doubao does NOT expose rate-limit headers on the chat endpoint — there is no
 * `x-ratelimit-*` and no `x-event-states-limit`. The authoritative source is a
 * separate summary endpoint that the desktop app calls on launch.
 *
 * It reports `window_limit_groups[].window_limits[]`, where each entry is one
 * rolling consumption window:
 *
 *   window_type 1 -> 5-hour limit   (verified: end_time - start_time = 18e6 ms)
 *   window_type 2 -> weekly quota    (verified: end_time - start_time = 604.8e6 ms)
 *   window_type 3 -> bonus quota     (a promotional grant from `incentive_quota_section`,
 *                                     with an expiry but no start: "activity bonus quota")
 *
 * The window length was confirmed arithmetically from the server's own
 * timestamps rather than inferred from the UI, so the mapping is pinned.
 */
import { requireDoubaoCredentials as loadDoubaoCredentials } from './doubao-upstream.ts'
import { buildHeaders, buildQueryUrl, QUOTA_ENDPOINT } from './doubao-upstream.ts'

/** Quota results are cached briefly so a chatty session does not hammer the API. */
export const QUOTA_TTL_MS = 5 * 60 * 1000

export type QuotaWindowType = 'five_hour' | 'weekly' | 'incentive'

export interface QuotaWindow {
  type: QuotaWindowType
  /** Raw window_type from the server. */
  windowType: number
  /** Percent of this window already consumed, 0-100. */
  usedPercent: number
  /** Percent still available, 0-100. */
  remainingPercent: number
  /** Epoch ms when this window resets. Drives the countdown. */
  resetsAt: number
  /** Epoch ms when the window opened. */
  startedAt: number
  /** Window length in ms, derived from the server's own timestamps. */
  windowMs: number
  /**
   * True when the server sent NO window timestamps at all.
   *
   * Doubao zeroes `start_time`/`end_time` for some plans, and silently
   * inventing "opened when you looked, resets one period from now" produced a
   * countdown that was wrong by up to a week — the user reads "resets in 6 days"
   * for a window that may reset in twenty minutes. When the instant is unknown
   * the UI says so instead.
   */
  resetUnknown?: boolean
  /** Raw consumed amount, when the server reports it (a "2,100"-style string). */
  usedAmount?: number
  /** Server-provided group name, e.g. 「活动赠送额度」. */
  label?: string
  /**
   * True when the window has no start instant because it begins counting on
   * first use. Doubao renders this as 「开始使用后计时」.
   */
  startsOnUse?: boolean
  /** Raw entitlement total, same shape as {@link usedAmount}. */
  totalAmount?: number
}

export interface DoubaoQuota {
  /** True when Doubao reports all entitlements exhausted. */
  exhausted: boolean
  windows: QuotaWindow[]
  /** Subscription identity, when the account has one. */
  plan?: string
  planActive?: boolean
  /** Epoch ms when this reading was taken. */
  fetchedAt: number
  /** Populated when the quota could not be read. */
  error?: string
}

interface RawWindowLimit {
  window_type?: number
  item_type?: number
  used_percent?: number
  less_than_one_percent?: boolean
  start_time?: number
  end_time?: number
  /** Formatted strings, e.g. "2,100". Present even when used_percent is not. */
  total_amount?: string | number
  used_amount?: string | number
}

/**
 * Parse one of the server's amount fields.
 *
 * They arrive as formatted strings ("2,100"), and they are the only source of a
 * percentage for the plans that omit `used_percent`. Returns undefined rather
 * than NaN so callers can tell "no data" from "zero".
 */
function parseAmount(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const digits = value.replace(/[^0-9.]/g, '')
  if (digits === '') return undefined
  const parsed = Number(digits)
  return Number.isFinite(parsed) ? parsed : undefined
}

function mapWindowType(value: number): QuotaWindowType | undefined {
  if (value === 1) return 'five_hour'
  if (value === 2) return 'weekly'
  if (value === 3) return 'incentive'
  return undefined
}

/**
 * Convert one server window into the shape the UI consumes.
 *
 * Three shapes are observed:
 *
 * - both timestamps present: a rolling window with a real reset instant;
 * - both zero: the window has not started yet (Doubao renders
 *   「开始使用后计时」); the reset instant is unknown and MUST NOT be invented;
 * - only `end_time`: a promotional grant with an expiry but no start.
 *
 * Reconstructing a missing start from the nominal window length used to make
 * the card count down to a moment the server never sent — off by up to a week.
 */
export function normalizeWindow(raw: RawWindowLimit, label?: string): QuotaWindow | undefined {
  const type = raw.window_type === undefined ? undefined : mapWindowType(raw.window_type)
  if (!type) return undefined
  const start = raw.start_time ?? 0
  const end = raw.end_time ?? 0
  const usedAmount = parseAmount(raw.used_amount)
  const totalAmount = parseAmount(raw.total_amount)
  // used_percent wins when the server sends it; amounts are the fallback for the
  // plans that only report them.
  const fromAmounts =
    usedAmount !== undefined && totalAmount !== undefined && totalAmount > 0
      ? Math.min(100, Math.max(0, (usedAmount / totalAmount) * 100))
      : undefined
  const used = typeof raw.used_percent === 'number' ? raw.used_percent : (fromAmounts ?? 0)
  const base = {
    type,
    windowType: raw.window_type as number,
    usedPercent: used,
    remainingPercent: Math.max(0, 100 - used),
    ...(label === undefined || label === '' ? {} : { label }),
    ...(usedAmount === undefined ? {} : { usedAmount }),
    ...(totalAmount === undefined ? {} : { totalAmount }),
  }
  if (end <= 0) {
    // Nothing has started: say so instead of counting down to a made-up moment.
    return { ...base, resetsAt: 0, startedAt: 0, windowMs: 0, resetUnknown: true, startsOnUse: true }
  }
  return {
    ...base,
    // start 0 with an end means "counts from first use": the expiry is real,
    // the opening instant simply does not exist yet.
    ...(start <= 0 ? { startsOnUse: true } : {}),
    resetsAt: end,
    startedAt: start > 0 ? start : 0,
    windowMs: start > 0 && end > start ? end - start : 0,
  }
}

/**
 * How long a FAILED reading is reused.
 *
 * The quota endpoint is consulted before every chat turn, and a failure used to
 * be forgotten immediately — so an outage cost every single turn another round
 * trip that was going to fail the same way, on the request's critical path. The
 * window is short enough that a recovery is invisible (a turn later) and long
 * enough to stop that fan-out.
 */
const QUOTA_FAILURE_TTL_MS = 30_000

/**
 * Remember a failed reading, and return it.
 *
 * One helper because all three failure exits (no credentials, HTTP error,
 * thrown) must go through it: a failure that skips the memo is exactly the bug
 * this exists to prevent.
 */
function rememberFailure(quota: DoubaoQuota): DoubaoQuota {
  cachedFailure = quota
  cachedFailureAt = Date.now()
  return quota
}

/**
 * Read the account's current quota.
 *
 * Never throws: an unreachable endpoint yields a `DoubaoQuota` carrying an
 * `error`, because a quota panel failure must not take down a chat request.
 */
export interface RawQuotaData {
  window_limit_section?: {
    usage_exhausted?: boolean
    window_limit_groups?: Array<{ feature_group_name?: string; window_limits?: RawWindowLimit[] }>
  }
  enterprise_window_limit_section?: {
    usage_exhausted?: boolean
    window_limit_groups?: Array<{ feature_group_name?: string; window_limits?: RawWindowLimit[] }>
  }
  incentive_quota_section?: {
    usage_exhausted?: boolean
    window_limit_groups?: Array<{ feature_group_name?: string; window_limits?: RawWindowLimit[] }>
  }
  current_subscription?: { display?: { short_name?: string; product_name?: string } }
  member_info?: { hasActiveSubscription?: boolean }
}

/**
 * Only report the account as exhausted when all active quota entitlements say
 * so: an exhausted promotional bonus must not block turns while the main
 * window still has headroom.
 */
export function evaluateQuotaExhausted(data: RawQuotaData | undefined): boolean {
  const hasActiveGroups = (section?: {
    window_limit_groups?: Array<{ window_limits?: RawWindowLimit[] }>
  }): boolean => Boolean(section?.window_limit_groups?.some((g) => (g.window_limits?.length ?? 0) > 0))

  const windowExhausted = data?.window_limit_section?.usage_exhausted
  const enterpriseExhausted = data?.enterprise_window_limit_section?.usage_exhausted
  const incentiveExhausted = data?.incentive_quota_section?.usage_exhausted

  const activeFlags: boolean[] = []
  if (typeof windowExhausted === 'boolean') activeFlags.push(windowExhausted)
  if (typeof enterpriseExhausted === 'boolean' && hasActiveGroups(data?.enterprise_window_limit_section)) {
    activeFlags.push(enterpriseExhausted)
  }
  if (typeof incentiveExhausted === 'boolean' && hasActiveGroups(data?.incentive_quota_section)) {
    activeFlags.push(incentiveExhausted)
  }
  const fallbackFlags = [windowExhausted, enterpriseExhausted, incentiveExhausted].filter(
    (flag): flag is boolean => typeof flag === 'boolean',
  )
  const flags = activeFlags.length > 0 ? activeFlags : fallbackFlags
  return flags.length > 0 && flags.every(Boolean)
}

export async function fetchQuota(options: { force?: boolean } = {}): Promise<DoubaoQuota> {
  const now = Date.now()
  if (!options.force && cached && now - cached.fetchedAt < QUOTA_TTL_MS) {
    return cached
  }
  if (!options.force && cachedFailure !== undefined && now - cachedFailureAt < QUOTA_FAILURE_TTL_MS) {
    return cachedFailure
  }

  /**
   * No session is a quotable answer, not a throw.
   *
   * The quota panel sits beside the chat card, and a user who has not signed in yet still
   * needs to SEE it — with "not signed in" in the error field — rather than have the panel
   * disappear or the card throw on render.
   */
  let credentials: ReturnType<typeof loadDoubaoCredentials>
  try {
    credentials = loadDoubaoCredentials()
  } catch (error: unknown) {
    return rememberFailure({
      exhausted: false,
      windows: [],
      fetchedAt: now,
      error: error instanceof Error ? error.message : 'Doubao credentials unavailable.',
    })
  }

  try {
    const response = await fetch(buildQueryUrl(QUOTA_ENDPOINT, credentials.pairs.get('msToken')), {
      method: 'POST',
      headers: buildHeaders(credentials, { 'content-type': 'application/json' }),
      body: JSON.stringify({ product_line: 'membership' }),
    })
    if (!response.ok) {
      return rememberFailure({ exhausted: false, windows: [], fetchedAt: now, error: `HTTP ${response.status}` })
    }
    const payload = (await response.json()) as { data?: RawQuotaData }

    // Two sections, one list: the regular windows and the promotional grants
    // that Doubao shows above them ("活动赠送额度"). Reading only the first
    // section hid the grant that was actually being consumed.
    const sections = [
      payload.data?.window_limit_section,
      payload.data?.incentive_quota_section,
    ]
    const windows: QuotaWindow[] = []
    for (const section of sections) {
      for (const group of section?.window_limit_groups ?? []) {
        for (const limit of group.window_limits ?? []) {
          const normalized = normalizeWindow(limit, group.feature_group_name)
          if (normalized) windows.push(normalized)
        }
      }
    }

    const quota: DoubaoQuota = {
      exhausted: evaluateQuotaExhausted(payload.data),
      windows,
      fetchedAt: now,
    }
    const plan = payload.data?.current_subscription?.display?.short_name
    if (plan) quota.plan = plan
    if (payload.data?.member_info?.hasActiveSubscription !== undefined) {
      quota.planActive = payload.data.member_info.hasActiveSubscription
    }

    cached = quota
    cachedFailure = undefined
    return quota
  } catch (error) {
    return rememberFailure({ exhausted: false, windows: [], fetchedAt: now, error: (error as Error).message })
  }
}

let cached: DoubaoQuota | undefined
/** The last FAILED reading, reused for {@link QUOTA_FAILURE_TTL_MS}. */
let cachedFailure: DoubaoQuota | undefined
let cachedFailureAt = 0

/** Drop the cached reading so the next call hits the server. */
export function invalidateQuotaCache(): void {
  cached = undefined
  // A forced refresh is the user saying "the panel is wrong": it must not be
  // answered from the failure memo either.
  cachedFailure = undefined
  cachedFailureAt = 0
}

/** Convenience lookup for a specific window. */
export function findWindow(quota: DoubaoQuota, type: QuotaWindowType): QuotaWindow | undefined {
  return quota.windows.find((window) => window.type === type)
}

/**
 * Milliseconds until a window resets, clamped at zero.
 * Drives the countdown the user asked for.
 */
export function millisUntilReset(window: QuotaWindow, now = Date.now()): number {
  if (window.resetUnknown === true) return 0
  return Math.max(0, window.resetsAt - now)
}

/** Human-readable duration, e.g. `4h 12m`. */
export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (minutes) parts.push(`${minutes}m`)
  if (!days && !hours && seconds) parts.push(`${seconds}s`)
  return parts.join(' ') || '0s'
}