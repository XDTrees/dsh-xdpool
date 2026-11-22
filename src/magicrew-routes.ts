/**
 * Magicrew 的 HTTP 路由：登录、账号、余额、签到 —— 两站各一套。
 *
 * 路径常量在 `status-paths.ts` 里早就定义好了（`POOL_MAGICREW_*`），
 * 但一直没有实现。这个文件补上。
 *
 * | 路径 | 方法 | 作用 |
 * |---|---|---|
 * | `/plugins/dsh-xdpool/magicrew/session` | GET/POST/DELETE | 读账号 / 粘凭据登录 / 清空 |
 * | `/plugins/dsh-xdpool/magicrew/wallet` | GET | 读积分（含包明细）|
 * | `/plugins/dsh-xdpool/magicrew/checkin` | POST | 签到（领每日登录积分）|
 * | `/plugins/dsh-xdpool/magicrew/accounts` | GET/PATCH/DELETE | 列表 / 开关 / 删单个账号 |
 *
 * @module dsh-xdpool/magicrew-routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  POOL_MAGICREW_CN_LOGIN_PATH,
  POOL_MAGICREW_INTL_LOGIN_PATH,
  POOL_MAGICREW_CN_ACCOUNTS_PATH,
  POOL_MAGICREW_CN_CHECKIN_PATH,
  POOL_MAGICREW_CN_SESSION_PATH,
  POOL_MAGICREW_CN_WALLET_PATH,
  POOL_MAGICREW_INTL_ACCOUNTS_PATH,
  POOL_MAGICREW_INTL_CHECKIN_PATH,
  POOL_MAGICREW_INTL_SESSION_PATH,
  POOL_MAGICREW_INTL_WALLET_PATH,
} from './status-paths.ts'
import { originTrusted, type TrustedHosts } from './origin-trust.ts'
import {
  MAGICREW_CN,
  MAGICREW_INTL,
  magicrewDisplayNickname,
  magicrewJwtClaims,
  parseMagicrewCredential,
  type MagicrewProduct,
} from './magicrew-protocol.ts'
import { magicrewBalance, magicrewCatalog, magicrewCheckin, magicrewJwtExpiry } from './magicrew-upstream.ts'
import { magicrewBrowserSignIn } from './magicrew-browser.ts'
import {
  addMagicrewAccount,
  readMagicrewAccounts,
  removeMagicrewAccount,
  setMagicrewAccountEnabled,
  updateMagicrewCredential,
  type MagicrewAccount,
} from './magicrew-store.ts'

export interface MagicrewRouteOptions {
  /** 有账号变化时叫一声，让账号池重算。 */
  adopted: () => void
  trustedHosts?: () => TrustedHosts
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * 一个账号对外的形状。
 *
 * 只给界面需要的东西 —— **凭据本身不出这个文件**（JWT 就是登录态）。
 */
function publicAccount(account: MagicrewAccount, product: MagicrewProduct): Record<string, unknown> {
  const credential = account.credential
  return {
    id: account.id,
    site: credential.site,
    nickname: magicrewDisplayNickname(credential, product),
    enabled: account.enabled,
    createdAt: account.createdAt,
    ...magicrewJwtExpiry(credential) === undefined
      ? {}
      : { expiresAt: magicrewJwtExpiry(credential) },
    ...credential.phone === undefined ? {} : { phone: credential.phone },
    /* 告诉界面这把 key 还能不能用，卡片据此决定要不要印「需续期」 */
    ...credential.apiKey === undefined
      ? { hasApiKey: false }
      : { hasApiKey: true, ...credential.apiKeyExpiresAt === undefined ? {} : { apiKeyExpiresAt: credential.apiKeyExpiresAt } },
  }
}

/**
 * 挂一站的四条路由。
 */
