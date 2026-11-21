/**
 * Doubao sign-in, done the way the reference implementation does it.
 *
 * WHAT WAS WRONG BEFORE
 *
 * An earlier attempt called Doubao's `chat/completion` with a hand-built body and the user's
 * own browser cookies, and was answered `710020202 common invalid param` for every shape it
 * tried. That failure looked like a payload problem and was actually three missing REQUEST
 * DETAILS, each of which silently turns a working session into a refusal:
 *
 *   1. `User-Agent` must end with `SamanthaDoubao/<version>` — the desktop client identifies
 *      itself that way, and the upstream checks it.
 *   2. `Referer` must be `chrome://doubao-chat/`, NOT an https URL. A web referer marks the
 *      caller as a browser rather than the app.
 *   3. `sec-ch-ua` must carry the client's real brand string.
 *
 * Get any of them wrong and the answer is `710022004 rate limited`, which reads as throttling
 * and is not — the request was never accepted in the first place.
 *
 * No `a_bogus` signature is needed. Measured against the live service: a request whose
 * signature is deliberately corrupted still answers 200, because only the cookie matters for
 * the endpoints used here.
 *
 * HOW THE SESSION IS OBTAINED
 *
 * Doubao's own QR entrance is closed (`2035 非法请求`), so there is no scan endpoint to call.
 * What works is a real Chromium window driven over the DevTools protocol: the user scans or
 * enters a phone code at their own pace, and `Storage.getCookies` — which is BROWSER-scoped,
 * so one call returns every cookie without attaching to a page that may still be redirecting
 * — harvests the jar. The dedicated profile persists, so the second visit usually needs no
 * scan at all.
 *
 * @module dsh-xdpool/doubao-auth
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { chromiumCandidates, defaultBrowser } from './default-browser.ts'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The cookies a usable session needs. `sid_guard` is preferred but not required. */
const REQUIRED = ['sessionid', 'sessionid_ss', 'sid_tt', 'uid_tt'] as const

/** Domains whose cookies belong to Doubao; the passport jar spans several. */
const DOUBAO_DOMAIN = /(^|\.)(doubao|bytedance|zijieapi)\.com$/iu

/** The page that mints the jar. */
export const DOUBAO_LOGIN_URL = 'https://www.doubao.com/chat/'

/** Where the dedicated Chromium profile lives. Persisted on purpose. */
export function browserProfileDir(): string {
  return join(homedir(), '.dsh', 'doubao-browser-profile')
}

/** The port the sign-in browser listens on. Unusual enough to avoid a real session. */
const DEBUG_PORT = 9333

/**
 * Browsers this can drive, and where they actually live.
 *
 * EVERY Chromium-based browser speaks the same DevTools protocol, so this is not "Chrome
 * only". Edge ships with Windows, and users install Chrome, Brave, Vivaldi and Chromium into
 * their own profile directory rather than into `Program Files` — a user who has one of those
 * but not a machine-wide Chrome was told "no browser found", which reads as a broken feature.
 *
 * The per-user entries matter most: a machine-wide install needs administrator rights, so the
 * browser a normal user actually has is often under `%LOCALAPPDATA%`.
 */
/**
 * The browser to drive: the user's own default first, then the shared candidate list.
 *
 * Both lists used to be local to this file, which meant a browser added for the Marvis channel
 * was invisible here. See default-browser.ts.
 */
function findBrowser(): string | undefined {
  const preferred = defaultBrowser()
  if (preferred !== undefined) return preferred.path
  return chromiumCandidates()[0]?.path
}

export interface DoubaoSession {
  /** `name → value`, ready to be joined into a Cookie header. */
  cookies: Record<string, string>
  /** The UA the client identifies itself with, ending in `SamanthaDoubao/<version>`. */
  userAgent: string
  /** When this was captured. */
  savedAt: string
}

/** Whether a stored session has the cookie that matters. */
export function sessionUsable(session: DoubaoSession | undefined): session is DoubaoSession {
  if (session === undefined) return false
  const sessionId = session.cookies['sessionid']
  return typeof sessionId === 'string' && sessionId !== ''
}

/** The `Cookie:` header value for a session. */
export function cookieHeader(session: DoubaoSession): string {
  return Object.entries(session.cookies).map(([name, value]) => `${name}=${value}`).join('; ')
}

/** One Chrome DevTools Protocol cookie, narrowed to the fields read here. */
interface CdpCookie {
  name?: unknown
  value?: unknown
  domain?: unknown
}

