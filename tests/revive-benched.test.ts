/**
 * A benched credential gets asked, not just waited out.
 *
 * The cooldown that follows a rejected sign-in is a GUESS at how long the problem
 * lasts, and it is routinely wrong in both directions:
 *
 *   - too long: the user signs in again in the desktop app, and the pooled copy
 *     sits out the remaining half hour "just in case";
 *   - too short: a transient upstream hiccup benched a healthy account, and
 *     nothing brings it back until the window expires.
 *
 * `reviveBenched` replaces "wait and hope" with "ask": one cheap authenticated
 * read per benched account, and only a SUCCESSFUL one clears the bench. The
 * asymmetry is the whole design — a failed probe must never extend or shorten a
 * bench, otherwise how often we probe would change how long accounts stay out.
 */
import { describe, expect, it, vi } from 'vitest'
import { WorkBuddyAccountPool } from '../src/accounts.ts'
import type { WorkBuddyCredential } from '../src/accounts.ts'

function credential(id: string): WorkBuddyCredential {
  return {
    accessToken: `token-${id}`,
    refreshToken: `refresh-${id}`,
    expiresAtMs: Date.now() + 3_600_000,
    domain: 'copilot.tencent.com',
    sourcePath: `/tmp/${id}.json`,
    label: `Account ${id.toUpperCase()}`,
    // `uid` is what tells two logins apart: without it the pool dedupes two
    // credentials on the same domain into ONE account, so a two-account fixture
    // silently became a one-account fixture.
    uid: id,
  } as unknown as WorkBuddyCredential
}

/**
 * A pool holding `ids`, discovered through the external-source seam.
 *
 * `authDirs: []` is load-bearing: without it `scan()` also reads the developer's
 * own desktop auth directory, so on this machine the fixture silently held seven
 * real accounts beside the two it declared and every count in this file was
 * wrong. A test that depends on what happens to be signed in is not a test.
 */
async function poolWith(ids: readonly string[]): Promise<WorkBuddyAccountPool> {
  const pool = new WorkBuddyAccountPool({ authDirs: [], persistent: false })
  pool.applyExternalSource(async () => ids.map(credential))
  await pool.scan()
  return pool
}

describe('reviveBenched asks instead of waiting', () => {
  it('returns a benched account to rotation when the probe succeeds', async () => {
    const pool = await poolWith(['a', 'b'])
    const benchedId = pool.list()[0]?.id
    if (benchedId === undefined) throw new Error('fixture lost its accounts')
    pool.penalizeCredentialDead(benchedId)
    expect(pool.deadCredentials().map(entry => entry.id)).toEqual([benchedId])

    const revived = await pool.reviveBenched(async () => ({ ok: true }))
    expect(revived.map(entry => entry.id)).toEqual([benchedId])
    expect(pool.deadCredentials()).toEqual([])
  })

  it('leaves the bench EXACTLY as it was when the probe fails', async () => {
    const pool = await poolWith(['a'])
    const benchedId = pool.list()[0]?.id
    if (benchedId === undefined) throw new Error('fixture lost its account')
    pool.penalizeCredentialDead(benchedId)
    const before = pool.list()[0]?.credentialDeadUntilMs
    expect(before).toBeGreaterThan(Date.now())

    await pool.reviveBenched(async () => { throw new Error('still 401') })

    // Untouched — not extended, not shortened, not cleared. A probe is evidence
    // only when it succeeds; treating a failure as new information would make the
    // cooldown depend on the probe interval.
    expect(pool.list()[0]?.credentialDeadUntilMs).toBe(before)
    expect(pool.deadCredentials().map(entry => entry.id)).toEqual([benchedId])
  })

  it('does not probe accounts that are not benched', async () => {
    const pool = await poolWith(['a', 'b'])
    const benchedId = pool.list()[0]?.id
    if (benchedId === undefined) throw new Error('fixture lost its accounts')
    pool.penalizeCredentialDead(benchedId)
    const probe = vi.fn(async () => ({ ok: true }))
    await pool.reviveBenched(probe)
    // Only the benched account is probed. Probing healthy ones would add an
    // upstream call per account per run for no information.
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('does nothing at all, and spends no calls, when nothing is benched', async () => {
    const pool = await poolWith(['a'])
    const probe = vi.fn(async () => ({ ok: true }))
    expect(await pool.reviveBenched(probe)).toEqual([])
    expect(probe).not.toHaveBeenCalled()
  })

  it('revives the ones that answer and keeps the ones that do not', async () => {
    const pool = await poolWith(['a', 'b'])
    for (const account of pool.list()) pool.penalizeCredentialDead(account.id)
    expect(pool.deadCredentials()).toHaveLength(2)
    // The upstream accepts only the first account's token.
    const good = pool.list()[0]?.credential.accessToken
    const revived = await pool.reviveBenched(async credential => {
      if (credential.accessToken === good) return { ok: true }
      throw new Error('401')
    })
    expect(revived).toHaveLength(1)
    expect(pool.deadCredentials()).toHaveLength(1)
  })

  it('the probe receives each account own credential, not a shared one', async () => {
    const pool = await poolWith(['a'])
    const account = pool.list()[0]
    if (account === undefined) throw new Error('fixture lost its account')
    pool.penalizeCredentialDead(account.id)
    const seen: string[] = []
    await pool.reviveBenched(async credential => {
      seen.push(credential.accessToken)
      return { ok: true }
    })
    // Probing with the wrong token would clear a credential that is still broken,
    // which is worse than never reviving it.
    expect(seen).toEqual([account.credential.accessToken])
  })
})
