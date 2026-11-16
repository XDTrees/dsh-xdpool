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
 * WHY THE WINDOW USED TO CLOSE TWO SECONDS AFTER IT OPENED
 *
 * A persistent profile CARRIES the previous sign-in. Reopening it therefore hands back a
 * complete-looking jar — `sessionid`, `sid_tt`, `uid_tt` and all — before anybody scans, and
 * the old loop treated "the cookies are all here" as "the sign-in finished", so it returned,
 * the `finally` closed the window, and the user watched a window flash by.
 *
 * That is only correct while the passport still ACCEPTS the jar. Doubao retires a session the
 * moment the same account signs in somewhere else, and what is left behind in the profile is
 * a complete but dead jar: every cookie check above passes while every real call answers
 * 「会话过期」. The difference between "signed in" and "a dead jar that looks signed in" is a
 * question only the server can answer, so it is asked — see {@link passportSessionState}.
 *
 * @module dsh-xdpool/doubao-auth
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The cookies a usable session needs. `sid_guard` is preferred but not required. */
const REQUIRED = ['sessionid', 'sessionid_ss', 'sid_tt', 'uid_tt'] as const

/** Domains whose cookies belong to Doubao; the passport jar spans several. */
const DOUBAO_DOMAIN = /(^|\.)(doubao|bytedance|zijieapi)\.com$/iu

/** The page that mints the jar. */
export const DOUBAO_LOGIN_URL = 'https://www.doubao.com/chat/'

/**
 * The passport document that answers "is this session still alive".
 *
 * The same endpoint the card already calls to label the account, so a `live` verdict costs no
 * new server contract — and the card's own label and this check can never disagree about which
 * jar they are talking about.
 */
const PASSPORT_ACCOUNT_URL = 'https://www.doubao.com/passport/account/info/v2/'

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
const MACHINE_BROWSERS: readonly string[] = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'C:\\Program Files\\Vivaldi\\Application\\vivaldi.exe',
]

/** Per-user install locations, which the machine-wide list above cannot know about. */
const PER_USER_BROWSERS: readonly string[] = [
  'Google\\Chrome\\Application\\chrome.exe',
  'Microsoft\\Edge\\Application\\msedge.exe',
  'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'Vivaldi\\Application\\vivaldi.exe',
]

/**
 * The first driveable browser, or undefined.
 *
 * Machine-wide installs are tried first because that is the common case on a work machine;
 * per-user installs are the fallback, and they are what a user without administrator rights
 * will have.
 */
function findBrowser(): string | undefined {
  for (const candidate of MACHINE_BROWSERS) {
    if (existsSync(candidate)) return candidate
  }
  const local = process.env['LOCALAPPDATA']
  if (local !== undefined) {
    for (const relative of PER_USER_BROWSERS) {
      const path = join(local, relative)
      if (existsSync(path)) return path
    }
  }
  return undefined
}

/** A session: the cookie pairs and the User-Agent they were taken under. */
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

/**
 * The cookie stores Chromium keeps inside a profile.
 *
 * Two layouts because Chromium moved the jar into `Default/Network/` in the mid-90s versions
 * and older installs still have `Default/Cookies`. Both are listed so the wipe lands on
 * whichever one this browser wrote; a missing file is skipped silently.
 */
export function profileCookieFiles(): string[] {
  const root = browserProfileDir()
  return [
    join(root, 'Default', 'Network', 'Cookies'),
    join(root, 'Default', 'Network', 'Cookies-journal'),
    join(root, 'Default', 'Cookies'),
    join(root, 'Default', 'Cookies-journal'),
  ]
}

/**
 * Delete the sign-in profile's cookie store.
 *
 * Only meaningful while no browser holds that profile: Chromium writes the jar back on exit,
 * so a delete under a live window is undone. The callers respect that — sign-out runs when no
 * window is open, and the in-window path clears cookies over the DevTools protocol instead.
 */
