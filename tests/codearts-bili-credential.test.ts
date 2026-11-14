/**
 * The two CodeArts signing changes that make billion-context stop refusing.
 *
 * Context — two independent mechanisms, both needed:
 *
 *   1. `UNSIGNED-PAYLOAD` (tests/codearts-unsigned-payload.test.ts covers the
 *      signer itself). Huawei's signer spec lets a caller exclude the body from
 *      the signature; the gateway then authenticates method/path/query/headers
 *      and skips the body-hash comparison, so a post-signing body rewrite no
 *      longer invalidates anything upstream.
 *
 *   2. The bili re-sign markers. billion-context's stated contract is binary —
 *      a body-signed model request is either RE-SIGNED+COMPRESSED or REFUSED —
 *      and it decides "is this body-signed?" from header SHAPE, not from the
 *      header's value: any name ending in `-signature` / `-content-sha256`
 *      counts, so `UNSIGNED-PAYLOAD` does not exempt a request. What removes the
 *      refusal is giving bili a credential: the two loopback markers
 *      `x-bili-resign` / `x-bili-resign-credential`.
 *
 * The markers carry the secret access key, so the interesting property is WHEN
 * they are attached. bili strips them in its forward header loop before egress
 * (with bili in the path the secret never leaves the machine) — but with bili
 * ABSENT nothing strips them, and the pack would send AK/SK to Huawei in a
 * header Huawei does not read.
 *
 * The arming gate is therefore the user's explicit `codeartsResignHeaders:
 * true`, and nothing infers it. An earlier revision armed the markers whenever
 * bili's fetch chain was present in `globalThis`; that is exactly the regression
 * this file pins, because bili's re-sign takes over the benefit decision too and
 * put the 404 back. See the note at the marker site in `stream()`.
 *
 * `pack.js` is a build artifact of another repository patched in place with
 * `[xdpool-local]` markers, so these are source + driver assertions: they fail
 * if a re-vendor drops either patch.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pack = readFileSync(new URL('../vendor/channel-pack/pack.js', import.meta.url), 'utf8')

/** The CodeArts chat loop, bounded by anchors unique to it. */
function chatLoop(): string {
  const start = pack.indexOf('const extraSignedHeaders = isBenefitModel && !benefitHeaderDropped')
  expect(start).toBeGreaterThan(-1)
  const fetched = pack.indexOf('response = await this.fetchImpl(url, {', start)
  expect(fetched).toBeGreaterThan(start)
  return pack.slice(start, fetched)
}

describe('the chat loop does NOT arm the markers automatically', () => {
  it('requires an explicit true, never a probe', () => {
    const loop = chatLoop()
    expect(loop).toContain('if (this.options.codeartsResignHeaders === true) {')
    // The probe-driven arming is what caused the regression; it must be gone.
    expect(loop).not.toContain('biliFetchChainPresent()')
  })

  it('records why, so the next reader does not re-wire it', () => {
    const loop = chatLoop()
    expect(loop).toContain('NO bili re-sign markers')
    expect(loop).toContain('apigBenefitFor')
  })

  it('still sends the three fields decodeApigCredential reads when opted in', () => {
    // The opt-in path must stay functional: bili parses base64 JSON and reads
    // exactly ak/sk/token, so an opt-in user is not left with a broken marker.
    const loop = chatLoop()
    expect(loop).toContain('ak: credential.access_key_id')
    expect(loop).toContain('sk: credential.secret_access_key')
    expect(loop).toContain('token: credential.security_token')
    expect(loop).toContain('"sdk-hmac-sha256"')
  })

  it('sets them after signing, so they never join the signed header list', () => {
    // bili's SIGNED_HEADER_NAMES is authorization / x-sdk-date /
    // x-sdk-content-sha256 / x-security-token / maas_type — the markers are not
    // in it, and stamping them after signRequestHuawei keeps it that way.
    const loop = chatLoop()
    const signed = loop.indexOf('const signed = await signRequestHuawei(')
    const stamped = loop.indexOf('headers.set("x-bili-resign"')
    expect(signed).toBeGreaterThan(-1)
    if (stamped > -1) expect(stamped).toBeGreaterThan(signed)
  })
})

describe('the two patches stay scoped to CodeArts chat', () => {
  it('never attaches the markers on the other Huawei-signed routes', () => {
    // fetchSignedGet / queryQueueStatus / signedSnapRequest must stay clean:
    // they carry no model body worth re-signing, and a leaked credential marker
    // would be a secret on the wire for no reason.
    const markerSites = (pack.match(/headers\.set\(\s*"x-bili-resign-credential"/gu) ?? []).length
    expect(markerSites).toBe(1)
  })

  it('opts exactly one call site into UNSIGNED-PAYLOAD', () => {
    const optedIn = (pack.match(/extraSignedHeaders,\n\s*\/\/ \[xdpool-local\] UNSIGNED-PAYLOAD/gu) ?? []).length
    expect(optedIn).toBe(1)
  })
})
