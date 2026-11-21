/**
 * Accio (阿里) — endpoints, and the catalogue shape.
 *
 * THE CATALOGUE IS NESTED AND FILTERED
 *
 * `POST /api/llm/config/v2` answers `data[]`, each with a `modelList[]`. Only entries whose
 * `visible` is literally `true` belong in a picker — the rest are retired, region-locked, or
 * internal. `reasoningEfforts` is `null` on most rows (31 of 38 in measurement), which means
 * "no ladder", and must not be read as "the field is missing".
 *
 * THE CARRIER IS THE `modelCode`
 *
 * The request body takes `modelCode`, not the display name; the display name is what the
 * picker shows. Sending the wrong one is answered as an unknown model.
 *
 * @module dsh-xdpool/accio-protocol
 */

/** The gateway every model call goes through. */
export const ACCIO_GATEWAY = 'https://phoenix-gw.alibaba.com'

/** Where sign-in happens. Two regions, two hosts. */
export const ACCIO_LOGIN_CN = 'https://www.accio-ai.com'
export const ACCIO_LOGIN_GLOBAL = 'https://zh.accio.com'

/** The model call. */
export const ACCIO_LLM_PATH = '/api/adk/llm/generateContent'

/** The catalogue. */
export const ACCIO_CATALOG_PATH = '/api/llm/config/v2'

/** The quota buckets. */
export const ACCIO_QUOTA_PATH = '/api/entitlement/quota'

/** The OAuth exchange, and the refresh. */
export const ACCIO_TOKEN_EXCHANGE_PATH = '/api/oauth/token'
export const ACCIO_REFRESH_PATH = '/api/auth/refresh_token'

/** The identity the gateway expects. */
export const ACCIO_CLIENT_ID = 'accio-work'
export const ACCIO_APP_KEY = 'OneChat'
export const ACCIO_APP_VERSION = '0.34.4'

/** Which region an account belongs to. */
export type AccioRegion = 'cn' | 'global'

/** One model as the catalogue describes it. */
export interface AccioModel {
  /** The `modelCode` a request must carry. */
  id: string
  name: string
  contextWindow: number
  maxTokens?: number
  /** The credit multiplier, when the vendor publishes one. */
  multiple?: number
  supportsImage: boolean
  efforts?: readonly string[]
  defaultEffort?: string
}

/** One stored account. */
export interface AccioCredential {
  region: AccioRegion
  accessToken: string
  refreshToken?: string
  nickname?: string
  /** Epoch ms. */
  expiresAt?: number
}

/** One quota bucket. */
export interface AccioQuotaBucket {
  /** `daily`, `monthly` or `referral`. */
  key: string
  label: string
  /** Percentage already spent, 0-100. */
  used: number
  /** Points still available, when the vendor says. */
  remaining?: number
  /** When the allowance refreshes, ISO. */
  resetsAt?: string
}

/** The three buckets the vendor reports. */
export const ACCIO_BUCKETS: readonly { key: string; label: string }[] = [
  { key: 'daily', label: '每日积分' },
  { key: 'monthly', label: '每月积分' },
  { key: 'referral', label: '推荐积分' },
]

/** The login base for one region. */
export function accioLoginBase(region: AccioRegion): string {
  return region === 'global' ? ACCIO_LOGIN_GLOBAL : ACCIO_LOGIN_CN
}

/**
 * Turn one catalogue row into a model.
 *
 * `visible !== true` is the exclusion test — not `visible === false`, because an absent field
 * on a retired row must exclude it too.
 */
export function normalizeAccioModel(raw: unknown): AccioModel | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  if (record['visible'] !== true) return undefined
  const id = typeof record['modelCode'] === 'string' ? record['modelCode'] : ''
  if (id === '') return undefined
  const displayName = typeof record['modelDisplayName'] === 'string' ? record['modelDisplayName'] : ''
  const context = Number(record['contextWindow'])
  const multiple = Number(record['effectiveMultiple'])
  const maxTokens = Number(record['maxTokens'])
  /**
   * `null` and `[]` both mean "no ladder".
   *
   * The field is present but null on most rows, so a truthiness test would call every model
   * reasoning-capable; the filter keeps only non-empty strings.
   */
  const efforts = Array.isArray(record['reasoningEfforts'])
    ? (record['reasoningEfforts'] as unknown[]).filter((effort): effort is string =>
      typeof effort === 'string' && effort.trim() !== '')
    : []
  const defaultEffort = typeof record['defaultReasoningEffort'] === 'string'
    && record['defaultReasoningEffort'].trim() !== ''
    ? record['defaultReasoningEffort']
    : undefined
  return {
    id,
    name: displayName === '' ? id : displayName,
    contextWindow: Number.isFinite(context) && context > 0 ? context : 0,
    ...Number.isFinite(maxTokens) && maxTokens > 0 ? { maxTokens: Math.floor(maxTokens) } : {},
    ...Number.isFinite(multiple) ? { multiple } : {},
    supportsImage: record['multimodal'] === true,
    ...efforts.length > 0 ? { efforts } : {},
    ...defaultEffort === undefined ? {} : { defaultEffort },
  }
}
