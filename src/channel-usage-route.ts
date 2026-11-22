/**
 * 渠道的「账号使用方式」—— issue #197 之后补回的一整条路由。
 *
 * 3.0.0 的账号池把使用方式从 3 种扩到 5 种（优先 / 轮换 / 均衡 / 粘住 / 按到期），
 * 客户端 `ChannelPoolSection.setChannelMode` 与 `ChannelUsagePane` 都往
 * `/plugins/dsh-xdpool/channels/usage` 发 POST，而**服务端从来没有注册过这条路径**：
 * 读侧只有 `api.channelUsage()` 这个进程内方法，没人把它挂到 HTTP 上。
 *
 * 结果就是用户点下去看到的那句：
 *
 *   账号使用方式没保存上：HTTP 405
 *
 * 405 不是 500，因为路径落到了宿主的兜底处理 —— 请求根本没进过插件。
 *
 * 这里把读写两面都挂出来，形状与客户端已经期待的 `ChannelUsageState` 一致：
 *
 *   GET  → { pool, channels }
 *   POST → { channel, strategy }，`strategy` 缺省/空 = 清除该渠道的覆盖
 *
 * 写入走 `writeChannelUsage`（原子替换 + 立刻 publish 给 pack），所以点一下
 * 就换策略，不需要重启。
 *
 * @module dsh-xdpool/channel-usage-route
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { originTrusted, type TrustedHosts } from './origin-trust.ts'
import { POOL_CHANNEL_USAGE_PATH } from './status-paths.ts'
import { isUsageStrategy, readChannelUsage, writeChannelUsage } from './channel-usage.ts'

/** What the two handlers need from the plugin. */
export interface ChannelUsageRouteOptions {
  /** The pool-wide strategy every channel falls back to (`config.distribution`). */
  pool: () => string
  /** The authorities this deployment serves, so a proxied UI can write — see `origin-trust.ts`. */
  trustedHosts?: (() => TrustedHosts) | undefined
}

/** Write one JSON answer. */
function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  })
  res.end(text)
}

/** Read a JSON body, or an empty object when there is none. */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** Register `GET`/`POST /plugins/dsh-xdpool/channels/usage`. */
export function registerChannelUsageRoute(ctx: Context, deps: ChannelUsageRouteOptions): void {
  const state = (): { pool: string; channels: Readonly<Record<string, string>> } => ({
    pool: deps.pool(),
    channels: readChannelUsage(),
  })
  // Registered through `ctx.effect` like every other route this plugin mounts,
  // so a plugin reload disposes the handler instead of stacking a second one on
  // the same path (two handlers answer the first request, the second is dead).
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: POOL_CHANNEL_USAGE_PATH,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
      if (!originTrusted(req, deps.trustedHosts?.() ?? [])) return json(res, 403, { error: 'origin-not-trusted' })
      if (req.method === 'GET') return json(res, 200, state())

      const body = await readJson(req)
      const channel = body['channel']
      if (typeof channel !== 'string' || channel.trim() === '') {
        return json(res, 400, { error: 'channel must be a non-empty string' })
      }
      /**
       * `strategy` absent (or `''`) CLEARS the override.
       *
       * Clearing is a real operation — the channel goes back to following the
       * pool default — and the card offers it, so refusing an empty value would
       * make "follow the pool" unreachable from the UI.
       *
       * Anything else must be one of the five this build understands: an unknown
       * string stored here would be silently ignored at request time, which reads
       * as "the click did nothing" — the exact complaint this route exists for.
       */
      const raw = body['strategy']
      const strategy = raw === undefined || raw === null || raw === '' ? undefined : raw
      if (strategy !== undefined && !isUsageStrategy(strategy)) {
        return json(res, 400, { error: 'strategy must be one of priority/round-robin/balanced/sticky/expiry' })
      }
      writeChannelUsage(channel.trim(), strategy)
      // The answer is the state AFTER the write, so the card can paint the click
      // immediately instead of trusting its optimistic copy.
      return json(res, 200, state())
    },
  }))
}
