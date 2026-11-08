/**
 * LAN relay: re-exposes the pool's loopback OpenAI shim on a LAN address, so a
 * second machine, a phone, or another editor can talk to the pool with a plain
 * OpenAI client.
 *
 * WHY A SEPARATE LISTENER INSTEAD OF BINDING THE SHIM TO 0.0.0.0
 *
 * The shim's own secret is minted per process and re-generated on every start.
 * Binding the shim directly would mean handing that secret to every device on
 * the network: one DSH restart later every client that saved it is broken, and
 * in the meantime it has been written into whatever config file each client
 * keeps its API key in.
 *
 * So the relay owns a key of its own, rotatable from the card, and holds the
 * shim secret inside the process. A client that has the relay key can reach the
 * pool through the relay. The shim secret is never written to a response and
 * never leaves this process — that separation is the whole security model, not
 * a detail.
 *
 * The relay translates nothing. It forwards a small whitelisted set of paths
 * verbatim and copies the upstream status, headers, and body back, so a remote
 * caller sees exactly the shape the shim produces — the shape the tests pin.
 * Translating here would put a second, drifting copy of the wire format between
 * the client and the code that is actually verified.
 *
 * @module dsh-xdpool/relay
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'
import type { WorkBuddyShim } from './shim.ts'
import { RELAY_HOP_HEADER } from './shim.ts'
import type { GatewayModelEntry } from './shim.ts'
import type { PoolWebRelayStatus } from './status-paths.ts'
/**
 * Marked on every forwarded request so a relay pointed at its own address
 * refuses instead of looping, and so the shim can tell a LAN client from the
 * host's own adapter. Re-exported for callers that read the relay's contract
 * rather than the shim's.
 */
export { RELAY_HOP_HEADER }
/**
 * The only paths this relay forwards.
 *
 * Deliberately exactly the routes the shim serves. Anything else is refused
 * with 404 *before* a byte of the body is read or forwarded, so the relay can
 * never become a general-purpose proxy for whatever else might answer on the
 * shim's port.
 */
export const RELAY_FORWARDED_PATHS: ReadonlySet<string> = new Set([
  '/v1/models',
  '/v1/chat/completions',
])
/** Default LAN port. Loopback by default; see {@link RELAY_HOSTS}. */
export const RELAY_DEFAULT_PORT = 8326
/**
 * Bind addresses the user may choose.
 *
 * `127.0.0.1` means "no off-box client can reach this at all", and it is the
 * default: listening on every interface is a decision to make on purpose, not a
 * side effect of a feature existing.
 */
export const RELAY_HOSTS: readonly string[] = ['127.0.0.1', '0.0.0.0']
export interface RelayLogger {
  info?(...args: unknown[]): void
  warn(...args: unknown[]): void
  error?(...args: unknown[]): void
}
export interface RelaySettings {
  enabled: boolean
  host: string
  port: number
  key: string
}
export interface PoolRelayStatus {
  enabled: boolean
  /** Whether a listener is actually bound right now. */
  listening: boolean
  host: string
  port: number
  /** Where a client should point; '' until something is listening. */
  endpoint: string
  /**
   * The relay key in full.
   *
   * Returned on purpose: the card has to show it once so the user can copy it
   * into the other device. This is the key WE minted for LAN clients, not the
   * shim secret, and it grants nothing beyond reaching the pool.
   */
  key: string
  /** Why nothing is bound; '' when there is nothing to explain. */
  error: string
}
export interface PoolRelay {
  /** Settles after the first bind attempt; never rejects. */
  ready: Promise<void>
  status(): Promise<PoolRelayStatus>
  /**
   * Re-read the settings and re-evaluate the listener.
   *
   * Called after every settings write. Key and switch changes take effect on the
   * next request because the settings are read per request; only a change of
   * address or port needs the listener rebuilt, which is why this exists instead
   * of making the caller tear the relay down and build it again.
   */
  sync(): Promise<PoolRelayStatus>
  close(): Promise<void>
}
export interface PoolRelayOptions {
  /** The loopback shim to forward to. */
  shim: WorkBuddyShim
  /** Current settings, re-read on every request and every status call. */
  read: () => RelaySettings
  logger?: RelayLogger
}
/**
 * Bind address and port, or undefined when the settings cannot describe one.
 *
 * An out-of-range port is treated as "not configured" rather than clamped:
 * silently listening somewhere other than where the user asked is worse than
 * declining to start and saying so.
 */