/** The global WebSocket, typed structurally so this file needs no DOM lib. */
type SocketLike = {
  addEventListener: (type: string, listener: (event: unknown) => void) => void
  send: (data: string) => void
  close: () => void
}

/** The client version the reference implementation was measured against. */
export const DOUBAO_VERSION = '2.31.4'

/**
 * The headers that make an external request indistinguishable from the app's.
 *
 * `extra` is applied last so a caller can override the cookie header for a specific turn.
 */
export function buildHeaders(session: DoubaoSession, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'User-Agent': session.userAgent,
    // `chrome://`, NOT https. A web referer marks the caller as a browser.
    Referer: 'chrome://doubao-chat/',
    accept: '*/*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'agw-js-conv': 'str',
    cookie: cookieHeader(session),
    ...extra,
  }
}

/** Sleep for a moment without pulling in a helper. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Wait until the browser's DevTools endpoint answers, and return its WebSocket URL. */
async function waitForDevtools(port: number, deadline: number): Promise<string | undefined> {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/json/version`, {
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) {
        const body = await response.json() as { webSocketDebuggerUrl?: unknown }
        if (typeof body.webSocketDebuggerUrl === 'string') return body.webSocketDebuggerUrl
      }
    } catch {
      // Not listening yet; keep waiting until the deadline.
    }
    await sleep(400)
  }
  return undefined
}

/**
 * One `Storage.getCookies` round-trip.
 *
 * Browser-scoped on purpose: the page target may still be navigating, and attaching to it
 * would race the sign-in redirect chain.
 */
async function readCookies(wsUrl: string, timeoutMs = 15_000): Promise<CdpCookie[]> {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => SocketLike }).WebSocket
  if (Ctor === undefined) throw new Error('this Node build has no global WebSocket')
  const socket = new Ctor(wsUrl)
  return await new Promise<CdpCookie[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { socket.close() } catch { /* already closing */ }
      reject(new Error('CDP timeout while reading cookies'))
    }, timeoutMs)

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id: 1, method: 'Storage.getCookies', params: {} }))
    })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('CDP socket error'))
    })
    socket.addEventListener('message', (event: unknown) => {
      const data = (event as { data?: unknown }).data
      if (typeof data !== 'string') return
      let message: { id?: unknown; result?: { cookies?: unknown }; error?: { message?: unknown } }
      try {
        message = JSON.parse(data) as typeof message
      } catch {
        return
      }
      if (message.id !== 1) return
      clearTimeout(timer)
      try { socket.close() } catch { /* already closed */ }
      if (message.error !== undefined) {
        reject(new Error(String(message.error.message ?? 'CDP error')))
        return
      }
      const cookies = message.result?.cookies
      resolve(Array.isArray(cookies) ? cookies as CdpCookie[] : [])
    })
  })
}

/**
 * Pick the Doubao cookies into `name → value`.
 *
 * First writer wins: CDP lists the more specific host first in practice, and a later
 * `.doubao.com` duplicate must not shadow it.
 */
function pickPairs(cookies: readonly CdpCookie[]): Record<string, string> {
  const pairs: Record<string, string> = {}
  for (const cookie of cookies) {
    const name = cookie.name
    const value = cookie.value
    const domain = cookie.domain
    if (typeof name !== 'string' || typeof value !== 'string' || value === '') continue
    if (typeof domain !== 'string' || !DOUBAO_DOMAIN.test(domain.replace(/^\./u, ''))) continue
    if (pairs[name] === undefined) pairs[name] = value
  }
  return pairs
}

/** Kill a spawned browser including its renderer children. */
function terminate(child: ChildProcess): void {
  if (child.pid === undefined) return
  try {
    // Windows: `child.kill()` leaves the renderer/gpu children behind, which keeps the
    // user-data-dir locked and makes the NEXT login fail to start.
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    try { child.kill() } catch { /* gone already */ }
  }
}

/** What one interactive sign-in produced. */
export interface BrowserLoginResult {
  ok: boolean
  /** Actionable failure text, or undefined on success. Never a secret. */
  reason?: string
  session?: DoubaoSession
}

/**
 * Run one interactive sign-in and return the harvested session.
 *
 * The window stays open for the whole budget so the user can finish a scan or a phone code
 * at their own pace; it is closed on the way out either way.
 */
export async function browserLogin(options: {
  timeoutMs?: number
  onProgress?: (message: string) => void
} = {}): Promise<BrowserLoginResult> {
  const say = options.onProgress ?? (() => {})

  /**
   * A SIGN-IN WINDOW OF OUR OWN, and that is the arrangement the reference implementation
   * uses for the same reason.
   *
   * The other channels in this plugin return a `loginUrl` and let the page call
   * `window.open`, so their buttons always produce a window — the browser is the user's own
   * default. Doubao cannot use that door: a window opened that way has no debugging port, so
   * the cookies it collects cannot be read, and the session is lost the moment the tab
   * closes.
   *
   * So the window is started here, with a dedicated profile the user's own browser never
   * touches, and the debugging port is what makes the result readable. Nothing is asked of
   * the user beyond signing in once.
   */
  const exe = findBrowser()
  if (exe === undefined) {
    return { ok: false, reason: '没找到 Chrome 或 Edge。浏览器扫码登录需要一个 Chromium 内核的浏览器。' }
  }

  const timeoutMs = options.timeoutMs ?? 300_000
  const deadline = Date.now() + timeoutMs
  const profile = browserProfileDir()
  mkdirSync(profile, { recursive: true })

  const child = spawn(exe, [
    `--remote-debugging-port=${String(DEBUG_PORT)}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    DOUBAO_LOGIN_URL,
  ], { stdio: 'ignore', detached: false })

  try {
    say('已打开浏览器，请在弹出的窗口里扫码或短信登录…')
    const wsUrl = await waitForDevtools(DEBUG_PORT, Math.min(deadline, Date.now() + 20_000))
    if (wsUrl === undefined) {
      return { ok: false, reason: `浏览器调试端口 ${String(DEBUG_PORT)} 没起来（可能被占用）。` }
    }

    let lastNote = 0
    while (Date.now() < deadline) {
      let cookies: CdpCookie[] = []
      try {
        cookies = await readCookies(wsUrl)
      } catch (error: unknown) {
        // The page may be mid-navigation; retry until the deadline.
        say(`读取登录态失败，重试中：${error instanceof Error ? error.message : String(error)}`)
        await sleep(1500)
        continue
      }
      const pairs = pickPairs(cookies)
      if (pairs['sessionid'] !== undefined) {
        const missing = REQUIRED.filter(name => pairs[name] === undefined)
        if (missing.length > 0) {
          // A `sessionid` without the others is a half-written jar: the sign-in writes its
          // cookies in stages, and sealing it now would store a session the server rejects
          // as expired.
          say(`登录已开始，等待 cookie 补齐（缺 ${missing.join(', ')}）…`)
          await sleep(1500)
          continue
        }
        const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 SamanthaDoubao/${DOUBAO_VERSION}`
        say(`已取到登录态（${String(Object.keys(pairs).length)} 条 cookie）`)
        return {
          ok: true,
          session: { cookies: pairs, userAgent, savedAt: new Date().toISOString() },
        }
      }
      if (Date.now() - lastNote > 10_000) {
        lastNote = Date.now()
        say(`… 等待扫码（已看到 ${String(cookies.length)} 条浏览器 cookie）`)
      }
      await sleep(2000)
    }
    return { ok: false, reason: '等待登录超时。扫码完成后请重试。' }
  } finally {
    terminate(child)
  }
}

/**
 * Read the session out of the sign-in browser WITHOUT opening it.
 *
 * Used by the background poll: the window is already open (the user started a sign-in), and
 * the card asks every couple of seconds whether the jar is complete yet. Returns undefined
 * when there is nothing usable — which is the ordinary answer while the user is still typing.
 */
export async function readExistingSession(): Promise<DoubaoSession | undefined> {
  let wsUrl: string | undefined
  try {
    const response = await fetch(`http://127.0.0.1:${String(DEBUG_PORT)}/json/version`, {
      signal: AbortSignal.timeout(1500),
    })
    if (!response.ok) return undefined
    const body = await response.json() as { webSocketDebuggerUrl?: unknown }
    if (typeof body.webSocketDebuggerUrl === 'string') wsUrl = body.webSocketDebuggerUrl
  } catch {
    return undefined
  }
  if (wsUrl === undefined) return undefined
  try {
    const pairs = pickPairs(await readCookies(wsUrl, 4000))
    if (pairs['sessionid'] === undefined) return undefined
    const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 SamanthaDoubao/${DOUBAO_VERSION}`
    return { cookies: pairs, userAgent, savedAt: new Date().toISOString() }
  } catch {
    return undefined
  }
}
