/**
 * Marvis routes: sign in, paste a callback, read the wallet.
 *
 * THREE DOORS, because the environment decides which one works:
 *
 *   - `POST /marvis/login` opens an isolated browser and drives QQ or WeChat there. This is the
 *     one that "just works" on a desktop.
 *   - `POST /marvis/paste` takes a callback URL — the only door on a machine with no browser, or
 *     where the driving browser is blocked by security software.
 *   - `POST /marvis/browser` is for the card's own two buttons; the body says which login type.
 *
 * @module dsh-xdpool/marvis-routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  POOL_MARVIS_LOGIN_PATH,
  POOL_MARVIS_PASTE_PATH,
  POOL_MARVIS_SESSION_PATH,
  POOL_MARVIS_WALLET_PATH,
} from './status-paths.ts'
import { originTrusted, type TrustedHosts } from './origin-trust.ts'
import { browserLogin } from './marvis-login.ts'
import { deviceGuid } from './marvis-device.ts'
import { exchangeCode, extractCode } from './marvis-session.ts'
import { readMarvisAccounts, removeAllMarvisAccounts, removeMarvisAccount, saveMarvisAccount } from './marvis-store.ts'
import { marvisWallet } from './marvis-upstream.ts'
import { MARVIS_MODELS } from './marvis-models.ts'

/** The routes' dependencies. */
export interface MarvisRouteOptions {
  /** The accounts, so the card can show them. */
  accounts: () => Promise<readonly { openid: string; nickname?: string; loginType: string }[]>
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

/** Mount the Marvis routes. */
export function registerMarvisRoutes(ctx: Context, deps: MarvisRouteOptions): void {
  ctx.effect(() => {
    const trust = (req: IncomingMessage): boolean => originTrusted(req, deps.trustedHosts?.() ?? [])

    /** The session: what is stored, and how to forget it. */
    const disposeSession = ctx.webServer.register({
      kind: 'exact',
      path: POOL_MARVIS_SESSION_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
        try {
          if (req.method === 'DELETE') {
            const body = await readBody(req)
            const openid = typeof body['openid'] === 'string' ? body['openid'] : ''
            if (openid === '') await removeAllMarvisAccounts()
            else await removeMarvisAccount(openid)
            deps.adopted()
            return json(res, 200, { ok: true, accounts: await deps.accounts() })
          }
          if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
          const accounts = await deps.accounts()
          return json(res, 200, {
            ok: true,
            signedIn: accounts.length > 0,
            accounts,
            models: MARVIS_MODELS.map(model => ({ id: model.id, name: model.name })),
            /** The device this machine presents; shown so a support thread can compare. */
            guid: deviceGuid(),
          })
        } catch (error: unknown) {
          return json(res, 500, { error: messageOf(error) })
        }
      },
    })

    /** Sign in through a browser this process drives. */
    const disposeLogin = ctx.webServer.register({
      kind: 'exact',
      path: POOL_MARVIS_LOGIN_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
        try {
          const body = await readBody(req)
          const loginType = body['loginType'] === 'WX' ? 'WX' : 'QC'
          const result = await browserLogin({ loginType })
          if (!result.ok || result.code === undefined) {
            return json(res, 200, { ok: false, reason: result.reason ?? '没有拿到授权码' })
          }
          const account = await exchangeCode({
            code: result.code,
            loginType,
            guid: deviceGuid(),
            ...(result.state === undefined ? {} : { state: result.state }),
          })
          await saveMarvisAccount(account)
          deps.adopted()
          return json(res, 200, {
            ok: true,
            signedIn: true,
            ...(account.nickname === undefined ? {} : { nickname: account.nickname }),
            accounts: await deps.accounts(),
          })
        } catch (error: unknown) {
          return json(res, 200, { ok: false, reason: messageOf(error) })
        }
      },
    })

    /** Paste a callback URL — the door for a machine with no driveable browser. */
    const disposePaste = ctx.webServer.register({
      kind: 'exact',
      path: POOL_MARVIS_PASTE_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
        try {
          const body = await readBody(req)
          const raw = typeof body['callback'] === 'string' ? body['callback'] : ''
          const loginType = body['loginType'] === 'WX' ? 'WX' : 'QC'
          const code = extractCode(raw)
          if (code === undefined) {
            return json(res, 200, {
              ok: false,
              reason: '这段内容里找不到授权码。请把地址栏里那条 …marvis_oauth?code=… 整条粘贴进来',
            })
          }
          /** `state` travels verbatim: QQ's is a decimal and the service compares the string. */
          let state: string | undefined
          try {
            state = new URL(raw).searchParams.get('state') ?? undefined
          } catch {
            state = undefined
          }
          const account = await exchangeCode({
            code,
            loginType,
            guid: deviceGuid(),
            ...(state === undefined ? {} : { state }),
          })
          await saveMarvisAccount(account)
          deps.adopted()
          return json(res, 200, {
            ok: true,
            signedIn: true,
            ...(account.nickname === undefined ? {} : { nickname: account.nickname }),
            accounts: await deps.accounts(),
          })
        } catch (error: unknown) {
          return json(res, 200, { ok: false, reason: messageOf(error) })
        }
      },
    })

    /** The wallet: charged tokens used and left. */
    const disposeWallet = ctx.webServer.register({
      kind: 'exact',
      path: POOL_MARVIS_WALLET_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
        try {
          const accounts = await readMarvisAccounts()
          const account = accounts[0]
          if (account === undefined) return json(res, 200, { ok: false, signedIn: false })
          const wallet = await marvisWallet(account)
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
      disposeWallet()
      disposePaste()
      disposeLogin()
      disposeSession()
    }
  })
}
