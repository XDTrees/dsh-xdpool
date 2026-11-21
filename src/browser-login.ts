/**
 * A browser window the user signs into, and the credential we take back out.
 *
 * WHY A WINDOW RATHER THAN A BOX ON THE CARD
 *
 * Several of these vendors have no login API a card can post to: the sign-in is a page with a
 * captcha, an SMS code, or a Google button, and the token only exists in that page's
 * `localStorage` afterwards. Asking the user to open devtools and copy it out is asking them to
 * do the plugin's job. So the plugin starts a browser of its own, points it at the vendor's
 * login page, and reads the token over the DevTools protocol once the page has it.
 *
 * THE THREE THINGS THAT MAKE THIS WORK, AND THE WAY EACH ONE BREAKS
 *
 *   1. `detached: true` plus `unref()`. Without them the browser is a child of the DSH process,
 *      and it vanishes the moment that process is replaced — which is exactly when a user
 *      restarts to pick up a new build. The window they were typing into disappears mid-login.
 *   2. `--remote-debugging-port=0` and reading `DevToolsActivePort`. A fixed port collides with
 *      whatever else is running; port 0 lets the browser choose, and the file is where it says
 *      which. A browser that starts but never writes that file was blocked (AV products do it),
 *      which is a different failure from "it never started".
 *   3. A THROWAWAY profile. The user's own Chrome profile is off limits: reading it would reach
 *      cookies belonging to everything else on their machine, and writing to it can corrupt
 *      their real session.
 *
 * @module dsh-xdpool/browser-login
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { pluginDataDir } from './ignored.ts'
import { chromiumCandidates, preferredLoginBrowser } from './default-browser.ts'

/** How long to wait for the browser to publish its debugging port. */
const PORT_WAIT_MS = 8_000

/** The machine-readable session of one open window. */
export interface BrowserSession {
  port: number
  dir: string
  child: ChildProcess
}

/** Where the throwaway profiles live. */
function profilesRoot(): string {
  return join(pluginDataDir(), 'login-profiles')
}

/** A fresh profile directory for one sign-in. */
function newProfileDir(tag: string): string {
  const dir = join(profilesRoot(), `${tag}-${String(Date.now())}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Remove profiles older than `maxAgeMs`.
 *
 * A profile holds cookies from a real sign-in, so leaving them on disk forever is both clutter
 * and a small liability. Two hours is long enough for a slow login and short enough that a
 * forgotten profile does not outlive the day.
 */
export function sweepLoginProfiles(maxAgeMs = 2 * 3_600_000): number {
  const root = profilesRoot()
  let removed = 0
  try {
    for (const name of readdirSync(root)) {
      const path = join(root, name)
      try {
        if (!statSync(path).isDirectory()) continue
        if (Date.now() - statSync(path).mtimeMs < maxAgeMs) continue
        rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
        removed += 1
      } catch {
        // A profile still in use cannot be removed; the next sweep gets it.
      }
    }
  } catch {
    // No directory yet — nothing to sweep.
  }
  return removed
}

/** Wait for Chromium to write `DevToolsActivePort` and read the port from its first line. */
async function waitForPort(dir: string, timeoutMs = PORT_WAIT_MS): Promise<number> {
  const file = join(dir, 'DevToolsActivePort')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const first = readFileSync(file, 'utf8').split('\n')[0]?.trim() ?? ''
      const port = Number(first)
      if (Number.isFinite(port) && port > 0) return port
    } catch {
      // Not written yet.
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return 0
}

/**
 * Start a browser on `url` and hand back its debugging port.
 *
 * The window stays open after this returns — that is the point. The caller polls the page and
 * closes it when the credential arrives or the user gives up.
 */
export async function launchLoginBrowser(url: string, tag: string): Promise<BrowserSession> {
  /**
   * The user's own browser first.
   *
   * Taking  opened Chrome for the new channels while the older ones
   * opened Edge — a window in a different browser loses the user's passwords and session, so it
   * reads as being signed out everywhere.
   */
  const exe = preferredLoginBrowser()?.path ?? chromiumCandidates()[0]?.path
  if (exe === undefined) {
    throw new Error('这台机器上没找到 Chrome / Edge / Brave / Chromium，浏览器登录需要其中之一')
  }
  sweepLoginProfiles()
  const dir = newProfileDir(tag)
  /**
   * A profile directory reused from a crashed run leaves lock files that make the new process
   * appear to start and then do nothing. They are cheap to remove and expensive to diagnose.
   */
  for (const name of ['DevToolsActivePort', 'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
    try {
      unlinkSync(join(dir, name))
    } catch {
      // Absent is the normal case.
    }
  }

  let child: ChildProcess
  try {
    child = spawn(exe, [
      `--user-data-dir=${dir}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate,MediaRouter',
      '--disable-background-networking',
      // A fresh profile offers to sign in and sync, and that dialog covers the login page.
      '--disable-sync',
      '--disable-extensions',
      url,
    ], {
      /**
       * Detached, and unreferenced.
       *
       * The window has to outlive the request that opened it: the user may spend a minute on the
       * vendor's page, and DSH may be restarted in that time. Without both flags the browser is
       * a child of this process and dies with it.
       */
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    child.unref()
  } catch (error: unknown) {
    throw new Error(`浏览器启动失败：${error instanceof Error ? error.message : String(error)}`)
  }

  const port = await waitForPort(dir)
  if (port === 0) {
    try { child.kill() } catch { /* already gone */ }
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 150 }) } catch { /* ignore */ }
    throw new Error('浏览器起来了但没写出调试端口（可能被安全软件拦了远程调试）')
  }
  return { port, dir, child }
}

