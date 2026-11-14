/**
 * CodeArts: `APIG.0101` on the benefit route must drop `maas_type` and retry,
 * not report a dead credential.
 *
 * MEASURED, 2026-11-14, live gateway, freshly signed-in account, one variable
 * at a time (identical body, identical signature, only the header set differs):
 *
 *   POST /api/v2/chat/completions  glm-5.3-flash  stream:true
 *     without maas_type  → 200 SSE with real deltas
 *     with    maas_type  → 200 SSE carrying `InferHub.APIG.0101.404`
 *   the same pair with stream:false
 *     without            → 200
 *     with               → 404 `{"error_code":"APIG.0101"}`
 *
 * So the body, the signature, the account and the model are all fine. The
 * trigger is the `maas_type: benefit` header, and the gateway answers "this
 * route is not published for this account" — a DIFFERENT answer from the
 * `InferHub.4004.200 benefit not found` the pack already handled, which is why
 * the existing drop-and-retry never fired and the user saw a hard failure.
 *
 * The pack sends the header because `CODEARTS_BENEFIT_FALLBACK` names
 * `glm-5.3-flash` and `deepseek-v4.1-flash` whenever the benefit cache is empty
 * — exactly the models a fresh install asks about first.
 *
 * `pack.js` is a build artifact of another repository patched in place with
 * `[xdpool-local]` markers, so these assertions pin the source shape that makes
 * the recovery correct: the matcher, both transports, and the scope.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pack = readFileSync(new URL('../vendor/channel-pack/pack.js', import.meta.url), 'utf8')

/** The matcher plus its two constants, lifted out of the bundle. */
function loadMatcher(): (body: unknown) => boolean {
  const codes = pack.indexOf('var CODEARTS_BENEFIT_ROUTE_ERROR_CODE = "APIG.0101";')
  expect(codes).toBeGreaterThan(-1)
  const start = pack.indexOf('function isBenefitRouteUnavailable(body) {')
  expect(start).toBeGreaterThan(codes)
  const end = pack.indexOf('\n}', start)
  expect(end).toBeGreaterThan(start)
  const source = [
    'var CODEARTS_BENEFIT_ROUTE_ERROR_CODE = "APIG.0101";',
    pack.slice(start, end + 2),
    'return isBenefitRouteUnavailable;',
  ].join('\n')
  const factory = new Function(source) as () => (body: unknown) => boolean
  return factory()
}

describe('the APIG.0101 matcher recognises both transports', () => {
  it('matches the 404 body the gateway sends for stream:false', () => {
    // Verbatim from the reproduction, including the request_id.
    const body = '{"error_msg":"The API does not exist or has not been published in the environment","error_code":"APIG.0101","request_id":"29b913c5f8a04c2b9f1a0e2a4d0b7c11"}'
    expect(loadMatcher()(body)).toBe(true)
  })

  it('matches the 200 SSE frame the gateway sends for stream:true', () => {
    // Same refusal, different transport — and the code is spelled with the
    // InferHub prefix, so a plain `=== "APIG.0101"` comparison would miss it.
    expect(loadMatcher()('InferHub.APIG.0101.404')).toBe(true)
  })

  it('does not fire on the benefit-quota refusal it must not swallow', () => {
    // `InferHub.4004.200` has its own branch and its own message ("quota used
    // up, resets at …"). Matching it here would replace a precise message with
    // a generic route error.
    const body = '{"error_code":"InferHub.4004.200","error_msg":"benefit not found"}'
    expect(loadMatcher()(body)).toBe(false)
  })

  it('does not fire on an unrelated 404 that shares the sentence', () => {
    // The sentence alone is not a vendor identity: without an APIG marker or a
    // Huawei request_id, a 404 from any other upstream stays a plain 404.
    const body = '{"error_msg":"The API does not exist or has not been published in the environment"}'
    expect(loadMatcher()(body)).toBe(false)
  })

  it('is total — never throws on odd input', () => {
    const matches = loadMatcher()
    expect(matches(undefined)).toBe(false)
    expect(matches('')).toBe(false)
    expect(matches(42)).toBe(false)
    expect(matches({ error_code: 'APIG.0101' })).toBe(false)
  })
})

