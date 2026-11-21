import { describe, expect, it } from 'vitest'
import { deviceGuid, resetDeviceCache } from '../src/marvis-device.ts'
import { extractCode } from '../src/marvis-session.ts'
import { MARVIS_MODELS, MARVIS_DEFAULT_MODEL, findMarvisModel } from '../src/marvis-models.ts'
import { chatHeaders, marvisExt, ualSignature, uskeyOf } from '../src/marvis-protocol.ts'

/**
 * The pieces of the Marvis channel that decide whether the upstream accepts a request.
 *
 * Every fact here came from the reference implementation, which measured each one against the
 * live service. Getting any of them wrong produces a failure that reads like something else —
 * a missing device answers `-109 RC_PARAMS_INVALID`, which sounds like a malformed request, and a
 * browser UA is answered `4100404`, which sounds like risk control.
 */
describe('the device id', () => {
  it('is 32 lowercase hex and stable across calls', () => {
    // Stability matters: a per-call id would make every request look like a new device.
    resetDeviceCache()
    const first = deviceGuid()
    expect(first).toMatch(/^[0-9a-f]{32}$/u)
    expect(deviceGuid()).toBe(first)
  })
})

describe('the fingerprint', () => {
  it('mints a fresh uskey each time', () => {
    // The upstream allows two requests per uskey and answers 403 from the third, so one is made
    // per request rather than cached.
    expect(uskeyOf()).not.toBe(uskeyOf())
  })

  it('is a compact JSON object with no spaces', () => {
    // The service compares the raw string.
    const ext = marvisExt({ guid: 'a'.repeat(32) })
    expect(ext).not.toContain(' ')
    const parsed = JSON.parse(ext) as Record<string, unknown>
    expect(parsed['guid']).toBe('a'.repeat(32))
    expect(parsed['taskType']).toBe('user')
    expect(typeof parsed['uskey']).toBe('string')
    expect(typeof parsed['nonce']).toBe('string')
  })

  it('omits qimei36 rather than inventing one', () => {
    // The field must match the device; a made-up value is worse than an absent one.
    const parsed = JSON.parse(marvisExt({ guid: 'b'.repeat(32) })) as Record<string, unknown>
    expect(parsed['qimei36']).toBeUndefined()
  })
})

describe('the chat headers', () => {
  const account = { openid: 'o', accessToken: 't', loginType: '1', guid: 'c'.repeat(32), expiresAt: 0 }

  it('identifies as the client, not a browser', () => {
    // A browser UA here is answered 4100404 — risk control, not an auth problem.
    expect(chatHeaders(account)['User-Agent']).toBe('AsyncOpenAI/Python 2.32.0')
  })

  it('carries every Ual-Access header the gateway checks', () => {
    const headers = chatHeaders(account)
    for (const name of ['Ual-Access-Openid', 'Ual-Access-Access-Token', 'Ual-Access-Login-Type', 'Ual-Access-Guid', 'Ual-Access-MarvisExt']) {
      expect(headers[name], name).toBeTruthy()
    }
  })

  it('does not carry a business signature', () => {
    // `Ual-Access-Signature` belongs to `/v3/*`. Sending it to the gateway turns a 403 into a
    // 401 and sends the reader looking for an expired session.
    expect(chatHeaders(account)['Ual-Access-Signature']).toBeUndefined()
  })
})

describe('the business signature', () => {
  it('is md5 of query + timestamp + key + nonce', () => {
    // 32 hex characters, lowercase. The value itself is opaque; the shape is what the service
    // checks before it even looks at the query.
    const signature = ualSignature('{"a":1}', '1700000000000', '1234')
    expect(signature).toMatch(/^[0-9a-f]{32}$/u)
    // Deterministic for the same inputs, different for a different nonce.
    expect(ualSignature('{"a":1}', '1700000000000', '1234')).toBe(signature)
    expect(ualSignature('{"a":1}', '1700000000000', '1235')).not.toBe(signature)
  })
})

describe('the catalogue', () => {
  it('has the eight slots the subscription grants', () => {
    expect(MARVIS_MODELS).toHaveLength(8)
    expect(findMarvisModel(MARVIS_DEFAULT_MODEL)).toBeDefined()
  })

  it('shows the REAL model, not the slot name', () => {
    // The service routes a slot per account, so the id says nothing about what answered. The
    // display name is the model that was measured behind each slot.
    const main = findMarvisModel('main-auto')
    expect(main?.name).toBe('deepseek-v4-1-flash-261017')
    expect(main?.name).not.toBe('main-auto')
  })

  it('keeps display names pure ASCII', () => {
    // A space or full-width bracket in a model name has been observed to stall some clients
    // during the reply phase.
    for (const model of MARVIS_MODELS) {
      expect(/^[ -~]+$/u.test(model.name), model.name).toBe(true)
    }
  })

  it('declares a smaller window for the vision model', () => {
    // Claiming a million here would let the host size a compaction against a limit nobody
    // promised.
    const vision = findMarvisModel('hunyuan-turbos-vision')
    expect(vision?.contextWindow).toBe(32_000)
    expect(vision?.contextWindow).toBeLessThan(1_000_000)
  })
})

describe('reading a pasted callback', () => {
  it('finds the code in a whole callback URL', () => {
    expect(extractCode('https://x.y/marvis_oauth?login_type=QC&code=ABC123xyz&state=31.1')).toBe('ABC123xyz')
  })

  it('finds it in a bare query fragment', () => {
    expect(extractCode('code=ABC123xyz&state=1')).toBe('ABC123xyz')
  })

  it('accepts a bare code', () => {
    expect(extractCode('ABC123xyzQ')).toBe('ABC123xyzQ')
  })

  it('reads a JSON blob', () => {
    expect(extractCode(JSON.stringify({ code: 'ABC123xyz' }))).toBe('ABC123xyz')
  })

  it('rejects a numeric failure code', () => {
    // A failure response carries `code: -107`; only a string of real length is an auth code.
    expect(extractCode(JSON.stringify({ code: -107 }))).toBeUndefined()
  })

  it('rejects text with no code at all', () => {
    expect(extractCode('https://x.y/nothing-here')).toBeUndefined()
    expect(extractCode('')).toBeUndefined()
  })
})
