/**
 * The Doubao lane's routes: sign in, report the session, read the quota.
 *
 * WHY THESE LIVE HERE AND NOT IN THE PACK
 *
 * Every other channel's routes are provided by the vendored pack, which owns the credential
 * and the wire. Doubao has no pack adapter — one cookie jar is the whole lane — so its three
 * calls are registered by this plugin, beside the others it already serves.
 *
 * THE SIGN-IN IS INTERACTIVE BY DESIGN
 *
 * Doubao's own QR entrance is closed (`2035 非法请求`), so there is nothing to poll. What
 * works is a real Chromium window: the user scans or enters a phone code, and the session is
 * harvested over the DevTools protocol. That is why `POST` opens a window rather than
 * returning a URL for the browser to open — the debugging port has to belong to the browser
 * that signs in, and only one this process started can promise that.
 *
 * @module dsh-xdpool/doubao-routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DoubaoAutomation } from './doubao-automation.ts'
import type { Context } from '@deepseek-ai/cordis'
import {
  POOL_DOUBAO_AUTOMATION_PATH,
  POOL_DOUBAO_CAMPAIGN_PATH,
  POOL_DOUBAO_CLAIM_PATH,
  POOL_DOUBAO_MODELS_PATH,
  POOL_DOUBAO_QUOTA_PATH,
  POOL_DOUBAO_SESSION_PATH,
} from './status-paths.ts'
import { claimTasks, fetchCampaign } from './doubao-campaign.ts'
import { fetchAccountName } from './doubao-upstream.ts'
import { fetchLiveModels } from './doubao-catalog-live.ts'
import { browserLogin, readExistingSession, sessionUsable, type DoubaoSession } from './doubao-auth.ts'
import { fetchQuota } from './doubao-quota.ts'
import { setDoubaoSession } from './doubao-upstream.ts'

/** The routes' dependencies. */
export interface DoubaoRouteOptions {
  /** The stored session, read fresh on each request. */
  session: () => DoubaoSession | undefined
  /** Adopt a session that a sign-in produced. */
  save: (session: DoubaoSession) => void
  /** Forget the session. */
  clear: () => void
  /** The credit automation, so the card can read and flip it. */
  automation: () => DoubaoAutomation
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

/** Write a JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * Whether the request came from the host's own page.
 *
 * An ABSENT `Origin` is allowed and is the common case: only cross-origin requests carry the
 * header, so a same-origin request from the card sends none. Requiring it refused every call
 * the UI made — the paste arrived, was rejected `403` before any parsing ran, and the card
 * reported it as a bad cookie. A page in the user's browser driving this endpoint is
 * cross-origin by construction and always sends `Origin`, so the hostname check covers it.
 */
function loopbackOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  try {
    const url = new URL(origin)
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  } catch {
    return false
  }
}

/**
 * Mount the Doubao routes.
 *
 * The sign-in route answers `signedIn: false` rather than an error when the user closes the
 * window: "did not finish signing in" is an ordinary state, and the card says so.
 */
