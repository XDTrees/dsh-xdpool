/**
 * "Expiring first" distribution tests.
 *
 * The mode exists because one-off credit packs are use-it-or-lose-it: when they
 * expire the credits are gone, while an account whose packs have no deadline
 * loses nothing by waiting. So the pool should spend the soonest-to-die pack
 * first.
 *
 * Both directions are load-bearing. Spend too lazily and credits are burnt for
 * nothing; spend too eagerly — treating "we have never looked" as "about to
 * expire" — and the pool stops behaving like a pool at all. The cases below pin
 * the deadline ordering, the write-through rule that keeps a spent pack from
 * pinning the pool forever, and the two places the reading is actually wired in
 * (the shim's background refresh and the card refresh), because a mode that
 * sorts on a value nobody ever writes is indistinguishable from `priority`.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXPIRY_READING_TTL_MS, WorkBuddyAccountPool } from '../src/accounts.ts'
import { WorkBuddyCatalog } from '../src/catalog.ts'
import { createWorkBuddyShim } from '../src/shim.ts'
import { WorkBuddyUpstreamClient } from '../src/upstream.ts'
import { poolWebStatus } from '../src/web-status.ts'

const shims: { close(): Promise<void> }[] = []
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** Write a fake auth directory holding `count` distinct accounts. */
async function fakeAuthDir(count: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wbpool-expiry-'))
  tempDirs.push(dir)
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
    const name = i === 0 ? 'workbuddy-desktop.info' : `workbuddy-desktop.2026-09-0${i}T00-00-00-000Z.1.uuid.info`
    await writeFile(join(auth, name), JSON.stringify(document), 'utf8')
  }
  return auth
}

/** A scanned pool over `count` fake accounts, already in `expiry` mode. */
async function expiryPool(count: number): Promise<WorkBuddyAccountPool> {
  const instance = new WorkBuddyAccountPool({
    authDirs: [await fakeAuthDir(count)],
    logger: { warn() {}, info() {}, error() {} },
    distribution: 'expiry',
  })
  await instance.scan()
  return instance
}

