/**
 * AutoClaw (智谱澳龙 / OpenClaw 云端) — two sites, OpenAI-shaped gateway with a signature.
 *
 * THREE THINGS THAT DECIDE WHETHER A CALL WORKS
 *
 *   1. Every request carries an md5 signature: `md5(APP_ID & timestamp & APP_KEY)`. It is not
 *      optional, and a wrong one is answered as an auth failure.
 *   2. The chat body must carry a REQUIRED system prefix. The vendor's own proxy looks for it,
 *      and a request without it is refused — which reads like an account problem.
 *   3. The two sites are different hosts with different accounts: the international one is
 *      `autoglm-api.autoglm.ai`, the domestic one `autoglm-acceleration-api.zhipuai.cn`.
 *
 * THE WALLET HAS FIVE BUCKETS, AND THEIR NAMES ARE THE VENDOR'S
 *
 * Reward, daily, subscription, fuel-pack and other. The labels are copied verbatim rather than
 * invented, because a user comparing the card with the vendor's own console needs the same
 * words.
 *
 * @module dsh-xdpool/autoclaw-protocol
 */
import { inspectPaste } from './paste-guard.ts'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The app identity the signature is built from. */
export const AUTOCLAW_APP_ID = '100003'
export const AUTOCLAW_APP_KEY = '38d2391985e2369a5fb8227d8e6cd5e5'
export const AUTOCLAW_SOURCE_ID = 'autoclaw'
export const AUTOCLAW_CLIENT_VERSION = '2.1.1'

/**
 * The system prefix every chat request must carry.
 *
 * The vendor's proxy checks for it; a request without it is refused as if the account were
 * broken. It is prepended rather than replacing the caller's own system prompt.
 */
export const AUTOCLAW_SYSTEM_PREFIX = 'You are AutoClaw. Answer the user directly and concisely'

/** The thinking ladder. `off` is expressed by omitting the field, as the vendor's client does. */
export const AUTOCLAW_EFFORTS: readonly string[] = ['low', 'high', 'max']

/** The window the gateway serves. */
export const AUTOCLAW_CONTEXT_WINDOW = 1_048_576

/** One site. */
export interface AutoclawSite {
  id: string
  displayName: string
  apiBase: string
  /**
   * The site a user signs into.
   *
   * Measured: the domestic site keeps its session in `localStorage` under `autoglm/token` and
   * `autoglm/refreshToken`, both prefixed with `Bearer `. That is the door the browser sign-in
   * uses — the SMS and Z.ai routes both have problems the user should not have to work around.
   */
  web: string
}

/** The international site. */
export const AUTOCLAW_INTL: AutoclawSite = {
  id: 'autoclaw',
  displayName: 'AutoClaw 国际',
  apiBase: 'https://autoglm-api.autoglm.ai',
  web: 'https://autoglm.ai',
}

/** The domestic site. Note the different host entirely. */
export const AUTOCLAW_CN: AutoclawSite = {
  id: 'autoclaw-cn',
  displayName: 'AutoClaw 国内',
  apiBase: 'https://autoglm-acceleration-api.zhipuai.cn',
  web: 'https://autoglm.zhipuai.cn',
}

/** Both sites. */
export const AUTOCLAW_SITES: readonly AutoclawSite[] = [AUTOCLAW_INTL, AUTOCLAW_CN]

/** One model. */
export interface AutoclawModel {
  id: string
  name: string
  free: boolean
}

/**
 * The models, as measured.
 *
 * The remote catalogue carries most of them; `zai_glm-5.3-flash` is the one that is free AND
 * absent from it, so it lives here or nowhere.
 */
export const AUTOCLAW_MODELS: readonly AutoclawModel[] = [
  { id: 'zai_glm-5.3-flash', name: 'GLM-5.3-Flash', free: true },
  { id: 'zaicoding_glm-5.3', name: 'GLM-5.3 编程', free: false },
  { id: 'zai_auto', name: 'Auto', free: false },
  { id: 'zai_auto-fast', name: 'Auto 快速', free: false },
]

/** The wallet buckets, named as the vendor names them. */
export const AUTOCLAW_WALLET_LABELS: Readonly<Record<string, string>> = {
  reward: '奖励积分',
  daily: '每日积分',
  subscription: '签约积分',
  fuel_pack: '加油包积分',
  other: '其他积分',
}

/** One stored account. */
export interface AutoclawCredential {
  site: string
  accessToken: string
  refreshToken?: string
  nickname?: string
  expiresAt?: number
}

/** One wallet bucket. */
export interface AutoclawBucket {
  type: string
  label: string
  balance: number
}