function mountSite(
  ctx: Context,
  product: MagicrewProduct,
  paths: { login: string; session: string; wallet: string; checkin: string; accounts: string },
  deps: MagicrewRouteOptions,
): () => void {
  const trust = (req: IncomingMessage): boolean => originTrusted(req, deps.trustedHosts?.() ?? [])

  /*
    开窗登录 —— 和其他扫码渠道同一条路。

    插件起一个独立浏览器窗口指向网页登录页，用户登完之后读 localStorage 里的
    `authorization` / `organizationCode`，存进账号池。请求会等到登完才返回（可能几分钟）。
  */
  const disposeLogin = ctx.webServer.register({
    kind: 'exact',
    path: paths.login,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
      if (req.method !== 'POST') return json(res, 405, { error: 'method-not-allowed' })
      try {
        const result = await magicrewBrowserSignIn({ product })
        if (result === undefined) {
          return json(res, 200, {
            ok: false,
            signedIn: false,
            reason: '没有等到登录完成，可以再试一次。',
          })
        }
        /*
          存之前先验一次。签名过期、组织码不配套这类问题，
          现在发现好过让用户看着一张绿卡片然后在第一次对话时失败。
        */
        const credential = {
          site: product.site,
          jwt: result.jwt,
          ...result.organizationCode === undefined ? {} : { organizationCode: result.organizationCode },
          ...result.nickname === undefined ? {} : { nickname: result.nickname },
        } as const
        const catalog = await magicrewCatalog(credential, product)
        if (catalog.ok === false) {
          return json(res, 200, {
            ok: false,
            signedIn: false,
            reason: `凭据验证失败：${catalog.error}`,
          })
        }
        const account = await addMagicrewAccount(product.site, credential)
        deps.adopted()
        return json(res, 200, {
          ok: true,
          signedIn: true,
          account: publicAccount(account, product),
          models: catalog.value.length,
        })
      } catch (cause: unknown) {
        return json(res, 500, { error: cause instanceof Error ? cause.message : String(cause) })
      }
    },
  })

  const disposeSession = ctx.webServer.register({
    kind: 'exact',
    path: paths.session,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
      try {
        if (req.method === 'GET') {
          const accounts = await readMagicrewAccounts(product.site)
          return json(res, 200, {
            ok: true,
            signedIn: accounts.length > 0,
            accounts: accounts.map(account => publicAccount(account, product)),
          })
        }
        if (req.method === 'DELETE') {
          for (const account of await readMagicrewAccounts(product.site)) {
            await removeMagicrewAccount(product.site, account.id)
          }
          deps.adopted()
          return json(res, 200, { ok: true, signedIn: false, accounts: [] })
        }
        if (req.method === 'POST') {
          const body = await readBody(req)
          /*
            登录有两条腿，都收：
            · `credential` —— 用户粘贴的整段 JSON / 单条 JWT
            · `jwt` + `refreshToken` —— 网页登录回调直接给的两个字段
          */
          const raw = typeof body['credential'] === 'string'
            ? safeParse(body['credential'])
            : body
          const parsed = parseMagicrewCredential(raw, product.site)
          if (parsed === undefined) {
            return json(res, 200, {
              ok: false,
              reason: '这段内容里没有可用的登录凭据（需要 jwt / access_token）',
            })
          }
          /*
            存之前先验一次。签名过期、组织码不配套这类问题，
            现在发现好过让用户看着一张绿卡片然后在第一次对话时失败。
          */
          const catalog = await magicrewCatalog(parsed, product)
          if (catalog.ok === false) {
            return json(res, 200, { ok: false, reason: `凭据验证失败：${catalog.error}` })
          }
          /*
            昵称：上游可能没给，就从 JWT 里读。
            两处都没有时留空 —— 界面会退回产品名，而不是显示一串 id。
          */
          const claims = magicrewJwtClaims(parsed.jwt)
          const withName: typeof parsed = {
            ...parsed,
            ...parsed.nickname === undefined && claims.nickname !== undefined
              ? { nickname: claims.nickname }
              : {},
            ...parsed.phone === undefined && claims.phone !== undefined ? { phone: claims.phone } : {},
            ...parsed.accountId === undefined && claims.subject !== undefined
              ? { accountId: claims.subject }
              : {},
          }
          const account = await addMagicrewAccount(product.site, withName)
          deps.adopted()
          return json(res, 200, {
            ok: true,
            account: publicAccount(account, product),
            models: catalog.value.length,
          })
        }
        return json(res, 405, { error: 'method-not-allowed' })
      } catch (cause: unknown) {
        return json(res, 500, { error: cause instanceof Error ? cause.message : String(cause) })
      }
    },
  })

  const disposeWallet = ctx.webServer.register({
    kind: 'exact',
    path: paths.wallet,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
      try {
        const accounts = await readMagicrewAccounts(product.site)
        if (accounts.length === 0) return json(res, 200, { ok: true, accounts: [] })
        /*
          逐账号读余额。一家渠道一次请求，串行会在三五个账号时明显卡；
          但并发打同一个上游又容易触发风控 —— 折中：并发，但每个账号独立 catch，
          一个失败不影响其他人。
        */
        const rows = await Promise.all(accounts.map(async account => {
          const result = await magicrewBalance(account.credential, product)
          return result.ok
            ? {
                accountId: account.id,
                nickname: magicrewDisplayNickname(account.credential, product),
                balance: {
                  total: result.value.total,
                  packages: result.value.packages.map(row => ({
                    name: row.name,
                    ...row.amount === undefined ? {} : {
                      /* 卡片按「剩余比例」画进度条，这里把绝对量换算回去 */
                      remaining: result.value.total > 0
                        ? Math.round(((row.amount) / result.value.total) * 100)
                        : 0,
                    },
                    ...row.amount === undefined ? {} : { amount: row.amount },
                    ...row.total === undefined ? {} : { total: row.total },
                    ...row.expiresAt === undefined ? {} : { expiresAt: row.expiresAt },
                  })),
                  unit: '积分',
                },
              }
            : {
                accountId: account.id,
                nickname: magicrewDisplayNickname(account.credential, product),
                error: result.error,
              }
        }))
        return json(res, 200, { ok: true, accounts: rows })
      } catch (cause: unknown) {
        return json(res, 500, { error: cause instanceof Error ? cause.message : String(cause) })
      }
    },
  })

  const disposeCheckin = ctx.webServer.register({
    kind: 'exact',
    path: paths.checkin,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
      if (req.method !== 'POST') return json(res, 405, { error: 'method-not-allowed' })
      try {
        const body = await readBody(req)
        const wanted = typeof body['accountId'] === 'string' ? body['accountId'] : undefined
        const accounts = await readMagicrewAccounts(product.site)
        const targets = wanted === undefined
          ? accounts.filter(account => account.enabled)
          : accounts.filter(account => account.id === wanted)
        if (targets.length === 0) return json(res, 200, { ok: false, reason: '没有可签到的账号' })
        let gained = 0
        const messages: string[] = []
        for (const account of targets) {
          const result = await magicrewCheckin(account.credential, product)
          if (result.ok) {
            if (result.gained !== undefined) gained += result.gained
            messages.push(`${magicrewDisplayNickname(account.credential, product)}：${result.message}`)
          } else {
            messages.push(`${magicrewDisplayNickname(account.credential, product)}：${result.error}`)
          }
        }
        deps.adopted()
        return json(res, 200, {
          ok: true,
          gained,
          message: messages.join('；'),
        })
      } catch (cause: unknown) {
        return json(res, 500, { error: cause instanceof Error ? cause.message : String(cause) })
      }
    },
  })

  const disposeAccounts = ctx.webServer.register({
    kind: 'exact',
    path: paths.accounts,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!trust(req)) return json(res, 403, { error: 'origin-not-trusted' })
      try {
        if (req.method === 'GET') {
          const accounts = await readMagicrewAccounts(product.site)
          return json(res, 200, { ok: true, accounts: accounts.map(row => publicAccount(row, product)) })
        }
        const body = await readBody(req)
        const id = typeof body['accountId'] === 'string' ? body['accountId'] : ''
        if (id === '') return json(res, 400, { error: 'accountId 必填' })
        if (req.method === 'DELETE') {
          const removed = await removeMagicrewAccount(product.site, id)
          deps.adopted()
          return json(res, 200, { ok: removed, reason: removed ? undefined : '没有这个账号' })
        }
        if (req.method === 'PATCH' || req.method === 'POST') {
          if (typeof body['enabled'] === 'boolean') {
            const ok = await setMagicrewAccountEnabled(product.site, id, body['enabled'])
            deps.adopted()
            return json(res, 200, { ok })
          }
          /* 换凭据（续期后写回）*/
          const parsed = parseMagicrewCredential(body['credential'], product.site)
          if (parsed === undefined) return json(res, 400, { error: '凭据不完整' })
          const ok = await updateMagicrewCredential(product.site, id, parsed)
          deps.adopted()
          return json(res, 200, { ok })
        }
        return json(res, 405, { error: 'method-not-allowed' })
      } catch (cause: unknown) {
        return json(res, 500, { error: cause instanceof Error ? cause.message : String(cause) })
      }
    },
  })

  return () => {
    disposeLogin()
    disposeSession()
    disposeWallet()
    disposeCheckin()
    disposeAccounts()
  }
}

