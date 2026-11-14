/**
 * Patch channel-pack: stop sending `maas_type: benefit` on a route the account
 * does not have.
 *
 * THE REPORT
 *
 *   codearts: model request failed with HTTP 404
 *   ({"error_msg":"The API does not exist or has not been published in the
 *   environment","error_code":"APIG.0101", ...})
 *
 * Reproduced against the live gateway on 2026-11-14 with a freshly signed-in
 * account, one variable at a time (identical body, identical signature, only
 * the header set differs):
 *
 *   POST /api/v2/chat/completions, stream:true, glm-5.3-flash
 *     without maas_type  → 200 SSE, real deltas
 *     with    maas_type  → 200 SSE carrying `InferHub.APIG.0101.404`
 *
 *   the same pair with stream:false:
 *     without maas_type  → 200
 *     with    maas_type  → 404 APIG.0101
 *
 * So the body, the signature and the model are all fine. The single trigger is
 * the `maas_type: benefit` header, and the answer is Huawei APIG saying *that
 * route does not exist for this account* — not "bad credential", not "model
 * missing", and emphatically not the `InferHub.4004.200` the pack already knew
 * how to handle.
 *
 * WHY THE PACK SENDS IT AT ALL
 *
 * `isCodeArtsBenefitModel()` falls back to `CODEARTS_BENEFIT_FALLBACK =
 * ["glm-5.3-flash", "deepseek-v4.1-flash"]` whenever the benefit cache is empty
 * — i.e. for exactly the models a fresh install asks about first. An account
 * without the benefit entitlement has no such route, so the header turns a
 * perfectly ordinary request into a 404. Both fallback models behave this way.
 *
 * THE FIX
 *
 * Treat APIG.0101 as a third answer next to `benefit not found`
 * (`InferHub.4004.200`): the benefit route is unavailable for this account, so
 * DROP `maas_type` and retry ONCE with the plain route. That is the request
 * that was measured to succeed. If the retry also fails, the error is reported
 * verbatim instead of being retried forever.
 *
 * The retry reuses the existing `benefitHeaderDropped` latch, so it is bounded
 * by construction: one drop per request, and only when the chat actually
 * carried the header (`isBenefitModel`) and has not dropped it yet.
 *
 * Both transports are covered, because the gateway picks one at random:
 * a 404 status body and a 200 SSE error frame (`{"text":"[DONE]",
 * "error_code":"InferHub.APIG.0101.404"}`) were both observed for the same
 * request — the second one would otherwise be swallowed as "stream ended".
 *
 * SCOPE: only the CodeArts chat loop. `fetchSignedGet`, `queryQueueStatus` and
 * `signedSnapRequest` never send `maas_type`, so they cannot hit this.
 *
 * Idempotent: re-running finds the marker and stops.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const PACK = join(ROOT, 'vendor', 'channel-pack', 'pack.js')
const MARKER = '[xdpool-local] APIG.0101 means the benefit route is not published'

const raw = readFileSync(PACK, 'utf8')
const eol = raw.includes('\r\n') ? '\r\n' : '\n'
let text = raw.replaceAll('\r\n', '\n')

if (text.includes(MARKER)) {
  console.log('already patched — nothing to do')
  process.exit(0)
}

/** Replace exactly one occurrence, failing loudly when the pack moved on. */
function replaceOnce (needle, replacement, label) {
  const count = text.split(needle).length - 1
  if (count !== 1) {
    throw new Error(`${label}: expected 1 occurrence, found ${String(count)} — pack.js changed shape, re-derive the patch`)
  }
  text = text.replace(needle, () => replacement)
}

// ---------------------------------------------------------------- 1. constants
replaceOnce(
  'var CODEARTS_BENEFIT_NOT_FOUND_ERROR_CODE = "InferHub.4004.200";',
  [
    'var CODEARTS_BENEFIT_NOT_FOUND_ERROR_CODE = "InferHub.4004.200";',
    '// [xdpool-local] APIG.0101 means the benefit route is not published — see',
    '// tools/patch-pack-codearts-benefit-route.mjs. Measured 2026-11-14: the same',
    '// body signed with `maas_type: benefit` answers this on both fallback models,',
    '// while the identical body without the header answers 200.',
    'var CODEARTS_BENEFIT_ROUTE_ERROR_CODE = "APIG.0101";',
    'var BENEFIT_ROUTE_UNAVAILABLE_CODE = "BENEFIT_ROUTE_UNAVAILABLE";',
  ].join('\n'),
  'benefit error-code constants',
)

