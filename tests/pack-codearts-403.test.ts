/**
 * The CodeArts 403 report, as executable assertions.
 *
 * A user filed all of this with measurements (`CodeArts-403-bug-report.md`):
 *
 *   1. The host's `attributionHeaders()` stamps a bot User-Agent, and the
 *      snap-access gateway rejects exactly that with 403 TM.00000001. Same
 *      credential, same body, same endpoint — dropping the UA or sending an
 *      IDE-shaped one answers 200.
 *   2. `isAuthError` / `httpErrorCode` mapped 401 **and** 403 to `AUTH`, which the
 *      card renders as "API 密钥无效", so a header problem was reported as a bad
 *      key.
 *   3. The auth branch refreshed the SAME account and continued, so one rejected
 *      credential failed a whole multi-account pool while every other failure
 *      class rotated.
 *   4. The throw discarded the upstream body, leaving `HTTP 403` and nothing else.
 *
 * These are source assertions against the vendored bundle. It is a build artifact
 * of another repository patched in place with `[xdpool-local]` markers, so the
 * risk is not "does the logic work" — it is "does the patch still exist after the
 * next re-vendor", which is exactly when nobody re-runs the live experiment.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const pack = readFileSync(new URL('../vendor/channel-pack/pack.js', import.meta.url), 'utf8')

describe('CodeArts requests carry an IDE-shaped User-Agent', () => {
  it('overrides the host user-agent header explicitly', () => {
    expect(pack).toContain('headers.set("user-agent", "CodeArts-Agent/1.0')
  })

  it('still builds its headers from attributionHeaders first', () => {
    // The other attribution headers must survive: they identify the host for
    // support and are not rejected. Only the UA is replaced.
    expect(pack).toContain('new Headers(attributionHeaders())')
  })
})

describe('403 is not treated as an auth failure for CodeArts', () => {
  it('isAuthError sends every 401 to auth and inspects a 403 body', () => {
    expect(pack).toContain('403 is not auth for CodeArts')
    // The unconditional pair is gone from the CodeArts helper.
    const helper = pack.slice(pack.indexOf('function isAuthError'), pack.indexOf('function isSseQueueErrorCode'))
    expect(helper).not.toMatch(/status === 401 \|\| status === 403/u)
    expect(helper).toMatch(/if \(status === 401\) return true;/u)
    expect(helper).toMatch(/if \(status === 403\) \{/u)
    // A 403 whose body names the token still counts: APIG.0602 is a real expiry.
    expect(helper).toContain('APIG.0602')
  })

  it('leaves the five other adapters alone', () => {
    // 403 means a credential problem for most vendors. Only CodeArts was measured,
    // so only CodeArts changed — the count is the guard against a future patch
    // sweeping all of them on a guess.
    const remaining = (pack.match(/status === 401 \|\| status === 403/gu) ?? []).length
    expect(remaining, 'the other adapters were rewritten too').toBeGreaterThanOrEqual(9)
  })
})

describe('a rejected credential rotates the account', () => {
  it('asks the pool for another account before giving up', () => {
    expect(pack).toContain('auth failure rotates the account')
    const branch = pack.slice(
      pack.indexOf('auth failure rotates the account'),
      pack.indexOf('auth failure rotates the account') + 1600,
    )
    expect(branch).toContain('getAvailableAccount')
    // One shot per account, or the loop could spin on a single-entry pool.
    expect(branch).toContain('rateLimitTried.has(next.entry.id)')
    expect(branch).toContain('rateLimitTried.add(next.entry.id)')
  })

  it('still refreshes when no other account is available', () => {
    // Rotation is the first attempt, not a replacement: a single-account pool must
    // keep the refresh-and-retry path it had.
    const branch = pack.slice(
      pack.indexOf('auth failure rotates the account'),
      pack.indexOf('auth failure rotates the account') + 1800,
    )
    expect(branch).toContain('await this.options.refresh()')
    expect(branch).toContain('resolveCredential()')
  })
})

describe('the HTTP-status error carries the upstream body', () => {
  it('includes the parsed detail in the message', () => {
    expect(pack).toContain('error detail on the HTTP-status throw')
    expect(pack).toContain('const failureDetail = errorDetail(errorText)')
    // Truncated: a gateway answering with an HTML error page must not flood it.
    expect(pack).toContain('.slice(0, 200)')
  })

  it('keeps the status code on the error, for the caller to classify', () => {
    const throwSite = pack.slice(pack.indexOf('const failureDetail = errorDetail'))
    expect(throwSite.slice(0, 400)).toContain('{ status: response.status }')
  })
})
