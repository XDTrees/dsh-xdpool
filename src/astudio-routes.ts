/**
 * AStudio routes: sign in, read the wallet, claim the daily reward.
 *
 * THREE DOORS
 *
 *   - `POST /astudio/login` takes a pasted credential — a `modelBearerToken`, or the web
 *     session cookies. The reference implementation also offers SMS and WeChat QR through a
 *     local page; that page is a browser surface this plugin does not host, so the paste door is
 *     the one that works everywhere and needs no captcha solver.
 *   - `GET /astudio/session` reports what is stored.
 *   - `GET /astudio/wallet` and `POST /astudio/checkin` read the points and claim the day's
 *     reward.
 *
 * @module dsh-xdpool/astudio-routes
 */
import { inspectPaste } from './paste-guard.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  POOL_ASTUDIO_CHECKIN_PATH,
  POOL_ASTUDIO_BROWSER_LOGIN_PATH,
  POOL_ASTUDIO_LOGIN_PATH,
  POOL_ASTUDIO_SESSION_PATH,
  POOL_ASTUDIO_WALLET_PATH,
} from './status-paths.ts'
import { originTrusted, type TrustedHosts } from './origin-trust.ts'
import { astudioBalance, astudioCheckin, astudioMintBearer } from './astudio-account.ts'
import { astudioCatalog } from './astudio-upstream.ts'
import { astudioBrowserSignIn } from './astudio-browser.ts'
import {
  readAstudioAccounts,
  removeAllAstudioAccounts,
  removeAstudioAccount,
  saveAstudioAccount,
} from './astudio-store.ts'
import { ASTUDIO_MODELS } from './astudio-models.ts'

/** The routes' dependencies. */
export interface AstudioRouteOptions {
  /** Called after a successful sign-in, so the adapter sees it without a restart. */
  adopted: () => void
  trustedHosts?: () => TrustedHosts
}

/** Write JSON. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Read a JSON body, or an empty object. */
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

/**
 * Pull the uid and session out of whatever the user pasted.
 *
 * Three shapes arrive in practice: a bare `modelBearerToken`, a cookie string, and the whole
 * `astron-session.json`. All three are accepted because all three are what a user actually
 * copies.
 */
export function parseAstudioCredential(input: string): {
  bearer?: string
  cookie?: string
  accountId?: string
} {
  /**
   * A paste that cannot be a credential is refused before it is stored.
   *
   * Accepting it would fail at the vendor with `HTTP 401`, which reads as "my account
   * is broken" rather than "I pasted the wrong thing".
   */
  if (inspectPaste(input) !== undefined) return {}

  const text = input.trim()
  if (text === '') return {}
  // A whole session document.
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      const bearer = parsed['modelBearerToken'] ?? parsed['model_bearer_token']
      const uid = parsed['accountId'] ?? parsed['account_id'] ?? parsed['uid']
      const sso = parsed['ssoSessionId'] ?? parsed['sso_session_id']
      const token = parsed['token']
      const parts: string[] = []
      if (typeof sso === 'string' && sso !== '') parts.push(`ssoSessionId=${sso}`)
      if (typeof uid === 'string' && uid !== '') parts.push(`account_id=${uid}`)
      if (typeof token === 'string' && token !== '') parts.push(`token=${token}`)
      return {
        ...(typeof bearer === 'string' && bearer !== '' ? { bearer } : {}),
        ...(parts.length === 0 ? {} : { cookie: parts.join('; ') }),
        ...(typeof uid === 'string' && uid !== '' ? { accountId: uid } : {}),
      }
    } catch {
      return {}
    }
  }
  // A cookie header.
  if (/ssoSessionId=/iu.test(text)) {
    const uid = /account_id=([^;]+)/iu.exec(text)?.[1]
    return {
      cookie: text,
      ...(uid === undefined ? {} : { accountId: uid }),
    }
  }
  // A bare bearer: a JWT, which is three dot-separated parts.
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(text)) return { bearer: text }
  // Anything else is taken as an opaque bearer rather than refused: the vendor has used
  // several token shapes, and a wrong guess is answered by the gateway anyway.
  return { bearer: text }
}