/** An upstream billing envelope carrying the given raw package rows. */
function creditsEnvelope(accounts: unknown[]): Response {
  return new Response(JSON.stringify({
    code: 0,
    msg: 'ok',
    data: { Response: { Data: { Accounts: accounts } } },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

/** A one-off (non-monthly) pack that dies at `expiredTime`. */
function oneOff(expiredTime: string, remain = 50): Record<string, unknown> {
  return {
    PackageName: 'one-off', CapacityType: 1, CapacitySize: 100, CapacityRemain: remain, ExpiredTime: expiredTime,
  }
}

/** A monthly pack: it refreshes on a cycle, so it can never be "wasted". */
function monthly(cycleEndTime: string): Record<string, unknown> {
  return {
    PackageName: 'monthly', CapacityType: 4, CycleCapacitySize: 1000, CycleCapacityRemain: 800, CycleEndTime: cycleEndTime,
  }
}

const DAY = 24 * 60 * 60 * 1000

describe('reading the deadline off a billing response', () => {
  it('takes the soonest one-off pack as the account deadline', async () => {
    const client = new WorkBuddyUpstreamClient({
      fetchImpl: (async () => creditsEnvelope([
        oneOff(new Date(Date.now() + 30 * DAY).toISOString()),
        oneOff(new Date(Date.now() + 3 * DAY).toISOString()),
      ])) as unknown as typeof fetch,
    })
    const credits = await client.fetchCredits({
      accessToken: 't', refreshToken: 'r', expiresAtMs: Date.now() + 3_600_000, domain: '',
    } as never)

    const soon = Date.now() + 3 * DAY
    expect(credits.nearestExpiryMs).toBeDefined()
    // Within a second of the sooner pack, not the later one.
    expect(Math.abs((credits.nearestExpiryMs ?? 0) - soon)).toBeLessThan(1_000)
  })

  it('ignores a monthly pack, whose cycle deadline is not a deadline', async () => {
    // A monthly pack refreshes on its cycle, so an imminent CycleEndTime costs
    // the user nothing. Counting it would make `expiry` mode chase a non-loss.
    const client = new WorkBuddyUpstreamClient({
      fetchImpl: (async () => creditsEnvelope([
        monthly(new Date(Date.now() + 1_000).toISOString()),
      ])) as unknown as typeof fetch,
    })
    const credits = await client.fetchCredits({
      accessToken: 't', refreshToken: 'r', expiresAtMs: Date.now() + 3_600_000, domain: '',
    } as never)

    expect(credits.nearestExpiryMs).toBeUndefined()
    expect(credits.packages[0]?.expiresAtMs).toBeUndefined()
    // The refresh instant is still reported, which is what makes it monthly.
    expect(credits.packages[0]?.refreshAtMs).toBeDefined()
  })
})

describe('expiry mode spends the packs that are about to die', () => {
  it('serves from the account whose deadline is soonest', async () => {
    const instance = await expiryPool(3)
    const [first, second, third] = instance.list()
    // Deliberately NOT in deadline order: the middle account dies first, and
    // the last one has nothing to lose.
    instance.noteCredits(first!.id, 100, Date.now() + 20 * DAY)
    instance.noteCredits(second!.id, 100, Date.now() + 1 * DAY)
    instance.noteCredits(third!.id, 100, undefined)

    const picked = await instance.acquire()
    expect(picked?.id).toBe(second!.id)
  })

  it('falls back to priority when nobody has ever been read', async () => {
    // "We have not looked" must not outrank a real deadline — and with no
    // readings at all there is nothing to sort by, so the pool behaves exactly
    // as it does in priority mode.
    const instance = await expiryPool(2)
    const [first] = instance.list()
    const picked = await instance.acquire()
    expect(picked?.id).toBe(first!.id)
  })

  it('sorts an account with no deadline after one that has a deadline', async () => {
    const instance = await expiryPool(2)
    const [first, second] = instance.list()
    // The FIRST account in pool order has no deadline; the second does.
    instance.noteCredits(first!.id, 100, undefined)
    instance.noteCredits(second!.id, 100, Date.now() + 5 * DAY)

    const picked = await instance.acquire()
    expect(picked?.id).toBe(second!.id)
  })

  it('forgets a deadline once the pack is gone, instead of pinning the pool to it', async () => {
    // Write-through, not merge: a pack that has been spent disappears from the
    // next reading. Keeping the stale deadline would send every request back to
    // an account whose credits are already gone — the opposite of the intent.
    const instance = await expiryPool(2)
    const [first, second] = instance.list()
    instance.noteCredits(first!.id, 100, Date.now() + 1 * DAY)
    instance.noteCredits(second!.id, 100, Date.now() + 30 * DAY)
    expect((await instance.acquire())?.id).toBe(first!.id)

    instance.noteCredits(first!.id, 0, undefined)
    expect(instance.creditExpiryOf(first!.id)).toBeUndefined()
    expect((await instance.acquire())?.id).toBe(second!.id)
  })

  it('keeps pool order when two accounts die at the same instant', async () => {
    const instance = await expiryPool(2)
    const [first, second] = instance.list()
    const at = Date.now() + 2 * DAY
    instance.noteCredits(first!.id, 100, at)
    instance.noteCredits(second!.id, 100, at)

    const picked = await instance.acquire()
    expect(picked?.id).toBe(first!.id)
  })

  it('still drops a reserved account from the running, deadlines or not', async () => {
    // The mode picks within the available pool, so a reserve must survive it.
    const instance = await expiryPool(2)
    const [first, second] = instance.list()
    instance.setCreditReserves({ [first!.id]: 100, [second!.id]: 100 })
    instance.noteCredits(first!.id, 10, Date.now() + 1 * DAY)
    instance.noteCredits(second!.id, 5_000, Date.now() + 30 * DAY)

    const picked = await instance.acquire()
    expect(picked?.id).toBe(second!.id)
  })
})

describe('the deadline is actually wired in from a live reading', () => {
  it('learns it from the shim\'s background balance refresh', async () => {
    const dir = await fakeAuthDir(1)
    const instance = new WorkBuddyAccountPool({
      authDirs: [dir],
      logger: { warn() {}, info() {}, error() {} },
      distribution: 'expiry',
    })
    await instance.scan()
    const account = instance.list()[0]!
    const expiry = new Date(Date.now() + 4 * DAY).toISOString()

    const client = new WorkBuddyUpstreamClient({
      fetchImpl: (async (url: unknown) => {
        if (String(url).includes('get-user-resource')) return creditsEnvelope([oneOff(expiry)])
        return new Response('data: {"ok":true}\n\ndata: [DONE]\n\n', {
          status: 200, headers: { 'Content-Type': 'text/event-stream' },
        })
      }) as unknown as typeof fetch,
    })
    const shim = createWorkBuddyShim({ pool: instance, client, catalog: new WorkBuddyCatalog(), region: 'cn' })
    shims.push(shim)
    await shim.ready

    const response = await fetch(`${shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${shim.token()}` },
      body: JSON.stringify({ model: 'hy4-preview', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(response.status).toBe(200)
    await response.text()

    // The refresh is deliberately fire-and-forget, so wait for it rather than
    // assuming it finished with the response.
    const deadline = await waitFor(() => instance.creditExpiryOf(account.id))
    expect(deadline).toBeDefined()
    expect(Math.abs((deadline ?? 0) - Date.parse(expiry))).toBeLessThan(1_000)
  })

  it('learns it from a card refresh too', async () => {
    // The card refresh is the most frequent place a balance is read, so a mode
    // that only listened to the request path would stay blind on an idle pool.
    const dir = await fakeAuthDir(1)
    const instance = new WorkBuddyAccountPool({
      authDirs: [dir],
      logger: { warn() {}, info() {}, error() {} },
      distribution: 'expiry',
    })
    await instance.scan()
    const account = instance.list()[0]!
    const expiry = new Date(Date.now() + 6 * DAY).toISOString()

    const client = new WorkBuddyUpstreamClient({
      fetchImpl: (async (url: unknown) => {
        if (String(url).includes('get-user-resource')) return creditsEnvelope([oneOff(expiry)])
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
      }) as unknown as typeof fetch,
    })

    await poolWebStatus({
      pool: instance,
      catalogs: { cn: new WorkBuddyCatalog(), global: new WorkBuddyCatalog() },
      client,
    })

    const deadline = instance.creditExpiryOf(account.id)
    expect(deadline).toBeDefined()
    expect(Math.abs((deadline ?? 0) - Date.parse(expiry))).toBeLessThan(1_000)
  })
})

/**
 * A billing client that answers per access token, recording each read.
 *
 * Keyed by token rather than by call order so a test can say exactly which
 * account answered what, which is the only way to prove "this account was not
 * read again" rather than "some request happened".
 */
function billingClient(
  byToken: Readonly<Record<string, () => Response>>,
  onOther?: (url: string) => Response,
) {
  const reads: string[] = []
  const fetchImpl = async (url: unknown, init: RequestInit): Promise<Response> => {
    const path = String(url)
    if (!path.includes('get-user-resource')) {
      // Strict by default: a test that is not about the chat path must fail
      // loudly if something unexpected reaches upstream. Only the one case that
      // drives a real request through the shim supplies a responder.
      if (onOther === undefined) throw new Error(`unexpected upstream call: ${path}`)
      return onOther(path)
    }
    const headers = init.headers as Record<string, string>
    const token = (headers['Authorization'] ?? '').replace('Bearer ', '')
    reads.push(token)
    const answer = byToken[token]
    if (answer === undefined) throw new Error(`no billing fixture for ${token}`)
    return answer()
  }
  return { client: new WorkBuddyUpstreamClient({ fetchImpl: fetchImpl as unknown as typeof fetch }), reads }
}

/** How many reads a given token has answered. */
function readsOf(reads: readonly string[], token: string): number {
  return reads.filter(entry => entry === token).length
}

/** A logger that keeps what it was told, for asserting on the signals. */
function recordingLogger() {
  const warnings: string[] = []
  const infos: string[] = []
  return {
    warnings,
    infos,
    logger: {
      warn: (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) },
      info: (...args: unknown[]) => { infos.push(args.map(String).join(' ')) },
      error: () => {},
    },
  }
}

/** A pool over `count` fake accounts, in `expiry` mode, wired to a billing client. */
async function warmedPool(count: number, options: {
  client?: WorkBuddyUpstreamClient
  logger?: { info?(...args: unknown[]): void; warn(...args: unknown[]): void; error?(...args: unknown[]): void }
  distribution?: 'expiry' | 'priority'
  expiryReadingTtlMs?: number
} = {}): Promise<WorkBuddyAccountPool> {
  const instance = new WorkBuddyAccountPool({
    authDirs: [await fakeAuthDir(count)],
    logger: options.logger ?? { warn() {}, info() {}, error() {} },
    distribution: options.distribution ?? 'expiry',
    ...options.client === undefined ? {} : { client: options.client as never },
    ...options.expiryReadingTtlMs === undefined ? {} : { expiryReadingTtlMs: options.expiryReadingTtlMs },
  })
  await instance.scan()
  return instance
}

describe('a cold start fills its deadline readings instead of picking blind', () => {
  it('reads every account once after the scan, then serves the soonest to expire', async () => {
    // Two one-off packs, deliberately NOT in pool order: the account that dies
    // first is the one the pool would never reach by index alone. A cold start
    // used to fall back to `pool[0]` here and burn the later pack first.
    const soon = Date.now() + 1 * DAY
    const later = Date.now() + 20 * DAY
    const billing = billingClient({
      'token-0': () => creditsEnvelope([oneOff(new Date(later).toISOString())]),
      'token-1': () => creditsEnvelope([oneOff(new Date(soon).toISOString())]),
    })
    const instance = await warmedPool(2, { client: billing.client })
    const dyingFirst = instance.list().find(account => account.credential.accessToken === 'token-1')!

    // The warm is fire-and-forget on purpose, so wait for the readings rather
    // than assuming the scan awaited them.
    await waitFor(() => instance.expiryReadingOf(dyingFirst.id).state === 'at' ? true : undefined)
    expect(instance.expiryReadingOf(dyingFirst.id).state).toBe('at')
    expect(billing.reads.length).toBe(2)

    const picked = await instance.acquire()
    expect(picked?.id).toBe(dyingFirst.id)
    // Serving does not re-read: both readings are fresh.
    expect(billing.reads.length).toBe(2)
  })

  it('says so instead of silently picking the earliest of a partial reading', async () => {
    // S0: with one account unread, the earliest of the READ ones is not the
    // answer. The pick must stay on the documented fallback and be announced.
    const billing = billingClient({
      'token-0': () => creditsEnvelope([oneOff(new Date(Date.now() + 2 * DAY).toISOString())]),
      'token-1': () => { throw new Error('billing endpoint down') },
    })
    const recorder = recordingLogger()
    const instance = await warmedPool(2, { client: billing.client, logger: recorder.logger })
    const blind = instance.list().find(account => account.credential.accessToken === 'token-1')!
    await waitFor(() => recorder.warnings.some(line => line.includes('read failed')) ? true : undefined)

    const picked = await instance.acquire()
    expect(picked?.id).toBe(instance.list()[0]!.id)
    const guard = recorder.warnings.find(line => line.includes('no deadline reading'))
    expect(guard).toBeDefined()
    expect(guard).toContain(blind.label)
    expect(guard).toContain('falling back to pool order')
  })
})

describe('a finished reading is never re-read', () => {
  it('does not read a pure monthly-pack account again (S1)', async () => {
    // The account's packs all refresh on a cycle, so `fetchCredits` can never
    // report a deadline. Reading it again cannot change the answer — the old
    // code deleted the key instead of recording "nothing expires", so every
    // throttle window re-read it forever.
    const billing = billingClient({
      'token-0': () => creditsEnvelope([monthly(new Date(Date.now() + 5 * DAY).toISOString())]),
      'token-1': () => creditsEnvelope([oneOff(new Date(Date.now() + 9 * DAY).toISOString())]),
    })
    const instance = await warmedPool(2, { client: billing.client })
    await waitFor(() => instance.expiryReadingOf(instance.list()[1]!.id).state === 'at' ? true : undefined)
    const monthlyAccount = instance.list().find(account => account.credential.accessToken === 'token-0')!

    expect(instance.expiryReadingOf(monthlyAccount.id).state).toBe('none')
    expect(instance.creditExpiryOf(monthlyAccount.id)).toBeUndefined()
    expect(readsOf(billing.reads, 'token-0')).toBe(1)

    // Two more scans: the monthly account must not be read again, and neither
    // must the account whose reading is still fresh.
    await instance.scan()
    await instance.scan()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(readsOf(billing.reads, 'token-0')).toBe(1)
    expect(readsOf(billing.reads, 'token-1')).toBe(1)
  })

  it('writes the deadline only, leaving the reserve floor alone (S7)', async () => {
    // The warm was not asked for by the user, so it must not move an account
    // across its reserved-credit floor: the balance is the reserve's business.
    const billing = billingClient({
      'token-0': () => creditsEnvelope([oneOff(new Date(Date.now() + 3 * DAY).toISOString())]),
    })
    const instance = await warmedPool(1, { client: billing.client })
    const account = instance.list()[0]!
    await waitFor(() => instance.creditExpiryOf(account.id))
    instance.setCreditReserves({ [account.id]: 100 })

    // `fetchCredits` reported a total below the floor, but the warm never wrote
    // it, so the account is not held back.
    expect(instance.creditsOf(account.id)).toBeUndefined()
    expect(instance.isReserved(account.id)).toBe(false)
    expect((await instance.acquire())?.id).toBe(account.id)
  })
})

describe('a rejected sign-in is left out of the warm', () => {
  it('never reads a dead account and never revives it (S2)', async () => {
    // `get-user-resource` answers 200 for a banned account, so a successful read
    // is not proof the sign-in works. Clearing the dead mark on it is exactly
    // what got a banned account revived six times in a day.
    const billing = billingClient({
      'token-0': () => creditsEnvelope([oneOff(new Date(Date.now() + 1 * DAY).toISOString())]),
      'token-1': () => creditsEnvelope([oneOff(new Date(Date.now() + 2 * DAY).toISOString())]),
    })
    // Load the accounts without warming them, so the dead mark exists before the
    // pass that is under test.
    const instance = await warmedPool(2, { client: billing.client, distribution: 'priority' })
    const dead = instance.list().find(account => account.credential.accessToken === 'token-0')!
    instance.penalizeCredentialDead(dead.id)
    const clearSpy = vi.spyOn(instance, 'clearCredentialDead')

    instance.applyConfig({ distribution: 'expiry' })
    await instance.scan()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(readsOf(billing.reads, 'token-0')).toBe(0)
    expect(readsOf(billing.reads, 'token-1')).toBe(1)
    expect(instance.expiryReadingOf(dead.id).state).toBe('unread')
    expect(clearSpy).not.toHaveBeenCalled()
  })
})

describe('a reading ages out and is topped up without a timer', () => {
  it('treats an expired reading as unread, says so, and reads it again', async () => {
    const billing = billingClient({
      'token-0': () => creditsEnvelope([oneOff(new Date(Date.now() + 4 * DAY).toISOString())]),
    })
    const recorder = recordingLogger()
    // Long enough that the reading is still fresh when the poll below sees it,
    // short enough that the expiry is observed by waiting rather than by
    // reaching into the clock — the TTL has to work on real time, not just on an
    // injected `now`.
    const ttlMs = 500
    const instance = await warmedPool(1, {
      client: billing.client,
      logger: recorder.logger,
      expiryReadingTtlMs: ttlMs,
    })
    const account = instance.list()[0]!
    await waitFor(() => instance.creditExpiryOf(account.id))
    expect(readsOf(billing.reads, 'token-0')).toBe(1)
    expect(instance.expiryReadingOf(account.id).stale).toBe(false)

    await new Promise(resolve => setTimeout(resolve, ttlMs + 250))
    expect(instance.expiryReadingOf(account.id).stale).toBe(true)
    // The stale reading is not used as a sort key, and the degradation is said
    // out loud at `info` level rather than passing for a real answer.
    await instance.acquire()
    expect(recorder.infos.some(line => line.includes('older than'))).toBe(true)

    await instance.scan()
    await waitFor(() => instance.expiryReadingOf(account.id).stale ? undefined : true)
    expect(readsOf(billing.reads, 'token-0')).toBe(2)
    expect(instance.expiryReadingOf(account.id).state).toBe('at')
    expect(instance.expiryReadingOf(account.id).stale).toBe(false)
  })

  it('is topped up by a served request, using the request path rather than a timer', async () => {
    // The shim already refreshes balances after a successful request; the
    // deadline rides on the same heartbeat. Asserted through the pool method the
    // shim calls, so it is the wiring being tested and not a log line.
    const expiry = new Date(Date.now() + 7 * DAY).toISOString()
    const billing = billingClient({
      'token-0': () => creditsEnvelope([oneOff(expiry)]),
    }, () => new Response('data: {"ok":true}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const ttlMs = 500
    const instance = await warmedPool(1, { client: billing.client, expiryReadingTtlMs: ttlMs })
    const account = instance.list()[0]!
    await waitFor(() => instance.creditExpiryOf(account.id))
    await new Promise(resolve => setTimeout(resolve, ttlMs + 250))
    expect(instance.expiryReadingOf(account.id).stale).toBe(true)

    const warmSpy = vi.spyOn(instance, 'warmExpiryReadingFor')
    const shim = createWorkBuddyShim({
      pool: instance,
      client: billing.client,
      catalog: new WorkBuddyCatalog(),
      region: 'cn',
    })
    shims.push(shim)
    await shim.ready
    const response = await fetch(`${shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${shim.token()}` },
      body: JSON.stringify({ model: 'hy4-preview', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(response.status).toBe(200)
    await response.text()

    await waitFor(() => warmSpy.mock.calls.some(call => call[0] === account.id) ? true : undefined)
    expect(warmSpy).toHaveBeenCalledWith(account.id)
    await waitFor(() => instance.expiryReadingOf(account.id).stale ? undefined : true)
    expect(instance.expiryReadingOf(account.id).state).toBe('at')
  })
})

describe('the deadline read accepts cancellation', () => {
  it('aborts the billing request when the caller signal fires', async () => {
    // The warm must give up when the host shuts down; the built-in timeout is
    // merged with the caller's signal rather than replaced, so both still work.
    let seen: AbortSignal | undefined
    const client = new WorkBuddyUpstreamClient({
      fetchImpl: ((_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        seen = init.signal ?? undefined
        const signal = init.signal
        if (signal === undefined || signal.aborted) {
          reject(new DOMException('aborted', 'AbortError'))
          return
        }
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })) as unknown as typeof fetch,
    })
    const controller = new AbortController()
    const pending = client.fetchCredits({
      accessToken: 't', refreshToken: 'r', expiresAtMs: Date.now() + 3_600_000, domain: '',
    } as never, controller.signal)
    await waitFor(() => seen === undefined ? undefined : true)
    // A merged signal, not the raw caller one: the 30 s timeout is still armed.
    expect(seen).not.toBe(controller.signal)
    expect(seen?.aborted).toBe(false)
    controller.abort()
    await expect(pending).rejects.toThrow(/abort/i)
  })

  it('still reads normally when no signal is passed', async () => {
    const client = new WorkBuddyUpstreamClient({
      fetchImpl: (async () => creditsEnvelope([
        oneOff(new Date(Date.now() + 2 * DAY).toISOString()),
      ])) as unknown as typeof fetch,
    })
    const credits = await client.fetchCredits({
      accessToken: 't', refreshToken: 'r', expiresAtMs: Date.now() + 3_600_000, domain: '',
    } as never)
    expect(credits.nearestExpiryMs).toBeDefined()
  })
})

/** Poll `read` until it answers, or fail after a generous bound. */
async function waitFor<T>(read: () => T | undefined, timeoutMs = 5_000): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() > deadline) return undefined
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

process.on('exit', () => {
  for (const shim of shims) void shim.close()
})
