/**
 * 百智云 routes: paste a key, read the wallet, claim the daily credit.
 *
 * Two credentials, two jobs: the API key talks to the gateway, and the console session reads the
 * wallet and claims the credit. A key alone is a working account that cannot report a balance.
 *
 * @module dsh-xdpool/baizhi-routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  POOL_BAIZHI_CHECKIN_PATH,
  POOL_BAIZHI_BROWSER_LOGIN_PATH,
  POOL_BAIZHI_SESSION_PATH,
  POOL_BAIZHI_WALLET_PATH,
} from './status-paths.ts'
import { originTrusted, type TrustedHosts } from './origin-trust.ts'
import { BAIZHI_KEYS_PAGE } from './baizhi-protocol.ts'
import { baizhiCatalog, baizhiCheckin, baizhiWallet } from './baizhi-upstream.ts'
import { baizhiBrowserSignIn, baizhiReadApiKey } from './baizhi-browser.ts'
import {
  readBaizhiCredentials,
  removeAllBaizhiCredentials,
  removeBaizhiCredential,
  saveBaizhiCredential,
} from './baizhi-store.ts'

/** The routes' dependencies. */
export interface BaizhiRouteOptions {
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

/** Mount the 百智云 routes. */
export function registerBaizhiRoutes(ctx: Context, deps: BaizhiRouteOptions): void {
  ctx.effect(() => {
    const trust = (req: IncomingMessage): boolean => originTrusted(req, deps.trustedHosts?.() ?? [])

    /**
     * Sign in through a browser window on the console.
     *
     * The console session is not optional here: the points endpoints accept only cookies, and a
     * key-only account would send messages and show no balance. The same session is also how the
     * API key is obtained — the console answers it in plain text — so the user never has to copy
     * one out.
     */
    const disposeBrowserLogin = ctx.webServer.register({
      kind: 'exact',
      path: POOL_BAIZHI_BROWSER_LOGIN_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        try {
          const result = await baizhiBrowserSignIn({})
          if (result === undefined) {
            return json(res, 200, { ok: false, reason: '登录窗口已关闭，或等待超时' })
          }
          // The key is a convenience, not a requirement: a console with no key created yet
          // still gives a working account for the points endpoints.
          const apiKey = await baizhiReadApiKey(result.sessionCookie)
          const credential = {
            apiKey: apiKey ?? '',
            sessionCookie: result.sessionCookie,
            // 昵称读得到才写；读不到就不写，卡片退回短 id。
            ...(result.nickname === undefined ? {} : { nickname: result.nickname }),
          }
          if (apiKey !== undefined) {
            const catalog = await baizhiCatalog(credential)
            if (catalog.error !== undefined) {
              return json(res, 200, { ok: false, reason: `凭据验证失败：${catalog.error}` })
            }
          }
          await saveBaizhiCredential(credential)
          deps.adopted()
          return json(res, 200, {
            ok: true,
            signedIn: true,
            keyFound: apiKey !== undefined,
            ...(apiKey === undefined ? { warning: '控制台还没有 API Key，请先去创建一个' } : {}),
          })
        } catch (error: unknown) {
          return json(res, 200, { ok: false, reason: error instanceof Error ? error.message : String(error) })
        }
      },
    })

    const disposeSession = ctx.webServer.register({
      kind: 'exact',
      path: POOL_BAIZHI_SESSION_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
        try {
          if (req.method === 'DELETE') {
            const body = await readBody(req)
            const key = typeof body['apiKey'] === 'string' ? body['apiKey'] : ''
            if (key === '') await removeAllBaizhiCredentials()
            else await removeBaizhiCredential(key)
            deps.adopted()
            const left = await readBaizhiCredentials()
            return json(res, 200, { ok: true, signedIn: left.length > 0, accounts: left.map(strip) })
          }
          if (req.method === 'POST') {
            const body = await readBody(req)
            const apiKey = typeof body['apiKey'] === 'string' ? body['apiKey'].trim() : ''
            if (apiKey === '') return json(res, 200, { ok: false, reason: '请填入 API Key' })
            const cookieRaw = typeof body['sessionCookie'] === 'string' ? body['sessionCookie'].trim() : ''
            const sessionCookie = cookieRaw.replace(/^cookie:\s*/iu, '')
            const credential = {
              apiKey,
              ...(sessionCookie === '' ? {} : { sessionCookie }),
            }
            // Verify before storing: a key that cannot list models is worth nothing.
            const catalog = await baizhiCatalog(credential)
            if (catalog.error !== undefined) {
              return json(res, 200, { ok: false, reason: `凭据验证失败：${catalog.error}` })
            }
            await saveBaizhiCredential(credential)
            deps.adopted()
            return json(res, 200, {
              ok: true,
              signedIn: true,
              modelCount: catalog.models.length,
              models: catalog.models.map(model => ({ id: model.id, name: model.name })),
              keysPage: BAIZHI_KEYS_PAGE,
            })
          }
          if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
          const accounts = await readBaizhiCredentials()
          return json(res, 200, {
            ok: true,
            signedIn: accounts.length > 0,
            accounts: accounts.map(strip),
            keysPage: BAIZHI_KEYS_PAGE,
          })
        } catch (error: unknown) {
          return json(res, 500, { error: messageOf(error) })
        }
      },
    })

    const disposeWallet = ctx.webServer.register({
      kind: 'exact',
      path: POOL_BAIZHI_WALLET_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
        try {
          const accounts = await readBaizhiCredentials()
          const credential = accounts[0]
          if (credential === undefined) return json(res, 200, { ok: false, signedIn: false })
          const wallet = await baizhiWallet(credential)
          return json(res, 200, {
            ok: wallet.error === undefined,
            signedIn: true,
            ...wallet,
            ...(wallet.error === undefined ? {} : { error: wallet.error }),
          })
        } catch (error: unknown) {
          return json(res, 200, { ok: false, signedIn: true, error: messageOf(error) })
        }
      },
    })

    const disposeCheckin = ctx.webServer.register({
      kind: 'exact',
      path: POOL_BAIZHI_CHECKIN_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
        try {
          const accounts = await readBaizhiCredentials()
          const credential = accounts[0]
          if (credential === undefined) return json(res, 200, { ok: false, signedIn: false })
          const result = await baizhiCheckin(credential)
          return json(res, 200, { ok: result.outcome !== 'failed', ...result })
        } catch (error: unknown) {
          return json(res, 200, { ok: false, outcome: 'failed', message: messageOf(error) })
        }
      },
    })

    return () => {
    disposeBrowserLogin()
      disposeCheckin()
      disposeWallet()
      disposeSession()
    }
  })
}

/** A credential as the card may see it: no key, no cookie. */
function strip(credential: { apiKey: string; nickname?: string; sessionCookie?: string }): Record<string, unknown> {
  return {
    id: `key-${credential.apiKey.slice(0, 6)}`,
    ...(credential.nickname === undefined ? {} : { nickname: credential.nickname }),
    /** Whether a console session is stored, which the daily credit needs. */
    hasSession: credential.sessionCookie !== undefined && credential.sessionCookie !== '',
  }
}
