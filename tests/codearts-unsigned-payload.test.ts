/**
 * CodeArts chat requests sign the request with `UNSIGNED-PAYLOAD`.
 *
 * Huawei APIG's SDK-HMAC-SHA256 covers the body by default: the signer hashes
 * the bytes into `x-sdk-content-sha256` and the gateway recomputes the digest.
 * Anything that rewrites the body after signing invalidates the signature
 * upstream (401 APIG.0301 "body hash mismatch"). Huawei's own signer spec has
 * an escape hatch — send `X-Sdk-Content-Sha256: UNSIGNED-PAYLOAD` and the
 * gateway stops comparing the body hash, while still authenticating method,
 * path, query, host, x-sdk-date and the signed-header list.
 *
 * The interesting property is the SCOPE, not the flag itself: three other call
 * sites share `signRequestHuawei` (the model-catalog GET, the queue-status GET
 * and `signedSnapRequest`, which the points/benefit flow uses). If the flag
 * leaked to them, every one of those would silently stop pinning its body —
 * a change nobody asked for, on routes that never had the problem. So the
 * assertions below drive the extracted signer and check BOTH directions:
 * opted-in ⇒ body-independent; omitted ⇒ historical digest signing.
 *
 * `pack.js` is a build artifact of another repository, patched in place with
 * `[xdpool-local]` markers. Driving the extracted function is the strongest
 * check available — it fails if a re-vendor drops the patch, and it fails if
 * the patch is applied more broadly than intended.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pack = readFileSync(new URL('../vendor/channel-pack/pack.js', import.meta.url), 'utf8')

/** The signer plus its two hash helpers, lifted out of the bundle. */
type HuaweiSigner = (
  ak: string,
  sk: string,
  securityToken: string,
  method: string,
  urlStr: string,
  body: Uint8Array,
  extraHeaders?: Record<string, string>,
  unsignedPayload?: boolean,
) => Promise<Map<string, string>>

function loadSigner(): HuaweiSigner {
  const start = pack.indexOf('async function sha256Hex(data)')
  expect(start).toBeGreaterThan(-1)
  const end = pack.indexOf('// vendor/channel-pack/src/models.ts', start)
  expect(end).toBeGreaterThan(start)
  const factory = new Function(`${pack.slice(start, end)}\nreturn { signRequestHuawei };`) as () => {
    signRequestHuawei: HuaweiSigner
  }
  return factory().signRequestHuawei
}

const CHAT_URL = 'https://snap-access.cn-north-4.myhuaweicloud.com/api/v2/chat/completions'
const encode = (text: string) => new TextEncoder().encode(text)

function headerOf(headers: Map<string, string>, name: string): string {
  for (const [key, value] of headers) {
    if (key.toLowerCase() === name.toLowerCase()) return value
  }
  throw new Error(`header ${name} missing (have ${[...headers.keys()].join(',')})`)
}

/** Signature value, which is the only part that varies with the body. */
function signatureOf(headers: Map<string, string>): string {
  return headerOf(headers, 'authorization')
}

