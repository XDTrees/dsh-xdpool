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
 * 2. They are attached only when the user opts in explicitly. billion-context is
 *    an `optionalDependency`: when it is absent these headers reach the upstream
 *    verbatim, with `secret_access_key` inside (base64, trivially decodable).
 *    An earlier revision armed them from bili's own `globalThis` presence, on the
 *    theory that bili strips the markers and re-signs. It does strip them — and
 *    then re-signs through its own `DEFAULT_BENEFIT_MODELS` fallback, stamping
 *    `maas_type: benefit` back onto a request this plugin had deliberately
 *    stopped sending it on, which restored the APIG.0101 404 from the far side
 *    of the wire. So the gate is the explicit `codeartsResignHeaders === true`
 *    and nothing infers it. `tests/codearts-bili-credential.test.ts` owns the
 *    assertions; what stays HERE is signing ORDER, not policy.
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
  const started = pack.indexOf('const extraSignedHeaders = isBenefitModel && !benefitHeaderDropped')
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

  it('is opt-in only — a probe-driven arm reintroduced the 404', () => {
    // REVERSED, with the measurement that forced it. The arm used to switch on
    // whenever bili's fetch chain was present, on the theory that bili would
    // strip the markers and re-sign. It does strip them — and then re-signs
    // using its OWN `DEFAULT_BENEFIT_MODELS` fallback, stamping `maas_type:
    // benefit` back onto a request this plugin had deliberately stopped sending
    // it on. Net effect: the 404 came back, from the far side of the wire.
    //
    // So the gate is now the user's explicit `codeartsResignHeaders: true`, and
    // nothing infers it. See tests/codearts-bili-credential.test.ts for the
    // full chain.
    const window = codeArtsChatWindow()
    expect(window).toContain('this.options.codeartsResignHeaders === true)')
    expect(window).not.toContain('biliFetchChainPresent')
  })
})
