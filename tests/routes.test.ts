/**
 * Route-registration tests.
 *
 * A route that is registered inside the teardown closure looks perfect in
 * review and in every unit test that calls the handler directly — it just never
 * mounts. The card then gets an empty response and reports a JSON parse error,
 * which is a long way from "the code is in the wrong block".
 *
 * So these tests assert the one thing that actually broke: after the routes are
 * mounted, each mutating endpoint is present in the route table.
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorkBuddyAccountPool } from '../src/accounts.ts'
import { WorkBuddyCatalog } from '../src/catalog.ts'
import {
  POOL_ACCOUNT_DISABLE_PATH,
  POOL_ACCOUNT_PREFER_PATH,
  POOL_AUTOMATION_RUN_PATH,
  POOL_CHANNEL_MODELS_PATH,
  POOL_CHECKIN_PATH,
  POOL_CREDIT_RESERVE_PATH,
  POOL_CREDITS_TODAY_PATH,
  POOL_MODEL_PROBE_PATH,
  POOL_RESCAN_PATH,
  POOL_RESET_COOLDOWN_PATH,
  POOL_STATUS_PATH,
} from '../src/status-paths.ts'
import type {
  PoolWebChannelModel,
  PoolWebModelProbeResult,
} from '../src/status-paths.ts'
import { WorkBuddyUpstreamClient } from '../src/upstream.ts'
import { registerPoolStatusRoute } from '../src/web-status.ts'

/** Write a fake auth directory holding `count` accounts. */
async function fakeAuthDir(count: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wbp-routes-'))
  const auth = join(dir, 'auth')
  await mkdir(auth, { recursive: true })
  for (let i = 0; i < count; i += 1) {
    const document = {
      auth: {
        accessToken: `token-${i}`,
        refreshToken: `refresh-${i}`,
        expiresAt: Date.now() + 3_600_000,
        refreshExpiresAt: Date.now() + 30 * 24 * 3_600_000,
        domain: '',
      },
      account: { uid: `uid-${i}-${'0'.repeat(24)}`, uin: `10000000000${i}`, nickname: `Account${i}` },
    }
    const name = i === 0 ? 'workbuddy-desktop.info' : `workbuddy-desktop.r.${i}.uuid.info`
    await writeFile(join(auth, name), JSON.stringify(document), 'utf8')
  }
  return auth
}

/** A context stand-in that records every registration, plus the mount-time disposers. */
function fakeContext(routes: Map<string, unknown>): { ctx: unknown; disposers: (() => void)[] } {
  const disposers: (() => void)[] = []
  return {
    disposers,
    ctx: {
      effect(fn: () => unknown) {
        // Real cordis runs the effect body at mount and keeps its returned
        // disposer. Calling `fn()` here is what makes the routes actually
        // register, which is precisely the behaviour under test.
        const result = fn()
        if (typeof result === 'function') disposers.push(result as () => void)
        return () => {}
      },
      webServer: {
        register(entry: { path: string; handler: unknown }) {
          routes.set(entry.path, entry.handler)
          return () => { routes.delete(entry.path) }
        },
      },
    },
  }
}

/** Mount the routes over a scanned pool and hand back the route table. */
async function mount(accounts = 1): Promise<Map<string, unknown>> {
  const pool = new WorkBuddyAccountPool({ authDirs: [await fakeAuthDir(accounts)], logger: { warn() {} } })
  await pool.scan()
  const routes = new Map<string, unknown>()
  const { ctx } = fakeContext(routes)
  registerPoolStatusRoute(ctx as never, {
    pool,
    catalogs: { cn: new WorkBuddyCatalog(), global: new WorkBuddyCatalog() },
    client: new WorkBuddyUpstreamClient(),
    saveSelection() {},
    setAccountDisabled() {},
    setCreditReserve() {},
    runAutomation: async () => ({ ok: 1, failed: 0, credit: 0, energy: 0, claimed: 0 }),
  })
  return routes
}