/** The pages the debugging port is serving. */
async function listPages(port: number): Promise<{ type?: string; url?: string; webSocketDebuggerUrl?: string }[]> {
  const response = await fetch(`http://127.0.0.1:${String(port)}/json`, { signal: AbortSignal.timeout(4_000) })
  return (await response.json()) as { type?: string; url?: string; webSocketDebuggerUrl?: string }[]
}

/**
 * The page that is actually on the vendor's host.
 *
 * Falling back to the first page would pick `about:blank`, and evaluating there throws a
 * cross-origin `SecurityError` that reads like a broken CDP connection.
 */
async function pickLoginPage(
  port: number,
  hostFragment: string,
): Promise<{ webSocketDebuggerUrl?: string } | undefined> {
  const pages = (await listPages(port)).filter(page => page.type === 'page' && page.webSocketDebuggerUrl !== undefined)
  /**
   * Prefer the page on the vendor's domain, but do not require it.
   *
   * A sign-in can land the browser on a different host than the login page — an SSO callback, a
   * regional domain, or the app itself once the session exists. Requiring the fragment found
   * nothing there and the poll then ran out its whole timeout with the credential sitting in
   * plain sight on another tab. Falling back to any real page costs one failed evaluate when the
   * fragment page is the right one, which the retry loop absorbs.
   */
  const matching = pages.find(page => String(page.url ?? '').includes(hostFragment))
  if (matching !== undefined) return matching
  // `about:blank` and the DevTools page have no storage to read.
  return pages.find(page => {
    const url = String(page.url ?? '')
    return url.startsWith('http') && !url.startsWith('devtools://')
  })
}

/** Evaluate one expression in the page and return its string result. */
async function evaluateInPage(port: number, hostFragment: string, expression: string, timeoutMs = 8_000): Promise<string> {
  const page = await pickLoginPage(port, hostFragment)
  if (page?.webSocketDebuggerUrl === undefined) throw new Error('没有可用的登录页')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('CDP 连接超时')) }, timeoutMs)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP 连接失败')) })
  })
  try {
    const reply = await new Promise<{ exceptionDetails?: unknown; result?: { value?: unknown } }>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('CDP 求值超时')) }, timeoutMs)
      socket.addEventListener('message', (event) => {
        let message: { id?: number; error?: { message?: string }; result?: { exceptionDetails?: unknown; result?: { value?: unknown } } }
        try {
          message = JSON.parse(String(event.data)) as typeof message
        } catch {
          return
        }
        if (message.id !== 1) return
        clearTimeout(timer)
        if (message.error !== undefined) reject(new Error(message.error.message ?? 'CDP error'))
        else resolve(message.result ?? {})
      })
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }))
    })
    if (reply.exceptionDetails !== undefined) return ''
    const value = reply.result?.value
    return typeof value === 'string' ? value : ''
  } finally {
    try { socket.close() } catch { /* ignore */ }
  }
}

/** What one poll of the page produced. */
export interface PolledCredential {
  value: string
  at: number
}

/**
 * Poll the page until `read` answers something, or the deadline passes.
 *
 * The read is re-run rather than awaited once because the user is still working: the token
 * appears only after their last click, and a failed read usually means "the page is still
 * loading", not "this will never work".
 */
