/**
 * AutoClaw routes: paste a credential, read the wallet — one set per site.
 *
 * @module dsh-xdpool/autoclaw-routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  POOL_AUTOCLAW_CN_CODE_LOGIN_PATH,
  POOL_AUTOCLAW_CN_SEND_CODE_PATH,
  POOL_AUTOCLAW_CN_SESSION_PATH,
  POOL_AUTOCLAW_CN_WALLET_PATH,
  POOL_AUTOCLAW_INTL_CODE_LOGIN_PATH,
  POOL_AUTOCLAW_INTL_SEND_CODE_PATH,
  POOL_AUTOCLAW_INTL_SESSION_PATH,
  POOL_AUTOCLAW_INTL_WALLET_PATH,
} from './status-paths.ts'
import { originTrusted, type TrustedHosts } from './origin-trust.ts'
import {
  AUTOCLAW_CN,
  AUTOCLAW_INTL,
  parseAutoclawCredential,
  type AutoclawSite,
} from './autoclaw-protocol.ts'
import { autoclawCatalog, autoclawSendCode, autoclawWallet } from './autoclaw-upstream.ts'
import { autoclawBrowserSignIn } from './autoclaw-browser.ts'
import {
  autoclawCredentialFor,
  readAutoclawCredentials,
  removeAllAutoclawCredentials,
  removeAutoclawCredential,
  saveAutoclawCredential,
} from './autoclaw-store.ts'

/** The routes' dependencies. */
export interface AutoclawRouteOptions {
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

/** Mount one site's two routes. */
function mountSite(ctx: Context, site: AutoclawSite, paths: {
  session: string
  wallet: string
  sendCode: string
  codeLogin: string
}, deps: AutoclawRouteOptions): () => void {
  const trust = (req: IncomingMessage): boolean => originTrusted(req, deps.trustedHosts?.() ?? [])

  const disposeSession = ctx.webServer.register({
    kind: 'exact',
    path: paths.session,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
      try {
        if (req.method === 'DELETE') {
          await removeAutoclawCredential(site.id)
          deps.adopted()
          const all = await readAutoclawCredentials()
          return json(res, 200, {
            ok: true,
            signedIn: all.some(entry => entry.site === site.id),
            accounts: all.filter(entry => entry.site === site.id).map(strip),
          })
        }
        if (req.method === 'POST') {
          const body = await readBody(req)
          const pasted = typeof body['credential'] === 'string' ? body['credential'] : ''
          const parsed = parseAutoclawCredential(pasted)
          if (parsed.accessToken === undefined || parsed.accessToken === '') {
            return json(res, 200, { ok: false, reason: '这段内容里没有可用的 access token' })
          }
          const credential = {
            site: site.id,
            accessToken: parsed.accessToken,
            ...(parsed.refreshToken === undefined ? {} : { refreshToken: parsed.refreshToken }),
          }
          // Verify before storing: the signature and the token together decide whether this
          // works, and finding out now beats a green card that fails on the first turn.
          const catalog = await autoclawCatalog(site, credential)
          if (catalog.error !== undefined) {
            return json(res, 200, { ok: false, reason: `凭据验证失败：${catalog.error}` })
          }
          await saveAutoclawCredential(credential)
          deps.adopted()
          return json(res, 200, {
            ok: true,
            signedIn: true,
            modelCount: catalog.models.length,
            models: catalog.models.map(model => ({
              id: model.id,
              name: model.name,
              ...(model.free ? { free: true } : {}),
            })),
          })
        }
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        const credential = await autoclawCredentialFor(site.id)
        return json(res, 200, {
          ok: true,
          signedIn: credential !== undefined,
          accounts: credential === undefined ? [] : [strip(credential)],
        })
      } catch (error: unknown) {
        return json(res, 500, { error: messageOf(error) })
      }
    },
  })

