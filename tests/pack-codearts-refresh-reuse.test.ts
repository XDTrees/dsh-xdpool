/**
 * CodeArts: a CONSUMED refresh token must reach the reconcile path.
 *
 * The report:
 *
 *   CodeArts token request failed: 400 {"error_code":"STS5.1806",
 *   "error_msg":"invalid refresh token: 'the refresh token has been used'"}
 *
 * `requestToken` classifies a refresh failure into "terminal" only for
 * `invalid_grant` and `ExpiredRefreshToken`. `STS5.1806` matched neither, so it
 * became a plain `Error` and skipped the one handler written for it — the caller's
 * `instanceof RefreshTokenExpiredError` branch that re-reads the credential and, when
 * the token changed underneath (a concurrent replay), reconciles instead of marking
 * the account unrefreshable.
 *
 * The consequence of the old shape was not a wrong error message. It was that a
 * RECOVERABLE race presented as a bare 400 on every single request, forever, with the
 * recovery code sitting right there unreachable.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const pack = readFileSync(new URL('../vendor/channel-pack/pack.js', import.meta.url), 'utf8')

describe('the STS5.1806 classification', () => {
  it('is recognised as a terminal refresh failure', () => {
    expect(pack).toContain('[xdpool-local] a consumed refresh token is a dead credential')
    expect(pack).toContain('errorCode.includes("STS5.1806")')
    // The message text is the fallback: Huawei is not guaranteed to keep the code
    // stable across STS revisions, but the sentence is what the error actually says.
    expect(pack).toContain('refresh token has been used')
  })

  it('still raises the error type the reconcile branch listens for', () => {
    // If this ever became a plain `throw new Error`, the patch would be pointless —
    // the whole value is arriving at the handler with the right type.
    const start = pack.indexOf('errorCode.includes("STS5.1806")')
    expect(start).toBeGreaterThan(-1)
    const after = pack.slice(start, start + 400)
    expect(after).toContain('throw new RefreshTokenExpiredError(message2)')
  })

  it('is scoped inside the CodeArts token request, not the shared predicate', () => {
    // `STS5.*` is Huawei's namespace. Classifying it anywhere shared would let
    // another vendor's coincidentally-similar string mark a working credential dead.
    //
    // The enclosing function is `requestToken`. It builds its messages with the
    // CodeArts prefix, and its credential vocabulary (`dpop_private_key_jwk`) is the
    // DPoP one only that lane uses — `CLIENT_ID` itself is a module constant, so the
    // check cannot rely on finding `codearts-agent` inside the body.
    const stsAt = pack.indexOf('errorCode.includes("STS5.1806")')
    const fnStart = pack.lastIndexOf('async function requestToken', stsAt)
    expect(fnStart).toBeGreaterThan(-1)
    const fnEnd = pack.indexOf('async function exchangeAuthorizationCode', stsAt)
    expect(fnEnd).toBeGreaterThan(stsAt)
    const fnBody = pack.slice(fnStart, fnEnd)
    expect(fnBody).toContain('CodeArts token request failed')
    expect(fnBody).toContain('keyPair')
  })

  it('leaves the original two conditions intact', () => {
    // The patch adds alternatives; it must not replace the vocabulary the pack
    // already used for every other vendor.
    expect(pack).toContain('data?.error === "invalid_grant"')
    expect(pack).toContain('errorCode.includes("ExpiredRefreshToken")')
  })
})