function bindTarget(settings: RelaySettings): { host: string; port: number } | undefined {
  const host = RELAY_HOSTS.includes(settings.host) ? settings.host : RELAY_HOSTS[0]
  if (host === undefined) return undefined
  const port = settings.port
  // 0 is honoured as "let the OS pick", which is what a caller wants when it
  // only needs a port to test against. It can never come from the stored
  // settings: the store clears a 0 rather than writing it.
  if (!Number.isInteger(port) || port < 0 || port > 65_535) return undefined
  return { host, port }
}
/** Constant-time key comparison that tolerates a missing or wrong-length key. */
function keyMatches(presented: string, expected: string): boolean {
  if (expected === '') return false
  const a = Buffer.from(presented, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
/**
 * The caller's token, falling back to `x-api-key`.
 *
 * Both spellings are read because Anthropic-compatible clients send the latter,
 * and a relay that only understood one of them would look like a dead network
 * to half the clients it exists for.
 */
function bearerOf(req: IncomingMessage): string {
  const header = req.headers.authorization
  if (typeof header === 'string') {
    const match = /^Bearer\s+(.+)$/iu.exec(header.trim())
    if (match?.[1] !== undefined) return match[1].trim()
  }
  const alt = req.headers['x-api-key']
  if (typeof alt === 'string') return alt.trim()
  return ''
}
/** Connection-scoped headers, which must not be copied onto the next hop. */
const HOP_BY_HOP: ReadonlySet<string> = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])
/**
 * Headers for the upstream hop: the caller's, minus the hop-by-hop set and the
 * ones that must not travel onward, plus our own hop marker.
 *
 * `x-api-key` is dropped as well as `authorization`: a client using the
 * Anthropic spelling would otherwise have its relay key forwarded verbatim to
 * the shim, where it does nothing and is a leaked secret sitting in a log.
 */
function upstreamHeaders(req: IncomingMessage, shimToken: string): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {}
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase()
    if (HOP_BY_HOP.has(lower)) continue
    if (lower === 'host' || lower === 'authorization' || lower === 'x-api-key') continue
    if (lower === RELAY_HOP_HEADER) continue
    if (value !== undefined) headers[lower] = value
  }
  headers.authorization = `Bearer ${shimToken}`
  headers[RELAY_HOP_HEADER] = '1'
  return headers
}
function writeJson(res: ServerResponse, status: number, code: string, message: string): void {
  const body = `${JSON.stringify({ error: { message, type: code, code } })}\n`
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}
/**
 * Turn a bind failure into something the reader can act on.
 *
 * `listen EADDRINUSE: address already in use 127.0.0.1:8326` is accurate and useless.
 * The overwhelmingly common cause is not "another program stole the port" — it is a
 * previous DSH that has not finished exiting, still holding the relay it was serving.
 * The requested port and the old listener are the same, so the fix is either to wait,
 * or to pick a different port, and the message should say both.
 *
 * `EADDRNOTAVAIL` gets its own line because it means the machine has no such
 * interface, which is a different mistake from a busy port and sends the reader
 * looking in the wrong place if merged.
 *
 * The raw text is kept at the end rather than dropped: it is the only thing that can
 * be searched for, and a paraphrase that loses it is worse than no paraphrase.
 */
function explainBindFailure(raw: string, host: string, port: number): string {
  if (/EADDRINUSE/iu.test(raw)) {
    return `端口 ${port} 已被占用（${host}）。最常见的原因是上一个 DSH 还没完全退出、仍占着这个网关端口：稍等几秒重试，或换一个端口后再打开。原始错误：${raw}`
  }
  if (/EADDRNOTAVAIL/iu.test(raw)) {
    return `本机没有这个绑定地址（${host}）。选 127.0.0.1 只允许本机访问；要让手机等其他设备连进来才选 0.0.0.0。原始错误：${raw}`
  }
  if (/EACCES/iu.test(raw)) {
    return `没有权限绑定端口 ${port}。1024 以下的端口通常需要管理员权限，换一个 1024 以上的端口即可。原始错误：${raw}`
  }
  return raw
}