describe('pool card route table', () => {
  it('registers every route the card calls', async () => {
    const routes = await mount()
    // The read path.
    expect(routes.has(POOL_STATUS_PATH)).toBe(true)
    // Every mutating endpoint. These are the ones that vanish silently when a
    // registration lands in the teardown closure instead of at mount time.
    for (const path of [
      POOL_RESCAN_PATH,
      POOL_RESET_COOLDOWN_PATH,
      POOL_CHECKIN_PATH,
      POOL_ACCOUNT_DISABLE_PATH,
      POOL_AUTOMATION_RUN_PATH,
      POOL_CREDIT_RESERVE_PATH,
      POOL_ACCOUNT_PREFER_PATH,
      POOL_MODEL_PROBE_PATH,
      POOL_CHANNEL_MODELS_PATH,
    ]) {
      expect(routes.has(path), `${path} should be registered`).toBe(true)
    }
  })

  it('accepts a manual automation run and answers with the job result', async () => {
    const routes = await mount()
    const handler = routes.get(POOL_AUTOMATION_RUN_PATH) as (req: unknown, res: unknown) => Promise<void>
    expect(typeof handler).toBe('function')

    const res = {
      status: 0,
      body: undefined as unknown,
      writeHead(status: number) { this.status = status },
      end(payload: string) { this.body = JSON.parse(payload) },
    }
    const req = {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      on(event: string, listener: (arg?: unknown) => void) {
        if (event === 'data') setTimeout(() => { listener(Buffer.from(JSON.stringify({ job: 'tasks' }), 'utf8')) }, 0)
        if (event === 'end') setTimeout(() => { listener() }, 1)
        return req
      },
      destroy() {},
    }
    await handler(req, res)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, job: 'tasks' })
  })

  it('rejects an unknown automation job with 400 rather than running nothing', async () => {
    const routes = await mount()
    const handler = routes.get(POOL_AUTOMATION_RUN_PATH) as (req: unknown, res: unknown) => Promise<void>
    const res = {
      status: 0,
      body: undefined as unknown,
      writeHead(status: number) { this.status = status },
      end(payload: string) { this.body = JSON.parse(payload) },
    }
    const req = {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      on(event: string, listener: (arg?: unknown) => void) {
        if (event === 'data') setTimeout(() => { listener(Buffer.from(JSON.stringify({ job: 'nonsense' }), 'utf8')) }, 0)
        if (event === 'end') setTimeout(() => { listener() }, 1)
        return req
      },
      destroy() {},
    }
    await handler(req, res)
    expect(res.status).toBe(400)
  })

  it('answers a non-POST with 405', async () => {
    const routes = await mount()
    const handler = routes.get(POOL_CREDIT_RESERVE_PATH) as (req: unknown, res: unknown) => Promise<void>
    const res = {
      status: 0,
      body: undefined as unknown,
      writeHead(status: number) { this.status = status },
      end(payload: string) { this.body = JSON.parse(payload) },
    }
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, on() {}, destroy() {} }, res)
    expect(res.status).toBe(405)
  })
})

/**
 * The prefer route's own contract.
 *
 * It gets its own block because "the pin survives" is only true if BOTH halves
 * are right: the parser has to reject ids nothing can show, and the handler has
 * to reach the dependency that writes the file. A route registered but never
 * wired answers 503, which the card reports as a broken button — so the unwired
 * case is asserted as its own behaviour rather than left untested.
 */