/** Mount the AStudio routes. */
export function registerAstudioRoutes(ctx: Context, deps: AstudioRouteOptions): void {
  ctx.effect(() => {
    const trust = (req: IncomingMessage): boolean => originTrusted(req, deps.trustedHosts?.() ?? [])

    /**
     * Sign in through a browser window on the console.
     *
     * The desktop client's sign-in is a WeChat QR inside the app, but the WEB console offers a
     * phone number and an SMS code in ordinary inputs — so a window can complete it the way a user
     * would, and the cookies it leaves are what the points endpoints already accept.
     */
    const disposeBrowserLogin = ctx.webServer.register({
      kind: 'exact',
      path: POOL_ASTUDIO_BROWSER_LOGIN_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        try {
          const result = await astudioBrowserSignIn({})
          if (result === undefined) {
            return json(res, 200, {
              ok: false,
              reason: '登录窗口已关闭，或等待超时（没读到 ssoSessionId）',
            })
          }
          /**
           * The bearer is minted from the cookie.
           *
           * The model gateway wants a JWT, not a session cookie; the console exchanges one for
           * the other, which is what this same route already does for a pasted cookie.
           */
          const bearer = await astudioMintBearer({
            cookie: result.cookie,
            ...(result.accountId === undefined ? {} : { accountId: result.accountId }),
          })
          if (bearer === undefined || bearer === '') {
            return json(res, 200, { ok: false, reason: '会话已建立，但换不到对话用的令牌' })
          }
          const account = {
            accountId: result.accountId ?? 'astudio',
            bearer,
            cookie: result.cookie,
            /*
             * 昵称来自登录时读到的 cookie。
             *
             * 卡片用它标账号；没有就用 accountId，那会是一排长得一样的 `astudio`。
             * 只在真读到的时候才写，不编一个「AStudio 账号」——列表里重复的占位名
             * 比 id 更难分辨。
             */
            ...(result.nickname === undefined ? {} : { nickname: result.nickname }),
          }
          // Prove the credential reads before storing it.
          const probe = await astudioCatalog({ bearer })
          if (probe.error !== undefined) {
            return json(res, 200, { ok: false, reason: `凭据验证失败：${probe.error}` })
          }
          await saveAstudioAccount(account)
          deps.adopted()
          return json(res, 200, { ok: true, signedIn: true, modelCount: probe.models.length })
        } catch (error: unknown) {
          return json(res, 200, { ok: false, reason: messageOf(error) })
        }
      },
    })

    const disposeSession = ctx.webServer.register({
      kind: 'exact',
      path: POOL_ASTUDIO_SESSION_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
        try {
          if (req.method === 'DELETE') {
            const body = await readBody(req)
            const accountId = typeof body['accountId'] === 'string' ? body['accountId'] : ''
            if (accountId === '') await removeAllAstudioAccounts()
            else await removeAstudioAccount(accountId)
            deps.adopted()
            const left = await readAstudioAccounts()
            return json(res, 200, { ok: true, signedIn: left.length > 0, accounts: left.map(strip) })
          }
          if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
          const accounts = await readAstudioAccounts()
          return json(res, 200, {
            ok: true,
            signedIn: accounts.length > 0,
            accounts: accounts.map(strip),
            models: ASTUDIO_MODELS.map(model => ({
              id: model.id,
              name: model.name,
              ...(model.free === true ? { free: true } : {}),
            })),
          })
        } catch (error: unknown) {
          return json(res, 500, { error: messageOf(error) })
        }
      },
    })

    const disposeLogin = ctx.webServer.register({
      kind: 'exact',
      path: POOL_ASTUDIO_LOGIN_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
        try {
          const body = await readBody(req)
          const pasted = typeof body['credential'] === 'string' ? body['credential'] : ''
          const parsed = parseAstudioCredential(pasted)
          let bearer = parsed.bearer
          /**
           * A pasted cookie string is enough on its own.
           *
           * It is exchanged for a model bearer the same way the desktop app does at launch, so
           * a user who only has the browser session does not have to hunt for the JWT.
           */
          if ((bearer === undefined || bearer === '') && parsed.cookie !== undefined) {
            bearer = await astudioMintBearer({
              cookie: parsed.cookie,
              ...(parsed.accountId === undefined ? {} : { accountId: parsed.accountId }),
            })
          }
          /**
           * Verify before storing.
           *
           * A bearer that cannot list models is worth nothing on the card, and finding out now
           * beats a green "signed in" that fails on the first turn. The catalogue endpoint
           * requires the bearer, unlike Qiniu's anonymous `/v1/models`.
           */
          if (bearer !== undefined && bearer !== '') {
            const probe = await astudioCatalog({ bearer })
            /**
             * An ERROR is the answer, even when models come back with it.
             *
             * `astudioCatalog` falls back to the measured table when the live read fails, so a
             * 401 arrives WITH seven models attached. Checking `models.length === 0` therefore
             * never fired and any string was accepted; the error is what says the bearer is bad.
             */
            if (probe.error !== undefined) {
              return json(res, 200, { ok: false, reason: `凭据验证失败：${probe.error}` })
            }
          }
          if (bearer === undefined || bearer === '') {
            return json(res, 200, {
              ok: false,
              reason: '这段内容里没有可用的凭据。请粘贴 modelBearerToken、会话 Cookie，或整个 astron-session.json',
            })
          }
          const accountId = parsed.accountId ?? stableIdOf(bearer)
          await saveAstudioAccount({
            accountId,
            bearer,
            cookie: parsed.cookie ?? '',
          })
          deps.adopted()
          const accounts = await readAstudioAccounts()
          return json(res, 200, { ok: true, signedIn: true, accounts: accounts.map(strip) })
        } catch (error: unknown) {
          return json(res, 200, { ok: false, reason: messageOf(error) })
        }
      },
    })

    const disposeWallet = ctx.webServer.register({
      kind: 'exact',
      path: POOL_ASTUDIO_WALLET_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
        try {
          const accounts = await readAstudioAccounts()
          const account = accounts[0]
          if (account === undefined) return json(res, 200, { ok: false, signedIn: false })
          const balance = await astudioBalance(account)
          return json(res, 200, {
            ok: balance.error === undefined,
            signedIn: true,
            ...balance,
            ...(balance.error === undefined ? {} : { error: balance.error }),
          })
        } catch (error: unknown) {
          return json(res, 200, { ok: false, signedIn: true, error: messageOf(error) })
        }
      },
    })

    const disposeCheckin = ctx.webServer.register({
      kind: 'exact',
      path: POOL_ASTUDIO_CHECKIN_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
        try {
          const accounts = await readAstudioAccounts()
          const account = accounts[0]
          if (account === undefined) return json(res, 200, { ok: false, signedIn: false })
          const result = await astudioCheckin(account)
          return json(res, 200, { ok: result.outcome === 'claimed' || result.outcome === 'done', ...result })
        } catch (error: unknown) {
          return json(res, 200, { ok: false, outcome: 'failed', message: messageOf(error) })
        }
      },
    })

    return () => {
      disposeBrowserLogin()
      disposeCheckin()
      disposeWallet()
      disposeLogin()
      disposeSession()
    }
  })
}

/** An account as the card may see it: no credentials. */
function strip(account: { accountId: string; nickname?: string; cookie: string }): Record<string, unknown> {
  return {
    id: account.accountId,
    ...(account.nickname === undefined ? {} : { nickname: account.nickname }),
    /** Whether a web session is stored, which is what the points and check-in need. */
    hasSession: account.cookie !== '',
  }
}

/** A stable id for an account signed in by bearer alone. */
function stableIdOf(bearer: string): string {
  let hash = 0
  for (let index = 0; index < bearer.length; index += 1) {
    hash = (hash * 31 + bearer.charCodeAt(index)) | 0
  }
  return `key-${Math.abs(hash).toString(16)}`
}