// ------------------------------------------------- 2. the matcher, next to its peers
replaceOnce(
  'function isQueueError(status, body) {',
  [
    '/**',
    ' * [xdpool-local] Did the gateway answer "no such route for this account"? — see',
    ' * tools/patch-pack-codearts-benefit-route.mjs.',
    ' *',
    ' * Huawei APIG uses `APIG.0101` when a path is not published in the environment at',
    ' * all, and the SSE variant prefixes it (`InferHub.APIG.0101.404`). Both spellings',
    ' * are matched on the code; the sentence is the fallback, because the gateway does',
    ' * not guarantee the code stays hyphen-for-dot across revisions.',
    ' */',
    'function isBenefitRouteUnavailable(body) {',
    '  if (typeof body !== "string" || body.length === 0) return false;',
    '  if (body.includes(CODEARTS_BENEFIT_ROUTE_ERROR_CODE)) return true;',
    '  if (!/the api does not exist|has not been published in the environment/i.test(body)) return false;',
    '  // The sentence alone is not enough to claim a vendor: an unrelated 404 could',
    '  // phrase it the same way. It only counts next to an APIG marker, which is what',
    '  // both observed spellings carry (`"error_code":"APIG.0101"` in the 404 body,',
    '  // `InferHub.APIG.0101.404` in the SSE frame).',
    '  return body.includes("APIG.") || body.includes("request_id");',
    '}',
    'function isQueueError(status, body) {',
  ].join('\n'),
  'queue-error matcher',
)

// ------------------------------------------- 3. non-2xx: drop the header, retry once
replaceOnce(
  [
    '        const errorText = await response.text().catch(() => "");',
    '        if (isAuthError(response.status, errorText) && !authRefreshed) {',
  ].join('\n'),
  [
    '        const errorText = await response.text().catch(() => "");',
    '        // [xdpool-local] APIG.0101 on the benefit route — see',
    '        // tools/patch-pack-codearts-benefit-route.mjs.',
    '        //',
    '        // The account has no benefit entitlement for this model, so the gateway',
    '        // has no `maas_type: benefit` route to answer and reports the path as',
    '        // unpublished. Measured: the identical request WITHOUT the header is a',
    '        // 200 on the same credential, so the honest recovery is to drop it and',
    '        // retry, not to report a dead API key. Checked before isAuthError because',
    '        // a 404 is not auth, and before the queue probe because queueing the',
    '        // request would not make the route appear.',
    '        if (',
    '          isBenefitModel &&',
    '          !benefitHeaderDropped &&',
    '          isBenefitRouteUnavailable(errorText)',
    '        ) {',
    '          benefitHeaderDropped = true;',
    '          continue;',
    '        }',
    '        if (isAuthError(response.status, errorText) && !authRefreshed) {',
  ].join('\n'),
  'non-2xx benefit-route retry',
)

// --------------------------------------------- 4. SSE frame: same answer, other transport
replaceOnce(
  [
    '            if (data.error_code === CODEARTS_BENEFIT_NOT_FOUND_ERROR_CODE) {',
    '              throw new LlmError2(`codearts: ${message2}`, BENEFIT_NOT_FOUND_CODE, { status: 200 });',
    '            }',
  ].join('\n'),
  [
    '            if (data.error_code === CODEARTS_BENEFIT_NOT_FOUND_ERROR_CODE) {',
    '              throw new LlmError2(`codearts: ${message2}`, BENEFIT_NOT_FOUND_CODE, { status: 200 });',
    '            }',
    '            // [xdpool-local] the same benefit-route refusal can arrive as a 200 SSE',
    '            // frame instead of a 404 body — see',
    '            // tools/patch-pack-codearts-benefit-route.mjs. Left unmapped it would be',
    '            // rethrown as INVALID_REQUEST, which is terminal: no header drop, no retry,',
    '            // and a message that names neither the cause nor the recovery.',
    '            if (isBenefitRouteUnavailable(data.error_code) || isBenefitRouteUnavailable(message2)) {',
    '              throw new LlmError2(`codearts: ${message2}`, BENEFIT_ROUTE_UNAVAILABLE_CODE, { status: 200 });',
    '            }',
  ].join('\n'),
  'SSE benefit-route frame',
)

// ---------------------------------- 5. the SSE retry latch must accept the new code
replaceOnce(
  '          } else if (error instanceof LlmError2 && error.code === BENEFIT_NOT_FOUND_CODE && isBenefitModel && !benefitHeaderDropped) {',
  [
    '          } else if (',
    '            error instanceof LlmError2 &&',
    '            // [xdpool-local] APIG.0101 sets the same latch — see',
    '            // tools/patch-pack-codearts-benefit-route.mjs.',
    '            (error.code === BENEFIT_NOT_FOUND_CODE || error.code === BENEFIT_ROUTE_UNAVAILABLE_CODE) &&',
    '            isBenefitModel &&',
    '            !benefitHeaderDropped',
    '          ) {',
  ].join('\n'),
  'SSE retry latch',
)

