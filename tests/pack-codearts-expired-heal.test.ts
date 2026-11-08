/**
 * CodeArts: an expired STS credential must be healed before it is reported.
 *
 * A Huawei STS triple lives ~2 hours; the refresh_token behind it lives ~30 days. The
 * gateway answers an expired one with `APIG.0602 Bad request: the security token has
 * expired`, which reads like a sign-in failure. Two things went wrong because of it:
 *
 *   1. the card said "启用 · 长期有效" while the balance cell showed that 400 — both
 *      halves wrong, each pushing the reader to a different wrong next step;
 *   2. an account that a model request had failed over AWAY from never re-entered the
 *      scheduler's "expiring within the hour" window, so it sat expired indefinitely
 *      behind a refresh_token that would have fixed it in one call.
 *
 * The heal is placed on `handleMethod` rather than in one RPC branch because three
 * families read that credential and any of them can be the first call after expiry:
 * `credits.balances`, `credits.status`, `credits.claimAll`.
 *
 * Ported from unmerged PR #114, whose `pack.js` half never reached `main`.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const pack = readFileSync(new URL('../vendor/channel-pack/pack.js', import.meta.url), 'utf8')

describe('the expired-credential heal', () => {
  it('defines the expiry predicate and the heal', () => {
    expect(pack).toContain('function codeartsCredentialExpired(credential)')
    expect(pack).toContain('async function healExpiredCodeArtsCredentials(')
  })

  it('reads the credential\'s OWN stamp, not the pool mirror', () => {
    // The pool copy can be stale after any write; only the credential file knows.
    const start = pack.indexOf('function codeartsCredentialExpired(credential)')
    const body = pack.slice(start, start + 420)
    expect(body).toContain('credential.expires_at')
    expect(body).not.toContain('pool')
  })

  it('runs on the shared handleMethod entry, before the method switch', () => {
    // Patching one branch would leave the other two reporting a dead sign-in for a
    // credential that one refresh fixes.
    const entry = pack.indexOf('  async function handleMethod(method, payload, _signal) {')
    expect(entry).toBeGreaterThan(-1)
    const after = pack.slice(entry, entry + 2600)
    const healAt = after.indexOf('healExpiredCodeArtsCredentials(')
    const switchAt = after.indexOf('method.startsWith("opencode.")')
    expect(healAt).toBeGreaterThan(-1)
    expect(switchAt).toBeGreaterThan(-1)
    expect(healAt).toBeLessThan(switchAt)
    // Scoped to the CodeArts provider only.
    expect(after.slice(0, healAt)).toContain('payload.provider === "codearts"')
  })

  it('goes through the scheduler\'s serial queue so one token is never spent twice', () => {
    // Huawei rotates on use: two concurrent refreshes leave one holding a spent
    // token, which is exactly the STS5.1806 the companion patch classifies.
    expect(pack).toContain('await auth.refreshAccountCredential(entry.credentialRef, pool, entry.id)')
  })

  it('is best-effort: a failed heal must not replace the real error', () => {
    // The balance line is the only place left that can say "sign in again"; turning a
    // heal failure into an exception would trade a useful message for a crash.
    const start = pack.indexOf('async function healExpiredCodeArtsCredentials(')
    const body = pack.slice(start, start + 1400)
    expect(body).toContain('catch (error)')
    // Swallowed, not rethrown.
    expect(body).not.toMatch(/catch \(error\) \{\s*throw/u)
  })

  it('only refuses to heal when the credential cannot refresh at all', () => {
    const start = pack.indexOf('async function healExpiredCodeArtsCredentials(')
    const body = pack.slice(start, start + 1400)
    expect(body).toContain('if (!isCodeArtsRefreshable(credential)) continue')
  })

  it('names the condition in the balance error instead of only echoing APIG', () => {
    // Only when it really is expired — a 5xx keeps its original wording.
    const start = pack.indexOf('const advice = codeartsCredentialExpired(credential)')
    expect(start).toBeGreaterThan(-1)
    const around = pack.slice(start, start + 600)
    expect(around).toContain('advice')
    // The advice text points at the action that works, not at signing in again.
    expect(pack).toContain('\\u70B9\\u300C\\u5237\\u65B0\\u51ED\\u636E\\u300D')
  })
})