/** 用户粘贴的内容：可能是一整段 JSON，也可能是裸的 JWT。 */
function safeParse(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return undefined
    }
  }
  /* 裸 JWT 的形状：两段点分 */
  if (/^[\w-]+\.[\w-]+\.[\w-]+$/u.test(trimmed)) return { jwt: trimmed }
  return undefined
}

/** 挂两站的全部路由。 */
export function registerMagicrewRoutes(ctx: Context, deps: MagicrewRouteOptions): () => void {
  const disposeCn = mountSite(ctx, MAGICREW_CN, {
    login: POOL_MAGICREW_CN_LOGIN_PATH,
    session: POOL_MAGICREW_CN_SESSION_PATH,
    wallet: POOL_MAGICREW_CN_WALLET_PATH,
    checkin: POOL_MAGICREW_CN_CHECKIN_PATH,
    accounts: POOL_MAGICREW_CN_ACCOUNTS_PATH,
  }, deps)
  const disposeIntl = mountSite(ctx, MAGICREW_INTL, {
    login: POOL_MAGICREW_INTL_LOGIN_PATH,
    session: POOL_MAGICREW_INTL_SESSION_PATH,
    wallet: POOL_MAGICREW_INTL_WALLET_PATH,
    checkin: POOL_MAGICREW_INTL_CHECKIN_PATH,
    accounts: POOL_MAGICREW_INTL_ACCOUNTS_PATH,
  }, deps)
  return () => {
    disposeCn()
    disposeIntl()
  }
}
