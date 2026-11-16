import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'
import { createPoolRelay, newRelayKey, RELAY_FORWARDED_PATHS, RELAY_HOP_HEADER, type PoolRelay, type RelaySettings } from '../src/relay.ts'
import type { WorkBuddyShim } from '../src/shim.ts'
import { POOL_RELAY_PATH } from '../src/status-paths.ts'
/**
 * The LAN relay is the one part of this plugin that puts a network listener on
 * an interface the user did not explicitly ask for, so these tests are mostly
 * about what it REFUSES. A relayed request is just the shim's own answer copied
 * across — which is exactly why the tests here do not retest the shim's wire
 * format, and instead assert that the relay adds no interpretation of its own.
 */
const KEY = newRelayKey()
interface Answer {
  status: number
  body: string
  headers?: Record<string, string>
}
/**
 * A stand-in for the loopback shim: records what arrived and answers with a
 * fixed script. Using a real shim here would test the shim again; what matters
 * is what the relay puts in front of it.
 */
function fakeShim(answers: Answer[]): WorkBuddyShim & { seen: { method: string; url: string; headers: Record<string, unknown>; body: string }[] } {
  const seen: { method: string; url: string; headers: Record<string, unknown>; body: string }[] = []
  const shim = {
    baseUrl: () => 'http://127.0.0.1:65535',
    token: () => 'shim-secret-never-leaves-this-process',
    close: async (): Promise<void> => {},
    seen,
  }
  void shim
  return shim as WorkBuddyShim & { seen: typeof seen }
}
let relays: PoolRelay[] = []
afterEach(async () => {
  const open = relays
  relays = []
  for (const relay of open) await relay.close()
})
/**
 * Run `run` with `DSH_HOME` pointed at a throwaway directory.
 *
 * Deliberately async. An earlier version restored the variable in a `finally`
 * around `return run(home)`, which for an async callback fires the moment the
 * promise is handed back — the restore ran while the store was still writing,
 * so every `await updateRelaySetting(...)` inside landed in the developer's real
 * `~/.dsh` profile. The test passed; the machine did not.
 */
