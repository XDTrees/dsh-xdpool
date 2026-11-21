/**
 * Accio's sign-in: OAuth 2.0 with PKCE, on our own loopback.
 *
 * WHY THIS WORKS WITHOUT THE IDE
 *
 * The reference client reads a DPAPI-encrypted file and calls a native signing module, which ties
 * it to Windows and to that install directory. But its `startLoginWithCallbackMode` is ordinary
 * PKCE with a PUBLIC client (`client_id = 'accio-work'`, no secret) and a loopback redirect, and
 * the code does not validate the redirect against a whitelist — so any loopback can complete the
 * round trip. That is what this module does.
 *
 * ⚠️ OPENING THE BROWSER: NEVER `cmd /c start`
 *
 * `cmd.exe` treats `&` as a command separator, so the authorization URL is cut at its first one:
 *
 *   https://www.accio-ai.com/login?return_url=…%26launcher_timestamp%3D<ts>
 *                                                               ↑ truncation point
 *   lost: &state=…&code_challenge=…&code_challenge_method=S256&client_id=accio-work
 *
 * Three symptoms follow from that single bug, and each one points somewhere else:
 *
 *   · 「请升级客户端」 — without `code_challenge` the page hits its legacy-client gate, whose
 *     test is exactly "local return_url AND no code_challenge";
 *   · a File Explorer window — the leftover fragment is opened as a path;
 *   · the callback never arrives — `state` and `code_challenge` were both in the lost part.
 *
 * `rundll32 url.dll,FileProtocolHandler` passes the URL to the system handler with no shell in
 * between, which is why it is used here.
 *
 * @module dsh-xdpool/accio-oauth
 */
import { createHash, randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

/** The public client id. No secret: PKCE is what secures the exchange. */
export const ACCIO_CLIENT_ID = 'accio-work'

/** Where the code is exchanged, and where the credential is refreshed. */
export const ACCIO_TOKEN_EXCHANGE_PATH = '/api/oauth/token'
export const ACCIO_REFRESH_PATH = '/api/auth/refresh_token'

/** The path the redirect lands on. */
const CALLBACK_PATH = '/auth/callback-accio'

/** One PKCE pair. */
export interface PkcePair {
  verifier: string
  challenge: string
}

/** A verifier long enough to satisfy RFC 7636, and its S256 challenge. */
export function createPkcePair(): PkcePair {
  // 32 random bytes → 43 base64url characters, inside the 43–128 range the RFC allows.
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

/** An opaque `state` value, so a callback from another flow cannot be mistaken for ours. */
export function createState(): string {
  return randomBytes(16).toString('hex')
}

/** Build the authorization URL. */
export function buildAuthUrl(input: {
  loginBaseUrl: string
  redirectUri: string
  state: string
  codeChallenge: string
}): string {
  const params = new URLSearchParams({
    return_url: input.redirectUri,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    client_id: ACCIO_CLIENT_ID,
    ttid: `ttid_${randomBytes(16).toString('hex')}`,
    language: 'zh',
  })
  return `${input.loginBaseUrl}/login?${params.toString()}`
}

/**
 * Open a URL in the system browser.
 *
 * The trailing callback is not decoration: `execFile` reports failure as an asynchronous `'error'`
 * event, and passing a callback is what makes Node attach a listener for it. Without one, a
 * missing `rundll32` becomes an uncaught exception that takes the host down.
 */
export function openInSystemBrowser(url: string): { ok: boolean } {
  try {
    if (process.platform === 'win32') {
      // No shell, so `&` in the URL survives.
      execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], () => {})
      return { ok: true }
    }
    execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], () => {})
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/** The credential the exchange answers. */
export interface AccioTokenResult {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
}

/** One in-flight sign-in, kept between the two calls. */
interface PendingOAuth {
  server: ReturnType<typeof createServer>
  port: number
  verifier: string
  state: string
  redirectUri: string
  /** Filled by the callback; `undefined` until the browser comes back. */
  result: { code?: string; error?: string } | undefined
  createdAt: number
}

/**
 * The in-flight sign-ins, keyed by `state`.
 *
 * A map rather than one slot: two cards, or two windows, can be mid-sign-in at once and the
 * callback identifies its own attempt by the state it echoes.
 */
const pending = new Map<string, PendingOAuth>()

/** Drop attempts nobody came back to, so a forgotten window cannot hold a port forever. */
function sweepPending(maxAgeMs = 600_000): void {
  for (const [key, entry] of pending) {
    if (Date.now() - entry.createdAt < maxAgeMs) continue
    try { entry.server.close() } catch { /* already closed */ }
    pending.delete(key)
  }
}

/**
 * Begin a sign-in: listen on a loopback, build the URL, and hand it back.
 *
 * Returning the URL BEFORE the user has done anything is what lets the card show a link and a
 * 「重新打开」 button: a request that only answers when the flow finishes leaves the user looking
 * at a spinner with no way to tell whether a window ever opened.
 */
