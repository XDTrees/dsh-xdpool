/**
 * The pack RPC bridge: how the client reaches the login channels' management
 * route, and what shape comes back.
 *
 * This pair of bugs is why the account pool stayed empty while accounts were
 * provably on disk: the host hands a dynamic package's client ctx a Proxy that
 * *throws* on direct property access to an undeclared service
 * (`cordis-client-runner`'s dynamic ctx), so reading `ctx.connection` inside the
 * same `try` as `ctx.get('connection')` skipped the one exempt path and left the
 * bridge unset — every `callPack` silently degraded to a raw `fetch` that the
 * host answers 401. The card then read "no accounts" while the accounts were
 * there. Nothing about it looks broken, which is why it is pinned here.
 *
 * @module dsh-xdpool/tests/client-pack-rpc
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type ChannelRpcModule = typeof import('../src/client/channel-rpc.ts')

/**
 * Load a fresh copy of the module: the bridge is module-level state, so a
 * cached copy would hand the next test the previous test's connection.
 */
async function freshModule(): Promise<ChannelRpcModule> {
  vi.resetModules()
  return await import('../src/client/channel-rpc.ts')
}

/**
 * The shape the host actually hands to a client package: a Proxy whose getter
 * rejects undeclared services by throwing (and reporting the run as failed),
 * exactly as `dynamicCordisContext` builds it.
 */
function hostileCtx(connection: unknown): { get(name: string): unknown } {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'get') return (name: string): unknown => (name === 'connection' ? connection : undefined)
      throw new Error(`service "${String(prop)}" is not declared by this plugin`)
    },
  }) as unknown as { get(name: string): unknown }
}

describe('installPackRpc', () => {
  beforeEach(() => { vi.resetModules() })

  it('falls back to ctx.get when direct property access throws', async () => {
    const rpc = { call: vi.fn().mockResolvedValue({ ok: true, value: { accounts: [] } }) }
    const mod = await freshModule()
    mod.installPackRpc(hostileCtx({ rpc }))
    // The bridge must now answer rather than degrade to a 401'd raw fetch.
    await expect(mod.callPack('account.list', {})).resolves.toEqual({ ok: true, value: { accounts: [] } })
    expect(rpc.call).toHaveBeenCalledTimes(1)
  })

  it('speaks the /api channel-pack target and the request payload shape', async () => {
    const rpc = { call: vi.fn().mockResolvedValue({ ok: true, value: { accounts: [] } }) }
    const mod = await freshModule()
    mod.installPackRpc(hostileCtx({ rpc }))
    await mod.callPack('model.list', { provider: 'zcode' })
    const [channel, endpoint, payload] = rpc.call.mock.calls[0] as [string, string, unknown]
    expect(channel).toBe('/api')
    expect(endpoint).toBe('channel-pack')
    expect(payload).toEqual({ method: 'model.list', payload: { provider: 'zcode' } })
  })

  it('reports a thrown rpc call as a failed envelope instead of rejecting', async () => {
    const rpc = { call: vi.fn().mockRejectedValue(new Error('transport failure for /api/channel-pack: HTTP 401')) }
    const mod = await freshModule()
    mod.installPackRpc(hostileCtx({ rpc }))
    const envelope = await mod.callPack('account.list', {})
    expect(envelope.ok).toBe(false)
  })

  it('leaves no bridge when the shell offers no connection service', async () => {
    const mod = await freshModule()
    mod.installPackRpc(hostileCtx(undefined))
    // No bridge → the fetch fallback, which the host answers 401. Asserted as
    // "did not crash on install", because the fallback's outcome belongs to the
    // host, not to this module.
    expect(() => mod.installPackRpc({})).not.toThrow()
  })

  it('lazily resolves the bridge when connection becomes available after installation', async () => {
    let connection: unknown = undefined
    const delayedCtx = {
      get(name: string): unknown {
        if (name === 'connection') return connection
        return undefined
      },
    }
    const mod = await freshModule()
    mod.installPackRpc(delayedCtx)

    // Initially connection is undefined, then it arrives before the first call:
    const rpc = { call: vi.fn().mockResolvedValue({ ok: true, value: { accounts: [{ id: 'test-1' }] } }) }
    connection = { rpc }

    // callPack must lazily resolve and use the bridge rather than failing to raw fetch:
    const res = await mod.callPack('account.list', { provider: 'test' })
    expect(rpc.call).toHaveBeenCalledTimes(1)
    expect(res).toEqual({ ok: true, value: { accounts: [{ id: 'test-1' }] } })
  })

  it('resets the bridge on transport failure so subsequent calls can re-resolve', async () => {
    let rpcCall = vi.fn().mockRejectedValue(new Error('connection reset'))
    let connection: unknown = { rpc: { call: rpcCall } }
    const dynamicCtx = {
      get(name: string): unknown {
        if (name === 'connection') return connection
        return undefined
      },
    }
    const mod = await freshModule()
    mod.installPackRpc(dynamicCtx)

    // First call throws:
    const res1 = await mod.callPack('account.list', {})
    expect(res1.ok).toBe(false)
    expect(res1.error?.message).toBe('connection reset')

    // Connection recovers with a new healthy rpc:
    const newRpcCall = vi.fn().mockResolvedValue({ ok: true, value: { recovered: true } })
    connection = { rpc: { call: newRpcCall } }

    const res2 = await mod.callPack('account.list', {})
    expect(newRpcCall).toHaveBeenCalledTimes(1)
    expect(res2).toEqual({ ok: true, value: { recovered: true } })
  })
})

