/**
 * MonkeyCode — two sites, Anthropic-shaped gateway.
 *
 * WHAT IS DIFFERENT ABOUT THIS CHANNEL
 *
 *   1. The wire is Anthropic Messages, not OpenAI. `/v1/models` answers 405, so the model table
 *      is a measured snapshot rather than something fetched.
 *   2. The session is a cookie (`monkeycode_ai_session`) which is exchanged for a gateway key.
 *   3. The API paths were masked in the upstream source and had to be recovered character by
 *      character — a guessed path 404s, which looks like a dead account.
 *
 * THE TRAP IN THE MODEL TABLE
 *
 * `glm-5` is NOT a DeepSeek and its window has nothing to do with 1M — copying the neighbours'
 * window would be a lie, and it would push the host's overflow compaction past a number the
 * gateway can never accept. It also has no controlled thinking ladder on this gateway, so
 * declaring `reasoning` would make the host send an effort that is silently ignored.
 *
 * @module dsh-xdpool/monkeycode-protocol
 */

/** One site. */
export interface MonkeycodeSite {
  id: string
  displayName: string
  /** The gateway that serves the models. */
  gatewayBaseUrl: string
  /** The platform that serves the wallet and the API keys. */
  platformBaseUrl: string
  /** Where the API keys live. Recovered from the source, not guessed. */
  apiKeysPath: string
}

/** The domestic site. */
export const MONKEYCODE_CN: MonkeycodeSite = {
  id: 'monkeycode',
  displayName: 'MonkeyCode',
  gatewayBaseUrl: 'https://proxy.monkeycode-ai.com/v1',
  platformBaseUrl: 'https://monkeycode-ai.com',
  apiKeysPath: '/api/v1/users/ohmyagent/api-keys',
}

/** The international site. Note the different top-level domain. */
export const MONKEYCODE_INTL: MonkeycodeSite = {
  id: 'monkeycode-intl',
  displayName: 'MonkeyCode 国际',
  gatewayBaseUrl: 'https://proxy.monkeycode-ai.net/v1',
  platformBaseUrl: 'https://monkeycode-ai.net',
  apiKeysPath: '/api/v1/users/ohmyagent/api-keys',
}

/** Both sites. */
export const MONKEYCODE_SITES: readonly MonkeycodeSite[] = [MONKEYCODE_CN, MONKEYCODE_INTL]

/** The Anthropic Messages version header. */
export const MONKEYCODE_ANTHROPIC_VERSION = '2023-06-01'

/** The session cookie the platform sets. */
export const MONKEYCODE_SESSION_COOKIE = 'monkeycode_ai_session'

/** The thinking ladder the gateway accepts. */
export const MONKEYCODE_EFFORTS: readonly string[] = ['none', 'low', 'medium', 'high']

/** The default rung, matching the desktop client. */
export const MONKEYCODE_DEFAULT_EFFORT = 'medium'

/** One model. */
export interface MonkeycodeModel {
  id: string
  name: string
  contextWindow: number
  maxOutputTokens: number
  /** Whether the gateway honours a thinking effort. */
  reasoning: boolean
}

/** One entry of the measured table. */
interface ModelSpec {
  name: string
  contextWindow: number
  maxOutputTokens: number
  reasoning: boolean
}

/**
 * The catalogue.
 *
 * `/v1/models` on the gateway answers 405, so this table is the whole truth — it is a snapshot
 * of what the gateway serves, keyed by the id the request must carry.
 *
 * The prefixed ids spend a subscription tier's quota; the bare ids spend credits.
 */
const MODEL_SPECS: Readonly<Record<string, ModelSpec>> = {
  'monkeycode-basic/deepseek-flash': { name: 'DeepSeek Flash（basic 额度）', contextWindow: 1_048_576, maxOutputTokens: 8_192, reasoning: true },
  'monkeycode-basic/deepseek-v4-flash': { name: 'DeepSeek V4 Flash（basic 额度）', contextWindow: 1_048_576, maxOutputTokens: 8_192, reasoning: true },
  'monkeycode-pro/deepseek-flash': { name: 'DeepSeek Flash（pro 额度）', contextWindow: 1_048_576, maxOutputTokens: 8_192, reasoning: true },
  'monkeycode-pro/deepseek-v4-pro': { name: 'DeepSeek V4 Pro（pro 额度）', contextWindow: 1_048_576, maxOutputTokens: 8_192, reasoning: true },
  'monkeycode-ultra/deepseek-v4-pro': { name: 'DeepSeek V4 Pro（ultra 额度）', contextWindow: 1_048_576, maxOutputTokens: 8_192, reasoning: true },
  'deepseek-flash': { name: 'DeepSeek Flash（按积分计费）', contextWindow: 1_048_576, maxOutputTokens: 8_192, reasoning: true },
  'deepseek-v4-flash': { name: 'DeepSeek V4 Flash（按积分计费）', contextWindow: 1_048_576, maxOutputTokens: 8_192, reasoning: true },
  'deepseek-v4-pro': { name: 'DeepSeek V4 Pro（按积分计费）', contextWindow: 1_048_576, maxOutputTokens: 8_192, reasoning: true },
  /**
   * GLM-5, deliberately without the DeepSeek neighbours' window and without `reasoning`.
   *
   * Its real window is 128K — declaring 1M would be a fabrication that also moves the host's
   * overflow threshold past anything the gateway accepts. And this gateway gives it no
   * controlled thinking ladder, so claiming one makes the host send an effort that is dropped.
   */
  'glm-5': { name: 'GLM-5（按积分计费）', contextWindow: 128_000, maxOutputTokens: 8_192, reasoning: false },
}

/** The catalogue, key order fixed so a diff is readable. */
export const MONKEYCODE_MODELS: readonly MonkeycodeModel[] = Object.entries(MODEL_SPECS).map(
  ([id, spec]) => ({
    id,
    name: spec.name,
    contextWindow: spec.contextWindow,
    maxOutputTokens: spec.maxOutputTokens,
    reasoning: spec.reasoning,
  }),
)

/** One entry by id. */
export function findMonkeycodeModel(id: string): MonkeycodeModel | undefined {
  return MONKEYCODE_MODELS.find(model => model.id === id)
}

/** One stored account: a session cookie, and the gateway key minted from it. */
export interface MonkeycodeCredential {
  site: string
  /** The platform session cookie, used for the wallet and to re-mint the key. */
  cookie: string
  /** The gateway key, `Bearer`-shaped. Rotates, so it is re-minted when refused. */
  apiKey?: string
  nickname?: string
}

/** One wallet bucket. */
export interface MonkeycodeWallet {
  /** Credits left, when the vendor says. */
  credits?: number
  /** The subscription tier's remaining allowance, when there is one. */
  plan?: string
  error?: string
}