describe('the prefer route', () => {
  /** Mount with an optional dep, so "wired" and "unwired" are both reachable. */
  async function mountPrefer(
    setPreferredAccount?: (accountId: string | null) => Promise<void> | void,
  ): Promise<Map<string, unknown>> {
    const pool = new WorkBuddyAccountPool({ authDirs: [await fakeAuthDir(2)], logger: { warn() {} } })
    await pool.scan()
    const routes = new Map<string, unknown>()
    const { ctx } = fakeContext(routes)
    registerPoolStatusRoute(ctx as never, {
      pool,
      catalogs: { cn: new WorkBuddyCatalog(), global: new WorkBuddyCatalog() },
      client: new WorkBuddyUpstreamClient(),
      saveSelection() {},
      setCreditReserve() {},
      ...setPreferredAccount === undefined ? {} : { setPreferredAccount },
    })
    return routes
  }

  /** A fake request carrying `body` as JSON, from the loopback origin. */
  function postReq(body: unknown): unknown {
    const req = {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      on(event: string, listener: (arg?: unknown) => void) {
        if (event === 'data') setTimeout(() => { listener(Buffer.from(JSON.stringify(body), 'utf8')) }, 0)
        if (event === 'end') setTimeout(() => { listener() }, 1)
        return req
      },
      destroy() {},
    }
    return req
  }

  function fakeRes(): { res: unknown; read: () => { status: number; body: Record<string, unknown> } } {
    const state = { status: 0, body: undefined as unknown }
    const res = {
      writeHead(status: number) { state.status = status },
      end(payload: string) { state.body = JSON.parse(payload) },
    }
    return { res, read: () => ({ status: state.status, body: state.body as Record<string, unknown> }) }
  }

  it('answers 503 when the host wired no writer, rather than pretending to pin', async () => {
    const routes = await mountPrefer()
    const handler = routes.get(POOL_ACCOUNT_PREFER_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    await handler(postReq({ accountId: 'acct-1' }), res)
    expect(read().status).toBe(503)
  })

  it('forwards a pin and a clear to the writer, unchanged', async () => {
    const seen: (string | null)[] = []
    const routes = await mountPrefer((accountId) => { seen.push(accountId) })
    const handler = routes.get(POOL_ACCOUNT_PREFER_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    // A clear is `null`, not a sentinel string: the host decides what a stale id
    // means, and the card must not have to guess a magic value for "nothing".
    await handler(postReq({ accountId: null }), res)
    expect(read().status).toBe(200)
    expect(seen).toEqual([null])
  })

  it('rejects an id the pool cannot show, so the file holds no orphans', async () => {
    const seen: (string | null)[] = []
    const routes = await mountPrefer((accountId) => { seen.push(accountId) })
    const handler = routes.get(POOL_ACCOUNT_PREFER_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    await handler(postReq({ accountId: 'not-a-real-account' }), res)
    expect(read().status).toBe(400)
    expect(seen).toEqual([])
  })

  it('refuses GET, because a stray prefetch would pin an account', async () => {
    const routes = await mountPrefer()
    const handler = routes.get(POOL_ACCOUNT_PREFER_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, on() {}, destroy() {} }, res)
    expect(read().status).toBe(405)
  })

  it('refuses a foreign origin, so a page on the LAN cannot choose the account', async () => {
    const routes = await mountPrefer()
    const handler = routes.get(POOL_ACCOUNT_PREFER_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    const req = postReq({ accountId: null }) as { headers: Record<string, string>; method: string }
    req.headers['origin'] = 'http://192.168.1.50:3000'
    await handler(req, res)
    expect(read().status).toBe(403)
  })

  it('unregisters with the rest of the table', async () => {
    const pool = new WorkBuddyAccountPool({ authDirs: [await fakeAuthDir(1)], logger: { warn() {} } })
    await pool.scan()
    const routes = new Map<string, unknown>()
    const { ctx, disposers } = fakeContext(routes)
    registerPoolStatusRoute(ctx as never, {
      pool,
      catalogs: { cn: new WorkBuddyCatalog(), global: new WorkBuddyCatalog() },
      client: new WorkBuddyUpstreamClient(),
      saveSelection() {},
      setCreditReserve() {},
    })
    expect(routes.has(POOL_ACCOUNT_PREFER_PATH)).toBe(true)
    for (const dispose of disposers) dispose()
    expect(routes.has(POOL_ACCOUNT_PREFER_PATH)).toBe(false)
  })
})

/**
 * The two per-model routes the three model pages share.
 *
 * Both are POST-only on purpose. The probe is the only thing in this plugin
 * that spends the user's own quota, so a GET would let a prefetch -- or someone
 * walking URLs on the LAN -- burn it. The channel-model read is the same shape
 * for the same reason: it walks the host's adapter registry once per id.
 */
describe('the per-model routes', () => {
  /** Mount with whichever deps a case needs, so "wired" and "unwired" are both reachable. */
  async function mountModels(deps: {
    probeModel?: (provider: string, model: string, signal?: AbortSignal) => Promise<PoolWebModelProbeResult>
    channelModels?: (providers: readonly string[]) => Promise<Readonly<Record<string, readonly PoolWebChannelModel[]>>>
  }): Promise<Map<string, unknown>> {
    const pool = new WorkBuddyAccountPool({ authDirs: [await fakeAuthDir(1)], logger: { warn() {} } })
    await pool.scan()
    const routes = new Map<string, unknown>()
    const { ctx } = fakeContext(routes)
    registerPoolStatusRoute(ctx as never, {
      pool,
      catalogs: { cn: new WorkBuddyCatalog(), global: new WorkBuddyCatalog() },
      client: new WorkBuddyUpstreamClient(),
      saveSelection() {},
      setCreditReserve() {},
      ...deps,
    })
    return routes
  }

  function postReq(body: unknown, origin = 'http://localhost:3000'): unknown {
    const req = {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      on(event: string, listener: (arg?: unknown) => void) {
        if (event === 'data') setTimeout(() => { listener(Buffer.from(JSON.stringify(body), 'utf8')) }, 0)
        if (event === 'end') setTimeout(() => { listener() }, 1)
        return req
      },
      destroy() {},
    }
    return req
  }

  function fakeRes(): { res: unknown; read: () => { status: number; body: Record<string, unknown> } } {
    const state = { status: 0, body: undefined as unknown }
    const res = {
      writeHead(status: number) { state.status = status },
      end(payload: string) { state.body = JSON.parse(payload) },
    }
    return { res, read: () => ({ status: state.status, body: state.body as Record<string, unknown> }) }
  }

  it('measures a model only when the host wired a probe', async () => {
    const seen: [string, string][] = []
    const routes = await mountModels({
      probeModel: async (provider, model) => {
        seen.push([provider, model])
        return { ok: true, firstFrameMs: 412, outputChars: 5 }
      },
    })
    const handler = routes.get(POOL_MODEL_PROBE_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    await handler(postReq({ provider: 'xdpool', model: 'deepseek-v3' }), res)
    expect(read().status).toBe(200)
    // The pair goes through exactly as the row spelled it: only the host knows
    // which credential and endpoint a given provider id resolves to.
    expect(seen).toEqual([['xdpool', 'deepseek-v3']])
    expect(read().body).toEqual({ ok: true, firstFrameMs: 412, outputChars: 5 })
  })

  it('reports the probe as unavailable rather than pretending a model failed', async () => {
    // "This build cannot measure" and "this model did not answer" are different
    // sentences, and only the second one should ever make a user distrust a key.
    const routes = await mountModels({})
    const handler = routes.get(POOL_MODEL_PROBE_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    await handler(postReq({ provider: 'x', model: 'y' }), res)
    expect(read().status).toBe(503)
  })

  it('answers a probe failure as a 200 with the failure inside it', async () => {
    // The route succeeded; the measurement is what failed. Turning that into a
    // 500 would make the card's error branch unreachable for the case it exists.
    const routes = await mountModels({
      probeModel: async () => ({ ok: false, outputChars: 0, error: 'the model returned no output' }),
    })
    const handler = routes.get(POOL_MODEL_PROBE_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    await handler(postReq({ provider: 'x', model: 'y' }), res)
    expect(read().status).toBe(200)
    expect(read().body).toEqual({ ok: false, outputChars: 0, error: 'the model returned no output' })
  })

  it('refuses a probe body that names no model', async () => {
    const routes = await mountModels({ probeModel: async () => ({ ok: true, outputChars: 1 }) })
    const handler = routes.get(POOL_MODEL_PROBE_PATH) as (req: unknown, res: unknown) => Promise<void>
    for (const body of [{}, { provider: 'x' }, { model: 'y' }, { provider: 1, model: 'y' }, { provider: '  ', model: 'y' }]) {
      const { res, read } = fakeRes()
      await handler(postReq(body), res)
      expect(read().status, JSON.stringify(body)).toBe(400)
    }
  })

  it('probes a model that is not in any roster, because that is often the question', async () => {
    // No membership check on purpose: the most useful thing to measure is a
    // model that has just been published upstream and is not selectable yet.
    const seen: [string, string][] = []
    const routes = await mountModels({
      probeModel: async (provider, model) => { seen.push([provider, model]); return { ok: true, outputChars: 1 } },
    })
    const handler = routes.get(POOL_MODEL_PROBE_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    await handler(postReq({ provider: 'zcode', model: 'brand-new-1' }), res)
    expect(read().status).toBe(200)
    expect(seen).toEqual([['zcode', 'brand-new-1']])
  })

  it('refuses GET on the probe, so a prefetch cannot spend the quota', async () => {
    const routes = await mountModels({ probeModel: async () => ({ ok: true, outputChars: 1 }) })
    const handler = routes.get(POOL_MODEL_PROBE_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, on() {}, destroy() {} }, res)
    expect(read().status).toBe(405)
  })

  it('refuses a foreign origin on both routes', async () => {
    const routes = await mountModels({
      probeModel: async () => ({ ok: true, outputChars: 1 }),
      channelModels: async () => ({}),
    })
    for (const path of [POOL_MODEL_PROBE_PATH, POOL_CHANNEL_MODELS_PATH]) {
      const handler = routes.get(path) as (req: unknown, res: unknown) => Promise<void>
      const { res, read } = fakeRes()
      await handler(postReq({ provider: 'x', model: 'y', providers: ['x'] }, 'http://192.168.1.50:3000'), res)
      expect(read().status, path).toBe(403)
    }
  })

  it('asks the host about exactly the providers it was given', async () => {
    const seen: (readonly string[])[] = []
    const routes = await mountModels({
      channelModels: async (providers) => { seen.push(providers); return { gemini: [{ id: 'gemini-3', name: 'Gemini 3' }] } },
    })
    const handler = routes.get(POOL_CHANNEL_MODELS_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    await handler(postReq({ providers: ['gemini', 'codearts'] }), res)
    expect(read().status).toBe(200)
    expect(seen).toEqual([['gemini', 'codearts']])
    expect(read().body).toEqual({ models: { gemini: [{ id: 'gemini-3', name: 'Gemini 3' }] } })
  })

  it('collapses a repeated provider rather than asking about it twice', async () => {
    // A page that merges two lists will produce a duplicate. Refusing it would
    // fail for a reason the user cannot see and cannot act on.
    const seen: (readonly string[])[] = []
    const routes = await mountModels({
      channelModels: async (providers) => { seen.push(providers); return {} },
    })
    const handler = routes.get(POOL_CHANNEL_MODELS_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    await handler(postReq({ providers: ['gemini', ' gemini ', 'gemini'] }), res)
    expect(read().status).toBe(200)
    expect(seen).toEqual([['gemini']])
  })

  it('answers an empty roster with an empty document rather than a rejection', async () => {
    // A page with nothing signed in has nothing to ask about, and that is a
    // normal state rather than a malformed request.
    const routes = await mountModels({ channelModels: async () => ({}) })
    const handler = routes.get(POOL_CHANNEL_MODELS_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    await handler(postReq({ providers: [] }), res)
    expect(read().status).toBe(200)
    expect(read().body).toEqual({ models: {} })
  })

  it('refuses a roster long enough to be an amplifier', async () => {
    // Each id costs one walk of the host's adapter registry. The login roster
    // is thirteen rows, so a thousand is not a page that forgot to slice.
    const routes = await mountModels({ channelModels: async () => ({}) })
    const handler = routes.get(POOL_CHANNEL_MODELS_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    const many = Array.from({ length: 33 }, (_, index) => `p${index}`)
    await handler(postReq({ providers: many }), res)
    expect(read().status).toBe(400)
  })

  it('rejects a roster that is not a list of strings', async () => {
    const routes = await mountModels({ channelModels: async () => ({}) })
    const handler = routes.get(POOL_CHANNEL_MODELS_PATH) as (req: unknown, res: unknown) => Promise<void>
    for (const body of [{}, { providers: 'gemini' }, { providers: [1] }, { providers: null }]) {
      const { res, read } = fakeRes()
      await handler(postReq(body), res)
      expect(read().status, JSON.stringify(body)).toBe(400)
    }
  })

  it('surfaces a throwing host rather than answering with an empty document', async () => {
    // An empty document is a claim: "these channels have no models". A route
    // failure is not that claim, so it must not be dressed as one.
    const routes = await mountModels({
      channelModels: async () => { throw new Error('registry is down') },
    })
    const handler = routes.get(POOL_CHANNEL_MODELS_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    await handler(postReq({ providers: ['gemini'] }), res)
    expect(read().status).toBe(500)
  })

  it('reports the channel models as unavailable when no pack is mounted', async () => {
    const routes = await mountModels({})
    const handler = routes.get(POOL_CHANNEL_MODELS_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    await handler(postReq({ providers: ['gemini'] }), res)
    expect(read().status).toBe(503)
  })

  it('unregisters both with the rest of the table', async () => {
    const pool = new WorkBuddyAccountPool({ authDirs: [await fakeAuthDir(1)], logger: { warn() {} } })
    await pool.scan()
    const routes = new Map<string, unknown>()
    const { ctx, disposers } = fakeContext(routes)
    registerPoolStatusRoute(ctx as never, {
      pool,
      catalogs: { cn: new WorkBuddyCatalog(), global: new WorkBuddyCatalog() },
      client: new WorkBuddyUpstreamClient(),
      saveSelection() {},
      setCreditReserve() {},
      probeModel: async () => ({ ok: true, outputChars: 1 }),
      channelModels: async () => ({}),
    })
    for (const path of [POOL_MODEL_PROBE_PATH, POOL_CHANNEL_MODELS_PATH]) {
      expect(routes.has(path), path).toBe(true)
    }
    for (const dispose of disposers) dispose()
    for (const path of [POOL_MODEL_PROBE_PATH, POOL_CHANNEL_MODELS_PATH]) {
      expect(routes.has(path), path).toBe(false)
    }
  })
})

/**
 * The measured day total, which the composer strip prefers over its own estimate.
 *
 * GET-only: it reads a file another plugin keeps updated, so there is nothing to protect
 * from a prefetch -- but a POST has no meaning here, and a route that answers one is a
 * route that will eventually be called with a body nobody validated.
 */
describe('the measured credit day route', () => {
  /** Mount with the reader wired or not, so both the 200 and the 503 are reachable. */
  async function mountToday(
    creditsToday?: () => Promise<{ day: string; total?: number; accounts: number; source: 'cost-meter'; available: boolean }>,
  ): Promise<Map<string, unknown>> {
    const pool = new WorkBuddyAccountPool({ authDirs: [await fakeAuthDir(1)], logger: { warn() {} } })
    await pool.scan()
    const routes = new Map<string, unknown>()
    const { ctx } = fakeContext(routes)
    registerPoolStatusRoute(ctx as never, {
      pool,
      catalogs: { cn: new WorkBuddyCatalog(), global: new WorkBuddyCatalog() },
      client: new WorkBuddyUpstreamClient(),
      saveSelection() {},
      setCreditReserve() {},
      ...creditsToday === undefined ? {} : { creditsToday },
    })
    return routes
  }

  function getReq(origin?: string): unknown {
    return {
      method: 'GET',
      headers: origin === undefined ? {} : { origin },
      on() {},
      destroy() {},
    }
  }

  function fakeRes(): { res: unknown; read: () => { status: number; body: Record<string, unknown> } } {
    const state = { status: 0, body: undefined as unknown }
    const res = {
      writeHead(status: number) { state.status = status },
      end(payload: string) { state.body = JSON.parse(payload) },
    }
    return { res, read: () => ({ status: state.status, body: state.body as Record<string, unknown> }) }
  }

  it('answers with the day document the reader produced', async () => {
    const routes = await mountToday(async () => ({
      day: '2026-11-14', total: 86, accounts: 4, source: 'cost-meter', available: true,
    }))
    const handler = routes.get(POOL_CREDITS_TODAY_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    await handler(getReq('http://localhost:3000'), res)
    expect(read().status).toBe(200)
    expect(read().body).toEqual({
      day: '2026-11-14', total: 86, accounts: 4, source: 'cost-meter', available: true,
    })
  })

  it('passes `available: false` through, rather than turning it into a zero', async () => {
    // The whole point of the route: "nothing recorded the day" is an answer the panel
    // renders as a sentence, and a zero would make it print a measured 0 instead.
    const routes = await mountToday(async () => ({
      day: '2026-11-14', accounts: 0, source: 'cost-meter', available: false,
    }))
    const handler = routes.get(POOL_CREDITS_TODAY_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    await handler(getReq(), res)
    expect(read().status).toBe(200)
    expect(read().body['available']).toBe(false)
    expect(read().body['total']).toBeUndefined()
  })

  it('answers 503 when the host wired no reader, rather than an empty day', async () => {
    const routes = await mountToday()
    const handler = routes.get(POOL_CREDITS_TODAY_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    await handler(getReq(), res)
    expect(read().status).toBe(503)
  })

  it('refuses POST and a foreign origin', async () => {
    const routes = await mountToday(async () => ({
      day: '2026-11-14', total: 1, accounts: 1, source: 'cost-meter', available: true,
    }))
    const handler = routes.get(POOL_CREDITS_TODAY_PATH) as (req: unknown, res: unknown) => Promise<void>
    const post = fakeRes()
    await handler({ method: 'POST', headers: { origin: 'http://localhost:3000' }, on() {}, destroy() {} }, post.res)
    expect(post.read().status).toBe(405)
    const foreign = fakeRes()
    await handler(getReq('http://192.168.1.50:3000'), foreign.res)
    expect(foreign.read().status).toBe(403)
  })

  it('surfaces a throwing reader instead of an empty document', async () => {
    const routes = await mountToday(async () => { throw new Error('home is unreadable') })
    const handler = routes.get(POOL_CREDITS_TODAY_PATH) as (req: unknown, res: unknown) => Promise<void>
    const { res, read } = fakeRes()
    await handler(getReq(), res)
    expect(read().status).toBe(500)
  })
})