async function withHome<T>(run: (home: string) => Promise<T> | T): Promise<T> {
  const previous = process.env.DSH_HOME
  const home = mkdtempSync(join(tmpdir(), 'xdpool-relay-'))
  process.env.DSH_HOME = home
  try {
    return await run(home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
}
describe('relay settings store', () => {
  it('keeps the relay section out of a store that never had one', async () => {
    const { readAggregateSettingsSync, aggregateSettingsPath } = await import('../src/store.ts')
    await withHome(async home => {
      expect(readAggregateSettingsSync().relay).toBeUndefined()
      expect(aggregateSettingsPath()).toBe(join(home, '.xdpool', 'aggregate.json'))
    })
  })
  it('never writes outside the throwaway home it was given', async () => {
    const { updateRelaySetting } = await import('../src/store.ts')
    const live = process.env.DSH_HOME
    await withHome(async home => {
      await updateRelaySetting({ enabled: true, port: 18326, key: KEY })
      // The guard that would have caught the original bug: an async body that
      // outlives the helper's restore must not fall back to the caller's home.
      expect(process.env.DSH_HOME).toBe(home)
    })
    expect(process.env.DSH_HOME).toBe(live)
  })
  it('round-trips a relay patch and clears each empty field', async () => {
    const { updateRelaySetting, readAggregateSettingsSync } = await import('../src/store.ts')
    await withHome(async () => {
      await updateRelaySetting({ enabled: true, host: '0.0.0.0', port: 18326, key: KEY })
      const saved = readAggregateSettingsSync().relay
      expect(saved?.enabled).toBe(true)
      expect(saved?.host).toBe('0.0.0.0')
      expect(saved?.port).toBe(18326)
      expect(saved?.key).toBe(KEY)
      // An empty key must CLEAR rather than store '', because every reader checks
      // presence: an empty string reads as "configured" and would leave a relay
      // that looks protected and is not.
      await updateRelaySetting({ key: '' })
      expect(readAggregateSettingsSync().relay?.key).toBeUndefined()
      // `enabled` is one of those fields: false is a real setting, not an empty
      // one. Turning the relay off has to survive, or the next read would report
      // "never enabled" and the card would lose the fact that this user turned it
      // off on purpose.
      await updateRelaySetting({ host: '', port: 0, key: '' })
      const after = readAggregateSettingsSync()
      expect(after.relay).toEqual({ enabled: true })
      // Nothing but a boolean left is still a section we keep — but a store with
      // no relay field at all must round-trip as absent, which is the first case
      // in this file and the state a fresh install is in.
      const store = await import('../src/store.ts')
      const bare = store.readAggregateSettingsSync()
      await store.writeAggregateSettings({ ...bare, enabled: true, relay: undefined })
      expect(store.readAggregateSettingsSync().relay).toBeUndefined()
    })
  })
  it('stores the gateway share list, and stores "nothing" as nothing', async () => {
    // The write door for the picker. `normalizeRelay` cleaned the field on the
    // way in from disk, but `updateRelaySetting` had no branch for it at all, so
    // saving from the card rewrote the section without it and the gateway stayed
    // open — a save that reported success and changed nothing.
    const { updateRelaySetting, readAggregateSettingsSync } = await import('../src/store.ts')
    await withHome(async () => {
      await updateRelaySetting({ enabled: true, models: ['buddy:hy3', 'qoder:qfmodel'] })
      expect(readAggregateSettingsSync().relay?.models).toEqual(['buddy:hy3', 'qoder:qfmodel'])
      await updateRelaySetting({ models: [] })
      // An empty list is the user's answer, not an absence: it has to read back as
      // `[]` so the gateway refuses everything instead of silently re-opening.
      expect(readAggregateSettingsSync().relay?.models).toEqual([])
    })
  })
  it('leaves the share list alone when a patch changes only the address', async () => {
    const { updateRelaySetting, readAggregateSettingsSync } = await import('../src/store.ts')
    await withHome(async () => {
      await updateRelaySetting({ models: ['buddy:hy3'] })
      await updateRelaySetting({ host: '0.0.0.0', port: 18326 })
      // An absent field must not be read as "share nothing", or editing the
      // listener would reopen a gateway on the wrong assumption.
      expect(readAggregateSettingsSync().relay?.models).toEqual(['buddy:hy3'])
      await updateRelaySetting({ key: KEY })
      expect(readAggregateSettingsSync().relay?.models).toEqual(['buddy:hy3'])
    })
  })
  it('cleans the list on the write door the same way the read door does', async () => {
    const { updateRelaySetting, readAggregateSettingsSync } = await import('../src/store.ts')
    await withHome(async () => {
      await updateRelaySetting({ models: [' buddy:hy3 ', 'buddy:hy3', 7, null, 'qoder:qfmodel'] })
      expect(readAggregateSettingsSync().relay?.models).toEqual(['buddy:hy3', 'qoder:qfmodel'])
    })
  })
  it('ignores a port it cannot bind instead of moving the relay somewhere else', async () => {
    const { updateRelaySetting, readAggregateSettingsSync } = await import('../src/store.ts')
    await withHome(async () => {
      await updateRelaySetting({ enabled: true, port: 18326 })
      await updateRelaySetting({ port: 99_999 })
      // A typo in the port must not quietly relocate the listener; the field
      // keeps its old value and the user's other devices keep working.
      expect(readAggregateSettingsSync().relay?.port).toBe(18326)
      await updateRelaySetting({ port: 0 })
      // 0 is not a typo but the card's "forget this" value: it clears the field
      // so the relay falls back to the documented default rather than to whatever
      // it happened to be before.
      expect(readAggregateSettingsSync().relay?.port).toBeUndefined()
    })
  })
  it('does not lose the API keys stored beside it when the relay section is malformed', async () => {
    const { updateProviderSetting, writeAggregateSettings, readAggregateSettingsSync } = await import('../src/store.ts')
    const { PROVIDER_IDS } = { PROVIDER_IDS: ['agnes'] as const }
    await withHome(async () => {
      await updateProviderSetting(PROVIDER_IDS[0], { apiKey: 'sk-test' })
      // A hand-edited file with a nonsense relay section must not take the
      // provider keys down with it — the same rule chains follow.
      const current = readAggregateSettingsSync()
      await writeAggregateSettings({ ...current, relay: 'nonsense' } as never)
      const after = readAggregateSettingsSync()
      expect(after.relay).toBeUndefined()
      expect(after.providers?.['agnes']?.apiKey).toBe('sk-test')
    })
  })
})
describe('relay defaults', () => {
  it('starts off, loopback-only, and with no key', async () => {
    const { readAggregateSettingsSync } = await import('../src/store.ts')
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    // `enabled` is read as `=== true`, never inferred from the presence of a
    // host or a port. A file that happened to carry a port must never be enough
    // to expose someone's account pool to the network.
    expect(source).toContain('enabled: saved.enabled === true')
    expect(source).toContain('RELAY_DEFAULT_PORT')
    void readAggregateSettingsSync
  })
  it('forwards exactly the paths the shim serves', () => {
    expect([...RELAY_FORWARDED_PATHS].sort()).toEqual(['/v1/chat/completions', '/v1/models'])
  })
})
/** Send one request through a listener and collect the response. */
function call(
  port: number,
  options: { method?: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: options.method ?? 'GET',
        path: options.path,
        headers: options.headers ?? {},
      },
      res => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', chunk => {
          body += String(chunk)
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers as Record<string, unknown> }))
      },
    )
    req.on('error', reject)
    req.end(options.body)
  })
}
/** Boot a relay on an ephemeral loopback port, forwarding to a stub upstream. */
async function startRelay(
  settings: RelaySettings,
  upstream: { status: number; body: string; contentType?: string },
): Promise<{ port: number; seen: { authorization: string | undefined; hop: string | undefined; apiKey: string | undefined; host: string | undefined; body: string }[] }> {
  const seen: { authorization: string | undefined; hop: string | undefined; apiKey: string | undefined; host: string | undefined; body: string }[] = []
  const upstreamServer = (await import('node:http')).createServer((req, res) => {
    let body = ''
    req.on('data', chunk => {
      body += String(chunk)
    })
    req.on('end', () => {
      seen.push({
        authorization: req.headers.authorization,
        hop: req.headers[RELAY_HOP_HEADER] as string | undefined,
        apiKey: req.headers['x-api-key'] as string | undefined,
        host: req.headers.host,
        body,
      })
      res.writeHead(upstream.status, { 'content-type': upstream.contentType ?? 'text/event-stream' })
      res.end(upstream.body)
    })
  })
  await new Promise<void>(resolve => upstreamServer.listen(0, '127.0.0.1', resolve))
  const upstreamPort = (upstreamServer.address() as { port: number }).port
  const shim = {
    baseUrl: () => `http://127.0.0.1:${upstreamPort}`,
    token: () => 'shim-secret',
    ready: Promise.resolve(),
    close: async (): Promise<void> => {},
  } satisfies WorkBuddyShim
  const relay = createPoolRelay({ shim, read: () => settings })
  relays.push(relay)
  await relay.ready
  const status = await relay.status()
  return { port: status.port, seen }
}
describe('relay listener', () => {
  it('refuses every request while it is switched off', async () => {
    // Port 0 with `enabled: false` binds nothing at all, so there is no port to
    // dial. Binding it anyway and answering 503 is the stronger behaviour and
    // the one worth pinning: it says "off", not "nothing here".
    const shim = {
      baseUrl: () => 'http://127.0.0.1:65535',
      token: () => 'shim-secret',
      ready: Promise.resolve(),
      close: async (): Promise<void> => {},
    } satisfies WorkBuddyShim
    const relay = createPoolRelay({ shim, read: () => ({ enabled: false, host: '127.0.0.1', port: 0, key: KEY }) })
    relays.push(relay)
    await relay.ready
    const status = await relay.status()
    // Nothing is bound while it is off, and the status says so rather than
    // handing the card an endpoint that will refuse every call.
    expect(status.listening).toBe(false)
    expect(status.endpoint).toBe('')
    await expect(call(1, { path: '/v1/models', headers: { authorization: `Bearer ${KEY}` } })).rejects.toThrow()
  })
  it('refuses a request with no key, a wrong key, or no key configured at all', async () => {
    const relay = await startRelay({ enabled: true, host: '127.0.0.1', port: 0, key: KEY }, { status: 200, body: '{}' })
    expect((await call(relay.port, { path: '/v1/models' })).status).toBe(401)
    expect((await call(relay.port, { path: '/v1/models', headers: { authorization: 'Bearer nope' } })).status).toBe(401)
    // A wrong-length key must be refused without throwing: `timingSafeEqual`
    // throws on a length mismatch, and a 500 here would look like a crash.
    expect((await call(relay.port, { path: '/v1/models', headers: { authorization: 'Bearer short' } })).status).toBe(401)
    // The correct key answers — otherwise the three 401s above would prove only
    // that the listener is refusing everyone, which is not what is being tested.
    expect((await call(relay.port, { path: '/v1/models', headers: { authorization: `Bearer ${KEY}` } })).status).toBe(200)
  })
  it('accepts the Anthropic spelling of the key too', async () => {
    const { port, seen } = await startRelay({ enabled: true, host: '127.0.0.1', port: 0, key: KEY }, { status: 200, body: 'data: [DONE]\n\n' })
    const answer = await call(port, { path: '/v1/models', headers: { 'x-api-key': KEY } })
    expect(answer.status).toBe(200)
    expect(seen).toHaveLength(1)
  })
  it('never lets the caller learn the shim secret', async () => {
    const { port, seen } = await startRelay({ enabled: true, host: '127.0.0.1', port: 0, key: KEY }, { status: 200, body: 'data: [DONE]\n\n' })
    const answer = await call(port, {
      path: '/v1/chat/completions',
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'x-api-key': KEY },
      body: '{"model":"hy3"}',
    })
    expect(answer.status).toBe(200)
    expect(answer.body).toBe('data: [DONE]\n\n')
    expect(answer.body).not.toContain('shim-secret')
    // The caller's own key is replaced by the shim secret for the inner hop. It
    // is NOT forwarded alongside: an Anthropic-style client would otherwise have
    // its shared secret sitting in the shim's logs.
    expect(seen[0]?.authorization).toBe('Bearer shim-secret')
    expect(seen[0]?.apiKey).toBeUndefined()
    expect(seen[0]?.hop).toBe('1')
    // Host is recomputed for the upstream hop, not copied from the caller.
    expect(seen[0]?.host).not.toContain(String(port))
  })
  it('refuses a request that already came through a relay', async () => {
    const { port } = await startRelay({ enabled: true, host: '127.0.0.1', port: 0, key: KEY }, { status: 200, body: '{}' })
    const answer = await call(port, {
      path: '/v1/models',
      headers: { authorization: `Bearer ${KEY}`, [RELAY_HOP_HEADER]: '1' },
    })
    expect(answer.status).toBe(508)
    expect(answer.body).toContain('relay_loop')
  })
  it('refuses a path it does not forward, without touching upstream', async () => {
    const { port, seen } = await startRelay({ enabled: true, host: '127.0.0.1', port: 0, key: KEY }, { status: 200, body: '{}' })
    for (const path of ['/', '/healthz', '/v1/embeddings', '/v1/models/../secrets']) {
      const answer = await call(port, { path, headers: { authorization: `Bearer ${KEY}` } })
      expect(answer.status).toBe(404)
    }
    expect(seen).toHaveLength(0)
  })
  it('reports the bound port rather than the requested one', async () => {
    const shim = {
      baseUrl: () => 'http://127.0.0.1:65535',
      token: () => 'shim-secret',
      ready: Promise.resolve(),
      close: async (): Promise<void> => {},
    } satisfies WorkBuddyShim
    const relay = createPoolRelay({ shim, read: () => ({ enabled: true, host: '127.0.0.1', port: 0, key: KEY }) })
    relays.push(relay)
    await relay.ready
    const status = await relay.status()
    // Port 0 asks the OS to pick; reporting the configured 0 back would leave the
    // user with an endpoint that does not exist.
    expect(status.listening).toBe(true)
    expect(status.port).toBeGreaterThan(0)
    expect(status.endpoint).toBe(`http://127.0.0.1:${status.port}/v1`)
  })
  it('surfaces a bind failure as a status instead of taking startup down', async () => {
    // Bind an ephemeral port with a throwaway server, then ask the relay for that
    // same port: the clash is real, not simulated.
    const blocker = (await import('node:http')).createServer(() => {})
    await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve))
    const taken = (blocker.address() as { port: number }).port
    const shim = {
      baseUrl: () => 'http://127.0.0.1:65535',
      token: () => 'shim-secret',
      ready: Promise.resolve(),
      close: async (): Promise<void> => {},
    } satisfies WorkBuddyShim
    const relay = createPoolRelay({ shim, read: () => ({ enabled: true, host: '127.0.0.1', port: taken, key: KEY }) })
    relays.push(relay)
    // A port clash must resolve, not reject: `ready` rejecting would surface as a
    // plugin startup failure over a feature the user merely switched on.
    await expect(relay.ready).resolves.toBeUndefined()
    const status = await relay.status()
    expect(status.listening).toBe(false)
    expect(status.error).not.toBe('')
    blocker.close()
  })
  it('stops listening when the switch is turned off', async () => {
    const shim = {
      baseUrl: () => 'http://127.0.0.1:65535',
      token: () => 'shim-secret',
      ready: Promise.resolve(),
      close: async (): Promise<void> => {},
    } satisfies WorkBuddyShim
    let settings: RelaySettings = { enabled: true, host: '127.0.0.1', port: 0, key: KEY }
    const relay = createPoolRelay({ shim, read: () => settings })
    relays.push(relay)
    await relay.ready
    const first = await relay.status()
    expect(first.listening).toBe(true)
    settings = { ...settings, enabled: false }
    const second = await relay.sync()
    expect(second.listening).toBe(false)
    expect(second.endpoint).toBe('')
    await expect(call(first.port, { path: '/v1/models', headers: { authorization: `Bearer ${KEY}` } })).rejects.toThrow()
  })
  it('re-reads the settings per request, so a rotated key takes effect at once', async () => {
    const shim = {
      baseUrl: () => 'http://127.0.0.1:65535',
      token: () => 'shim-secret',
      ready: Promise.resolve(),
      close: async (): Promise<void> => {},
    } satisfies WorkBuddyShim
    let settings: RelaySettings = { enabled: true, host: '127.0.0.1', port: 0, key: KEY }
    const relay = createPoolRelay({ shim, read: () => settings })
    relays.push(relay)
    await relay.ready
    const status = await relay.status()
    expect((await call(status.port, { path: '/v1/models', headers: { authorization: `Bearer ${KEY}` } })).status).not.toBe(401)
    // No sync call here: that is the point. A client that had the old key saved
    // must stop working immediately after the user rotates, not after a restart.
    settings = { ...settings, key: newRelayKey() }
    expect((await call(status.port, { path: '/v1/models', headers: { authorization: `Bearer ${KEY}` } })).status).toBe(401)
  })
  it('keeps running when the settings reader throws', async () => {
    const shim = {
      baseUrl: () => 'http://127.0.0.1:65535',
      token: () => 'shim-secret',
      ready: Promise.resolve(),
      close: async (): Promise<void> => {},
    } satisfies WorkBuddyShim
    const relay = createPoolRelay({
      shim,
      read: () => {
        throw new Error('store unreadable')
      },
    })
    relays.push(relay)
    await relay.ready
    expect((await relay.status()).listening).toBe(false)
    expect((await relay.status()).enabled).toBe(false)
  })
})
describe('relay route', () => {
  it('is a single loopback-guarded route in the plugin namespace', () => {
    expect(POOL_RELAY_PATH).toBe('/plugins/dsh-xdpool/relay')
    const source = readFileSync(new URL('../src/web-status.ts', import.meta.url), 'utf8')
    const at = source.indexOf('disposeRelay = ctx.webServer.register')
    expect(at).toBeGreaterThan(-1)
    const body = source.slice(at, at + 900)
    expect(body).toContain("req.method !== 'GET' && req.method !== 'POST'")
    /**
     * The gate is now `originTrusted`, which accepts loopback, the host's own `trustedHosts`,
     * and a same-origin request behind a reverse proxy — `loopbackOrigin` refused all but the
     * first, which is why every button answered 403 over Tailscale (#164).
     */
    expect(body).toContain('originTrusted(req')
    expect(body).toContain('deps.relayDocument === undefined || deps.saveRelay === undefined')
    // The disposal must be inside the cleanup closure that runs on unload, not
    // merely mentioned somewhere in the file — an unregistered listener would
    // keep serving the pool after the plugin is gone.
    const cleanup = source.indexOf('disposeRelay()')
    expect(cleanup).toBeGreaterThan(at)
    expect(source.slice(at, cleanup)).not.toContain('disposeRelay()')
  })
  it('mints a key on first enable rather than serving an open relay', async () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    const at = source.indexOf('saveRelay: async')
    expect(at).toBeGreaterThan(-1)
    // Bounded by the end of the deps object rather than a fixed character count:
    // a window measured in characters makes every added comment a threat to this
    // test, and the failure it reports is "the text moved", not "the behaviour
    // broke" — which is the one thing a source-scanning assertion must never do.
    const end = source.indexOf('  }))', at)
    expect(end).toBeGreaterThan(at)
    const body = source.slice(at, end)
    // An empty key from the card means "rotate"; the store would read that as
    // "clear", so the new secret is minted on this side of the write.
    expect(body).toContain("patch.key === '' ? newRelayKey() : patch.key")
    expect(body).toContain('before.key ?? newRelayKey()')
    // And the listener is re-evaluated from the persisted file, not the patch.
    expect(body).toContain('await relay.sync()')
  })
})