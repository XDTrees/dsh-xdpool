/**
 * Marvis sign-in: QQ / WeChat OAuth, driven in a browser this process starts.
 *
 * WHY A BROWSER AND NOT A LOCAL CALLBACK SERVER
 *
 * `redirect_uri` is fixed inside Tencent's service
 * (`yybadaccess.3g.qq.com/marvis_client_login/marvis_oauth`) and pre-registered with QQ/WeChat,
 * so nothing the plugin hosts can receive the code. The reference implementation solves this by
 * intercepting the callback **before the request leaves the browser** over CDP — which also keeps
 * the code unconsumed, so this side exchanges it exactly once with the device guid attached.
 *
 * THE TWO THINGS THAT MAKE OR BREAK IT
 *
 *   1. `Ual-Access-MarvisExt` must be injected into EVERY request the login window makes.
 *      Without it the upstream answers 「请使用 Marvis 客户端」 — this, not the OAuth dance, is
 *      why a plain browser login never worked.
 *   2. The browser UA must be the client's own Electron UA. A plain Chrome UA is answered
 *      `-109 RC_PARAMS_INVALID`, which reads like a bad parameter and is actually a rejected
 *      caller.
 *
 * @module dsh-xdpool/marvis-login
 */
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { MARVIS_UA, marvisExt, QQ_APP_ID, WX_APP_ID, MARVIS_BASE } from './marvis-protocol.ts'
import { deviceGuid } from './marvis-device.ts'
import { chromiumCandidates, defaultBrowser } from './default-browser.ts'

/** The fixed callback the service registered. Its query decides which app the code belongs to. */
const REDIRECT = `${MARVIS_BASE}/marvis_client_login/marvis_oauth`

/** The path fragment that marks a callback, used when the url pattern is not enough. */
const CALLBACK_PATH = 'marvis_client_login/marvis_oauth'

/** What the login window shows once the code is captured. */
const COMPLETE_PAGE = `<!doctype html><meta charset="utf-8">
<title>授权完成</title>
<body style="font:16px/1.6 system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0f1115;color:#e8eaf0">
<div style="text-align:center"><div style="font-size:44px">✓</div>
<h1 style="font-size:20px;margin:12px 0 8px">授权完成</h1>
<p style="margin:0;color:#8a90a0;font-size:13px">已拿到授权码，正在换取登录态…<br>这个窗口会自动关闭。</p></div>`

/** A browser that exists on this machine. */
interface Browser {
  name: string
  path: string
}

/** What one sign-in produced. */
export interface MarvisLoginResult {
  ok: boolean
  reason?: string
  /** The OAuth code, already stripped from the callback URL. */
  code?: string
  /** The `state` the service will compare against. Kept as the original string. */
  state?: string
  /** Whether the callback was stopped before the browser sent it. */
  intercepted?: boolean
}

/** The shared candidate list — see default-browser.ts for why it is not local. */
function candidates(): readonly Browser[] {
  return chromiumCandidates()
}

/**
 * The browser to drive: the user's own default first, then the fixed list.
 *
 * Every other channel in this plugin hands a URL to `window.open` and appears in whatever browser
 * the user actually uses. A lane that drives one itself must do the same, or the same user gets
 * Edge for thirteen channels and Chrome for the two this plugin owns — for no reason they can see.
 */
function findBrowser(): Browser | undefined {
  const preferred = defaultBrowser()
  if (preferred !== undefined) return preferred
  return candidates()[0]
}

/** An unused local port, so two sign-ins do not fight over one. */
async function freePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => { resolve(port) })
    })
  })
}

/** Whether a URL is the login callback. */
export function isCallbackUrl(url: string): boolean {
  if (!url.includes(CALLBACK_PATH)) return false
  try {
    const params = new URL(url).searchParams
    return params.has('code') || params.has('error') || params.has('error_description')
  } catch {
    return false
  }
}

/** The authorization page for one login type. */
export function authorizeUrl(loginType: 'QC' | 'WX', guid: string): string {
  if (loginType === 'WX') {
    const params = new URLSearchParams({
      appid: WX_APP_ID,
      // The query decides which app the service exchanges the code for; without it the answer
      // is `-109`.
      redirect_uri: `${REDIRECT}?login_type=${loginType}`,
      response_type: 'code',
      scope: 'snsapi_login',
      state: guid,
    })
    return `https://open.weixin.qq.com/connect/qrconnect?${params.toString()}`
  }
  const params = new URLSearchParams({
    which: 'Login',
    display: 'pc',
    response_type: 'code',
    client_id: QQ_APP_ID,
    redirect_uri: `${REDIRECT}?login_type=${loginType}`,
    /**
     * A DECIMAL, and it must stay one.
     *
     * The client sends `Math.random()*100` (e.g. `31.1177412`) and the service compares it
     * verbatim. Rounding it to an integer is answered as an invalid parameter.
     */
    state: String(Math.random() * 100),
  })
  return `https://graph.qq.com/oauth2.0/authorize?${params.toString()}`
}

