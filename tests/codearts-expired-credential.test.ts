/**
 * CodeArts: an expired STS credential is healed, then named, never just echoed.
 *
 * Reported 2026-11-03 against `codearts-4c263b4b`: the balance cell read
 * `HTTP 400 APIG.0602 Bad request: the security token has expired` on an account
 * the card simultaneously labelled "启用 · 长期有效".
 *
 * The label half of that is `channel-expiry-label.test.ts`. This file covers the
 * host half, where two separate things were missing:
 *
 *   1. **No heal.** Huawei mints these AK/SK/security-token triples with a two
 *      hour life while the refresh_token behind them lives ~30 days. The
 *      30-minute scheduler only re-mints inside a lead window, and a credential
 *      the pool has stopped rotating (its model requests fail over to a sibling)
 *      never reaches it. So a perfectly refreshable account sat expired, and the
 *      panel's first action was to report it. Opening the panel now re-mints
 *      first — through `refreshAccountCredential`, the same per-ref serial queue
 *      the scheduler uses, so the two can never consume one refresh_token twice.
 *   2. **No advice.** `APIG.0602` reads like a dead sign-in. It is not: one
 *      refresh fixes it. The copy only says so when the stamp really is past, so
 *      a 5xx keeps its own wording instead of borrowing that hint.
 *
 * Both failures are silently swallowed on purpose — an `invalid_grant` (token
 * rotated away by another client) must still let the balance query run, because
 * that row is the only place left that can tell the user to sign in again.
 *
 * Source-level assertions: these paths need live credentials and a network, and
 * a test that had to reach Huawei would be neither hermetic nor honest here.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pack = readFileSync(new URL('../vendor/channel-pack/pack.js', import.meta.url), 'utf8')

/**
 * The CodeArts branch of `credits.balances`, up to the next provider.
 *
 * Anchored on the `case` label, not on the bare provider check: `codearts.status`
 * and `credits.claimAll` carry the same `if (req.provider === "codearts")` line
 * and both appear earlier in the file, so a bare anchor silently asserts about
 * the wrong branch.
 */
const codeartsBranch = pack.slice(
  pack.indexOf('case "credits.balances": {'),
  pack.indexOf('if (req.provider === LOBSTERAI.id) {', pack.indexOf('case "credits.balances": {')),
)

/** The heal helper body, bounded by the collector that follows it. */
const healHelper = pack.slice(
  pack.indexOf('async function healExpiredCodeArtsCredentials('),
  pack.indexOf('async function collectCreditBalances('),
)

describe('every CodeArts entry point heals, not just the panel', () => {
  it('heals at the shared RPC gate, before the method switch', () => {
    // One heal covers `credits.balances` (panel), `credits.status` and
    // `credits.claimAll` (the 09:00 check-in). Patching a single branch would
    // have left the scheduler failing silently on the same expired credential.
    const gate = pack.slice(
      pack.indexOf('async function handleMethod('),
      pack.indexOf('switch (method) {', pack.indexOf('async function handleMethod(')),
    )
    expect(gate).toContain('payload.provider === "codearts"')
    expect(gate).toContain('healExpiredCodeArtsCredentials(')
    expect(gate).toContain('await pool.listAccounts("codearts")')
    // Guarded: a heal failure must not replace the request's own answer.
    expect(gate).toContain('catch (error)')
    expect(gate).not.toContain('throw ')
  })

  it('no longer heals inside a single branch', () => {
    // Two heal sites would be two chances to drift apart.
    const count = (pack.match(/healExpiredCodeArtsCredentials\(/g) ?? []).length
    expect(count).toBe(2) // the definition + exactly one call
  })

  it('decides from the credential\'s own stamp, not from the pool cache', () => {
    // `pool.listAccounts` returns a mirror of `expires_at` that any write can
    // leave stale; the credential is the thing that is actually signed with.
    expect(pack).toContain('function codeartsCredentialExpired(')
    expect(pack).toContain('Date.parse(raw)')
    expect(healHelper).toContain('codeartsCredentialExpired(credential)')
  })

  it('re-mints through the SAME serial queue the scheduler uses', () => {
    // A second path that re-minted on its own would race the 30-minute loop into
    // replaying one refresh_token — and Huawei invalidates the old one on issue,
    // so the loser reads as "refresh_token revoked" and the account is marked
    // unrefreshable while its token was healthy.
    expect(healHelper).toContain('auth.refreshAccountCredential(entry.credentialRef, pool, entry.id)')
    expect(healHelper).not.toContain('refreshCredentialUnderLock')
    expect(healHelper).not.toMatch(/fetch\(/u)
  })

  it('is best-effort: a refused refresh still lets the query run', () => {
    // Swallowing here is deliberate. The reported error is what tells the user to
    // sign in again; turning a heal failure into a thrown exception would replace
    // that actionable row with a bare crash.
    expect(healHelper).toContain('catch (error)')
    expect(healHelper).not.toContain('throw ')
  })

  it('skips what it cannot heal instead of asking anyway', () => {
    // Disabled accounts are out of rotation by the user's own choice, and a
    // credential with no refresh material would only produce a rejected call.
    expect(healHelper).toContain('entry.enabled === false')
    expect(healHelper).toContain('isCodeArtsRefreshable(credential)')
  })
})

describe('the error names the cause and the fix', () => {
  it('adds the advice only when the stamp is actually past', () => {
    // Guarding on the stamp is what keeps a 5xx from borrowing sign-in advice.
    expect(codeartsBranch).toMatch(/codeartsCredentialExpired\(credential\)/u)
    expect(codeartsBranch).toContain('\\u5237\\u65B0\\u51ED\\u636E')
    expect(codeartsBranch).toContain('\\u65E0\\u9700\\u91CD\\u65B0\\u767B\\u5F55')
  })

  it('still passes the upstream message through untouched', () => {
    // The raw APIG text is the only evidence a maintainer can match against the
    // gateway docs; the advice is prefixed, never a substitute.
    expect(codeartsBranch).toContain('${result.message}')
  })
})
