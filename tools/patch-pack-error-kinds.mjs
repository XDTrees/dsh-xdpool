/**
 * Patch the vendored pack's error classification for two misreported channels
 * (#118).
 *
 * Both cases chose the wrong KIND of failure, and the kind is what the host
 * turns into the sentence the user reads — so a wrong kind sends them to fix
 * something that is not broken.
 *
 * ## 1. codearts: `InferHub.4004.200 benefit not found` → reported as an
 *    invalid API key
 *
 * `httpErrorCode()` maps every 401/403 to `"AUTH"`, and this plugin's
 * `SESSION_DEAD_MARKERS` renders `AUTH` as "API 密钥无效". The credential is
 * perfectly valid: the request carries `maas_type: benefit` because the model
 * appears in `CODEARTS_BENEFIT_FALLBACK`, and THAT ACCOUNT has no benefit
 * entitlement for that model. The upstream answers inside a 200 body, so the
 * status is not even the signal — the code is.
 *
 * Fix: recognise the benefit code and answer `INVALID_REQUEST` (a terminal,
 * non-auth failure) with the upstream's own words kept. The account is not
 * parked as dead, so the user is not sent to re-authenticate.
 *
 * ## 2. qodercn: a 200-envelope refusal whose body is only
 *    `{"pricingUrl": …}` → rendered as `model_error` with a raw URL as the
 *    message
 *
 * The Qoder envelope unwrapper falls back to "the whole inner JSON" when the
 * refusal names no `code` and no `message`, so the user is shown a URL string
 * and a generic type. The URL is upstream's own way of saying "look at the
 * pricing page", i.e. a QUOTA signal — and it should be reported as one, with a
 * sentence, keeping the URL as detail.
 *
 * Both patches are additive and marker-guarded, matching the file's existing
 * `[xdpool-local]` convention.
 *
 * Idempotent.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const PACK = join(ROOT, 'vendor', 'channel-pack', 'pack.js')
const MARKER = '[xdpool-local] benefitNotFound'

const raw = readFileSync(PACK, 'utf8')
const eol = raw.includes('\r\n') ? '\r\n' : '\n'
let text = raw.replaceAll('\r\n', '\n')

if (text.includes(MARKER)) {
  console.log('already patched — nothing to do')
  process.exit(0)
}

// ---------------------------------------------------------------- codearts

const OLD_HTTP_ERROR = `function httpErrorCode(status, body) {
  if (status === 401 || status === 403) return "AUTH";`

const NEW_HTTP_ERROR = `function httpErrorCode(status, body) {
  // [xdpool-local] benefitNotFound — see tools/patch-pack-error-kinds.mjs
  //
  // CodeArts answers \`InferHub.4004.200 benefit not found\` when the account has
  // no entitlement for the model. The request carries \`maas_type: benefit\`
  // because the model is in CODEARTS_BENEFIT_FALLBACK, i.e. the plugin asked for
  // a benefit the ACCOUNT does not have — not a bad credential.
  //
  // Checked BEFORE the 401/403 → "AUTH" rule because that rule is what turned
  // this into "API 密钥无效" and sent users to re-authenticate over a permission
  // they simply do not hold (#118). Left as INVALID_REQUEST: terminal, not auth,
  // so the pool does not park a perfectly good account.
  {
    const probe = typeof body === "string" ? body : JSON.stringify(body ?? "");
    if (probe.includes("InferHub.4004.200") || probe.toLowerCase().includes("benefit not found")) {
      return "INVALID_REQUEST";
    }
  }
  if (status === 401 || status === 403) return "AUTH";`

if (!text.includes(OLD_HTTP_ERROR)) {
  throw new Error('httpErrorCode shape changed — pack layout moved')
}
text = text.replace(OLD_HTTP_ERROR, NEW_HTTP_ERROR)
console.log('patched httpErrorCode for the CodeArts benefit refusal')

// Force the 400 branch to keep the upstream sentence for that code, so the
// message the user reads names the real cause instead of a generic phrase.
const OLD_400 = `  if (status === 400) {
    if (isContextWindowExceededError(detail)) return CONTEXT_WINDOW_EXCEEDED_CODE;
    return "INVALID_REQUEST";
  }`
const NEW_400 = `  if (status === 400) {
    if (isContextWindowExceededError(detail)) return CONTEXT_WINDOW_EXCEEDED_CODE;
    return "INVALID_REQUEST";
  }
  // [xdpool-local] A 200 body can carry the benefit refusal too (the upstream
  // answers 200 with an error frame), so the probe above is the only guard that
  // covers both transports — nothing to do here.`
if (text.includes(OLD_400)) {
  text = text.replace(OLD_400, NEW_400)
  console.log('annotated the 400 branch')
}

// ---------------------------------------------------------------- qodercn

const OLD_QODER = `        if (classifyInner(inner) === "error") {
          let code;
          let message2 = inner;
          try {
            const parsed = JSON.parse(inner);
            if (parsed.code !== void 0) code = parsed.code;
            if (typeof parsed.message === "string") message2 = parsed.message;
          } catch {
          }
          controller.enqueue(
            encoder2.encode(\`data: \${JSON.stringify({
              ...code === void 0 ? {} : { code },
              message: message2,
              type: "model_error"
            })}
\`)
          );
          continue;
        }`

const NEW_QODER = `        if (classifyInner(inner) === "error") {
          let code;
          let message2 = inner;
          // [xdpool-local] benefitNotFound / pricingUrl — see
          // tools/patch-pack-error-kinds.mjs
          //
          // A refusal whose body is only a pricingUrl is upstream pointing at its
          // own pricing page: a QUOTA signal, not a generic model error. The old
          // fallback (message2 = the whole inner JSON) showed the user a bare URL
          // next to "(112/model_error)", saying nothing about quota (#118). The
          // URL moves to detail so it stays diagnosable.
          let pricingUrl;
          let hasMessage = false;
          try {
            const probe = JSON.parse(inner);
            if (typeof probe?.pricingUrl === "string") pricingUrl = probe.pricingUrl;
            hasMessage = typeof probe?.message === "string";
          } catch {
          }
          try {
            const parsed = JSON.parse(inner);
            if (parsed.code !== void 0) code = parsed.code;
            if (typeof parsed.message === "string") message2 = parsed.message;
          } catch {
          }
          const quotaRefusal = pricingUrl !== void 0 && !hasMessage;
          controller.enqueue(
            encoder2.encode(\`data: \${JSON.stringify(quotaRefusal ? {
              code: QUOTA_EXCEEDED_CODE,
              message: "qoder: out of quota — upstream pointed at its pricing page",
              detail: pricingUrl,
              type: "model_error"
            } : {
              ...code === void 0 ? {} : { code },
              message: message2,
              type: "model_error"
            })}
\`)
          );
          continue;
        }`

if (!text.includes(OLD_QODER)) {
  throw new Error('the Qoder envelope refusal branch shape changed — pack layout moved')
}
text = text.replace(OLD_QODER, NEW_QODER)
console.log('patched the Qoder envelope refusal to report quota with a sentence')

writeFileSync(PACK, eol === '\r\n' ? text.replaceAll('\n', '\r\n') : text)
console.log('pack.js patched')