describe('callPack envelope round trip', () => {
  it('reads accounts out of the pack\'s {ok, value:{accounts}} answer', async () => {
    // pack.js `account.list` returns `{ ok: true, value: { accounts } }`; the
    // host's parseConnectionResponse strips one shell, so `rpc.call` hands back
    // exactly that object and callPack must hand the same shape to its readers.
    const accounts = [{ id: 'zcode-1', provider: 'zcode', nickname: 'me' }]
    const rpc = { call: vi.fn().mockResolvedValue({ ok: true, value: { accounts } }) }
    const mod = await freshModule()
    mod.installPackRpc(hostileCtx({ rpc }))
    expect(mod.accountsFrom(await mod.callPack('account.list', { provider: 'zcode' }))).toEqual(accounts)
  })

  it('preserves distinct accounts that share the same nickname', async () => {
    const accounts = [
      { id: 'cline-1', provider: 'cline', nickname: 'user@example.com' },
      { id: 'cline-2', provider: 'cline', nickname: 'user@example.com' },
    ]
    const rpc = { call: vi.fn().mockResolvedValue({ ok: true, value: { accounts } }) }
    const mod = await freshModule()
    mod.installPackRpc(hostileCtx({ rpc }))
    const received = mod.accountsFrom(await mod.callPack('account.list', { provider: 'cline' }))
    expect(received).toHaveLength(2)
    expect(received.map(a => a.id)).toEqual(['cline-1', 'cline-2'])
  })

  it('keeps an account with no provider string rather than dropping it', async () => {
    const rpc = { call: vi.fn().mockResolvedValue({ ok: true, value: { accounts: [{ id: 'x-1' }] } }) }
    const mod = await freshModule()
    mod.installPackRpc(hostileCtx({ rpc }))
    expect(mod.accountsFrom(await mod.callPack('account.list', { provider: 'x' }))).toEqual([
      { id: 'x-1', provider: '' },
    ])
  })

  it('surfaces a blacklisted model as disabled so the pool can uncheck it', async () => {
    const rpc = {
      call: vi.fn().mockResolvedValue({
        ok: true,
        value: { models: { zcode: [{ id: 'gm51model', name: 'GLM-5.1' }, { id: 'qmodel', name: 'Qwen', disabled: true }] } },
      }),
    }
    const mod = await freshModule()
    mod.installPackRpc(hostileCtx({ rpc }))
    const lists = mod.modelListsFrom((await mod.callPack('model.list', { provider: 'zcode' })).value)
    expect(lists.get('zcode')?.map(model => [model.id, model.disabled ?? false])).toEqual([
      ['gm51model', false],
      ['qmodel', true],
    ])
  })
})

/**
 * `account.list` has no "all providers" mode.
 *
 * `pool.listAccounts` filters on its first line (`filter(a => a.provider === provider)`),
 * so an unscoped payload matches nothing and answers "no accounts" for a channel
 * that holds three — silently, with no error to notice. That is the bug this
 * file exists to prevent from coming back, and it is invisible in a screenshot:
 * the page renders, it just renders nothing.
 *
 * This fake re-implements the pack's own filter, so a caller that drops the
 * provider fails here exactly as it fails against the real route.
 */
