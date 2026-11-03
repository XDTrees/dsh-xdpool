/**
 * Balance mirror across restarts, and `anyAvailable()` as a retry-loop probe.
 *
 * Both exist for the same underlying reason: the pool's in-memory view is
 * empty at cold start, and two different features have to reason about that.
 *
 * 1. A credit reserve decides whether to hand an account out by comparing its
 *    LAST KNOWN balance to the floor. With no reading the account stays in play
 *    (pinned by `reserve.test.ts` — enabling a reserve must not strand an
 *    unprobed pool). Correct on a first run, wrong on a restart that happens
 *    seconds after a reading: the pool then spends straight past a floor the
 *    user set. Observed 2026-10-30, a 20,000 floor account drained from 2,869.
 *
 * 2. The 429 retry loop asks "can any account still serve this model" after
 *    penalising one. It needs the answer BETWEEN attempts, not only when it
 *    starts one — otherwise a per-account limit walks the whole pool, and each
 *    attempt both fails and burns that account's quota for the model.
 */

import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorkBuddyAccountPool } from '../src/accounts.ts'

/** Write a fake auth directory holding `count` distinct CN accounts. */
async function fakeAuthDir(count: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wbp-balance-mirror-'))
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
    const name = i === 0 ? 'workbuddy-desktop.info' : `workbuddy-desktop.b.${i}.uuid.info`
    await writeFile(join(auth, name), JSON.stringify(document), 'utf8')
  }
  return auth
}

async function tempBalancePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wbp-balance-file-'))
  return join(dir, 'credit-balances.json')
}

/** A scanned pool that mirrors balances into `path`. */
async function mirroredPool(count: number, path: string): Promise<WorkBuddyAccountPool> {
  const instance = new WorkBuddyAccountPool({
    authDirs: [await fakeAuthDir(count)],
    creditBalancePath: path,
    logger: { warn() {} },
  })
  await instance.scan()
  return instance
}

describe('credit balance mirror', () => {
  it('writes a reading to disk so the next process can restore it', async () => {
    const path = await tempBalancePath()
    const instance = await mirroredPool(1, path)
    const account = instance.list()[0]!

    instance.noteCredits(account.id, 2_869)

    const document = JSON.parse(await readFile(path, 'utf8')) as {
      version?: number
      balances?: Record<string, number>
    }
    expect(document.version).toBe(1)
    expect(document.balances?.[account.id]).toBe(2_869)
  })

  it('restores the mirror, so a reserved account is refused immediately after a restart', async () => {
    const path = await tempBalancePath()

    // First run: learn the balance, set a floor far above it.
    const first = await mirroredPool(1, path)
    const account = first.list()[0]!
    first.setCreditReserves({ [account.id]: 20_000 })
    first.noteCredits(account.id, 2_869)

    // Second run: a brand-new pool over the same auth dir and the same mirror.
    // This is the restart window the old code got wrong — with no in-memory
    // reading it let the account through and drained it.
    const second = await mirroredPool(1, path)
    second.setCreditReserves({ [account.id]: 20_000 })

    expect(second.creditsOf(account.id)).toBe(2_869)
    expect(await second.acquire()).toBeUndefined()
  })

  it('still serves an account above its floor after a restart', async () => {
    const path = await tempBalancePath()
    const first = await mirroredPool(1, path)
    const account = first.list()[0]!
    first.setCreditReserves({ [account.id]: 100 })
    first.noteCredits(account.id, 5_000)

    const second = await mirroredPool(1, path)
    second.setCreditReserves({ [account.id]: 100 })

    expect((await second.acquire())?.id).toBe(account.id)
  })

  it('skips the write when the reading did not change', async () => {
    const path = await tempBalancePath()
    const instance = await mirroredPool(1, path)
    const account = instance.list()[0]!

    instance.noteCredits(account.id, 500)
    const firstWrite = JSON.parse(await readFile(path, 'utf8')) as { at?: number }

    // Same balance again: the card polls every couple of minutes and re-reads
    // the same number, so rewriting would be pure I/O amplification.
    instance.noteCredits(account.id, 500)
    const secondWrite = JSON.parse(await readFile(path, 'utf8')) as { at?: number }

    expect(secondWrite.at).toBe(firstWrite.at)
  })

  it('starts empty when no mirror exists yet, and stays usable', async () => {
    const path = await tempBalancePath()
    const instance = await mirroredPool(1, path)
    const account = instance.list()[0]!
    instance.setCreditReserves({ [account.id]: 100 })

    // No file, no reading: the unprobed-pool rule still applies.
    expect(instance.creditsOf(account.id)).toBeUndefined()
    expect((await instance.acquire())?.id).toBe(account.id)
  })

  it('ignores a corrupt mirror rather than failing to start', async () => {
    const path = await tempBalancePath()
    await writeFile(path, '{ not json', 'utf8')
    const instance = await mirroredPool(1, path)
    expect(instance.list().length).toBe(1)
  })

  it('drops entries that are not finite non-negative numbers', async () => {
    const path = await tempBalancePath()
    // Seed the mirror by hand so the pool sees hostile values.
    await writeFile(path, JSON.stringify({ version: 1, balances: { ghost: -5, also: 'nope' } }), 'utf8')
    const instance = await mirroredPool(1, path)
    const account = instance.list()[0]!
    expect(instance.creditsOf(account.id)).toBeUndefined()
  })
})

describe('anyAvailable()', () => {
  it('is true while some account can serve the model', async () => {
    const path = await tempBalancePath()
    const instance = await mirroredPool(2, path)
    const [a, b] = instance.list()
    instance.penalize(a!.id, Date.now() + 60_000, 'glm-5.3')

    // One account is cooling for this model, the other is not.
    expect(instance.anyAvailable('glm-5.3')).toBe(true)
    expect(instance.anyAvailable('kimi-k3.1-pro')).toBe(true)
    expect(b).toBeDefined()
  })

  it('is false once every account is cooling for that model', async () => {
    const path = await tempBalancePath()
    const instance = await mirroredPool(2, path)
    const until = Date.now() + 60_000
    for (const account of instance.list()) instance.penalize(account.id, until, 'glm-5.3')

    // This is the verdict the retry loop needs BEFORE spending another attempt:
    // the next one is a guaranteed 429 that also burns quota.
    expect(instance.anyAvailable('glm-5.3')).toBe(false)
    // Another model on the same accounts is untouched — the upstream meters
    // each product row separately.
    expect(instance.anyAvailable('deepseek-v4.1-flash')).toBe(true)
  })

  it('is true again once the cooldown passes', async () => {
    const path = await tempBalancePath()
    const instance = await mirroredPool(1, path)
    const account = instance.list()[0]!
    instance.penalize(account.id, Date.now() - 1, 'glm-5.3')
    expect(instance.anyAvailable('glm-5.3')).toBe(true)
  })

  it('respects the credit reserve', async () => {
    const path = await tempBalancePath()
    const instance = await mirroredPool(1, path)
    const account = instance.list()[0]!
    instance.setCreditReserves({ [account.id]: 1_000 })
    instance.noteCredits(account.id, 10)

    expect(instance.anyAvailable('glm-5.3')).toBe(false)
  })
})