describe('the CodeArts chat call opts into UNSIGNED-PAYLOAD', () => {
  it('sends the literal UNSIGNED-PAYLOAD in x-sdk-content-sha256', async () => {
    const signRequestHuawei = loadSigner()
    const signed = await signRequestHuawei('AK', 'SK', 'TOKEN', 'POST', CHAT_URL, encode('{"model":"m"}'), undefined, true)
    expect(headerOf(signed, 'x-sdk-content-sha256')).toBe('UNSIGNED-PAYLOAD')
  })

  it('still signs the header list, so the request stays authenticated', async () => {
    const signRequestHuawei = loadSigner()
    const signed = await signRequestHuawei('AK', 'SK', 'TOKEN', 'POST', CHAT_URL, encode('{"model":"m"}'), undefined, true)
    const authorization = headerOf(signed, 'authorization')
    // The scheme and the AK are unchanged — only the payload position of the
    // canonical request is now the literal string.
    expect(authorization).toMatch(/^SDK-HMAC-SHA256 Access=AK,SignedHeaders=/u)
    expect(authorization).toMatch(/Signature=[0-9a-f]{64}$/u)
    expect(authorization).toContain('x-sdk-content-sha256')
  })

  it('makes the signature independent of the body it will be sent with', async () => {
    // This is the whole point: billion-context rewrites the body, and a
    // body-covering signature cannot survive that. If this assertion ever
    // fails, the patch stopped doing the thing it exists for.
    const signRequestHuawei = loadSigner()
    const first = await signRequestHuawei('AK', 'SK', 'TOKEN', 'POST', CHAT_URL, encode('{"a":1}'), undefined, true)
    const second = await signRequestHuawei('AK', 'SK', 'TOKEN', 'POST', CHAT_URL, encode('{"a":2}'), undefined, true)
    expect(signatureOf(first)).toBe(signatureOf(second))
  })

  it('is the only call site that passes the flag', () => {
    // Three other callers share the signer. The count is the guard: a future
    // sweep that opts every route in (or out) shows up here.
    const optedIn = (pack.match(/extraSignedHeaders,\n\s*\/\/ \[xdpool-local\] UNSIGNED-PAYLOAD/gu) ?? []).length
    expect(optedIn).toBe(1)
    expect(pack).toContain('unsignedPayload === true ? "UNSIGNED-PAYLOAD" : await sha256Hex(body)')
  })
})

describe('every other Huawei-signed route keeps hashing its body', () => {
  it('signs the digest when the flag is omitted', async () => {
    const signRequestHuawei = loadSigner()
    const signed = await signRequestHuawei('AK', 'SK', 'TOKEN', 'POST', CHAT_URL, encode('{"a":1}'))
    expect(headerOf(signed, 'x-sdk-content-sha256')).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('keeps that digest body-dependent', async () => {
    const signRequestHuawei = loadSigner()
    const first = await signRequestHuawei('AK', 'SK', 'TOKEN', 'POST', CHAT_URL, encode('{"a":1}'))
    const second = await signRequestHuawei('AK', 'SK', 'TOKEN', 'POST', CHAT_URL, encode('{"a":2}'))
    expect(headerOf(first, 'x-sdk-content-sha256')).not.toBe(headerOf(second, 'x-sdk-content-sha256'))
    expect(signatureOf(first)).not.toBe(signatureOf(second))
  })

  it('leaves the catalog and queue-status GETs on the empty-body digest', async () => {
    // Both GET routes sign an empty body, so their digest is the well-known
    // sha256(""). Pinning the value proves they did not inherit the flag.
    const signRequestHuawei = loadSigner()
    const emptySha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    const get = await signRequestHuawei(
      'AK',
      'SK',
      'TOKEN',
      'GET',
      'https://snap-access.cn-north-4.myhuaweicloud.com/v1/model/builtin',
      new Uint8Array(),
    )
    expect(headerOf(get, 'x-sdk-content-sha256')).toBe(emptySha256)
  })

  it('still signs the benefit header for benefit models', async () => {
    // `maas_type: benefit` rides the signed header list on the chat call. The
    // flag changes the payload position only — the extra header must survive,
    // or benefit-quota models answer 404 "model is not registered".
    const signRequestHuawei = loadSigner()
    const signed = await signRequestHuawei(
      'AK',
      'SK',
      'TOKEN',
      'POST',
      CHAT_URL,
      encode('{"model":"glm-5.3-flash"}'),
      { maas_type: 'benefit' },
      true,
    )
    expect(headerOf(signed, 'maas_type')).toBe('benefit')
    expect(headerOf(signed, 'authorization')).toContain('maas_type')
    expect(headerOf(signed, 'x-sdk-content-sha256')).toBe('UNSIGNED-PAYLOAD')
  })
})
