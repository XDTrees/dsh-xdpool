/**
 * `GET /plugins/dsh-xdpool/session?sessionId=<id>` —— 一个会话当前的归属。
 *
 * WHY IT IS ITS OWN ROUTE
 *
 * `POOL_USAGE_PATH` already reports per-channel and per-account totals, but it
 * cannot answer "what is THIS conversation running on": its records are filed
 * under a per-request `turnId`, and its window is a bounded ring that a busy
 * session flushes out long before the user asks. The composer chip needs the
 * opposite shape — one conversation, right now, cheap enough to poll whenever
 * the model changes.
 *
 * WHAT IT MAY NOT DO
 *
 * It never carries prompt text or message content, by construction rather than
 * by scrubbing: the book it reads only ever holds an id, a vendor, a model id
 * and an account label. GET only, trusted-origin only, like every other read on
 * this plugin's surface.
 *
 * @module dsh-xdpool/session-route-route
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { originTrusted, type TrustedHosts } from './origin-trust.ts'
import { POOL_SESSION_ROUTE_PATH, type PoolWebSessionRoute } from './status-paths.ts'
import { normalizeSessionId, type SessionRouteBook } from './session-route.ts'

/** What the handler needs from the plugin. */
export interface SessionRouteOptions {
  /** The live book both shims write to. */
  book: () => SessionRouteBook | undefined
  /** The authorities this deployment serves, so a proxied UI can read — see `origin-trust.ts`. */
  trustedHosts?: (() => TrustedHosts) | undefined
}

/** Write one JSON answer. */
function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    // A poll that hits a cache answers the previous conversation's route, which
    // is worse than answering nothing: the chip would name an account the chat
    // on screen never used.
    'Cache-Control': 'no-store',
  })
  res.end(text)
}

/** Register `GET /plugins/dsh-xdpool/session`. */
export function registerSessionRoute(ctx: Context, deps: SessionRouteOptions): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: POOL_SESSION_ROUTE_PATH,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
      if (!originTrusted(req, deps.trustedHosts?.() ?? [])) return json(res, 403, { error: 'origin-not-trusted' })

      const requested = new URL(req.url ?? '/', 'http://localhost').searchParams.get('sessionId')
      const sessionId = normalizeSessionId(requested)
      if (sessionId === undefined) {
        return json(res, 400, { error: 'sessionId must be a non-empty id' })
      }
      /*
        书不存在（这个部署没装面板）与「会话还没发过请求」是两回事，但对外都只能是
        `known: false`：前者没有记录可读，后者读到的就是空。把区别写进响应会让浏览器
        那一半分支出一个它无法处理的分支 —— 两种情况角标都该显示「还没有调用」。
      */
      const route = deps.book()?.of(sessionId)
      if (route === undefined) return json(res, 200, { sessionId, known: false } satisfies PoolWebSessionRoute)
      return json(res, 200, {
        sessionId,
        known: true,
        channel: route.channel,
        region: route.region,
        model: route.model,
        account: route.account,
        at: route.at,
      } satisfies PoolWebSessionRoute)
    },
  }))
}