export async function waitForCredential(input: {
  session: BrowserSession
  hostFragment: string
  /** A page expression yielding a non-empty string when the credential is available. */
  read: string
  timeoutMs?: number
  intervalMs?: number
  /** Return false to keep waiting — used to ignore a credential older than the one we had. */
  accept?: (value: string) => boolean
}): Promise<string | undefined> {
  const deadline = Date.now() + (input.timeoutMs ?? 300_000)
  const interval = input.intervalMs ?? 1_500
  while (Date.now() < deadline) {
    try {
      const value = await evaluateInPage(input.session.port, input.hostFragment, input.read)
      if (value !== '' && (input.accept === undefined || input.accept(value))) return value
    } catch {
      // The page is still loading, or the target was replaced. Try again.
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  }
  return undefined
}

/** Close the window and remove its profile. */
export async function closeLoginBrowser(session: BrowserSession | undefined): Promise<void> {
  if (session === undefined) return
  // Ask the browser to quit itself first; it flushes the profile that way.
  try {
    await fetch(`http://127.0.0.1:${String(session.port)}/json/version`, { signal: AbortSignal.timeout(3_000) })
    const socket = new WebSocket(`ws://127.0.0.1:${String(session.port)}/devtools/browser`)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { resolve() }, 2_000)
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
        clearTimeout(timer)
        resolve()
      })
      socket.addEventListener('error', () => { clearTimeout(timer); resolve() })
    })
    try { socket.close() } catch { /* ignore */ }
  } catch {
    // Not answering; the kill below handles it.
  }
  try { session.child.kill() } catch { /* already gone */ }
  // Give the process a moment to release the directory before removing it.
  await new Promise(resolve => setTimeout(resolve, 400))
  try { rmSync(session.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }) } catch { /* in use */ }
}

/**
 * Open a URL in the user's OWN browser, with their own profile.
 *
 * WHY THIS EXISTS AS A SECOND DOOR
 *
 * Google refuses to sign in inside a browser that is not the one holding the user's Google
 * session — the throwaway profile above is exactly that, so the Google button on a vendor's
 * login page answers "this browser or app may not be secure". The workaround the vendor's own
 * site expects is the opposite: hand the URL to the daily browser, where the user is already
 * signed into Google, and let that tab do the OAuth round trip.
 *
 * The cost is that we cannot read the page afterwards — it is the user's browser, not ours, and
 * attaching to it would mean reaching into a profile full of their other sessions. So this door
 * only opens the page; the credential is picked up by the OTHER window, which is still polling
 * the same vendor host.
 */
export function openInDefaultBrowser(url: string): { name: string } | undefined {
  const target = chromiumCandidates()[0]
  if (target === undefined) return undefined
  try {
    spawn(target.path, [url], { detached: true, stdio: 'ignore', windowsHide: false }).unref()
    return { name: target.name }
  } catch {
    return undefined
  }
}

/**
 * Read the cookies the browser holds, INCLUDING HttpOnly ones.
 *
 * `document.cookie` is blind to anything the server marked HttpOnly — and a session cookie
 * usually is, precisely so page scripts cannot steal it. MonkeyCode's `monkeycode_ai_session` is
 * one of those: the reference notes say outright that a user cannot see it in the browser at all,
 * which is why the plugin used to ask for it and the answer was often "where do I find this?".
 *
 * `Network.getCookies` asks the browser itself, so it returns exactly what an outgoing request
 * would carry.
 */
export async function readBrowserCookies(
  session: BrowserSession,
  url: string,
): Promise<{ name: string; value: string }[]> {
  const response = await fetch(`http://127.0.0.1:${String(session.port)}/json`)
  const pages = (await response.json()) as { type?: string; url?: string; webSocketDebuggerUrl?: string }[]
  const page = pages.find(candidate => candidate.type === 'page' && String(candidate.url).startsWith('http'))
  if (page?.webSocketDebuggerUrl === undefined) return []

  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('CDP 连接超时')) }, 8_000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP 连接失败')) })
  })
  try {
    const reply = await new Promise<{ cookies?: { name?: string; value?: string }[] }>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('CDP 求值超时')) }, 12_000)
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as {
          id?: number
          error?: { message?: string }
          result?: { cookies?: { name?: string; value?: string }[] }
        }
        if (message.id !== 9_001) return
        clearTimeout(timer)
        if (message.error !== undefined) reject(new Error(message.error.message ?? 'CDP error'))
        else resolve(message.result ?? {})
      })
      socket.send(JSON.stringify({ id: 9_001, method: 'Network.getCookies', params: { urls: [url] } }))
    })
    return (reply.cookies ?? [])
      .filter((cookie): cookie is { name: string; value: string } =>
        typeof cookie.name === 'string' && typeof cookie.value === 'string')
  } finally {
    try { socket.close() } catch { /* ignore */ }
  }
}

/**
 * Wait until one of `names` appears among the browser's cookies, then return them all.
 *
 * The names are what the caller needs; reading the whole jar lets it build a `Cookie` header in
 * the order the vendor set them, which several gateways check.
 */
export async function waitForCookies(input: {
  session: BrowserSession
  url: string
  names: readonly string[]
  timeoutMs?: number
  intervalMs?: number
}): Promise<{ name: string; value: string }[] | undefined> {
  const deadline = Date.now() + (input.timeoutMs ?? 300_000)
  const interval = input.intervalMs ?? 1_500
  while (Date.now() < deadline) {
    try {
      const cookies = await readBrowserCookies(input.session, input.url)
      const found = new Set(cookies.map(cookie => cookie.name))
      if (input.names.every(name => found.has(name))) return cookies
    } catch {
      // The page is between navigations; try again.
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  }
  return undefined
}