describe('the non-2xx path drops the header and retries once', () => {
  it('checks the header state before retrying', () => {
    // Without both guards this is an infinite loop: `continue` re-signs and
    // re-sends, and the same 404 comes back forever.
    const start = pack.indexOf('[xdpool-local] APIG.0101 on the benefit route')
    expect(start).toBeGreaterThan(-1)
    const block = pack.slice(start, start + 1600)
    expect(block).toContain('isBenefitModel &&')
    expect(block).toContain('!benefitHeaderDropped &&')
    expect(block).toContain('isBenefitRouteUnavailable(errorText)')
    expect(block).toContain('benefitHeaderDropped = true;')
    expect(block).toContain('continue;')
  })

  it('sets the latch the chat loop already reads when signing', () => {
    // The retry is only a retry because the signer consults the latch: with it
    // set, `maas_type` is omitted and the request goes out on the plain route.
    expect(pack).toContain(
      'const extraSignedHeaders = isBenefitModel && !benefitHeaderDropped ? { maas_type: "benefit" } : void 0;',
    )
  })

  it('runs before the auth branch, so a 404 is never classified as a bad key', () => {
    const benefitAt = pack.indexOf('[xdpool-local] APIG.0101 on the benefit route')
    const authAt = pack.indexOf('if (isAuthError(response.status, errorText) && !authRefreshed) {', benefitAt)
    expect(authAt).toBeGreaterThan(benefitAt)
  })
})

describe('the SSE transport reaches the same retry', () => {
  it('raises the dedicated code instead of INVALID_REQUEST', () => {
    // `consumeSse` rethrows every unmapped `error_code` as INVALID_REQUEST,
    // which is terminal — no latch, no retry. The frame must be named.
    expect(pack).toContain('throw new LlmError2(`codearts: ${message2}`, BENEFIT_ROUTE_UNAVAILABLE_CODE, { status: 200 });')
  })

  it('teaches the catch clause to accept that code', () => {
    expect(pack).toContain(
      '(error.code === BENEFIT_NOT_FOUND_CODE || error.code === BENEFIT_ROUTE_UNAVAILABLE_CODE) &&',
    )
  })

  it('keeps the original benefit-not-found branch intact', () => {
    // Widening the condition must not delete the vocabulary that already
    // worked; the two codes answer different upstream conditions.
    expect(pack).toContain('if (data.error_code === CODEARTS_BENEFIT_NOT_FOUND_ERROR_CODE) {')
    expect(pack).toContain(
      'throw new LlmError2(`codearts: ${message2}`, BENEFIT_NOT_FOUND_CODE, { status: 200 });',
    )
  })
})

describe('the fix stays scoped to the CodeArts chat loop', () => {
  it('classifies the failure as INVALID_REQUEST for the message', () => {
    // Terminal and non-auth: it must not park a healthy account, and it must not
    // read as a server outage. httpErrorCode is what decides that for the user.
    const start = pack.indexOf('if (isBenefitRouteUnavailable(typeof body === "string" ? body : JSON.stringify(body ?? ""))) {')
    expect(start).toBeGreaterThan(-1)
    expect(pack.slice(start, start + 220)).toContain('return "INVALID_REQUEST";')
  })

  it('never attaches maas_type outside the chat call', () => {
    // fetchSignedGet / queryQueueStatus / signedSnapRequest sign no model body;
    // a benefit header there would be a second, unrelated way to 404.
    const sites = (pack.match(/maas_type: "benefit"/gu) ?? []).length
    expect(sites).toBe(1)
  })

  it('leaves the other APIG codes alone', () => {
    // APIG.0301 (bad signature) and APIG.0602 (expired STS) must keep their
    // existing classification — rotating the account or healing the token.
    expect(pack).toContain('"APIG.0602"')
    expect(pack).toContain('body.includes(CODEARTS_BENEFIT_ROUTE_ERROR_CODE)')
  })
})

