/**
 * The Doubao lane's routes: sign in, report the accounts, read their quota.
 *
 * WHY THESE LIVE HERE AND NOT IN THE PACK
 *
 * Every other channel's routes are provided by the vendored pack, which owns the credential
 * and the wire. Doubao has no pack adapter — one cookie jar per account is the whole lane — so
 * its calls are registered by this plugin, beside the others it already serves.
 *
 * THE SIGN-IN IS INTERACTIVE BY DESIGN
 *
 * Doubao's own QR entrance is closed (`2035 非法请求`), so there is nothing to poll. What
 * works is a real Chromium window: the user scans or enters a phone code, and the session is
 * harvested over the DevTools protocol. That is why `POST` opens a window rather than
 * returning a URL for the browser to open — the debugging port has to belong to the browser
 * that signs in, and only one this process started can promise that.
 *
 * ONE ACCOUNT PER SLOT (#171)
 *
 * A Chromium profile holds one signed-in account. Signing a second account into the same
 * profile overwrites the first account's `sessionid` INSIDE the browser, so the only way to
 * hold two jars is to open a second window on a second profile. `POST` therefore targets the
 * lowest free slot, and the harvest is filed against that slot — an account can only ever be
 * replaced by a sign-in that ran in ITS OWN window.
 *
 * @module dsh-xdpool/doubao-routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { originTrusted, type TrustedHosts } from './origin-trust.ts'
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
import { browserLogin, harvestSession, sessionUsable, type DoubaoSession } from './doubao-auth.ts'
import { fetchQuota, invalidateQuotaCache } from './doubao-quota.ts'
import type { DoubaoAccount, DoubaoRoster } from './doubao-roster.ts'

/** What one account looks like on the wire. */
export interface DoubaoAccountView {
  id: string
  /** The vendor's name for the user, when a read has succeeded. */
  name?: string
  /** A stable label for a row the name has not reached yet. */
  label: string
  /** The sign-in slot that owns this account's browser profile. */
  slot: number
  /** Epoch ms the jar was captured. */
  savedAt?: string
  /** False when the card's switch is off. */
  enabled: boolean
  /** True while the account is stepped aside, with the reason when there is one. */
  coolingDown: boolean
  cooldownReason?: string
}