/** The signature for one request. */
export function autoclawSign(timestamp: string | number): string {
  return createHash('md5').update(`${AUTOCLAW_APP_ID}&${String(timestamp)}&${AUTOCLAW_APP_KEY}`).digest('hex')
}

/** The headers every call carries. */
export function autoclawHeaders(credential: Pick<AutoclawCredential, 'accessToken'>): Record<string, string> {
  const timestamp = String(Date.now())
  return {
    authorization: `Bearer ${credential.accessToken}`,
    'content-type': 'application/json',
    accept: 'application/json',
    'x-app-id': AUTOCLAW_APP_ID,
    'x-timestamp': timestamp,
    'x-sign': autoclawSign(timestamp),
    'x-source-id': AUTOCLAW_SOURCE_ID,
    'x-client-version': AUTOCLAW_CLIENT_VERSION,
  }
}

/**
 * Pull a credential out of whatever the user pasted.
 *
 * Three shapes appear in practice: a JSON blob with both tokens, `key=value` lines, and a bare
 * token with no refresh.
 */
export function parseAutoclawCredential(input: string): { accessToken?: string; refreshToken?: string } {
  /**
   * A paste that cannot be a credential is refused before it is stored.
   *
   * Accepting it would fail at the vendor with `HTTP 401`, which reads as "my account
   * is broken" rather than "I pasted the wrong thing".
   */
  if (inspectPaste(input) !== undefined) return {}

  const text = input.trim()
  if (text === '') return {}
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      const access = parsed['accessToken'] ?? parsed['access_token'] ?? parsed['token']
      const refresh = parsed['refreshToken'] ?? parsed['refresh_token']
      return {
        ...(typeof access === 'string' && access !== '' ? { accessToken: access.replace(/^Bearer\s+/iu, '') } : {}),
        ...(typeof refresh === 'string' && refresh !== '' ? { refreshToken: refresh } : {}),
      }
    } catch {
      return {}
    }
  }
  // `key=value` or `key: value` lines.
  const lines = text.split('\n').map(line => line.trim()).filter(line => line !== '')
  if (lines.length > 1 || /^(?:accessToken|access_token)\s*[:=]/iu.test(text)) {
    let access: string | undefined
    let refresh: string | undefined
    for (const line of lines) {
      const match = /^([A-Za-z_]+)\s*[:=]\s*(.+)$/u.exec(line)
      if (match === null) continue
      const key = (match[1] ?? '').toLowerCase()
      const value = (match[2] ?? '').replace(/^Bearer\s+/iu, '').trim()
      if (value === '') continue
      if (key === 'accesstoken' || key === 'access_token' || key === 'token') access = value
      if (key === 'refreshtoken' || key === 'refresh_token') refresh = value
    }
    return {
      ...(access === undefined ? {} : { accessToken: access }),
      ...(refresh === undefined ? {} : { refreshToken: refresh }),
    }
  }
  return { accessToken: text.replace(/^Bearer\s+/iu, '') }
}

/** The SMS code endpoints. */
export const AUTOCLAW_SEND_CODE_PATH = '/userapi/v1/agent-send-code'
export const AUTOCLAW_LOGIN_PATH = '/userapi/v1/agent-login'

/**
 * The device id the login endpoints expect.
 *
 * Read from the desktop app's own file when it is there, because an account signed in through the
 * app already has a device id and presenting a different one makes the session look like it came
 * from a second machine. Falling back to a random UUID keeps a fresh install working without
 * pretending to be a device that does not exist.
 */
export function autoclawDeviceId(env: NodeJS.ProcessEnv = process.env): string {
  try {
    const base = env['APPDATA'] ?? join(env['USERPROFILE'] ?? '', 'AppData', 'Roaming')
    const file = join(base, 'AutoClaw-official', 'device', 'device-id.json')
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { deviceId?: unknown }
    if (typeof parsed.deviceId === 'string' && parsed.deviceId.trim() !== '') return parsed.deviceId.trim()
  } catch {
    // No desktop app, or a file in another shape; a fresh id is the honest answer.
  }
  return randomUUID()
}

/**
 * The headers the auth endpoints take.
 *
 * A different set from the chat signature: `X-Auth-*` rather than `x-app-id`/`x-sign`, and the
 * sign is over `appId & seconds & appKey` — note SECONDS, not milliseconds.
 */
export function autoclawAuthHeaders(): Record<string, string> {
  const seconds = String(Math.floor(Date.now() / 1000))
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-auth-appid': AUTOCLAW_APP_ID,
    'x-auth-timestamp': seconds,
    'x-auth-sign': autoclawSign(seconds),
    'x-lang': 'zh-CN',
    'x-channel': 'official',
  }
}