export function registerDoubaoRoutes(ctx: Context, deps: DoubaoRouteOptions): void {
  ctx.effect(() => {
    const disposeSession = ctx.webServer.register({
      kind: 'exact',
      path: POOL_DOUBAO_SESSION_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        try {
          if (req.method === 'DELETE') {
            deps.clear()
            setDoubaoSession(undefined)
            return json(res, 200, { ok: true, signedIn: false })
          }
          if (req.method === 'POST') {
            /**
             * Start an interactive sign-in, and answer when it lands or times out.
             *
             * The window stays open for the whole budget: a QR scan plus a phone confirmation
             * is a minute of a person's time, and cutting it short would make the lane look
             * broken to anyone who was simply slower than the timer.
             */
            const result = await browserLogin()
            if (!result.ok || result.session === undefined) {
              return json(res, 200, { ok: false, signedIn: false, message: result.reason ?? '登录失败' })
            }
            deps.save(result.session)
            setDoubaoSession(result.session)
            return json(res, 200, { ok: true, signedIn: true, message: '登录成功，会话已保存' })
          }
          if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
          /**
           * A read is not passive: the sign-in browser may be open and already signed into,
           * and the card asks every couple of seconds while the user finishes. Harvesting on
           * read is what turns that window into an account without the user pressing anything
           * twice.
           */
          const live = await readExistingSession()
          if (live !== undefined) {
            deps.save(live)
            setDoubaoSession(live)
            return json(res, 200, { ok: true, signedIn: true, savedAt: live.savedAt })
          }
          const stored = deps.session()
          if (!sessionUsable(stored)) {
            return json(res, 200, { ok: true, signedIn: false })
          }
          /**
           * The name travels with the session answer.
           *
           * The card needs it to label the account, and it is the only place the two are known
           * together — fetching it separately would double the card's round trips.
           */
          const name = await fetchAccountName(stored)
          return json(res, 200, {
            ok: true,
            signedIn: true,
            ...(name === undefined ? {} : { name }),
            ...(stored.savedAt === undefined ? {} : { savedAt: stored.savedAt }),
          })
        } catch (error: unknown) {
          return json(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })

    const disposeQuota = ctx.webServer.register({
      kind: 'exact',
      path: POOL_DOUBAO_QUOTA_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        const session = deps.session()
        if (session === undefined || !sessionUsable(session)) {
          return json(res, 200, { ok: false, signedIn: false, windows: [] })
        }
        try {
          setDoubaoSession(session)
          const quota = await fetchQuota({ force: true })
          return json(res, 200, {
            ok: quota.error === undefined,
            signedIn: true,
            exhausted: quota.exhausted,
            ...(quota.error === undefined ? {} : { error: quota.error }),
            windows: quota.windows,
          })
        } catch (error: unknown) {
          return json(res, 200, {
            ok: false,
            signedIn: true,
            windows: [],
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    })

    const disposeModels = ctx.webServer.register({
      kind: 'exact',
      path: POOL_DOUBAO_MODELS_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        /**
         * The same list the picker gets.
         *
         * The card used to render its own copy from the static catalogue, so a signed-in
         * account showed six models on the card and twelve in the picker. One route, one
         * answer.
         */
        try {
          const models = await fetchLiveModels(deps.session())
          // The rate and the window travel with the row: the card prints them, and neither is
          // available from any HTTP endpoint this lane can call.
          return json(res, 200, { ok: true, models })
        } catch (error: unknown) {
          return json(res, 200, {
            ok: false,
            models: [],
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    })

    const disposeCampaign = ctx.webServer.register({
      kind: 'exact',
      path: POOL_DOUBAO_CAMPAIGN_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        const session = deps.session()
        const campaign = await fetchCampaign(session)
        return json(res, 200, { ok: campaign.error === undefined, signedIn: session !== undefined, ...campaign })
      },
    })

    const disposeClaim = ctx.webServer.register({
      kind: 'exact',
      path: POOL_DOUBAO_CLAIM_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        const result = await claimTasks(deps.session())
        return json(res, 200, { ok: result.failed === 0, ...result })
      },
    })

    const disposeAutomation = ctx.webServer.register({
      kind: 'exact',
      path: POOL_DOUBAO_AUTOMATION_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        const automation = deps.automation()
        try {
          if (req.method === 'POST') {
            /**
             * `{ enabled }` flips the switch; an empty body runs one pass.
             *
             * Two actions, one route, because they are one concept to the card: the pane's
             * checkbox and its "run now" button both mean "make the automation do its job".
             */
            const body = await readJson(req)
            if (typeof body['enabled'] === 'boolean') {
              automation.setEnabled(body['enabled'])
              return json(res, 200, { ok: true, ...automation.state() })
            }
            const state = await automation.runOnce()
            return json(res, 200, { ok: true, ...state })
          }
          if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
          return json(res, 200, { ok: true, ...automation.state() })
        } catch (error: unknown) {
          return json(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })

    return () => {
      disposeSession()
      disposeQuota()
      disposeModels()
      disposeCampaign()
      disposeClaim()
      disposeAutomation()
    }
  })
}