// ------------------------------------------------------ 6. classify for the message
replaceOnce(
  '  const detail = errorDetail(body);',
  [
    '  // [xdpool-local] a benefit-route 404 is a terminal request problem, not a',
    '  // gateway outage or a dead key — see tools/patch-pack-codearts-benefit-route.mjs.',
    '  // Reported as INVALID_REQUEST so it is neither parked as AUTH nor retried.',
    '  if (isBenefitRouteUnavailable(typeof body === "string" ? body : JSON.stringify(body ?? ""))) {',
    '    return "INVALID_REQUEST";',
    '  }',
    '  const detail = errorDetail(body);',
  ].join('\n'),
  'httpErrorCode classification',
)

writeFileSync(PACK, text.replaceAll('\n', eol))
console.log('benefit-route patch applied')

// ---------------------------------------------------------------- 7. the memory
//
// Applied as a SECOND, independently marked step so that a file which already
// carries steps 1–6 (an earlier run of this tool) still receives it.
//
// WHY. Steps 1–6 recover a request: on APIG.0101 they drop `maas_type` and
// retry, which is correct but pays a wasted round trip every time and learns
// nothing. The underlying cause is unbounded — `isCodeArtsBenefitModel` falls
// back to `CODEARTS_BENEFIT_FALLBACK` whenever the benefit catalogue is empty,
// and the catalogue IS always empty because it comes from `opengw`, which
// answers 200 with `result: null` for every account measured here. So the two
// fallback models would carry the header on every turn, forever, and rediscover
// the same 404 on each one.
//
// A module-scope Set turns the first refusal into a per-process fact. It is
// deliberately NOT persisted to disk: the entitlement is a property of the
// account, and an account can gain it (a claim, a plan change) between runs — a
// durable "never use benefit" would then be a bug the user cannot clear.
const MEMORY_MARK = '[xdpool-local] benefit-route memory'
if (!text.includes(MEMORY_MARK)) {
  replaceOnce(
    'function isCodeArtsBenefitModel(model) {',
    [
      '// ' + MEMORY_MARK + ' — see tools/patch-pack-codearts-benefit-route.mjs.',
      '//',
      '// Models this process has already seen answer APIG.0101 on the benefit route.',
      '// The fallback list is a GUESS (see isCodeArtsBenefitModel); this table is',
      '// the measured answer, and it stops every later turn re-buying the same 404.',
      'var benefitRouteUnavailableModels = /* @__PURE__ */ new Set();',
      'function isCodeArtsBenefitModel(model) {',
    ].join('\n'),
    'benefit-route memory table',
  )

  replaceOnce(
    '    const isBenefitModel = isCodeArtsBenefitModel(options.model);',
    [
      '    // ' + MEMORY_MARK + ': a model that already answered APIG.0101 stays off',
      '    // the benefit route for the rest of this process.',
      '    const isBenefitModel = isCodeArtsBenefitModel(options.model)',
      '      && !benefitRouteUnavailableModels.has(options.model);',
    ].join('\n'),
    'benefit-route memory consult',
  )

  replaceOnce(
    [
      '          ) {',
      '            benefitHeaderDropped = true;',
      '            continue;',
      '          } else {',
      '            throw error;',
      '          }',
    ].join('\n'),
    [
      '          ) {',
      '            benefitHeaderDropped = true;',
      '            benefitRouteUnavailableModels.add(options.model);',
      '            continue;',
      '          } else {',
      '            throw error;',
      '          }',
    ].join('\n'),
    'benefit-route memory on SSE',
  )

  replaceOnce(
    [
      '        ) {',
      '          benefitHeaderDropped = true;',
      '          continue;',
      '        }',
      '        if (isAuthError(response.status, errorText) && !authRefreshed) {',
    ].join('\n'),
    [
      '        ) {',
      '          benefitHeaderDropped = true;',
      '          benefitRouteUnavailableModels.add(options.model);',
      '          continue;',
      '        }',
      '        if (isAuthError(response.status, errorText) && !authRefreshed) {',
    ].join('\n'),
    'benefit-route memory on non-2xx',
  )

  writeFileSync(PACK, text.replaceAll('\n', eol))
  console.log('benefit-route memory applied')
}