export async function startAccioOAuth(input: { loginBaseUrl: string }): Promise<{ authUrl: string; state: string }> {
  sweepPending()
  const pkce = createPkcePair()
  const state = createState()

  const server = createServer((req, res) => {
    const entry = pending.get(state)
    if (entry === undefined) {
      res.writeHead(410).end()
      return
    }
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end()
        return
      }
      const code = url.searchParams.get('code')
      const returnedState = url.searchParams.get('state')
      const error = url.searchParams.get('error')
      /**
        * The state must match.
        *
        * Without this any page could drive a callback into this listener and hand us a code it
        * controls; PKCE limits the damage but the state check is what makes the round trip belong
        * to THIS sign-in.
        */
      if (returnedState !== state) {
        entry.result = { error: 'state 不匹配，这次回调不是本窗口发起的' }
      } else if (error !== null) {
        entry.result = { error: `上游拒绝授权：${error}` }
      } else if (code !== null && code !== '') {
        entry.result = { code }
      } else {
        entry.result = { error: '回调里没有 code' }
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><meta charset="utf-8"><title>授权完成</title>'
        + '<p style="font:16px/1.6 system-ui;padding:40px">'
        + (entry.result.error === undefined ? '授权完成，可以关闭这个页面了。' : `授权失败：${entry.result.error}`)
        + '</p>')
    } catch {
      res.writeHead(500).end()
    }
  })

  /**
   * A synchronous port cannot be picked here.
   *
   * `listen` is asynchronous, so this returns a placeholder and fills the real port in the map
   * entry once it is known — the URL is rebuilt at that moment too. Callers poll
   * `finishAccioOAuth`, which is what makes the second phase authoritative.
   */
  const authUrl = await new Promise<string>((resolve, reject) => {
    server.once('error', (error) => {
      pending.delete(state)
      reject(error instanceof Error ? error : new Error(String(error)))
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo | null
      const port = address === null ? 0 : address.port
      if (port === 0) {
        reject(new Error('没能绑定本地回调端口'))
        return
      }
      const redirectUri = `http://127.0.0.1:${String(port)}${CALLBACK_PATH}`
      pending.set(state, {
        server,
        port,
        verifier: pkce.verifier,
        state,
        redirectUri,
        result: undefined,
        createdAt: Date.now(),
      })
      const url = buildAuthUrl({
        loginBaseUrl: input.loginBaseUrl,
        redirectUri,
        state,
        codeChallenge: pkce.challenge,
      })
      /**
       * Open the browser only after the listener is ready.
       *
       * A window opened first can reach the callback before the port is bound, and the redirect
       * then fails with a connection error the user reads as "the sign-in is broken".
       */
      openInSystemBrowser(url)
      resolve(url)
    })
  })
  return { authUrl, state }
}

/**
 * Collect the result of a started sign-in.
 *
 * Answers `undefined` while the browser is still open, so the card can show "waiting" rather than
 * a failure it has not established yet.
 */
export async function finishAccioOAuth(input: {
  state: string
  gatewayBaseUrl: string
}): Promise<AccioTokenResult | { pending: true } | undefined> {
  const entry = pending.get(input.state)
  if (entry === undefined) return undefined
  if (entry.result === undefined) return { pending: true }
  const settled = entry.result
  try { entry.server.close() } catch { /* already closed */ }
  pending.delete(input.state)
  if (settled.code === undefined) return undefined

  const response = await fetch(`${input.gatewayBaseUrl}${ACCIO_TOKEN_EXCHANGE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      code: settled.code,
      codeVerifier: entry.verifier,
      clientId: ACCIO_CLIENT_ID,
      redirectUri: entry.redirectUri,
    }),
    signal: AbortSignal.timeout(25_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`换取 token 失败：${text.slice(0, 160)}`)
  return parseTokenBody(text)
}

/**
 * Pull the credential out of whatever envelope the endpoint answers.
 *
 * The vendor nests it (`{data: {...}}`) on one path and returns it flat on another, and the field
 * names have appeared in both camelCase and snake_case — all four are read rather than betting on
 * one shape.
 */
export function parseTokenBody(text: string): AccioTokenResult {
  const parsed = JSON.parse(text) as Record<string, unknown>
  const data = (parsed['data'] ?? parsed) as Record<string, unknown>
  const access = data['accessToken'] ?? data['access_token'] ?? data['token']
  if (typeof access !== 'string' || access === '') {
    throw new Error('换取 token 的响应里没有 accessToken')
  }
  const refresh = data['refreshToken'] ?? data['refresh_token']
  const expires = data['expiresAt'] ?? data['expires_at'] ?? data['expires_in']
  let expiresAt: number | undefined
  if (typeof expires === 'number') {
    // Seconds vs milliseconds: a value that large cannot be seconds.
    expiresAt = expires < 10_000_000_000 ? expires * 1000 : expires
  }
  return {
    accessToken: access,
    ...(typeof refresh === 'string' && refresh !== '' ? { refreshToken: refresh } : {}),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  }
}

/**
 * Refresh an Accio credential.
 *
 * ⚠️ The vendor ROTATES `refresh_token` on every refresh, so two concurrent calls mean one
 * success and one `invalid_grant` — and the loser would mark a perfectly good account dead. The
 * caller must serialise this; the store lock in this plugin is what does.
 */
export async function accioRefresh(input: {
  gatewayBaseUrl: string
  accessToken: string
  refreshToken: string
}): Promise<AccioTokenResult> {
  const response = await fetch(`${input.gatewayBaseUrl}${ACCIO_REFRESH_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
    }),
    signal: AbortSignal.timeout(25_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`续期失败：${text.slice(0, 160)}`)
  return parseTokenBody(text)
}
