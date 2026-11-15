/**
 * The CodeArts resign headers the signed-request gateway wants.
 *
 * CodeArts signs every chat completion with SDK-HMAC-SHA256, and the signature
 * covers the request BODY. billion-context sits in front of it inside DSH and
 * compresses context, which necessarily rewrites the body — and a rewritten body
 * invalidates the signature. bili has no credential for this scheme, so it takes
 * its `compress-or-refuse` exit and answers the request locally with
 * `403 {"code":"bili_resign_unavailable"}`. The pack only sees a 403, and
 * `httpErrorCode()` maps every 403 to `AUTH`, so it surfaces as "API 密钥无效"
 * even though the credential is perfectly valid.
 *
 * Handing bili the three signing inputs lets it re-sign after compressing, which
 * is what keeps the link compressed.
 *
 * Two things are pinned here that are easy to get wrong:
 *
 * 1. The headers must be set AFTER `signRequestHuawei` and BEFORE the fetch. The
 *    Huawei signature is computed over a fixed header set that does not include
 *    them, so adding them earlier would either be overwritten by the signed map
 *    or (worse) silently change what gets signed.
 * 2. They are OFF unless explicitly enabled. billion-context is an
 *    `optionalDependency`: when it is absent these headers reach the upstream
 *    verbatim, with `secret_access_key` inside (base64, trivially decodable).
 *    bili does strip both headers and re-sign with its own credential when it is
 *    present — verified against a local echo upstream — but the switch must not
 *    depend on that, and bili's in-process native client builds its own
 *    `resignExtra` regardless of what the pack sends.
 *
 * `pack.js` is a build artifact of another repository (`vendor/channel-pack/src`
 * is not even tracked here), so it cannot be imported and driven; a source
 * assertion is the only check that survives the next pack refresh. It fails
 * loudly if a pack update drops the patch — the same shape as the 11128
 * coverage assertions in `tests/chat-identity-headers.test.ts`.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pack = readFileSync(new URL('../vendor/channel-pack/pack.js', import.meta.url), 'utf8')

/** The CodeArts adapter's chat loop, bounded by anchors unique to it. */
function codeArtsChatWindow(): string {
  // The anchor moved when the benefit header was retired (issue #150): the loop now sets
  // `extraSignedHeaders` to undefined, so the line is found by the plain assignment.
  const started = pack.indexOf('const extraSignedHeaders = void 0')
  expect(started).toBeGreaterThan(-1)
  const fetched = pack.indexOf('response = await this.fetchImpl(url, {', started)
  expect(fetched).toBeGreaterThan(started)
  return pack.slice(started, fetched)
}

describe('the vendored pack can hand billion-context a re-sign credential', () => {
  it('sets both resign headers by name', () => {
    const window = codeArtsChatWindow()
    expect(window).toContain('headers.set("x-bili-resign", "sdk-hmac-sha256")')
    expect(window).toContain('headers.set(')
    expect(window).toContain('"x-bili-resign-credential"')
  })

  it('sends the three fields decodeApigCredential reads', () => {
    // bili's decodeApigCredential() parses base64 JSON and reads exactly `ak`,
    // `sk` and `token` (token defaulting to ""). Any other spelling silently
    // decodes to undefined and the refusal comes straight back.
    const window = codeArtsChatWindow()
    expect(window).toContain('ak: credential.access_key_id')
    expect(window).toContain('sk: credential.secret_access_key')
    expect(window).toContain('token: credential.security_token')
    expect(window).toContain('"base64"')
  })

  it('sets them after the signature is computed, not before', () => {
    // Signing happens first; the resign headers are added to the outgoing
    // Headers object afterwards, so they are never part of the signed set.
    const window = codeArtsChatWindow()
    const signed = window.indexOf('const signed = await signRequestHuawei(')
    const stamped = window.indexOf('headers.set("x-bili-resign"')
    expect(signed).toBeGreaterThan(-1)
    expect(stamped).toBeGreaterThan(signed)
  })

  it('stays off unless explicitly enabled', () => {
    // Default-off is the safety property, not a style choice: without bili
    // stripping the header, the credential reaches the upstream.
    expect(codeArtsChatWindow()).toContain('if (this.options.codeartsResignHeaders === true)')
  })
})
