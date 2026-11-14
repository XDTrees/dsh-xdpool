/**
 * Patch channel-pack: stop GUESSING that a model has benefit quota.
 *
 * THE BUG, MEASURED END TO END
 *
 * `isCodeArtsBenefitModel()` decides whether a chat carries `maas_type: benefit`.
 * When the benefit catalogue is empty it falls back to a hardcoded guess:
 *
 *   CODEARTS_BENEFIT_FALLBACK = ["glm-5.3-flash", "deepseek-v4.1-flash"]
 *
 * That catalogue is ALWAYS empty on a real install, because it is read from
 * `opengw.developer.huaweicloud.com/api/v1/gateway/config`, which answers:
 *
 *   HTTP 200  {"error_code":"4000","error_msg":"invalid channel, group not found","result":null}
 *
 * So every request for those two models carries the benefit header, and an
 * account without that entitlement gets:
 *
 *   HTTP 200  data:{"text":"[DONE]","error_code":"InferHub.APIG.0101.404",
 *                   "error_msg":"The API does not exist or has not been published
 *                   in the environment"}
 *
 * The SAME body, SAME credential, SAME endpoint answered WITH the header is that
 * 404, and WITHOUT it is a normal 200 with real deltas. Verified repeatedly.
 *
 * WHY "DROP THE HEADER AND RETRY" WAS NOT ENOUGH
 *
 * An earlier iteration recognised APIG.0101, dropped `maas_type` and retried.
 * Instrumented on the user's machine, both attempts DID fire:
 *
 *   attempt model=deepseek-v4.1-flash sent=benefit
 *   attempt model=deepseek-v4.1-flash sent=plain
 *
 * but the second response was byte-for-byte the first one — same 404 frame, plus
 * the same trailing `upstream_stream_error`. The second request never reached
 * the gateway independently; something in the in-process fetch chain (DSH's
 * own traffic passes through billion-context's fetch patch) answered it from the
 * first response. A retry cannot fix a route that is wrong on the FIRST attempt.
 *
 * THE FIX
 *
 * Send `maas_type: benefit` only when the catalogue CONFIRMED the model, never
 * on a guess. Empty catalogue ⇒ no header ⇒ the plain route, which is the one
 * that works. Accounts that do hold benefit quota keep working: the plain route
 * accepts them (measured), they simply stop being *labelled* as benefit traffic.
 *
 * `CODEARTS_BENEFIT_FALLBACK` is kept as an escape hatch but emptied, and
 * `DSH_CODEARTS_BENEFIT_GUESS=1` restores the old guess for anyone who wants the
 * benefit route back without a catalogue.
 *
 * SCOPE: the benefit predicate plus the fallback list only. The cached-catalogue
 * path (`loadBenefitCache` / `saveBenefitCache`) is untouched, so a build that
 * does receive a real catalogue behaves exactly as before.
 *
 * Idempotent.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const PACK = join(ROOT, 'vendor', 'channel-pack', 'pack.js')
const MARKER = '[xdpool-local] no benefit-header guess'

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

// 1. Empty the guess, keeping the symbol so a re-vendor diff stays readable.
replaceOnce(
  'var CODEARTS_BENEFIT_FALLBACK = ["glm-5.3-flash", "deepseek-v4.1-flash"];',
  [
    '// ' + MARKER + ' — see tools/patch-pack-codearts-no-benefit-guess.mjs.',
    '//',
    '// Was ["glm-5.3-flash", "deepseek-v4.1-flash"]. That guess is what made the',
    '// benefit header unconditional, and the catalogue it stands in for is always',
    '// empty (opengw answers `result: null`). Measured: with the header the gateway',
    '// answers APIG.0101 for an account without the entitlement; without it, 200.',
    '//',
    '// The list is kept — empty — rather than deleted so `isCodeArtsBenefitModel`',
    '// keeps its shape and a restored entry is a one-line change.',
    '// DSH_CODEARTS_BENEFIT_GUESS=1 restores the historical guess.',
    'var CODEARTS_BENEFIT_FALLBACK = process.env.DSH_CODEARTS_BENEFIT_GUESS === "1"',
    '  ? ["glm-5.3-flash", "deepseek-v4.1-flash"]',
    '  : [];',
  ].join('\n'),
  'benefit fallback list',
)

// 2. Say why in the predicate, so the next reader does not "restore" the guess.
replaceOnce(
  [
    'function isCodeArtsBenefitModel(model) {',
    '  if (benefitMemoryCache === void 0) benefitMemoryCache = loadBenefitCache();',
  ].join('\n'),
  [
    'function isCodeArtsBenefitModel(model) {',
    '  // ' + MARKER + ': a CONFIRMED catalogue entry is the only reason to send',
    '  // `maas_type: benefit`. The guess is gone (see the constant above); guessing',
    '  // wrong does not degrade gracefully here, it turns every turn into a 404.',
    '  if (benefitMemoryCache === void 0) benefitMemoryCache = loadBenefitCache();',
  ].join('\n'),
  'benefit predicate',
)

writeFileSync(PACK, text.replaceAll('\n', eol))
console.log('no-benefit-guess patch applied')
