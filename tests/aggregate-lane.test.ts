/**
 * The aggregate lane, end to end at the shim boundary.
 *
 * The lane is the one place where a third-party credential is reachable from a
 * user request, so these tests are about the SPLIT rather than about the
 * forwarding: which model ids reach a third-party gateway, which fall through to
 * the account pool, and whether a stale picker entry can still be used.
 *
 * The provider id is a REAL registry entry on purpose. `parseProviderModelId`
 * and `buildAggregateCatalog` both reject an id the registry does not know, so a
 * made-up id would make the aggregate branch unreachable and every assertion
 * below would pass against the pool lane instead.
 */
import { describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { WorkBuddyCatalog, WorkBuddyModelInfo } from '../src/catalog.ts'
import type { WorkBuddyAccountPool } from '../src/accounts.ts'
import type { WorkBuddyUpstreamClient, WorkBuddyRegion } from '../src/upstream.ts'
import { POOL_MODEL_PREFIX, createWorkBuddyShim } from '../src/shim.ts'
import { AggregateCatalog, readSseHead } from '../src/aggregate.ts'
import type { AggregateStore } from '../src/store.ts'
/** A registry entry that takes an API key, speaks openai-chat, and lists a model. */
const PROVIDER_ID = 'agnes'
const MODEL_ID = 'agnes-2.0-flash'
const COMPOSITE_ID = `${PROVIDER_ID}/${MODEL_ID}`
const ONE_MODEL: WorkBuddyModelInfo = {
  id: 'hy3',
  name: 'HY3',
  contextWindow: 192_000,
  maxOutputTokens: 8_192,
  supportsImages: false,
}
/** A catalog with exactly one WorkBuddy row, and no upstream behind it. */
function poolCatalog(): WorkBuddyCatalog {
  return {
    visible: () => [ONE_MODEL],
    current: () => [ONE_MODEL],
    find: id => (id === ONE_MODEL.id ? ONE_MODEL : undefined),
    onChange: () => () => {},
  } as unknown as WorkBuddyCatalog
}
function poolWith(acquire: () => Promise<unknown>): WorkBuddyAccountPool {
  return {
    list: () => [], // No reserved accounts in this scripted pool.
    acquire,
    unavailableReason: () => ({ total: 0, cooling: 0, disabled: 0, reason: 'empty' }),
    noteServed: () => {},
  } as unknown as WorkBuddyAccountPool
}
/**
 * Stand up a fake third-party gateway on loopback.
 *
 * `seen` records what actually arrived, which is the only honest way to assert
 * the split: asserting on the shim's own bookkeeping would pass even if the
 * forwarder had sent the request to the wrong upstream.
 */
async function startFakeProvider(seen: { model?: string; body: string }[]): Promise<Server> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      let model: string | undefined
      try {
        const parsed = JSON.parse(body) as { model?: unknown }
        model = typeof parsed.model === 'string' ? parsed.model : undefined
      } catch {
        model = undefined
      }
      seen.push({ ...model === undefined ? {} : { model }, body })
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
/** A store pointing the real provider at the fake gateway. */
function storeFor(port: number): AggregateStore {
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
  }
}
describe('the aggregate lane splits traffic by model id', () => {
  it('forwards a composite id to its own provider with the bare model name', async () => {
    const seen: { model?: string; body: string }[] = []
    const upstream = await startFakeProvider(seen)
    const store = storeFor(portOf(upstream))
    const catalog = new AggregateCatalog(() => store)
    await catalog.refresh()
    const prepareChatBody = vi.fn((raw: string) => raw)
    const acquire = vi.fn(async () => undefined)
    const shim = createWorkBuddyShim({
      pool: poolWith(acquire),
      client: { prepareChatBody, prepareChatBodyFor: prepareChatBody } as unknown as WorkBuddyUpstreamClient,
      catalog: poolCatalog(),
      region: 'cn' as WorkBuddyRegion,
      aggregate: { catalog, readStore: () => store },
    })
    await shim.ready
    const port = new URL(shim.baseUrl()).port
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${shim.token()}` },
        body: JSON.stringify({ model: COMPOSITE_ID, messages: [{ role: 'user', content: 'hi' }] }),
      })
      expect(response.status).toBe(200)
      await response.text()
      expect(seen).toHaveLength(1)
      // The bare id travels: no provider publishes `agnes/agnes-2.0-flash`.
      expect(seen[0]?.model).toBe(MODEL_ID)
      // And the pool never saw the request.
      expect(prepareChatBody).not.toHaveBeenCalled()
      expect(acquire).not.toHaveBeenCalled()
    } finally {
      await shim.close()
      await new Promise<void>(resolve => upstream.close(() => resolve()))
    }
  })
  it('refuses a composite id the catalog no longer offers', async () => {
    const seen: { model?: string; body: string }[] = []
    const upstream = await startFakeProvider(seen)
    const store = storeFor(portOf(upstream))
    // The store still holds the key, but the running catalog is empty: the state
    // a provider switch-off or a key clear leaves behind.
    const empty = new AggregateCatalog(() => ({ ...store, enabled: false }))
    await empty.refresh()
    const shim = createWorkBuddyShim({
      pool: poolWith(async () => undefined),
      client: { prepareChatBody: (raw: string) => raw, prepareChatBodyFor: (raw: string) => raw } as unknown as WorkBuddyUpstreamClient,
      catalog: poolCatalog(),
      region: 'cn' as WorkBuddyRegion,
      aggregate: { catalog: empty, readStore: () => store },
    })
    await shim.ready
    const port = new URL(shim.baseUrl()).port
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${shim.token()}` },
        body: JSON.stringify({ model: COMPOSITE_ID, messages: [{ role: 'user', content: 'hi' }] }),
      })
      // Not forwarded: the picker row is gone, so the id names no credential
      // this shim still holds.
      expect(seen).toHaveLength(0)
      expect(response.status).not.toBe(200)
    } finally {
      await shim.close()
      await new Promise<void>(resolve => upstream.close(() => resolve()))
    }
  })
  it('falls a WorkBuddy model id through to the account pool, never to a third party', async () => {
    const seen: { model?: string; body: string }[] = []
    const upstream = await startFakeProvider(seen)
    const store = storeFor(portOf(upstream))
    const catalog = new AggregateCatalog(() => store)
    await catalog.refresh()
    const prepareChatBody = vi.fn((raw: string) => raw)
    const acquire = vi.fn(async () => undefined)
    const shim = createWorkBuddyShim({
      pool: poolWith(acquire),
      client: { prepareChatBody, prepareChatBodyFor: prepareChatBody } as unknown as WorkBuddyUpstreamClient,
      catalog: poolCatalog(),
      region: 'cn' as WorkBuddyRegion,
      aggregate: { catalog, readStore: () => store },
    })
    await shim.ready
    const port = new URL(shim.baseUrl()).port
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${shim.token()}` },
        body: JSON.stringify({ model: 'hy3', messages: [{ role: 'user', content: 'hi' }] }),
      })
      await response.text()
      // A plain WorkBuddy id has no composite prefix, so it took the pool path.
      expect(prepareChatBody).toHaveBeenCalled()
      expect(acquire).toHaveBeenCalled()
      expect(seen).toHaveLength(0)
    } finally {
      await shim.close()
      await new Promise<void>(resolve => upstream.close(() => resolve()))
    }
  })
  it('rejects a composite id whose provider the registry does not know', async () => {
    const seen: { model?: string; body: string }[] = []
    const upstream = await startFakeProvider(seen)
    const store = storeFor(portOf(upstream))
    const catalog = new AggregateCatalog(() => store)
    await catalog.refresh()
    const acquire = vi.fn(async () => undefined)
    const shim = createWorkBuddyShim({
      pool: poolWith(acquire),
      client: { prepareChatBody: (raw: string) => raw, prepareChatBodyFor: (raw: string) => raw } as unknown as WorkBuddyUpstreamClient,
      catalog: poolCatalog(),
      region: 'cn' as WorkBuddyRegion,
      aggregate: { catalog, readStore: () => store },
    })
    await shim.ready
    const port = new URL(shim.baseUrl()).port
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${shim.token()}` },
        body: JSON.stringify({ model: 'made-up/gpt-9', messages: [] }),
      })
      await response.text()
      // A slash is legal in a WorkBuddy model id too, so an unknown prefix must
      // not be forwarded on the strength of its shape alone.
      expect(seen).toHaveLength(0)
      expect(acquire).toHaveBeenCalled()
    } finally {
      await shim.close()
      await new Promise<void>(resolve => upstream.close(() => resolve()))
    }
  })
})
describe('the aggregate catalog lists both lanes', () => {
  it('answers /v1/models with the pool rows and the composite rows', async () => {
    const upstream = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end('data: [DONE]\n\n')
    })
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
    const store = storeFor(portOf(upstream))
    const catalog = new AggregateCatalog(() => store)
    await catalog.refresh()
    const shim = createWorkBuddyShim({
      pool: poolWith(async () => undefined),
      client: { prepareChatBody: (raw: string) => raw, prepareChatBodyFor: (raw: string) => raw } as unknown as WorkBuddyUpstreamClient,
      catalog: poolCatalog(),
      region: 'cn' as WorkBuddyRegion,
      aggregate: { catalog, readStore: () => store },
    })
    await shim.ready
    const port = new URL(shim.baseUrl()).port
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
        headers: { authorization: `Bearer ${shim.token()}` },
      })
      expect(response.status).toBe(200)
      const payload = await response.json() as { data: { id: string; owned_by: string }[] }
      const ids = payload.data.map(entry => entry.id)
      // The pool row is listed under its own channel prefix and the aggregate row
      // as a composite — two lanes, two self-describing spellings, one listing.
      expect(ids).toContain(`${POOL_MODEL_PREFIX}hy3`)
      expect(ids).toContain(COMPOSITE_ID)
    } finally {
      await shim.close()
      await new Promise<void>(resolve => upstream.close(() => resolve()))
    }
  })
})
describe('the SSE head is read once, not twice', () => {
  /** The stream a gateway sends when the whole answer lands in one write. */
  function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    })
  }

  it('does not repeat the first frame when the body arrives in one write', async () => {
    // The head reader seeds its frame collector with the first chunk, then keeps
    // reading and appends. Seeding it with the WHOLE head meant the first frame
    // was pushed twice the moment anything was appended after it — so a live
    // answer arrived with its opening token doubled.
    const head = await readSseHead(
      streamOf(
        'data: {"choices":[{"delta":{"content":"hi"}}]}\ndata: {"choices":[{"delta":{"content":" there"}}]}\ndata: [DONE]\n',
      ),
      new AbortController().signal,
      5_000,
    )
    expect(head.shape).toBe('sse')
    expect(head.payloads).toHaveLength(2)
    expect(head.payloads.map(payload => (JSON.parse(payload) as { choices: { delta: { content: string } }[] }).choices[0]?.delta.content)).toEqual([
      'hi',
      ' there',
    ])
  }, 30_000)

  it('joins a frame split across the chunk boundary without losing or doubling it', async () => {
    const head = await readSseHead(
      streamOf(
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
        'data: {"choices":[{"delta":{"content":" there"}}]}\n',
        'data: [DONE]\n',
      ),
      new AbortController().signal,
      5_000,
    )
    expect(head.shape).toBe('sse')
    // Same two frames, whichever way the network cut the body.
    expect(head.payloads).toHaveLength(2)
    expect(JSON.parse(head.payloads[1] ?? '{}')).toEqual({ choices: [{ delta: { content: ' there' } }] })
  }, 30_000)

  it('still hands a JSON body back as JSON', async () => {
    // The shape is decided by the bytes, not the content type: a front proxy
    // that mislabels a JSON body as an event stream is common, and believing the
    // header truncates real answers.
    const head = await readSseHead(
      streamOf('{"choices":[{"delta":{"content":"hi"}}]}'),
      new AbortController().signal,
      5_000,
    )
    expect(head.shape).toBe('json')
    expect(JSON.parse(head.text)).toEqual({ choices: [{ delta: { content: 'hi' } }] })
  }, 30_000)
})

describe('a shim built without the aggregate lane serves no third party at all', () => {
  it('never forwards a composite id', async () => {
    const seen: { model?: string; body: string }[] = []
    const upstream = await startFakeProvider(seen)
    const store = storeFor(portOf(upstream))
    const acquire = vi.fn(async () => undefined)
    const shim = createWorkBuddyShim({
      pool: poolWith(acquire),
      client: { prepareChatBody: (raw: string) => raw, prepareChatBodyFor: (raw: string) => raw } as unknown as WorkBuddyUpstreamClient,
      catalog: poolCatalog(),
      region: 'cn' as WorkBuddyRegion,
    })
    await shim.ready
    const port = new URL(shim.baseUrl()).port
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${shim.token()}` },
        body: JSON.stringify({ model: COMPOSITE_ID, messages: [] }),
      })
      await response.text()
      expect(seen).toHaveLength(0)
      expect(acquire).toHaveBeenCalled()
    } finally {
      await shim.close()
      await new Promise<void>(resolve => upstream.close(() => resolve()))
    }
  })
})