describe('account.list is provider-scoped', () => {
  const onDisk = [
    { id: 'zcode-1', provider: 'zcode', nickname: 'ZCode one' },
    { id: 'zcode-2', provider: 'zcode', nickname: 'ZCode two' },
    { id: 'trae-1', provider: 'trae', nickname: 'TRAE one' },
  ]
  function packLikeRpc() {
    return {
      call: vi.fn(async (_channel: string, _endpoint: string, request: unknown) => {
        const { method, payload } = request as { method: string; payload: { provider?: string } }
        if (method === 'provider.status') {
          const providers = (request as { payload: { providers: string[] } }).payload.providers
          const statuses: Record<string, unknown> = {}
          for (const provider of providers) {
            const total = onDisk.filter(entry => entry.provider === provider).length
            statuses[provider] = {
              models: { total: 0, disabled: 0 },
              accounts: { total, enabled: total },
              closed: false,
            }
          }
          return { ok: true, value: { statuses } }
        }
        if (method === 'account.list') {
          return {
            ok: true,
            value: { accounts: onDisk.filter(entry => entry.provider === payload.provider) },
          }
        }
        return { ok: true, value: { models: { [String(payload?.provider)]: [] } } }
      }),
    }
  }

  it('finds the three accounts the pool page has on disk', async () => {
    const mod = await freshModule()
    const rpc = packLikeRpc()
    mod.installPackRpc(hostileCtx({ rpc }))
    // What the pool page now does: one status round trip, then a scoped list.
    const statuses = mod.providerStatusesFrom(await mod.callPack('provider.status', {
      providers: ['zcode', 'trae', 'cline'],
    }))
    expect(statuses.get('zcode')?.accountsTotal).toBe(2)
    expect(statuses.get('trae')?.accountsTotal).toBe(1)
    expect(statuses.get('cline')?.accountsTotal).toBe(0)
    expect(
      mod.accountsFrom(await mod.callPack('account.list', { provider: 'zcode' })).map(a => a.id),
    ).toEqual(['zcode-1', 'zcode-2'])
  })

  it('answers empty for a channel with no account, without erroring', async () => {
    const mod = await freshModule()
    mod.installPackRpc(hostileCtx({ rpc: packLikeRpc() }))
    const envelope = await mod.callPack('account.list', { provider: 'cline' })
    expect(envelope.ok).toBe(true)
    expect(mod.accountsFrom(envelope)).toEqual([])
  })
})
/**
 * The catalogue's facts, and the window cap, on one code path.
 *
 * Two regressions are pinned here because both render as a plausible-looking
 * page rather than an error: a row with no window/figure at all (the pack used
 * to drop everything but id/name/disabled/dead, and the host's own list is
 * gated on a resolvable credential, so eight of nine channels had none), and a
 * cap that silently fails to apply (a budget at or above the native window is a
 * no-op server-side, so the UI must never send one).
 */
describe('catalogue facts and the window cap', () => {
  const rows = [
    // Vendor order, deliberately not reader order.
    { id: 'paid-small', name: 'Paid Small', contextWindow: 128_000, isFree: false, reasoning: true },
    { id: 'free-wide', name: 'Free Wide', contextWindow: 200_000, isFree: true, inputModalities: ['text', 'image'] },
    { id: 'free-narrow', name: 'Free Narrow', contextWindow: 32_000, isFree: true },
    { id: 'paid-wide', name: 'Paid Wide', contextWindow: 1_000_000, inputModalities: ['text'] },
  ]
  function catalogueRpc() {
    return {
      call: vi.fn(async (_channel: string, _endpoint: string, request: unknown) => {
        const { method, payload } = request as { method: string; payload: { provider: string; modelId?: string; budget?: number | null } }
        if (method === 'model.list') return { ok: true, value: { models: rows } }
        if (method === 'model.setContextBudget') {
          if (payload.budget === null) return { ok: true, value: { contextBudgets: {} } }
          return { ok: true, value: { contextBudgets: { [payload.modelId as string]: payload.budget } } }
        }
        return { ok: true, value: {} }
      }),
    }
  }

  it('keeps every fact the pack now answers on the row', async () => {
    const mod = await freshModule()
    mod.installPackRpc(hostileCtx({ rpc: catalogueRpc() }))
    const models = mod.modelsFrom((await mod.callPack('model.list', { provider: 'zcode' })).value)
    expect(models.find(m => m.id === 'free-wide')).toMatchObject({
      contextWindow: 200_000,
      isFree: true,
      inputModalities: ['text', 'image'],
    })
    // Reasoning arrives as a boolean, not an effort list: the picker prints one
    // fact, and shipping the enum per row would be noise.
    expect(models.find(m => m.id === 'paid-small')?.reasoning).toBe(true)
  })

  it('sorts free first, then widest, then vision, then name', async () => {
    const mod = await freshModule()
    mod.installPackRpc(hostileCtx({ rpc: catalogueRpc() }))
    const sorted = mod.sortChannelModels(mod.modelsFrom((await mod.callPack('model.list', { provider: 'zcode' })).value))
    expect(sorted.map(m => m.id)).toEqual(['free-wide', 'free-narrow', 'paid-wide', 'paid-small'])
  })

  it('sends the cap, and reports the applied value back on the row', async () => {
    const mod = await freshModule()
    const rpc = catalogueRpc()
    mod.installPackRpc(hostileCtx({ rpc }))
    const envelope = await mod.setChannelModelContextBudget('zcode', 'paid-wide', 200_000)
    const [, , request] = rpc.call.mock.calls[0] as [string, string, { payload: { budget: number } }]
    expect(request.payload.budget).toBe(200_000)
    expect((envelope.value as { contextBudget?: number }).contextBudget).toBe(200_000)
  })

  it('clears the cap by sending null rather than zero', async () => {
    const mod = await freshModule()
    const rpc = catalogueRpc()
    mod.installPackRpc(hostileCtx({ rpc }))
    await mod.setChannelModelContextBudget('zcode', 'paid-wide', undefined)
    const [, , request] = rpc.call.mock.calls[0] as [string, string, { payload: { budget: null } }]
    // A 0 would be written into the state file as "cap at zero tokens".
    expect(request.payload.budget).toBeNull()
  })
})