export function wipeProfileCookies(): number {
  let removed = 0
  for (const file of profileCookieFiles()) {
    try {
      if (!existsSync(file)) continue
      rmSync(file, { force: true })
      removed += 1
    } catch {
      // A locked or already-gone file is not a reason to fail the sign-in.
    }
  }
  return removed
}

/**
 * What the passport says about a jar: `live`, `dead`, or `unknown`.
 *
 * THREE STATES ON PURPOSE, and the middle one is the fix.
 *
 *   - `live` — the passport named the account. The sign-in really is finished.
 *   - `dead` — the passport answered and refused. A session signed in somewhere else leaves
 *     exactly this jar behind: complete, cookie-shaped, and useless.
 *   - `unknown` — no answer (offline, timeout, 5xx). The caller must keep waiting: closing the
 *     window on `unknown` is the old bug, and storing the jar on `unknown` hands the pool a
 *     session nobody verified.
 *
 * The endpoint is the same one the card already uses to label the account
 * (`passport/account/info/v2`), so a `live` verdict is also a `name` away from the label —
 * this adds no new server contract.
 */
export type PassportVerdict = 'live' | 'dead' | 'unknown'

/** The account document the passport returns, narrowed to what decides the verdict. */
interface PassportAccount {
  data?: {
    error_code?: unknown
    user_id?: unknown
    user_id_string?: unknown
    name?: unknown
  }
}

/**
 * Ask Doubao's passport whether it still accepts `cookies`.
 *
 * `fetch` is read from the global at call time so a test can stub it, and so a host that
 * patches `fetch` (an upload gate, a proxy) is respected rather than bypassed.
 */
export async function passportSessionState(
  cookies: Record<string, string>,
  userAgent: string,
): Promise<PassportVerdict> {
  const session: DoubaoSession = { cookies, userAgent, savedAt: new Date(0).toISOString() }
  let response: Response
  try {
    response = await fetch(PASSPORT_ACCOUNT_URL, {
      headers: buildHeaders(session),
      signal: AbortSignal.timeout(8_000),
    })
  } catch {
    return 'unknown'
  }
  if (!response.ok) return 'unknown'
  let body: PassportAccount
  try {
    body = await response.json() as PassportAccount
  } catch {
    return 'unknown'
  }
  const data = body.data
  // A 200 with no `data` is the passport saying "no account behind this jar".
  if (data === undefined || data === null || typeof data !== 'object') return 'dead'
  if (typeof data.error_code === 'number' && data.error_code !== 0) return 'dead'
  if (typeof data.user_id === 'number') return data.user_id > 0 ? 'live' : 'dead'
  if (typeof data.user_id_string === 'string' && data.user_id_string !== '') return 'live'
  if (typeof data.name === 'string' && data.name !== '') return 'live'
  return 'dead'
}

/** Send a batch of DevTools commands over one socket and resolve once every answer is in. */
async function runCdp(wsUrl: string, commands: readonly object[], timeoutMs = 8_000): Promise<boolean> {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => SocketLike }).WebSocket
  if (Ctor === undefined) return false
  const socket = new Ctor(wsUrl)
  return await new Promise<boolean>((resolve) => {
    const pending = new Set<number>()
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      try { socket.close() } catch { /* already closing */ }
      resolve(value)
    }
    timer = setTimeout(() => { finish(false) }, timeoutMs)
    socket.addEventListener('error', () => { finish(false) })
    socket.addEventListener('open', () => {
      commands.forEach((command, index) => {
        const id = index + 1
        pending.add(id)
        try {
          socket.send(JSON.stringify({ id, ...command }))
        } catch {
          finish(false)
        }
      })
    })
    socket.addEventListener('message', (event: unknown) => {
      const data = (event as { data?: unknown }).data
      if (typeof data !== 'string') return
      let message: { id?: unknown }
      try {
        message = JSON.parse(data) as { id?: unknown }
      } catch {
        return
      }
      if (typeof message.id !== 'number') return
      pending.delete(message.id)
      if (pending.size === 0) finish(true)
    })
  })
}