/** The routes' dependencies. */
export interface DoubaoRouteOptions {
  /** The roster, read fresh on each request. */
  roster: () => DoubaoRoster
  /** Called after a sign-in adopted an account, so the caller can persist. */
  save: () => void
  /** Forget one account, or all of them when no id is given. */
  clear: (id?: string) => void
  /** Turn one account's switch on or off, and persist it. */
  setEnabled: (id: string, enabled: boolean) => void
  /** The credit automation, so the card can read and flip it. */
  automation: () => DoubaoAutomation
  /** The authorities this deployment serves, so a proxied UI can sign in — see `origin-trust.ts`. */
  trustedHosts?: () => TrustedHosts
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

/** A row label that does not pretend to be a name: the vendor's is fetched separately. */
function labelOf(account: DoubaoAccount, index: number): string {
  if (account.name !== undefined && account.name !== '') return account.name
  return `豆包账号 ${String(index + 1)}`
}

/** The wire shape of one account. */
function viewOf(roster: DoubaoRoster, account: DoubaoAccount, index: number): DoubaoAccountView {
  const health = roster.healthOf(account.id)
  return {
    id: account.id,
    ...(account.name === undefined || account.name === '' ? {} : { name: account.name }),
    label: labelOf(account, index),
    slot: account.slot,
    enabled: account.disabled !== true,
    coolingDown: health.coolingDown,
    ...(health.message === undefined ? {} : { cooldownReason: health.message }),
    ...(account.session.savedAt === undefined ? {} : { savedAt: account.session.savedAt }),
  }
}

/** Every account as the card draws it. */
function accountsView(roster: DoubaoRoster): DoubaoAccountView[] {
  return roster.list().map((account, index) => viewOf(roster, account, index))
}

/**
 * Resolve the account a request is about.
 *
 * An explicit `?account=` (or body field) wins, so the card can act on one row. Without it the
 * FIRST usable account answers, which keeps an existing single-account caller working and is
 * what the quota panel means when it shows one figure.
 */
function accountFor(roster: DoubaoRoster, id: string | null | undefined): DoubaoAccount | undefined {
  if (typeof id === 'string' && id !== '') {
    return roster.list().find(account => account.id === id)
  }
  return roster.list()[0]
}

/** The query string's `account` value. */
function accountParam(req: IncomingMessage): string | undefined {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const value = url.searchParams.get('account')
  return value === null || value === '' ? undefined : value
}

/**
 * Mount the Doubao routes.
 *
 * The sign-in route answers `signedIn: false` rather than an error when the user closes the
 * window: "did not finish signing in" is an ordinary state, and the card says so.
 */
export function registerDoubaoRoutes(ctx: Context, deps: DoubaoRouteOptions): void {
  ctx.effect(() => {
    /**
     * One sign-in at a time, per process.
     *
     * Two concurrent `POST`s would open two windows and both write a session; the second would
     * land on whichever slot it was assigned, which is harmless — but the card's button would
     * also double-fire and the user would see two windows for one click. The lock is a
     * coalescing one: the second caller waits for the first instead of being refused.
     */
    let signing: Promise<{ ok: boolean; signedIn: boolean; message?: string; account?: DoubaoAccountView }> | undefined

    const runSignIn = async (): Promise<{ ok: boolean; signedIn: boolean; message?: string; account?: DoubaoAccountView }> => {
      const roster = deps.roster()
      const slot = roster.freeSlot()
      const result = await browserLogin({ slot })
      if (!result.ok || result.session === undefined) {
        return { ok: false, signedIn: false, ...(result.reason === undefined ? {} : { message: result.reason }) }
      }
      const adopted = roster.adopt({ session: result.session, slot })
      // A fresh jar invalidates whatever the old one had rotated onto us, or the stale values
      // would overwrite the new cookies on the very next request.
      invalidateQuotaCache(adopted.session)
      deps.save()
      /**
       * The name is read HERE, before answering.
       *
       * The card labels a row with it, and a row that says "豆包账号 2" for a minute after a
       * successful sign-in reads as a failed read. One request, already authenticated by the
       * jar that just arrived.
       */
      const name = await fetchAccountName(adopted.session)
      if (name !== undefined) {
        roster.setName(adopted.id, name)
        deps.save()
      }
      const updated = roster.get(adopted.id) ?? adopted
      const index = roster.list().findIndex(account => account.id === adopted.id)
      return {
        ok: true,
        signedIn: true,
        message: '登录成功，会话已保存',
        account: viewOf(roster, updated, index < 0 ? 0 : index),
      }
    }

    const disposeSession = ctx.webServer.register({
      kind: 'exact',
      path: POOL_DOUBAO_SESSION_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!originTrusted(req, deps.trustedHosts?.() ?? [])) return json(res, 403, { error: 'origin-not-trusted' })
        try {
          /**
           * `DELETE` forgets ONE account, or every account when no id is given.
           *
           * Removing one must not sign the others out: that was the single-account
           * assumption showing through, and with two accounts it meant deleting the second one
           * silently killed the first (#171).
           */
          if (req.method === 'DELETE') {
            const body = await readJson(req)
            const fromQuery = accountParam(req)
            const fromBody = typeof body['account'] === 'string' && body['account'] !== ''
              ? body['account']
              : undefined
            const id = fromQuery ?? fromBody
            deps.clear(id)
            return json(res, 200, { ok: true, signedIn: deps.roster().list().length > 0 })
          }
          if (req.method === 'POST') {
            /**
             * Start an interactive sign-in, and answer when it lands or times out.
             *
             * The window stays open for the whole budget: a QR scan plus a phone confirmation
             * is a minute of a person's time, and cutting it short would make the lane look
             * broken to anyone who was simply slower than the timer.
             */
            signing ??= runSignIn().finally(() => { signing = undefined })
            const result = await signing
            return json(res, 200, result)
          }
          /**
           * `PATCH` flips one account's switch.
           *
           * It lives on this route rather than on a second path because the thing being
           * toggled IS the session's owner: a Doubao account has no separate enable flag in any
           * store, so the row's switch is a property of the roster entry. The card's per-row
           * "disable" was answering `account.update` before, which the pack refused for a
           * provider it has no adapter for.
           */
          if (req.method === 'PATCH') {
            const body = await readJson(req)
            const id = accountParam(req)
              ?? (typeof body['account'] === 'string' && body['account'] !== '' ? body['account'] : undefined)
            if (id === undefined) return json(res, 400, { error: 'account is required' })
            if (typeof body['enabled'] !== 'boolean') return json(res, 400, { error: 'enabled is required' })
            if (deps.roster().get(id) === undefined) return json(res, 404, { error: 'unknown account' })
            deps.setEnabled(id, body['enabled'])
            return json(res, 200, { ok: true, accounts: accountsView(deps.roster()) })
          }
          if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })

          /**
           * A read harvests any open sign-in window, per slot.
           *
           * The card asks every couple of seconds while the user finishes a scan, and the
           * harvest is what turns that window into an account without the user pressing
           * anything twice. It is SLOT-SCOPED on purpose: harvesting "whatever answers on the
           * port" is how a stale window used to replace a working account.
           *
           * CONCURRENT and bounded: one slot's four-second CDP timeout must not be paid once per
           * account on a poll that runs every couple of seconds. `harvestSession` already
           * answers undefined when nothing is listening, so there is no separate liveness probe
           * — a second round trip would only double the cost of the ordinary "no window" case.
           */
          const roster = deps.roster()
          const harvested = await Promise.all(roster.list().map(async account => {
            const live = await harvestSession(account.slot)
            return live === undefined ? undefined : { account, live }
          }))
          let adopted = false
          for (const hit of harvested) {
            if (hit === undefined) continue
            roster.adopt({
              session: hit.live,
              slot: hit.account.slot,
              ...(hit.account.name === undefined ? {} : { name: hit.account.name }),
            })
            invalidateQuotaCache(hit.live)
            adopted = true
          }
          if (adopted) deps.save()
          const first = roster.list()[0]
          /**
           * The name of the account the card shows first, fetched only when it is MISSING.
           *
           * It travels with the session answer because the card needs it to label the row, and
           * this is the only place the two are known together — fetching it separately would
           * double the card's round trips. The guard matters because this route is polled every
           * couple of seconds during a sign-in: a name that is already known must not cost an
           * upstream request per poll, and every account after the first gets its name from its
           * own sign-in.
           */
          if (first !== undefined && (first.name === undefined || first.name === '')) {
            const name = await fetchAccountName(first.session)
            if (name !== undefined) {
              roster.setName(first.id, name)
              deps.save()
            }
          }
          const accounts = accountsView(roster)
          return json(res, 200, {
            ok: true,
            signedIn: accounts.length > 0,
            accounts,
            ...(first?.name === undefined ? {} : { name: first.name }),
            ...(first?.session.savedAt === undefined ? {} : { savedAt: first.session.savedAt }),
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
        if (!originTrusted(req, deps.trustedHosts?.() ?? [])) return json(res, 403, { error: 'origin-not-trusted' })
        const roster = deps.roster()
        const wanted = accountParam(req)
        /**
         * One account answers this call, and WHICH one is the caller's choice.
         *
         * `?all=1` reads every account, which is what the card needs to put a figure on each
         * row; a single account is the old shape and still the default, so a caller that has
         * not been taught about the roster keeps working.
         */
        const all = new URL(req.url ?? '/', 'http://localhost').searchParams.get('all')
        if (all === '1') {
          const readings: Record<string, unknown> = {}
          await Promise.all(roster.list().map(async account => {
            if (!sessionUsable(account.session)) return
            /**
             * NOT forced: this is the page-load read, and it runs for every account. A forced
             * read per row would put one upstream round trip per account on the critical path
             * of every card render — the cached reading is what makes a pool of five accounts
             * cost the same as one.
             */
            const quota = await fetchQuota({ session: account.session })
            readings[account.id] = {
              ok: quota.error === undefined,
              exhausted: quota.exhausted,
              ...(quota.error === undefined ? {} : { error: quota.error }),
              windows: quota.windows,
            }
          }))
          return json(res, 200, { ok: true, signedIn: roster.list().length > 0, accounts: readings })
        }
        const account = accountFor(roster, wanted)
        if (account === undefined || !sessionUsable(account.session)) {
          return json(res, 200, { ok: false, signedIn: false, windows: [] })
        }
        try {
          const quota = await fetchQuota({ force: true, session: account.session })
          return json(res, 200, {
            ok: quota.error === undefined,
            signedIn: true,
            accountId: account.id,
            exhausted: quota.exhausted,
            ...(quota.error === undefined ? {} : { error: quota.error }),
            windows: quota.windows,
          })
        } catch (error: unknown) {
          return json(res, 200, {
            ok: false,
            signedIn: true,
            accountId: account.id,
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
        if (!originTrusted(req, deps.trustedHosts?.() ?? [])) return json(res, 403, { error: 'origin-not-trusted' })
        /**
         * The same list the picker gets.
         *
         * The card used to render its own copy from the static catalogue, so a signed-in
         * account showed six models on the card and twelve in the picker. One route, one
         * answer.
         */
        try {
          const account = accountFor(deps.roster(), accountParam(req))
          const models = await fetchLiveModels(account?.session)
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
        if (!originTrusted(req, deps.trustedHosts?.() ?? [])) return json(res, 403, { error: 'origin-not-trusted' })
        const account = accountFor(deps.roster(), accountParam(req))
        const campaign = await fetchCampaign(account?.session)
        return json(res, 200, {
          ok: campaign.error === undefined,
          signedIn: account !== undefined,
          ...(account === undefined ? {} : { accountId: account.id }),
          ...campaign,
        })
      },
    })

    const disposeClaim = ctx.webServer.register({
      kind: 'exact',
      path: POOL_DOUBAO_CLAIM_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!originTrusted(req, deps.trustedHosts?.() ?? [])) return json(res, 403, { error: 'origin-not-trusted' })
        /**
         * Claim for ONE account, or for every account when none is named.
         *
         * The card's row button names its account, and the pane's "run now" leaves it out —
         * both mean "collect what is waiting", and iterating here is what makes the second
         * account's rewards reachable at all.
         */
        const roster = deps.roster()
        const wanted = accountParam(req)
        const targets = wanted === undefined
          ? roster.list()
          : roster.list().filter(account => account.id === wanted)
        if (targets.length === 0) return json(res, 200, { ok: false, claimed: 0, failed: 0, reason: '还没有登录态' })
        let claimed = 0
        let failed = 0
        let reason: string | undefined
        for (const account of targets) {
          const result = await claimTasks(account.session)
          claimed += result.claimed
          failed += result.failed
          reason ??= result.reason
        }
        return json(res, 200, {
          ok: failed === 0,
          claimed,
          failed,
          ...(reason === undefined ? {} : { reason }),
        })
      },
    })

    const disposeAutomation = ctx.webServer.register({
      kind: 'exact',
      path: POOL_DOUBAO_AUTOMATION_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!originTrusted(req, deps.trustedHosts?.() ?? [])) return json(res, 403, { error: 'origin-not-trusted' })
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

/** One account's session, for the callers that need a bare session rather than a view. */
export function sessionOf(roster: DoubaoRoster, id: string | undefined): DoubaoSession | undefined {
  return id === undefined ? roster.list()[0]?.session : roster.get(id)?.session
}
