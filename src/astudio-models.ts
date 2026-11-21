/**
 * AStudio (科大讯飞 Astron Studio) — protocol constants and the static model table.
 *
 * THE TWO IDENTITIES
 *
 * AStudio separates the web account from the model gateway, and each needs its own
 * credential:
 *
 *   - The WEB session (`ssoSessionId` + `account_id` cookies) reads points, membership and
 *     the daily-reward popup.
 *   - The MODEL bearer (a JWT, measured at three years) is what the gateway accepts. It is not
 *     the same token and cannot be used for the web endpoints.
 *
 * Signing in through the browser harvests the cookies, then exchanges them for a bearer via the
 * same endpoint the desktop app calls on launch.
 *
 * THE DAILY REWARD IS READ, THEN CLAIMED
 *
 * `client-popups/complete` posts a claim, and the proof that it worked is a GRANT line in
 * `points/details` — not a balance difference and not the popup's own text. Reading the details
 * first means a day already credited costs no write.
 *
 * @module dsh-xdpool/astudio-protocol
 */

/** The model gateway — OpenAI **Responses**, not chat/completions. */
export const ASTUDIO_GATEWAY = 'https://astronstudio-api-volces-prod.xf-yun.com'

/** Where a turn goes. */
export const ASTUDIO_RESPONSES_PATH = '/model-gateway/v1/responses'
/**
 * The chat/completions shape, which this build of the gateway also serves.
 *
 * The desktop app writes `responses` into its kernel, and the providers-hub build calls
 * `chat/completions`; both answer. chat/completions is used here because the shape maps
 * straight onto the host adapter without a translation layer.
 */
export const ASTUDIO_CHAT_PATH = '/model-gateway/v1/chat/completions'

/** The live catalogue. Reading it costs nothing. */
export const ASTUDIO_CATALOG_PATH = '/api/v1/model-manager/models'

/** The web account surface — cookies, not bearer. */
export const ASTUDIO_WEB = 'https://agent.xfyun.cn/xingchen-studio'

/** Exchange the web session for a model bearer, as the desktop app does at launch. */
export const ASTUDIO_BEARER_PATH = '/auth/bearer-token'

/** Points: balance, movements, and the daily-reward popup. */
export const ASTUDIO_POINTS_BALANCE_PATH = '/points/balance'
export const ASTUDIO_POINTS_DETAILS_PATH = '/points/details'
export const ASTUDIO_POINTS_SUMMARY_PATH = '/points/summary'
export const ASTUDIO_MEMBERSHIP_PATH = '/membership/me'
export const ASTUDIO_POPUPS_PENDING_PATH = '/client-popups/pending'
export const ASTUDIO_POPUPS_COMPLETE_PATH = '/client-popups/complete'

/**
 * The identity the web surface checks.
 *
 * Omitting `clientType` is answered `11001001` — the request is refused as a non-client, which
 * reads like an auth failure and is actually a missing header.
 */
export const ASTUDIO_CLIENT_TYPE = '21'

/**
 * The desktop build the headers claim to be.
 *
 * Measured from the client; the web surface checks it alongside `clientType` and answers
 * `11001001` when either is missing.
 */
export const ASTUDIO_STUDIO_VERSION = '3.5.2'

/** The popup that carries the daily login reward. */
export const ASTUDIO_DAILY_REWARD_COMPONENT = 'DAILY_REWARD_DIALOG'

/** One model. */
export interface AstudioModel {
  /** The slug the gateway takes. */
  id: string
  name: string
  contextWindow: number
  maxOutputTokens?: number
  /** The reasoning ladder this model accepts, when it reasons at all. */
  efforts?: readonly string[]
  defaultEffort?: string
  /** Spends nothing — usually a launch promotion. */
  free?: boolean
  vision?: boolean
}

/**
 * The catalogue as measured in November 2026.
 *
 * The live endpoint is authoritative and is read per account; this table is what the card shows
 * when a read fails, so it carries the same fields rather than a name alone.
 */
export const ASTUDIO_MODELS: readonly AstudioModel[] = [
  {
    id: 'astronclaw-auto',
    name: 'Auto',
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    efforts: ['none', 'high', 'max'],
    defaultEffort: 'high',
  },
  {
    id: 'spark-x2.6',
    name: 'Spark-X2.6',
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    efforts: ['none', 'high', 'max'],
    defaultEffort: 'high',
  },
  {
    id: 'spark-x2.6-4b',
    name: 'Spark-X2.6-Lite',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_000,
    efforts: ['none', 'high', 'max'],
    defaultEffort: 'high',
    free: true,
  },
  {
    id: 'spark-x2.5',
    name: 'Spark-X2.5',
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    efforts: ['none', 'high', 'max'],
    defaultEffort: 'high',
  },
  {
    id: 'xopglm52',
    name: 'GLM-5.2',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_000,
    efforts: ['none', 'high', 'max'],
    defaultEffort: 'high',
  },
  {
    id: 'xopdeepseekv4pro0813',
    name: 'DeepSeek-V4-Pro',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_000,
    efforts: ['none', 'high', 'max'],
    defaultEffort: 'high',
  },
  {
    /**
     * Measured working while the live catalogue still omitted it.
     *
     * Kept as a supplement so a gateway that serves a model the catalogue has not listed yet is
     * still usable; the moment the catalogue names the same slug that row wins.
     */
    id: 'xdeepseek-flash-in',
    name: 'DeepSeek-V4.1-Flash',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_000,
    efforts: ['none', 'high', 'max'],
    defaultEffort: 'high',
  },
]

/** The model a request falls back to. */
export const ASTUDIO_DEFAULT_MODEL = 'spark-x2.6-4b'

/** One entry by id. */
export function findAstudioModel(id: string): AstudioModel | undefined {
  return ASTUDIO_MODELS.find(model => model.id === id)
}

/**
 * The daily login points, by membership tier.
 *
 * Published by the vendor's own reward copy; the amount is informative, not something this
 * plugin computes — the claim itself is judged by the GRANT line.
 */
export const ASTUDIO_DAILY_POINTS: Readonly<Record<string, number>> = {
  体验版: 100,
  标准版: 200,
  高级版: 400,
  畅享版: 400,
}
