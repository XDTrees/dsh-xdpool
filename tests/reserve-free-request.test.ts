import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkBuddyAccountPool, type WorkBuddyCredential } from '../src/accounts.ts'
import { WorkBuddyCatalog } from '../src/catalog.ts'
import { createWorkBuddyShim, type WorkBuddyShim } from '../src/shim.ts'
import type { WorkBuddyUpstreamClient, WorkBuddyUpstreamModel } from '../src/upstream.ts'

const dirs: string[] = []
const shims: WorkBuddyShim[] = []
afterEach(async () => {
  await Promise.all(shims.splice(0).map(shim => shim.close()))
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})
function model(creditMultiplier?: number, tags?: string[]): WorkBuddyUpstreamModel {
  return { id: 'hy3', name: 'Hy3', contextWindow: 32000, maxTokens: 1000,
    ...(creditMultiplier === undefined ? {} : { creditMultiplier }),
    ...(tags === undefined ? {} : { tags }) }
}
async function fixture(pricing: (credential: WorkBuddyCredential, signal?: AbortSignal) => Promise<readonly WorkBuddyUpstreamModel[]>, count = 1) {
  const dir = await mkdtemp(join(tmpdir(), 'reserve-free-'))
  dirs.push(dir)
  const auth = join(dir, 'auth')
  await mkdir(auth)
  for (let n = 0; n < count; n += 1) {
    await writeFile(join(auth, n === 0 ? 'workbuddy-desktop.info' : `workbuddy-desktop.r.${n}.uuid.info`), JSON.stringify({
      auth: { accessToken: `fixture-token-${n}`, refreshToken: `fixture-refresh-${n}`, expiresAt: Date.now() + 3600000, domain: '' },
      account: { uin: `fixture-user-${n}`, nickname: `fixture-${n}` },
    }))
  }
  const pool = new WorkBuddyAccountPool({ authDirs: [auth], logger: { warn() {} } })
  await pool.scan()
  const id = pool.list()[0]!.id
  pool.setCreditReserves(Object.fromEntries(pool.list().map(account => [account.id, 1])))
  for (const account of pool.list()) pool.noteCredits(account.id, 0)
  const catalog = new WorkBuddyCatalog()
  const fetchModels = vi.fn(pricing)
  const chatStream = vi.fn(async (..._args: unknown[]) => ({ ok: true, response: new Response('data: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  }) }))
  const client = {
    fetchModels, chatStream,
    prepareChatBodyFor: (raw: string) => JSON.parse(raw),
    fetchCredits: async () => { throw new Error('no background billing in fixture') },
  } as unknown as WorkBuddyUpstreamClient
  const shim = createWorkBuddyShim({ pool, catalog, client, region: 'cn' })
  shims.push(shim)
  await shim.ready
  async function ask(modelId = 'hy3') {
    const response = await fetch(`${shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${shim.token()}` },
      body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'test' }] }),
    })
    return { status: response.status, body: await response.text() }
  }
  return { pool, catalog, id, fetchModels, chatStream, ask }
}
describe('zero-credit requests with a protected zero balance', () => {
  it('tries a freshly confirmed zero-price model, including the buddy prefix', async () => {
    const f = await fixture(async () => [model(0)])
    expect((await f.ask('buddy:hy3')).status).toBe(200)
    expect(f.fetchModels).toHaveBeenCalledTimes(1)
    expect(f.chatStream).toHaveBeenCalledTimes(1)
    expect(f.chatStream.mock.calls[0]?.[1]).toMatchObject({ model: 'hy3' })
    expect(f.pool.creditReserveOf(f.id)).toBe(1)
  })
  it.each([
    ['paid', model(0.29)],
    ['unknown', model()],
    ['promo badge without a zero price', model(0.29, ['badge:限时免费:#FF0000'])],
    ['night promo badge', model(0.29, ['badge:夜间免费:#FF0000'])],
  ])('keeps the reserve for %s', async (_label, row) => {
    const f = await fixture(async () => [row as WorkBuddyUpstreamModel])
    const result = await f.ask()
    expect(result.status).toBe(402)
    expect(result.body).toContain('reserve_floor')
    expect(result.body).not.toContain('every WorkBuddy account')
    expect(f.chatStream).not.toHaveBeenCalled()
  })
  it('does not reuse an old free price after the upstream changes it', async () => {
    let price = 0
    const f = await fixture(async () => [model(price)])
    expect((await f.ask()).status).toBe(200)
    price = 1
    expect((await f.ask()).status).toBe(402)
    expect(f.chatStream).toHaveBeenCalledTimes(1)
  })
  it('does not trust stale live prices when the refresh fails', async () => {
    const f = await fixture(async () => { throw new Error('offline') })
    f.catalog.updateFromUpstream([model(0)])
    expect((await f.ask()).status).toBe(402)
    expect(f.chatStream).not.toHaveBeenCalled()
  })
  it('does not treat an empty response or a missing model as free', async () => {
    const f = await fixture(async () => [])
    expect((await f.ask()).status).toBe(402)
    expect(f.chatStream).not.toHaveBeenCalled()
  })
  it('does not trust a model that is absent from the fresh response', async () => {
    const f = await fixture(async () => [{ ...model(0), id: 'another-model' }])
    expect((await f.ask()).status).toBe(402)
    expect(f.chatStream).not.toHaveBeenCalled()
  })
  it('does not bypass dead credentials or region boundaries', async () => {
    const f = await fixture(async () => [model(0)])
    expect(await f.pool.acquire('hy3', 'global', undefined, new Set([f.id]))).toBeUndefined()
    f.pool.penalizeCredentialDead(f.id)
    expect(await f.pool.acquire('hy3', 'cn', undefined, new Set([f.id]))).toBeUndefined()
    expect(f.pool.unavailableReason('hy3', 'cn', new Set([f.id])).reason).toBe('session_dead')
    expect(f.chatStream).not.toHaveBeenCalled()
  })
  it('never borrows a free price from another account, even when the paid one is preferred', async () => {
    const f = await fixture(async credential => [model(credential.accessToken === 'fixture-token-0' ? 1 : 0)], 2)
    const paid = f.pool.list().find(account => account.credential.accessToken === 'fixture-token-0')!
    f.pool.prefer(paid.id)
    expect((await f.ask()).status).toBe(200)
    expect(f.chatStream.mock.calls[0]?.[0]).toMatchObject({ accessToken: 'fixture-token-1' })
  })
  it('a failed price read for one account does not hide another free account', async () => {
    const f = await fixture(async credential => {
      if (credential.accessToken === 'fixture-token-0') throw new Error('offline')
      return [model(0)]
    }, 2)
    expect((await f.ask()).status).toBe(200)
    expect(f.chatStream.mock.calls[0]?.[0]).toMatchObject({ accessToken: 'fixture-token-1' })
  })
  it('does not query pricing when an ordinary eligible account can serve', async () => {
    const f = await fixture(async () => { throw new Error('must not query') }, 2)
    f.pool.noteCredits(f.pool.list()[1]!.id, 100)
    expect((await f.ask()).status).toBe(200)
    expect(f.fetchModels).not.toHaveBeenCalled()
  })
  it('passes a cancellation/timeout signal to the pricing read', async () => {
    const f = await fixture(async (_credential, signal) => {
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal?.aborted).toBe(false)
      return [model(0)]
    })
    expect((await f.ask()).status).toBe(200)
  })
  it('zero disables the floor, without requiring a pricing query', async () => {
    const f = await fixture(async () => { throw new Error('must not query') })
    f.pool.setCreditReserves({ [f.id]: 0 })
    expect((await f.ask()).status).toBe(200)
    expect(f.fetchModels).not.toHaveBeenCalled()
  })
  it('free exemptions still honor model cooldowns and disabled accounts', async () => {
    const f = await fixture(async () => [model(0)])
    f.pool.penalize(f.id, undefined, 'hy3')
    expect((await f.ask()).status).toBe(429)
    expect(f.pool.unavailableReason('hy3', 'cn', new Set([f.id])).reason).toBe('cooling')
    f.pool.applyConfig({ disabledAccountIds: [f.id] })
    expect(await f.pool.acquire('hy3', 'cn', undefined, new Set([f.id]))).toBeUndefined()
    expect(f.chatStream).not.toHaveBeenCalled()
  })
})