/** The `code` inside a callback URL. */
export function codeOf(url: string): string | undefined {
  try {
    const code = new URL(url).searchParams.get('code')
    return code !== null && code !== '' ? code : undefined
  } catch {
    return undefined
  }
}

/** The `state` inside a callback URL, kept as the original string. */
export function stateOf(url: string): string | undefined {
  try {
    const state = new URL(url).searchParams.get('state')
    return state !== null && state !== '' ? state : undefined
  } catch {
    return undefined
  }
}

/** Minimal shape of the DevTools socket this needs. */
type SocketLike = {
  addEventListener: (type: string, listener: (event: unknown) => void) => void
  removeEventListener: (type: string, listener: (event: unknown) => void) => void
  send: (data: string) => void
  close: () => void
}

/** Read JSON from the browser's DevTools endpoint. */
async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  return await response.json()
}

/**
 * Open a browser, stop the redirect before it is sent, and return the code.
 *
 * The window is isolated — a throwaway profile, no extensions, no history — because the
 * authorization pages treat a fresh window more kindly and because the user's own cookies must
 * not be touched.
 */
export async function browserLogin(options: {
  loginType: 'QC' | 'WX'
  timeoutMs?: number
  onProgress?: (message: string) => void
}): Promise<MarvisLoginResult> {
  const say = options.onProgress ?? (() => {})
  const browser = findBrowser()
  if (browser === undefined) {
    return {
      ok: false,
      reason: '没找到可用的 Chromium 内核浏览器（Chrome / Edge / 360 / QQ 浏览器都行）',
    }
  }
  const guid = deviceGuid()
  const url = authorizeUrl(options.loginType, guid)
  const timeoutMs = options.timeoutMs ?? 5 * 60_000
  const profile = mkdtempSync(join(tmpdir(), 'xdpool-marvis-login-'))
  const port = await freePort()

  const child = spawn(browser.path, [
    `--remote-debugging-port=${String(port)}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--exclude-switches=enable-automation',
    `--user-agent=${MARVIS_UA}`,
    '--lang=zh-CN',
    // about:blank first: every hook below must be installed BEFORE the navigation, or the
    // first request slips through and the interception never fires.
    'about:blank',
  ], { stdio: 'ignore', windowsHide: false })

  const cleanup = (): void => {
    try {
      // Windows leaves renderer children behind, which keeps the profile locked.
      spawnSync('taskkill', ['/PID', String(child.pid ?? 0), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      try { child.kill() } catch { /* already gone */ }
    }
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {
      // A locked temp directory must not fail the sign-in.
    }
  }

  const deadline = Date.now() + timeoutMs
  const sleep = async (ms: number): Promise<void> => await new Promise(resolve => setTimeout(resolve, ms))
  try {
    say(`已打开 ${browser.name}，请在弹出的窗口里用 ${options.loginType === 'WX' ? '微信' : 'QQ'} 登录…`)

    let pageWs = ''
    while (Date.now() < deadline) {
      try {
        const pages = await getJson(`http://127.0.0.1:${String(port)}/json/list`, 1000) as
          { type?: string; webSocketDebuggerUrl?: string }[]
        pageWs = pages.find(page => page.type === 'page' && page.webSocketDebuggerUrl !== undefined)
          ?.webSocketDebuggerUrl ?? ''
        if (pageWs !== '') break
      } catch {
        // The browser is still starting.
      }
      await sleep(300)
    }
    if (pageWs === '') {
      return {
        ok: false,
        reason: '浏览器没有打开调试端口（可能被安全软件拦了）。换个浏览器，或改用「粘贴回调地址」。',
      }
    }

    const Ctor = (globalThis as { WebSocket?: new (url: string) => SocketLike }).WebSocket
    if (Ctor === undefined) return { ok: false, reason: '这个 Node 版本没有全局 WebSocket' }
    const socket = new Ctor(pageWs)
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => { resolve() })
      socket.addEventListener('error', () => { reject(new Error('CDP 连不上')) })
    })

    let nextId = 0
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
    const send = async (method: string, params: Record<string, unknown> = {}, timeout = 10_000): Promise<unknown> =>
      await new Promise((resolve, reject) => {
        const id = ++nextId
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`CDP ${method} 超时`))
        }, timeout)
        pending.set(id, { resolve, reject, timer })
        try {
          socket.send(JSON.stringify({ id, method, params }))
        } catch (error: unknown) {
          clearTimeout(timer)
          pending.delete(id)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })

    let hit: string | undefined
    let fetchArmed = false
    const fulfill = (requestId: string): void => {
      // `body` must be base64 — that is the only shape `Fetch.fulfillRequest` accepts.
      void send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responsePhrase: 'OK',
        responseHeaders: [
          { name: 'Content-Type', value: 'text/html; charset=utf-8' },
          { name: 'Cache-Control', value: 'no-store' },
        ],
        body: Buffer.from(COMPLETE_PAGE, 'utf8').toString('base64'),
      }).catch(() => {})
    }

    const onMessage = (event: unknown): void => {
      const data = (event as { data?: unknown }).data
      if (typeof data !== 'string') return
      let message: { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } }
      try {
        message = JSON.parse(data) as typeof message
      } catch {
        return
      }
      if (message.id !== undefined) {
        const waiting = pending.get(message.id)
        if (waiting === undefined) return
        pending.delete(message.id)
        clearTimeout(waiting.timer)
        if (message.error !== undefined) waiting.reject(new Error(message.error.message ?? 'CDP error'))
        else waiting.resolve(message.result)
        return
      }
      if (message.method !== 'Fetch.requestPaused') return
      const params = message.params ?? {}
      const requestId = String(params['requestId'] ?? '')
      const request = params['request'] as { url?: unknown } | undefined
      const target = typeof request?.url === 'string' ? request.url : ''
      if (requestId === '') return
      if (!isCallbackUrl(target)) {
        void send('Fetch.continueRequest', { requestId }).catch(() => {})
        return
      }
      /**
       * NEVER continue a callback.
       *
       * Sending it lets the service consume the code, and the exchange from here would then be
       * answered `-107` — the code is single-use and this is the only chance to use it.
       */
      fulfill(requestId)
      hit ??= target
    }

    const failPending = (): void => {
      for (const [id, waiting] of pending) {
        clearTimeout(waiting.timer)
        waiting.reject(new Error('CDP 连接已关闭'))
        pending.delete(id)
      }
    }
    socket.addEventListener('message', onMessage)

    try {
      // Every hook BEFORE the navigation — see the about:blank note above.
      await send('Network.enable').catch(() => {})
      await send('Network.setUserAgentOverride', {
        userAgent: MARVIS_UA,
        acceptLanguage: 'zh-CN,zh;q=0.9',
        platform: 'Win32',
      }).catch(() => {})
      /**
       * The fingerprint header, on every request.
       *
       * The service validates `Ual-Access-MarvisExt` on EVERY call to the login host, and
       * answers 「请使用 Marvis 客户端」 without it. This is the reason a plain browser login
       * never worked, and it is the one header this window must always carry.
       */
      await send('Network.setExtraHTTPHeaders', {
        headers: { 'Ual-Access-MarvisExt': marvisExt({ guid }) },
      }).catch(() => {})
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})",
      }).catch(() => {})
      fetchArmed = await send('Fetch.enable', {
        patterns: [{ urlPattern: '*marvis_oauth*', requestStage: 'Request' }],
      }).then(() => true).catch(() => false)
      await send('Page.navigate', { url }).catch(() => {})

      while (Date.now() < deadline) {
        if (hit !== undefined) {
          // Let the completion page paint before the window closes.
          await sleep(700)
          const code = codeOf(hit)
          const state = stateOf(hit)
          return {
            ok: true,
            ...(code === undefined ? {} : { code }),
            ...(state === undefined ? {} : { state }),
            intercepted: true,
          }
        }
        await sleep(120)
      }
      return {
        ok: false,
        reason: `等了 ${String(Math.round(timeoutMs / 60_000))} 分钟还没完成授权`.replace('0 分钟', '几秒')
          + (fetchArmed ? '' : '（这个浏览器不接受 CDP 请求拦截，换一个再试）'),
      }
    } finally {
      socket.removeEventListener('message', onMessage)
      failPending()
      try { socket.close() } catch { /* already closed */ }
    }
  } finally {
    cleanup()
  }
}
