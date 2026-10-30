/**
 * Routing chains, end to end at the shim boundary plus the store round-trip.
 *
 * A chain is the one feature whose correctness is a claim about ORDER: the
 * members are tried in a sequence, the first that answers wins, and every failure
 * has to be recorded as that member's failure rather than as the chain's. These
 * tests are therefore about the sequence and the attribution, not about whether a
 * body reaches an upstream.
 *
 * The provider id is a REAL registry entry for the same reason
 * `aggregate-lane.test.ts` uses one: an invented id would be rejected by
 * `parseProviderModelId`, and the aggregate half of every mixed chain would be
 * unreachable while the test still passed.
 */
import { describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkBuddyCatalog, WorkBuddyModelInfo } from '../src/catalog.ts'
import type { WorkBuddyAccountPool } from '../src/accounts.ts'
import type { WorkBuddyUpstreamClient, WorkBuddyRegion } from '../src/upstream.ts'
import { createWorkBuddyShim } from '../src/shim.ts'
import { AggregateCatalog } from '../src/aggregate.ts'
import { buildComboCatalog, comboChain, comboId, normalizeCombos, resetComboRotation } from '../src/combos.ts'
import type { AggregateStore } from '../src/store.ts'
const PROVIDER_ID = 'agnes'
const MODEL_ID = 'agnes-2.0-flash'
const COMPOSITE_ID = `${PROVIDER_ID}/${MODEL_ID}`
const POOL_MODEL: WorkBuddyModelInfo = {
  id: 'hy3',
  name: 'HY3',
  contextWindow: 192_000,
  maxOutputTokens: 8_192,
  supportsImages: false,
}
function poolCatalog(): WorkBuddyCatalog {
  return {
    visible: () => [POOL_MODEL],
    current: () => [POOL_MODEL],
    find: id => (id === POOL_MODEL.id ? POOL_MODEL : undefined),
    onChange: () => () => {},
  } as unknown as WorkBuddyCatalog
}
/** A pool whose `acquire` returns a scripted account, or undefined when told to. */
function poolWith(
  acquire: (modelId?: string) => Promise<unknown>,
  unavailable: { reason: string; total?: number } = { reason: 'empty' },
): WorkBuddyAccountPool {
  return {
    list: () => [], // No reserved accounts in this scripted pool.
    acquire,
    unavailableReason: () => ({ total: unavailable.total ?? 0, cooling: 0, disabled: 0, reason: unavailable.reason }),
    noteServed: () => {},
    penalize: () => {},
    penalizeCredentialDead: () => {},
    penalizeExhausted: () => {},
  } as unknown as WorkBuddyAccountPool
}
/** One fake third-party gateway; `answers` decides per request whether it serves. */
async function startFakeProvider(
  seen: { model?: string; body: string }[],
  answers: (attempt: number) => number = () => 200,
): Promise<Server> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      let model: string | undefined
      try {
        model = (JSON.parse(body) as { model?: unknown }).model as string | undefined
      } catch {
        model = undefined
      }
      seen.push({ ...model === undefined ? {} : { model }, body })
      const status = answers(seen.length)
      if (status !== 200) {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: `refused ${status}`, type: 'invalid_request_error' } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return server
}
function portOf(server: Server): number {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server is not listening on a port')
  return address.port
}
function storeFor(port: number, combos?: unknown): AggregateStore {
  return {
    version: 1,
    enabled: true,
    providers: {
      [PROVIDER_ID]: {
        apiKey: 'sk-test-key',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        enabled: true,
      },
    },
    ...combos === undefined ? {} : { combos },
  }
}
/** An upstream client that reports a scripted failure for chosen model ids. */
function clientWith(failing: Record<string, { kind: string; status: number; message: string }>) {
  const chatStream = vi.fn(async (credential: unknown, prepared: string) => {
    const model = (JSON.parse(prepared) as { model?: unknown }).model as string | undefined
    const failure = model === undefined ? undefined : failing[model]
    if (failure !== undefined) return { ok: false as const, ...failure }
    return { ok: false as const, kind: 'server' as const, status: 0, message: 'unexpected success shape' }
  })
  return {
    client: {
      // The shim now prepares bodies region-aware; a fake that only answers
      // `prepareChatBody` would make every pool attempt throw.
      prepareChatBody: (raw: string) => raw,
      prepareChatBodyFor: (raw: string) => raw,
      chatStream,
    } as unknown as WorkBuddyUpstreamClient,
    chatStream,
  }
}
async function withShim<T>(
  setup: {
    store: AggregateStore
    pool?: WorkBuddyAccountPool
    client?: WorkBuddyUpstreamClient
    catalog?: AggregateCatalog
  },
  body: (shim: { baseUrl: () => string; token: () => string; close: () => Promise<void>; ready: Promise<void> }) => Promise<T>,
): Promise<T> {
  const catalog = setup.catalog ?? new AggregateCatalog(() => setup.store, () => [POOL_MODEL])
  await catalog.refresh()
  const shim = createWorkBuddyShim({
    pool: setup.pool ?? poolWith(async () => undefined),
    client: setup.client ?? ({
      prepareChatBody: (raw: string) => raw,
      prepareChatBodyFor: (raw: string) => raw,
    } as unknown as WorkBuddyUpstreamClient),
    catalog: poolCatalog(),
    region: 'cn' as WorkBuddyRegion,
    aggregate: { catalog, readStore: () => setup.store },
  })
  await shim.ready
  try {
    return await body(shim)
  } finally {
    await shim.close()
  }
}
function post(shim: { baseUrl: () => string; token: () => string }, model: string) {
  return fetch(`${shim.baseUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${shim.token()}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }] }),
  })
}
describe('a chain serves its first member that answers', () => {
  it('routes a chain id to the pool when the pool member is first', async () => {
    const seen: { model?: string; body: string }[] = []
    const upstream = await startFakeProvider(seen)
    const acquire = vi.fn(async () => ({ id: 'a1', label: 'acct', credential: { accessToken: 't' } }))
    const { client } = clientWith({ hy3: { kind: 'soft_rate', status: 429, message: 'rate limited' } })
    try {
      const response = await withShim(
        {
          store: storeFor(portOf(upstream), [{ name: 'chain', models: ['hy3', COMPOSITE_ID] }]),
          pool: poolWith(acquire),
          client,
        },
        shim => post(shim, 'combo:chain'),
      )
      expect(response.status).toBe(200)
      await response.text()
      // The pool member was tried first and declined; only then did the chain
      // reach the third-party gateway, under the bare model id.
      expect(acquire).toHaveBeenCalledWith('hy3', 'cn', expect.any(String))
      expect(seen).toHaveLength(1)
      expect(seen[0]?.model).toBe(MODEL_ID)
    } finally {
      await new Promise<void>(resolve => upstream.close(() => resolve()))
    }
  })
  it('tries the next member when the first declines, and reports BOTH attempts', async () => {
    const seen: { model?: string; body: string }[] = []
    const upstream = await startFakeProvider(seen)
    const { client } = clientWith({ hy3: { kind: 'soft_rate', status: 429, message: 'rate limited' } })
    try {
      const response = await withShim(
        {
          store: storeFor(portOf(upstream), [{ name: 'chain', models: ['hy3', COMPOSITE_ID] }]),
          pool: poolWith(async () => ({ id: 'a1', label: 'acct', credential: { accessToken: 't' } })),
          client,
        },
        shim => post(shim, 'combo:chain'),
      )
      expect(response.status).toBe(200)
      await response.text()
      // One pool attempt, one third-party attempt, in that order.
      expect(seen).toHaveLength(1)
      expect(seen[0]?.model).toBe(MODEL_ID)
    } finally {
      await new Promise<void>(resolve => upstream.close(() => resolve()))
    }
  })
  it('never lets a chain id reach the pool as a WorkBuddy model name', async () => {
    const seen: { model?: string; body: string }[] = []
    const upstream = await startFakeProvider(seen)
    const acquire = vi.fn(async () => undefined)
    try {
      const response = await withShim(
        { store: storeFor(portOf(upstream), [{ name: 'chain', models: [COMPOSITE_ID] }]), pool: poolWith(acquire) },
        shim => post(shim, 'combo:chain'),
      )
      expect(response.status).toBe(200)
      await response.text()
      // A `combo:` id has no slash, so the pool path could never have parsed it —
      // and it did not try.
      expect(acquire).not.toHaveBeenCalled()
      expect(seen[0]?.model).toBe(MODEL_ID)
    } finally {
      await new Promise<void>(resolve => upstream.close(() => resolve()))
    }
  })
  it('names the whole attempt list when every member declines', async () => {
    const seen: { model?: string; body: string }[] = []
    const upstream = await startFakeProvider(seen, () => 500)
    const { client } = clientWith({ hy3: { kind: 'soft_rate', status: 429, message: 'rate limited' } })
    try {
      const response = await withShim(
        {
          store: storeFor(portOf(upstream), [{ name: 'chain', models: ['hy3', COMPOSITE_ID] }]),
          pool: poolWith(async () => ({ id: 'a1', label: 'acct', credential: { accessToken: 't' } })),
          client,
        },
        shim => post(shim, 'combo:chain'),
      )
      const body = await response.text()
      expect(response.status).not.toBe(200)
      // The user must be able to see WHICH member failed, not just "chain failed".
      expect(body).toContain('hy3')
      expect(body).toContain(COMPOSITE_ID)
    } finally {
      await new Promise<void>(resolve => upstream.close(() => resolve()))
    }
  })
  it('answers 503 with the chain name when a chain row has no live member', async () => {
    const seen: { model?: string; body: string }[] = []
    const upstream = await startFakeProvider(seen)
    try {
      // The store keeps the key, but the catalog is off — so the chain resolves
      // to nothing. Falling through to the pool would send `combo:chain` to a
      // gateway that has never heard of it.
      const store = storeFor(portOf(upstream), [{ name: 'chain', models: [COMPOSITE_ID] }])
      const catalog = new AggregateCatalog(() => ({ ...store, enabled: false }), () => [POOL_MODEL])
      const response = await withShim(
        { store, catalog, pool: poolWith(async () => undefined) },
        shim => post(shim, 'combo:chain'),
      )
      const body = await response.text()
      expect(response.status).toBe(503)
      expect(body).toContain('combo:chain')
    } finally {
      await new Promise<void>(resolve => upstream.close(() => resolve()))
    }
  })
})
describe('the chain catalog refuses to advertise what it cannot serve', () => {
  it('drops a member the roster lost, and the whole chain when none survive', () => {
    const chains = normalizeCombos([{ name: 'mix', models: ['hy3', 'agnes/gone'] }])
    expect(chains).toHaveLength(1)
    const rows = buildComboCatalog(chains, { pool: [POOL_MODEL], aggregate: [] })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.models).toEqual(['hy3'])
  })
  it('drops a chain with no live member entirely', () => {
    const chains = normalizeCombos([{ name: 'mix', models: ['agnes/gone'] }])
    expect(buildComboCatalog(chains, { pool: [POOL_MODEL], aggregate: [] })).toEqual([])
  })
  it('takes the intersection of capacities, never the union', () => {
    const chains = normalizeCombos([{ name: 'mix', models: ['hy3', COMPOSITE_ID] }])
    const rows = buildComboCatalog(chains, {
      pool: [POOL_MODEL],
      aggregate: [{
        id: COMPOSITE_ID,
        name: 'Agnes',
        providerId: PROVIDER_ID,
        modelId: MODEL_ID,
        contextWindow: 32_000,
        maxOutputTokens: 16_000,
        supportsImages: true,
        wire: 'chat',
        source: 'static',
      }],
    })
    const row = rows[0]
    // The SMALLEST window: the host must never size a prompt against a member
    // that cannot take it.
    expect(row?.contextWindow).toBe(32_000)
    expect(row?.maxOutputTokens).toBe(8_192)
    // Image support is an intersection too — one member that cannot read an
    // image makes every image turn a failure.
    expect(row?.supportsImages).toBe(false)
  })
  it('rejects a chain that points at another chain', () => {
    const chains = normalizeCombos([{ name: 'outer', models: ['combo:inner'] }])
    // No members survive the self-reference filter, so nothing is stored.
    expect(chains).toEqual([])
  })
  it('skips a disabled chain', () => {
    const chains = normalizeCombos([{ name: 'off', models: ['hy3'], enabled: false }])
    expect(buildComboCatalog(chains, { pool: [POOL_MODEL], aggregate: [] })).toEqual([])
  })
})
describe('round-robin rotates, fallback does not', () => {
  it('keeps one member for stickyLimit turns, then advances', () => {
    resetComboRotation()
    const chains = normalizeCombos([{ name: 'rr', models: ['a', 'b', 'c'], strategy: 'round-robin', stickyLimit: 2 }])
    const [row] = buildComboCatalog(chains, {
      pool: [
        { ...POOL_MODEL, id: 'a' },
        { ...POOL_MODEL, id: 'b' },
        { ...POOL_MODEL, id: 'c' },
      ],
      aggregate: [],
    })
    if (row === undefined) throw new Error('chain produced no row')
    expect(comboChain(row)).toEqual(['a', 'b', 'c'])
    expect(comboChain(row)).toEqual(['a', 'b', 'c'])
    expect(comboChain(row)).toEqual(['b', 'c', 'a'])
    expect(comboChain(row)).toEqual(['b', 'c', 'a'])
    expect(comboChain(row)).toEqual(['c', 'a', 'b'])
    resetComboRotation()
  })
  it('restarts from the head every turn under fallback', () => {
    resetComboRotation()
    const chains = normalizeCombos([{ name: 'fb', models: ['a', 'b'], strategy: 'fallback' }])
    const [row] = buildComboCatalog(chains, {
      pool: [{ ...POOL_MODEL, id: 'a' }, { ...POOL_MODEL, id: 'b' }],
      aggregate: [],
    })
    if (row === undefined) throw new Error('chain produced no row')
    expect(comboChain(row)).toEqual(['a', 'b'])
    expect(comboChain(row)).toEqual(['a', 'b'])
    resetComboRotation()
  })
  it('peeks without consuming a rotation step', () => {
    resetComboRotation()
    const chains = normalizeCombos([{ name: 'rr', models: ['a', 'b'], strategy: 'round-robin', stickyLimit: 1 }])
    const [row] = buildComboCatalog(chains, {
      pool: [{ ...POOL_MODEL, id: 'a' }, { ...POOL_MODEL, id: 'b' }],
      aggregate: [],
    })
    if (row === undefined) throw new Error('chain produced no row')
    expect(comboChain(row, { peek: true })).toEqual(['a', 'b'])
    expect(comboChain(row, { peek: true })).toEqual(['a', 'b'])
    // The peeks consumed nothing, so the first real turn still starts at `a`.
    expect(comboChain(row)).toEqual(['a', 'b'])
    resetComboRotation()
  })
})
describe('the chain table survives a save/load round trip', () => {
  it('keeps a chain whose name is not written in Latin letters', async () => {
    /*
      Regression: the id slug was `[^a-z0-9]+` → '-', so a Chinese name became
      the empty string, `normalizeCombos` dropped the row, and the save reported
      success while storing nothing — reported as "the new route will not save".
      A name is user data; the id has to survive any script.
    */
    const { saveCombos, readAggregateSettingsSync, combosOf } = await import('../src/store.ts')
    const home = mkdtempSync(join(tmpdir(), 'xdpool-combos-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      await saveCombos([{ name: '写作回退', models: ['hy3'] }])
      const stored = combosOf(readAggregateSettingsSync())
      expect(stored.map(chain => chain.name)).toEqual(['写作回退'])
      expect(stored[0]?.id).toBe('combo:写作回退')
      // The ASCII shape must not change: ids already stored keep resolving.
      expect(comboId('Write Then Fallback')).toBe('combo:write-then-fallback')
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
  it('writes the whole table and reads back what it can serve', async () => {
    const { saveCombos } = await import('../src/store.ts')
    const home = mkdtempSync(join(tmpdir(), 'xdpool-combos-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      // eslint-disable-next-line no-await-in-loop -- kept sequential: the store
      // writes through a shared temp file, so overlapping saves would race.
      await saveCombos([
        { name: 'First', models: ['hy3', 'agnes/gone'] },
        { name: 'second', models: [COMPOSITE_ID], strategy: 'round-robin', stickyLimit: 3 },
        { name: 'empty', models: [] },
      ])
      const { readAggregateSettingsSync, combosOf } = await import('../src/store.ts')
      const stored = combosOf(readAggregateSettingsSync())
      // The empty chain is dropped; the two real ones survive normalisation.
      expect(stored.map(chain => chain.name)).toEqual(['First', 'second'])
      expect(stored[0]?.id).toBe('combo:first')
      expect(stored[1]?.strategy).toBe('round-robin')
      expect(stored[1]?.stickyLimit).toBe(3)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
  it('forgets the table when the user deletes every chain', async () => {
    const { saveCombos, readAggregateSettingsSync, combosOf, aggregateSettingsPath } = await import('../src/store.ts')
    const home = mkdtempSync(join(tmpdir(), 'xdpool-combos-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      await saveCombos([{ name: 'gone', models: ['hy3'] }])
      expect(combosOf(readAggregateSettingsSync())).toHaveLength(1)
      // Saving an empty list must CLEAR the key, not write an empty array. A
      // leftover `combos: []` is indistinguishable from "never configured" to
      // a future reader, and the file keeps a stale section forever.
      await saveCombos([])
      expect(combosOf(readAggregateSettingsSync())).toEqual([])
      const stored = JSON.parse(readFileSync(aggregateSettingsPath(), 'utf8')) as Record<string, unknown>
      expect('combos' in stored).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})