/**
 * The retry recovers ONE request; this makes the recovery stick.
 *
 * `CODEARTS_BENEFIT_FALLBACK` is a guess consulted when the benefit catalogue is
 * empty — and the catalogue IS always empty, because it comes from `opengw`,
 * which answers 200 with `result: null` for every account measured. So the two
 * fallback models carry `maas_type: benefit` unconditionally, and an account
 * without that entitlement would answer APIG.0101 on EVERY turn if each request
 * had to rediscover it.
 *
 * The table turns the first refusal into a per-process fact: every later request
 * for that model skips the header instead of buying another wasted round trip.
 */
describe('a model that refused the benefit route is not asked twice', () => {
  it('keeps the refusal table next to the model predicate', () => {
    expect(pack).toContain('var benefitRouteUnavailableModels = /* @__PURE__ */ new Set();')
    // Module scope, not per-request: a per-call Set would forget immediately and
    // the whole point (remembering across turns) would be lost.
    const setAt = pack.indexOf('var benefitRouteUnavailableModels')
    const classAt = pack.indexOf('var CodeArtsAdapter = class extends LlmAdapter {')
    expect(setAt).toBeGreaterThan(-1)
    expect(setAt).toBeLessThan(classAt)
  })

  it('consults the table when deciding to send the header', () => {
    expect(pack).toContain('&& !benefitRouteUnavailableModels.has(options.model);')
  })

  it('records the refusal on BOTH transports', () => {
    // One for the SSE error frame, one for the non-2xx body. Recording only one
    // would leave the other re-discovering the same 404 on every turn.
    expect((pack.match(/benefitRouteUnavailableModels\.add\(options\.model\)/gu) ?? []).length).toBe(2)
  })

  it('still sends the header on the first attempt for that model', () => {
    // The table must not disable the benefit route outright: an account that
    // DOES hold the entitlement should keep using it, and that is only knowable
    // by trying once.
    const decision = pack.indexOf('const isBenefitModel = isCodeArtsBenefitModel(options.model)')
    expect(decision).toBeGreaterThan(-1)
    expect(pack.slice(decision, decision + 160)).toContain('benefitRouteUnavailableModels.has(options.model)')
  })
})

/**
 * The retry was a safety net; this is the actual fix.
 *
 * Retrying cannot help when the FIRST request is already on a route the account
 * does not have — and on the user's machine the retry did not even get an
 * independent response (the in-process fetch chain answered the second request
 * from the first one, byte for byte). So the header must not be sent on a guess.
 *
 * The guess existed because the benefit catalogue is always empty: it comes from
 * `opengw`, which answers 200 with `result: null` for every account measured.
 */
describe('the benefit header is never sent on a guess', () => {
  it('empties the hardcoded fallback list', () => {
    // Was ["glm-5.3-flash", "deepseek-v4.1-flash"] — the reason an account
    // without the entitlement 404'd on every single turn.
    expect(pack).toContain('var CODEARTS_BENEFIT_FALLBACK = process.env.DSH_CODEARTS_BENEFIT_GUESS === "1"')
    expect(pack).toContain('  : [];')
  })

  it('keeps a documented escape hatch', () => {
    // Someone who DOES want the benefit route back without a catalogue can opt
    // in explicitly; the default is the route that works.
    expect(pack).toContain('DSH_CODEARTS_BENEFIT_GUESS')
    expect(pack).toContain('? ["glm-5.3-flash", "deepseek-v4.1-flash"]')
  })

  it('still honours a CONFIRMED catalogue entry', () => {
    // The cache path is untouched: a build that receives a real catalogue must
    // keep labelling benefit traffic correctly.
    expect(pack).toContain('if (benefitMemoryCache !== void 0 && benefitMemoryCache.includes(model)) return true;')
  })

  it('leaves the retry safety net in place', () => {
    // Belt and braces: if some future catalogue is wrong, APIG.0101 still drops
    // the header rather than failing the turn outright.
    expect(pack).toContain('isBenefitRouteUnavailable(errorText)')
    expect(pack).toContain('BENEFIT_ROUTE_UNAVAILABLE_CODE')
  })
})
