/**
 * A credit reserve explains the failure only when it explains ALL of it (#98).
 *
 * Reported from a five-account pool: one account ("不虚") sat at 2870 credits
 * against a 20000 reserve and had done so for weeks. Every time the pool could
 * not serve a request, `unavailableReason` walked the accounts, met that one
 * first, and returned `reason: 'reserve'` — which the shim turns into a 402 that
 * says "lower the reserve on the pool card". The other four accounts were never
 * even looked at, so a real cooldown or a revoked sign-in was reported as a
 * setting the user had made deliberately.
 *
 * The rule the fix encodes: `dead` / `cooling` / `disabled` describe something
 * the user cannot fix by editing a number, so they are reported first. `reserve`
 * is what is left when every usable account is parked under its floor.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorkBuddyAccountPool } from '../src/accounts.ts'

/** A pool with `count` CN accounts, all with fresh credentials. */
async function poolWith(count: number): Promise<WorkBuddyAccountPool> {
  const dir = mkdtempSync(join(tmpdir(), 'wbpool-reserve-'))
  for (let i = 0; i < count; i += 1) {
    writeFileSync(join(dir, `workbuddy-desktop.r${i}.info`), JSON.stringify({
      auth: {
        accessToken: `token-${i}`, refreshToken: 'r',
        expiresAt: Date.now() + 3_600_000, domain: 'www.workbuddy.cn',
      },
      account: { uid: `uid-${i}`, uin: `uin-${i}`, nickname: `acct${i}` },
    }))
  }
  const pool = new WorkBuddyAccountPool({ authDirs: [dir], logger: { warn() {} } })
  await pool.scan()
  return pool
}

describe('one parked account does not speak for the whole pool', () => {
  it('reports the reserve only when EVERY usable account is under its floor', async () => {
    const pool = await poolWith(2)
    const [first, second] = pool.list('cn')
    pool.setCreditReserves({ [first!.id]: 20_000, [second!.id]: 20_000 })
    pool.noteCredits(first!.id, 2_870)
    pool.noteCredits(second!.id, 50_000)
    // The second account is well above its floor, so the reserve is not what is
    // blocking anything.
    expect(pool.unavailableReason('hy3', 'cn').reason).toBe('none')

    // Park the second one too, and now the reserve really is the answer.
    pool.noteCredits(second!.id, 100)
    expect(pool.unavailableReason('hy3', 'cn').reason).toBe('reserve')
  })

  it('lets a cooldown outrank a parked account', async () => {
    // The reported case: one account under its reserve, the rest rate-limited.
    // The old code returned `reserve` on the FIRST account it met and never saw
    // the cooldowns, so the user was told to lower a reserve that was not the
    // problem.
    const pool = await poolWith(2)
    const [first, second] = pool.list('cn')
    pool.setCreditReserves({ [first!.id]: 20_000 })
    pool.noteCredits(first!.id, 0)
    pool.penalize(second!.id, Date.now() + 60 * 60 * 1000, 'hy3')
    const why = pool.unavailableReason('hy3', 'cn')
    expect(why.reason).toBe('cooling')
    expect(why.cooling).toBe(1)
  })

  it('lets a revoked sign-in outrank a parked account', async () => {
    // Waiting does not fix a revoked credential, and neither does a reserve
    // edit — so the "sign in again" answer must win over the 402.
    const pool = await poolWith(2)
    const [first, second] = pool.list('cn')
    pool.setCreditReserves({ [first!.id]: 20_000 })
    pool.noteCredits(first!.id, 0)
    pool.penalizeCredentialDead(second!.id)
    const why = pool.unavailableReason('hy3', 'cn')
    expect(why.reason).toBe('session_dead')
    expect(why.dead).toBe(1)
  })

  it('still counts a disabled account as its own explanation', async () => {
    const pool = await poolWith(2)
    const [first, second] = pool.list('cn')
    pool.setCreditReserves({ [first!.id]: 20_000 })
    pool.noteCredits(first!.id, 0)
    pool.applyConfig({ disabledAccountIds: [second!.id] })
    expect(pool.unavailableReason('hy3', 'cn').reason).toBe('disabled')
  })

  it('keeps an exempt account out of the reserve count entirely', async () => {
    // `reserveExempt` is how a freshly confirmed zero-price model gets through a
    // protected balance. An exempt account must not drag the pool into 402.
    const pool = await poolWith(1)
    const only = pool.list('cn')[0]!
    pool.setCreditReserves({ [only.id]: 20_000 })
    pool.noteCredits(only.id, 0)
    expect(pool.unavailableReason('hy3', 'cn').reason).toBe('reserve')
    expect(pool.unavailableReason('hy3', 'cn', new Set([only.id])).reason).toBe('none')
  })

  it('says "none" when no reserve is configured at all', async () => {
    const pool = await poolWith(1)
    expect(pool.unavailableReason('hy3', 'cn').reason).toBe('none')
  })
})