  /**
   * Send an SMS code.
   *
   * AutoClaw's sign-in is a phone number and a text message — there is no OAuth page a card can
   * drive and no key a user can copy, so this pair of routes is the only door. (The international
   * site's accounts have no bound phone, so the API answers there; the card reports what upstream
   * said rather than pretending the route is missing.)
   */
  const disposeSendCode = ctx.webServer.register({
    kind: 'exact',
    path: paths.sendCode,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
      try {
        const body = await readBody(req)
        const phone = typeof body['phone'] === 'string' ? body['phone'] : ''
        if (phone.trim() === '') return json(res, 200, { ok: false, reason: '请填入手机号' })
        const result = await autoclawSendCode(site, phone)
        return json(res, 200, result.ok ? { ok: true } : { ok: false, reason: result.error })
      } catch (error: unknown) {
        return json(res, 200, { ok: false, reason: messageOf(error) })
      }
    },
  })

  /**
   * Sign in through a browser window on AutoClaw's own site.
   *
   * The site is where a user signs in anyway, and its `localStorage` holds the token pair. Asking
   * for a phone number and a code — or for a token copied out of an app — makes the plugin do work
   * the site already did.
   */
  const disposeCodeLogin = ctx.webServer.register({
    kind: 'exact',
    path: paths.codeLogin,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
      try {
        const previous = await autoclawCredentialFor(site.id)
        const result = await autoclawBrowserSignIn({
          site,
          ...(previous === undefined ? {} : { previousToken: previous.accessToken }),
        })
        if (result === undefined) {
          return json(res, 200, { ok: false, reason: '登录窗口已关闭，或等待超时' })
        }
        const credential = {
          site: site.id,
          accessToken: result.accessToken,
          ...(result.refreshToken === undefined ? {} : { refreshToken: result.refreshToken }),
          ...(result.userId === undefined ? {} : { nickname: result.userId }),
        }
        // Same rule as every channel: prove it reads before storing it.
        const catalog = await autoclawCatalog(site, credential)
        if (catalog.error !== undefined) {
          return json(res, 200, { ok: false, reason: `凭据验证失败：${catalog.error}` })
        }
        await saveAutoclawCredential(credential)
        deps.adopted()
        return json(res, 200, {
          ok: true,
          signedIn: true,
          modelCount: catalog.models.length,
        })
      } catch (error: unknown) {
        return json(res, 200, { ok: false, reason: messageOf(error) })
      }
    },
  })

  const disposeWallet = ctx.webServer.register({
    kind: 'exact',
    path: paths.wallet,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
      if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
      try {
        const credential = await autoclawCredentialFor(site.id)
        if (credential === undefined) return json(res, 200, { ok: false, signedIn: false })
        const wallet = await autoclawWallet(site, credential)
        return json(res, 200, {
          ok: wallet.error === undefined,
          signedIn: true,
          total: wallet.total,
          buckets: wallet.buckets,
          ...(wallet.error === undefined ? {} : { error: wallet.error }),
        })
      } catch (error: unknown) {
        return json(res, 200, { ok: false, signedIn: true, error: messageOf(error) })
      }
    },
  })

  return () => {
    disposeWallet()
    disposeCodeLogin()
    disposeSendCode()
    disposeSession()
  }
}

/** Mount both sites. */
export function registerAutoclawRoutes(ctx: Context, deps: AutoclawRouteOptions): void {
  ctx.effect(() => {
    const disposeIntl = mountSite(ctx, AUTOCLAW_INTL, {
      session: POOL_AUTOCLAW_INTL_SESSION_PATH,
      wallet: POOL_AUTOCLAW_INTL_WALLET_PATH,
      sendCode: POOL_AUTOCLAW_INTL_SEND_CODE_PATH,
      codeLogin: POOL_AUTOCLAW_INTL_CODE_LOGIN_PATH,
    }, deps)
    const disposeCn = mountSite(ctx, AUTOCLAW_CN, {
      session: POOL_AUTOCLAW_CN_SESSION_PATH,
      wallet: POOL_AUTOCLAW_CN_WALLET_PATH,
      sendCode: POOL_AUTOCLAW_CN_SEND_CODE_PATH,
      codeLogin: POOL_AUTOCLAW_CN_CODE_LOGIN_PATH,
    }, deps)
    return () => {
      disposeCn()
      disposeIntl()
    }
  })
}

/** A credential as the card may see it: no token. */
function strip(credential: { site: string; nickname?: string }): Record<string, unknown> {
  return {
    id: credential.site,
    ...(credential.nickname === undefined ? {} : { nickname: credential.nickname }),
  }
}