/**
 * Build the relay.
 *
 * Nothing binds until {@link PoolRelay.ready} settles, so a port clash becomes a
 * status the card can display instead of an exception that takes plugin startup
 * down with it.
 */
export function createPoolRelay(options: PoolRelayOptions): PoolRelay {
  const { shim, logger } = options
  let server: Server | undefined
  let listening = false
  let boundHost = ''
  let boundPort = 0
  let bindError = ''
  /** Re-read per request; a throwing reader must not take the relay down. */
  const settingsOf = (): RelaySettings => {
    try {
      return options.read()
    } catch (error) {
      logger?.warn(`xdpool relay: settings unreadable, treating the relay as off: ${String(error)}`)
      return { enabled: false, host: RELAY_HOSTS[0] ?? '127.0.0.1', port: RELAY_DEFAULT_PORT, key: '' }
    }
  }
  const stop = (): Promise<void> =>
    new Promise<void>(resolve => {
      const current = server
      server = undefined
      listening = false
      boundHost = ''
      boundPort = 0
      if (current === undefined) {
        resolve()
        return
      }
      // Idle keep-alive sockets hold the port open past `close`, so they are
      // dropped outright. A client mid-request goes with them: the relay is
      // going away and there is nowhere left to finish the response.
      current.closeAllConnections?.()
      current.close(() => resolve())
    })
  const start = (host: string, port: number): Promise<void> =>
    new Promise<void>(resolve => {
      const next = createServer(handle)
      const fail = (error: unknown): void => {
        const raw = error instanceof Error ? error.message : String(error)
        bindError = explainBindFailure(raw, host, port)
        logger?.warn(`xdpool relay: cannot bind ${host}:${port} — ${raw}`)
        next.close(() => resolve())
      }
      next.once('error', fail)
      next.listen(port, host, () => {
        next.removeListener('error', fail)
        const address = next.address()
        if (address === null || typeof address === 'string') {
          bindError = 'the listener bound an address the relay cannot advertise'
          next.close(() => resolve())
          return
        }
        server = next
        listening = true
        boundHost = host
        boundPort = address.port
        bindError = ''
        // The port actually bound is reported, not the requested one: port 0
        // asks the OS for a free port and the caller has to be told which.
        logger?.info?.(`xdpool relay: listening on http://${host}:${address.port}/v1`)
        resolve()
      })
    })
  function handle(req: IncomingMessage, res: ServerResponse): void {
    const settings = settingsOf()
    // The loop marker is refused before the switch is even consulted. A relay
    // that has been pointed at its own address would otherwise answer its own
    // "you are switched off" 503 in a loop; refusing the hop unconditionally is
    // what makes a misconfiguration diagnosable instead of a request storm.
    if (req.headers[RELAY_HOP_HEADER] !== undefined) {
      writeJson(res, 508, 'relay_loop', 'this request already came through the relay')
      return
    }
    // Switch before key: a disabled relay holds no listener, so this only fires
    // for a request already in flight when the user turned it off — and there,
    // 503 says "off" where a 401 would tell the client its key is stale and
    // prompt for one that would not help.
    if (!settings.enabled) {
      writeJson(res, 503, 'relay_disabled', 'the XD Pool LAN relay is switched off')
      return
    }
    if (!keyMatches(bearerOf(req), settings.key)) {
      writeJson(res, 401, 'relay_unauthorized', 'a valid XD Pool relay key is required')
      return
    }
    const path = (req.url ?? '').split('?')[0] ?? ''
    if (!RELAY_FORWARDED_PATHS.has(path)) {
      writeJson(res, 404, 'relay_no_route', `${path} is not a path this relay forwards`)
      return
    }
    const target = new URL(`${shim.baseUrl()}${path}`)
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest
    const upstream = send(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port === '' ? 80 : Number(target.port),
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers: upstreamHeaders(req, shim.token()),
      },
      answer => {
        res.writeHead(answer.statusCode ?? 502, answer.headers)
        answer.pipe(res)
      },
    )
    // A caller that walks away mid-request must not leave the pool burning an
    // account's quota on a reply nobody will read.
    res.once('close', () => {
      if (!res.writableEnded) upstream.destroy()
    })
    upstream.on('error', error => {
      if (res.headersSent) {
        res.end()
        return
      }
      writeJson(res, 502, 'relay_unreachable', `the pool shim did not answer: ${String(error)}`)
    })
    // Streamed, not buffered: a 64 MB body must not be held in memory here, and
    // streaming keeps time-to-first-token on the LAN as short as on loopback.
    req.pipe(upstream)
  }
  const sync = async (): Promise<void> => {
    const settings = settingsOf()
    const target = bindTarget(settings)
    if (!settings.enabled || target === undefined) {
      await stop()
      bindError =
        settings.enabled && target === undefined
          ? `port ${settings.port} is not a port this relay can bind`
          : ''
      return
    }
    if (satisfied(target.host, target.port)) return
    await stop()
    await start(target.host, target.port)
  }
  /**
   * Whether the current listener already satisfies what the settings ask for.
   *
   * Compared against the REQUESTED port, not the bound one: binding port 0
   * resolves to some port the OS chose, so comparing the resolved value against
   * the request of 0 would never match and every sync would rebind — handing the
   * user a different port each time they saved anything.
   */
  const satisfied = (host: string, requestedPort: number): boolean =>
    server !== undefined && host === boundHost && (requestedPort === 0 || requestedPort === boundPort)
  const status = async (): Promise<PoolRelayStatus> => {
    const settings = settingsOf()
    return {
      enabled: settings.enabled,
      listening,
      host: boundHost === '' ? settings.host : boundHost,
      port: boundPort === 0 ? settings.port : boundPort,
      endpoint: listening ? `http://${boundHost}:${boundPort}/v1` : '',
      key: settings.key,
      error: bindError,
    }
  }
  const ready = sync().then(() => undefined)
  return {
    ready,
    status,
    sync: async (): Promise<PoolRelayStatus> => {
      await sync()
      return status()
    },
    close: stop,
  }
}
/** A fresh relay key: 32 random bytes, URL-safe so it survives a copy-paste. */
export function newRelayKey(): string {
  return randomBytes(32).toString('base64url')
}
/**
 * Compose the relay document the Gateway card renders.
 *
 * Extracted, and awaited HERE, because the bug this shape exists to prevent is
 * invisible at the call site: `status()` is async, and
 * `{ ...relay.status(), candidates }` spreads a PENDING PROMISE, which yields no
 * own properties at all. The document then carries the new fields and silently
 * drops `enabled`, `listening`, `host`, `port`, `key` and `error` — a card with no
 * switch, no key and no endpoint, served over HTTP 200 with nothing to indicate it
 * broke. This happened when the picker was added; the assertions below are the
 * reason it cannot happen quietly again.
 *
 * Every input is a function so a test can hand it a rejecting roster and still
 * require the rest of the document to arrive.
 */
export async function relayDocumentOf(input: {
  status: () => Promise<PoolRelayStatus>
  shared: () => readonly string[] | undefined
  roster: () => Promise<readonly GatewayModelEntry[]>
  warn?: (error: unknown) => void
}): Promise<PoolWebRelayStatus> {
  const status = await input.status()
  let candidates: readonly GatewayModelEntry[]
  try {
    candidates = await input.roster()
  } catch (error: unknown) {
    // A roster that cannot be read must not take the panel down with it: the
    // switch, the key and the address are all still usable, and the picker is the
    // one part that can honestly say "nothing to show right now".
    input.warn?.(error)
    candidates = []
  }
  const shared = input.shared()
  return {
    ...status,
    candidates,
    ...(shared === undefined ? {} : { shared }),
  }
}