/**
 * Marvis request shapes: two hosts, two authentications, never mixed.
 *
 * `Ual-Access-*` on `/v1` would turn a `403 风控` into a `401 登录态过期` — measured. The
 * business endpoints (`/v3/*`) need an md5 signature; the model gateway must not carry one.
 *
 * @module dsh-xdpool/marvis-protocol
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'

/** The one host this channel serves. */
export const MARVIS_BASE = 'https://yybadaccess.3g.qq.com'

/** Where a chat turn goes. */
export const MARVIS_CHAT_URL = `${MARVIS_BASE}/v1/chat/completions`

/** Where the wallet is read from. */
export const MARVIS_WALLET_PATH = '/v3/marvis_get_wallet'

/** Which app a session belongs to, as the gateway reports it. */
export const LOGIN_TYPE = { QC: '1', WX: '2' } as const

/** The QQ and WeChat application ids the login page uses. */
export const QQ_APP_ID = '1903794758'
export const WX_APP_ID = 'wxb650708317d56f88'

/** The client identity the model gateway accepts. Anything else is answered `4100404`. */
export const MARVIS_UA = 'AsyncOpenAI/Python 2.32.0'

/** The browser identity the login pages expect — the client's own Electron UA. */
export const MARVIS_BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Marvis/1.60.3300.408 Chrome/152.0.7977.130 Electron/44.7.0 Safari/537.36'

/** The business id every request declares. */
export const BUSINESS_ID = 'marvis_client'

/**
 * The signing key for `/v3/*`.
 *
 * It is a plain string in the client's renderer, not a secret — and it is not used for the model
 * gateway at all.
 */
const ACCESS_KEY = 'fpzkeTlcGLVP37qiOWd29MyaOqaJYxMi'

/** What a stored account carries. */
export interface MarvisAccount {
  openid: string
  accessToken: string
  refreshToken?: string
  nickname?: string
  /** `1` for QQ, `2` for WeChat. */
  loginType: string
  /** The device id this session was authorised on; it must travel with every request. */
  guid: string
  /** Epoch ms. */
  expiresAt: number
}

/**
 * The `Ual-Access-MarvisExt` value.
 *
 * A compact JSON object — no spaces, because the service compares the raw string. `qimei36` is
 * omitted entirely rather than filled with a placeholder: the field must match the device, so a
 * made-up value is worse than an absent one.
 */
export function marvisExt(account: { guid: string }): string {
  return JSON.stringify({
    osVersion: 'Windows-10-10.0.26200',
    guid: account.guid,
    uskey: uskeyOf(),
    nonce: randomUUID(),
    reqScene: 1,
    taskType: 'user',
    clientVersion: '1.60.3300.765',
    isIoa: false,
  })
}

/** The byte length of a uskey. */
const USKEY_BYTES = 376

/**
 * A fresh device fingerprint.
 *
 * The upstream allows two requests per uskey and answers `403` from the third, so one is minted
 * per request. It is pure local randomness — no SDK, no binary, no network.
 */
export function uskeyOf(): string {
  return randomBytes(USKEY_BYTES).toString('base64')
}

/** The headers a chat request needs. */
export function chatHeaders(account: MarvisAccount, options: {
  conversationId?: string
  responseId?: string
} = {}): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    // The client's own identity. A browser UA here is answered `4100404`.
    'User-Agent': MARVIS_UA,
    'X-Stainless-Lang': 'python',
    'X-Stainless-Package-Version': '2.32.0',
    'X-Stainless-OS': 'Windows',
    'X-Stainless-Arch': 'other:amd64',
    'X-Stainless-Runtime': 'CPython',
    'X-Stainless-Runtime-Version': '3.11.9',
    'X-Stainless-Async': 'async:asyncio',
    'X-Stainless-Raw-Response': 'true',
    Authorization: 'Bearer placeholder',
    'Ual-Access-Openid': account.openid,
    'Ual-Access-Access-Token': account.accessToken,
    'Ual-Access-Login-Type': account.loginType,
    'Ual-Access-Guid': account.guid,
    'Marvis-AgentTag': 'auto_discovery',
    'Marvis-Conversation-ID': options.conversationId ?? '',
    'Marvis-Response-ID': options.responseId ?? '',
    'Marvis-Scene': 'preload_summary',
    'Marvis-Protocol-Version': '1000',
    'X-Device-GUID': account.guid,
    'Ual-Access-MarvisExt': marvisExt(account),
  }
}

/** The md5 a `/v3/*` call signs with: `md5(query + timestamp + accessKey + nonce)`. */
export function ualSignature(query: string, timestamp: string, nonce: string): string {
  return createHash('md5').update(query + timestamp + ACCESS_KEY + nonce).digest('hex')
}

/** The headers a business request needs. */
export function businessHeaders(account: MarvisAccount, query: string): Record<string, string> {
  const timestamp = String(Date.now())
  const nonce = String(1000 + Math.floor(Math.random() * 9000))
  return {
    Accept: '*/*',
    'Content-Type': 'application/json; charset=utf-8',
    'User-Agent': MARVIS_BROWSER_UA,
    'Ual-Access-Businessid': BUSINESS_ID,
    'Ual-Access-Timestamp': timestamp,
    'Ual-Access-Nonce': nonce,
    'Ual-Access-Signature': ualSignature(query, timestamp, nonce),
    'Ual-Access-Guid': account.guid,
    'Ual-Access-Access-Token': account.accessToken,
    'Ual-Access-Login-Type': account.loginType,
    'Ual-Access-Openid': account.openid,
  }
}
