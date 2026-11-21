/**
 * Accio routes: pasted sign-in, quota.
 *
 * The region travels in the body rather than a separate path: both regions share one provider
 * group, and a card that supplied the wrong region would spend the other account's quota.
 *
 * @module dsh-xdpool/accio-routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  POOL_ACCIO_OAUTH_LOGIN_PATH,
  POOL_ACCIO_QUOTA_PATH,
  POOL_ACCIO_SESSION_PATH,
} from './status-paths.ts'
import { originTrusted, type TrustedHosts } from './origin-trust.ts'
import type { AccioRegion } from './accio-protocol.ts'
import { accioCatalog, accioQuota } from './accio-upstream.ts'
import { finishAccioOAuth, startAccioOAuth } from './accio-oauth.ts'
import { ACCIO_GATEWAY, ACCIO_LOGIN_CN, ACCIO_LOGIN_GLOBAL } from './accio-protocol.ts'
import {
  parseAccioCredential,
  readAccioCredentials,
  removeAccioCredential,
  removeAllAccioCredentials,
  saveAccioCredential,
} from './accio-store.ts'

/** The routes' dependencies. */
export interface AccioRouteOptions {
  adopted: () => void
  trustedHosts?: () => TrustedHosts
}

/** Write JSON. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Read a JSON body. */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
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

/** The safe message of an unknown error. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Whether a value is one of the two regions. */
function regionOf(value: unknown): AccioRegion | undefined {
  return value === 'global' ? 'global' : value === 'cn' ? 'cn' : undefined
}

/** Mount the Accio routes. */
export function registerAccioRoutes(ctx: Context, deps: AccioRouteOptions): void {
  ctx.effect(() => {
    const trust = (req: IncomingMessage): boolean => originTrusted(req, deps.trustedHosts?.() ?? [])

    const disposeSession = ctx.webServer.register({
      kind: 'exact',
      path: POOL_ACCIO_SESSION_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
        try {
          if (req.method === 'DELETE') {
            const body = await readBody(req)
            const region = regionOf(body['region'])
            if (region === undefined) await removeAllAccioCredentials()
            else await removeAccioCredential(region)
            deps.adopted()
            const left = await readAccioCredentials()
            return json(res, 200, { ok: true, signedIn: left.length > 0, accounts: left.map(strip) })
          }
          if (req.method === 'POST') {
            const body = await readBody(req)
            const pasted = typeof body['credential'] === 'string' ? body['credential'] : ''
            const region = regionOf(body['region']) ?? 'cn'
            const parsed = parseAccioCredential(pasted)
            if (parsed.accessToken === undefined || parsed.accessToken === '') {
              return json(res, 200, { ok: false, reason: '这段内容里没有可用的登录令牌' })
            }
            const credential = {
              region,
              accessToken: parsed.accessToken,
              ...(parsed.refreshToken === undefined ? {} : { refreshToken: parsed.refreshToken }),
            }
            // Verify before storing: a token that cannot list models is worth nothing on the
            // card, and reporting that now is better than showing a green "signed in" that
            // fails on the first turn.
            const catalog = await accioCatalog(credential)
            /**
             * An EMPTY list is a failed verification.
             *
             * The gateway answers a bad token with `success:false` and no models, not with an
             * HTTP error — so checking only `error` let any string through, and the account
             * failed on its first turn instead.
             */
            if (catalog.error !== undefined || catalog.models.length === 0) {
              return json(res, 200, {
                ok: false,
                reason: `凭据验证失败：${catalog.error ?? '这个令牌拿不到模型列表（可能已失效）'}`,
              })
            }
            await saveAccioCredential(credential)
            deps.adopted()
            return json(res, 200, {
              ok: true,
              signedIn: true,
              region,
              modelCount: catalog.models.length,
              models: catalog.models.map(model => ({
                id: model.id,
                name: model.name,
                ...(model.multiple === undefined ? {} : { multiple: model.multiple }),
              })),
            })
          }
          if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
          const accounts = await readAccioCredentials()
          return json(res, 200, { ok: true, signedIn: accounts.length > 0, accounts: accounts.map(strip) })
        } catch (error: unknown) {
          return json(res, 500, { error: messageOf(error) })
        }
      },
    })

    const disposeQuota = ctx.webServer.register({
      kind: 'exact',
      path: POOL_ACCIO_QUOTA_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
        try {
          const accounts = await readAccioCredentials()
          const credential = accounts[0]
          if (credential === undefined) return json(res, 200, { ok: false, signedIn: false })
          const quota = await accioQuota(credential)
          return json(res, 200, {
            ok: quota.error === undefined,
            signedIn: true,
            buckets: quota.buckets,
            ...(quota.error === undefined ? {} : { error: quota.error }),
          })
        } catch (error: unknown) {
          return json(res, 200, { ok: false, signedIn: true, error: messageOf(error) })
        }
      },
    })

    return () => {
      disposeQuota()
      disposeSession()
    }
  })
}

/** A credential as the card may see it: no token. */
function strip(credential: { region: string; nickname?: string }): Record<string, unknown> {
  return {
    id: credential.region,
    region: credential.region,
    ...(credential.nickname === undefined ? {} : { nickname: credential.nickname }),
  }
}