/**
 * Throw away a dead jar inside the ALREADY-OPEN window and put the page back on the sign-in
 * screen.
 *
 * This is what turns the old dead end into a working sign-in: without it, the only way out of
 * "the profile holds a session the server retired" was to close the window and hope, and the
 * next attempt reopened the same jar.
 */
async function clearSignInCookiesInWindow(port: number): Promise<boolean> {
  let pageWs: string | undefined
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/json/list`, {
      signal: AbortSignal.timeout(2500),
    })
    if (response.ok) {
      const list = await response.json() as unknown
      if (Array.isArray(list)) {
        for (const entry of list as { type?: unknown; webSocketDebuggerUrl?: unknown }[]) {
          if (entry?.type !== 'page') continue
          if (typeof entry.webSocketDebuggerUrl !== 'string') continue
          pageWs = entry.webSocketDebuggerUrl
          break
        }
      }
    }
  } catch {
    return false
  }
  if (pageWs === undefined) return false
  return await runCdp(pageWs, [
    { method: 'Network.clearBrowserCookies', params: {} },
    { method: 'Page.navigate', params: { url: DOUBAO_LOGIN_URL } },
  ])
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
  /** The session the plugin currently holds, so a retired one can be spotted before opening. */
  current?: () => DoubaoSession | undefined
  /** Called when {@link current} turned out to be a jar the passport has already retired. */
  onStaleSession?: () => void
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

  /**
   * THE JAR THE PROFILE IS ABOUT TO HAND BACK, CHECKED BEFORE THE WINDOW OPENS.
   *
   * This is the whole fix in one block. A persistent profile carries the last sign-in, so the
   * loop below would find a complete jar in about two seconds, call it success, and the
   * `finally` would close the window before the user could scan. When the passport still
   * accepts that jar the shortcut is correct — the lane really is signed in. When it does not,
   * the jar is what a session retired elsewhere leaves behind, and the ONLY way forward is to
   * throw it away, both on disk and in the plugin's own store, so the window that opens next is
   * a real sign-in page.
   */
  const current = options.current?.()
  if (current !== undefined && sessionUsable(current)) {
    const verdict = await passportSessionState(current.cookies, current.userAgent)
    if (verdict === 'dead') {
      wipeProfileCookies()
      options.onStaleSession?.()
      say('profile 里的登录态已被服务端作废（会话过期），已清除，请在弹出的窗口里重新扫码或短信登录。')
    }
  }

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
    let staleNote = 0
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
        /**
         * A COMPLETE COOKIE SET IS NOT A SESSION — ask the passport before calling this a
         * success. `unknown` keeps the window open and the loop running; only `live` may
         * return, and only `dead` is worth throwing the jar away for.
         */
        const verdict = await passportSessionState(pairs, userAgent)
        if (verdict !== 'live') {
          if (Date.now() - staleNote > 10_000) {
            staleNote = Date.now()
            say(verdict === 'dead'
              ? '窗口里的登录态已被服务端判为过期，正在清除并回到登录页…'
              : '已读到 cookie，但暂时无法向豆包确认登录态，继续等待…')
          }
          if (verdict === 'dead') await clearSignInCookiesInWindow(DEBUG_PORT)
          await sleep(2000)
          continue
        }
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
 *
 * The passport gets the same question as in {@link browserLogin}: a retired jar sitting in the
 * profile must not be promoted to "signed in" here, because the caller stores whatever this
 * returns. Without the check, "add account" could silently overwrite a healthy session with
 * one the server had already killed — and the next window would close on itself.
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
    if (await passportSessionState(pairs, userAgent) !== 'live') return undefined
    return { cookies: pairs, userAgent, savedAt: new Date().toISOString() }
  } catch {
    return undefined
  }
}
