/**
 * MonkeyCode routes: paste a session cookie, read the wallet — one set per site.
 *
 * The session is what is pasted, not the gateway key: the key is minted from the session and
 * rotates, and only the session can re-mint it or read a balance.
 *
 * @module dsh-xdpool/monkeycode-routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { monkeycodeBrowserSignIn } from './monkeycode-browser.ts'
import type { Context } from '@deepseek-ai/cordis'
import {
  POOL_MONKEYCODE_CN_BROWSER_LOGIN_PATH,
  POOL_MONKEYCODE_CN_SESSION_PATH,
  POOL_MONKEYCODE_CN_WALLET_PATH,
  POOL_MONKEYCODE_INTL_BROWSER_LOGIN_PATH,
  POOL_MONKEYCODE_INTL_SESSION_PATH,
  POOL_MONKEYCODE_INTL_WALLET_PATH,
} from './status-paths.ts'
import { originTrusted, type TrustedHosts } from './origin-trust.ts'
import {
  MONKEYCODE_CN,
  MONKEYCODE_INTL,
  MONKEYCODE_MODELS,
  type MonkeycodeSite,
} from './monkeycode-protocol.ts'
import { monkeycodeExchangeKey, monkeycodeWallet } from './monkeycode-upstream.ts'
import {
  monkeycodeCredentialFor,
  parseMonkeycodeCredential,
  readMonkeycodeCredentials,
  rememberMonkeycodeSecret,
  removeAllMonkeycodeCredentials,
  removeMonkeycodeCredential,
  saveMonkeycodeCredential,
} from './monkeycode-store.ts'

/** The routes' dependencies. */
export interface MonkeycodeRouteOptions {
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
function mountSite(ctx: Context, site: MonkeycodeSite, paths: {
  session: string
  wallet: string
  browserLogin: string
}, deps: MonkeycodeRouteOptions): () => void {
  const trust = (req: IncomingMessage): boolean => originTrusted(req, deps.trustedHosts?.() ?? [])

  /**
   * Sign in through a browser window.
   *
   * The session cookie is HttpOnly, so a card that asked the user to paste it was asking for
   * something they cannot see — the reference notes say exactly that. This reads it from the
   * browser itself, and gets a complete account in one step: the cookie is what mints the gateway
   * key and what reads the balance.
   */
  const disposeBrowserLogin = ctx.webServer.register({
    kind: 'exact',
    path: paths.browserLogin,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
      try {
        const result = await monkeycodeBrowserSignIn({ site })
        if (result === undefined) {
          return json(res, 200, { ok: false, reason: '登录窗口已关闭，或等待超时（没能读到会话 cookie）' })
        }
        const credential = {
          site: site.id,
          cookie: result.cookie,
          // 昵称读得到才写；读不到退回短 id。
          ...(result.nickname === undefined ? {} : { nickname: result.nickname }),
        }
        // Prove it exchanges for a key before storing it — a stale cookie would look signed in
        // and fail on the first message.
        const exchanged = await monkeycodeExchangeKey(site, result.cookie)
        if (exchanged.error !== undefined) {
          return json(res, 200, { ok: false, reason: `凭据验证失败：${exchanged.error ?? '换不到网关密钥'}` })
        }
        await saveMonkeycodeCredential(credential)
        deps.adopted()
        return json(res, 200, { ok: true, signedIn: true })
      } catch (error: unknown) {
        return json(res, 200, { ok: false, reason: messageOf(error) })
      }
    },
  })

  const disposeSession = ctx.webServer.register({
    kind: 'exact',
    path: paths.session,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
      try {
        if (req.method === 'DELETE') {
          await removeMonkeycodeCredential(site.id)
          deps.adopted()
          const all = await readMonkeycodeCredentials()
          return json(res, 200, {
            ok: true,
            signedIn: all.some(entry => entry.site === site.id),
            accounts: all.filter(entry => entry.site === site.id).map(strip),
          })
        }
        if (req.method === 'POST') {
          const body = await readBody(req)
          const pasted = typeof body['credential'] === 'string' ? body['credential'] : ''
          const parsed = parseMonkeycodeCredential(pasted)
          if (parsed.cookie === undefined || parsed.cookie === '') {
            return json(res, 200, { ok: false, reason: '这段内容里没有会话 Cookie' })
          }
          /**
           * Exchange before storing.
           *
           * A session that cannot mint a gateway key is worth nothing on the card; finding out
           * now beats a green "signed in" that fails on the first turn.
           */
          const exchanged = await monkeycodeExchangeKey(site, parsed.cookie)
          if (exchanged.apiKey === undefined || exchanged.signingSecret === undefined) {
            return json(res, 200, { ok: false, reason: `会话验证失败：${exchanged.error ?? '无法换取网关密钥'}` })
          }
          rememberMonkeycodeSecret(site.id, exchanged.signingSecret)
          await saveMonkeycodeCredential({
            site: site.id,
            cookie: parsed.cookie,
            apiKey: exchanged.apiKey,
          })
          deps.adopted()
          return json(res, 200, {
            ok: true,
            signedIn: true,
            modelCount: MONKEYCODE_MODELS.length,
            models: MONKEYCODE_MODELS.map(model => ({ id: model.id, name: model.name })),
          })
        }
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        const credential = await monkeycodeCredentialFor(site.id)
        return json(res, 200, {
          ok: true,
          signedIn: credential !== undefined,
          accounts: credential === undefined ? [] : [strip(credential)],
          models: MONKEYCODE_MODELS.map(model => ({ id: model.id, name: model.name })),
        })
      } catch (error: unknown) {
        return json(res, 500, { error: messageOf(error) })
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
        const credential = await monkeycodeCredentialFor(site.id)
        if (credential === undefined) return json(res, 200, { ok: false, signedIn: false })
        const wallet = await monkeycodeWallet(site, credential)
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

  return () => {
    disposeBrowserLogin()
    disposeWallet()
    disposeSession()
  }
}

/** Mount both sites. */
export function registerMonkeycodeRoutes(ctx: Context, deps: MonkeycodeRouteOptions): void {
  ctx.effect(() => {
    const disposeCn = mountSite(ctx, MONKEYCODE_CN, {
      session: POOL_MONKEYCODE_CN_SESSION_PATH,
      browserLogin: POOL_MONKEYCODE_CN_BROWSER_LOGIN_PATH,
      wallet: POOL_MONKEYCODE_CN_WALLET_PATH,
    }, deps)
    const disposeIntl = mountSite(ctx, MONKEYCODE_INTL, {
      session: POOL_MONKEYCODE_INTL_SESSION_PATH,
      browserLogin: POOL_MONKEYCODE_INTL_BROWSER_LOGIN_PATH,
      wallet: POOL_MONKEYCODE_INTL_WALLET_PATH,
    }, deps)
    return () => {
      disposeIntl()
      disposeCn()
    }
  })
}

/** A credential as the card may see it: no cookie, no key. */
function strip(credential: { site: string; nickname?: string }): Record<string, unknown> {
  return {
    id: credential.site,
    ...(credential.nickname === undefined ? {} : { nickname: credential.nickname }),
  }
}
