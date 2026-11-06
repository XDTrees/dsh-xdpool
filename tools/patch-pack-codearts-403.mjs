/**
 * Patch channel-pack: for the CODEARTS lane, 403 is not an auth failure.
 *
 * Everything IAM-related this gateway can reject is measured to be
 * **401 APIG.0301**:
 *
 *   bad SK signature       -> 401 APIG.0301 verify ak sk signature fail
 *   truncated STS token    -> 401 APIG.0301 Unauthorized
 *   wrong AK               -> 401 APIG.0301 Unauthorized
 *   body rewritten after   -> 401 APIG.0301 body hash mismatch
 *     signing
 *   UA rejected by WAF     -> 403 TM.00000001 网络繁忙
 *   too many sessions      -> 400 TM.00001041
 *   benefit not entitled   -> 200 InferHub.4004.200
 *
 * So a 403 here is NOT about the credential, and classifying it as `AUTH` made the
 * card render "API 密钥无效" for a key that worked — sending the user to sign in
 * again over a rejected request header.
 *
 * SCOPE: the CodeArts lane only. The same `401 || 403` shape appears in five other
 * adapters in this file, and for most of them 403 genuinely IS a credential
 * problem. Only CodeArts was measured, so only CodeArts is changed.
 *
 * Idempotent. Line endings come from the file, so the patch applies on a CRLF
 * checkout as well as an LF one.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const PATH = 'vendor/channel-pack/pack.js'
const MARKER = '[xdpool-local] 403 is not auth for CodeArts'

const source = readFileSync(PATH, 'utf8')
if (source.includes(MARKER)) {
  console.log('already patched')
  process.exit(0)
}

const EOL = source.includes('\r\n') ? '\r\n' : '\n'
const join = (...lines) => lines.join(EOL)

/** The one shared `isAuthError`, matched with CRLF tolerance. */
const AUTH_RE = new RegExp(
  'function isAuthError\\(status, body\\) \\{\\r?\\n'
  + '  if \\(status === 401 \\|\\| status === 403\\) return true;\\r?\\n'
  + '  return body\\.includes\\("APIG\\.0602"\\) \\|\\| '
  + '\\/invalid\\\\s\\+token\\|token\\\\s\\+expired\\|token\\\\s\\+is\\\\s\\+invalid\\/i\\.test\\(body\\);\\r?\\n'
  + '\\}',
  'g',
)

const NEW_AUTH = join(
  'function isAuthError(status, body) {',
  `  // ${MARKER}.`,
  '  //',
  '  // Every IAM rejection this gateway produces is measured to be 401 APIG.0301:',
  '  // bad SK signature, truncated STS token, wrong AK, and a body rewritten after',
  '  // signing all answer 401. A rejected User-Agent answers 403 TM.00000001, which',
  '  // is a WAF verdict on a request header and says nothing about the credential.',
  '  //',
  '  // 403 can still be about the token (`APIG.0602 security token has expired` is',
  '  // real), so the body decides. An unrecognised 403 falls through to the non-auth',
  '  // path, which is the honest answer: the upstream refused without claiming an',
  '  // auth failure.',
  '  if (status === 401) return true;',
  '  if (status === 403) {',
  '    return body.includes("APIG.0602")',
  '      || /invalid\\s+token|token\\s+expired|token\\s+is\\s+invalid|signature\\s+fail|Unauthorized/i.test(body);',
  '  }',
  '  return body.includes("APIG.0602") || /invalid\\s+token|token\\s+expired|token\\s+is\\s+invalid/i.test(body);',
  '}',
)

/**
 * The CodeArts `httpErrorCode` 401/403 line.
 *
 * Anchored on the `InferHub.4004.200` probe that an earlier local patch already
 * inserted into this same function, because the bare 401/403 line appears in five
 * other adapters too and those must not be rewritten. The probe is CodeArts-
 * specific, so the pair identifies this copy uniquely.
 */
const CODE_RE = new RegExp(
  '(probe\\.includes\\("InferHub\\.4004\\.200"\\)[\\s\\S]{0,240}?\\r?\\n)'
  + '(  if \\(status === 401 \\|\\| status === 403\\) return "AUTH";)',
  'g',
)

const NEW_CODE_LINE = join(
  '  // [xdpool-local] 403 is not auth — see isAuthError. The frontend renders AUTH',
  '  // as "API 密钥无效", so routing a WAF 403 here produced a confident wrong',
  '  // diagnosis. Only a 401, or a 403 whose body names the token, is AUTH.',
  '  if (status === 401) return "AUTH";',
  '  if (status === 403 && (String(body).includes("APIG.0602")',
  '    || /invalid\\s+token|token\\s+expired|token\\s+is\\s+invalid|signature\\s+fail|Unauthorized/i.test(String(body)))) {',
  '    return "AUTH";',
  '  }',
)

const authCount = (source.match(AUTH_RE) ?? []).length
if (authCount !== 1) throw new Error(`expected exactly 1 isAuthError body, found ${String(authCount)}`)
const codeCount = (source.match(CODE_RE) ?? []).length
if (codeCount !== 1) throw new Error(`expected exactly 1 CodeArts httpErrorCode anchor, found ${String(codeCount)}`)

let next = source.replace(AUTH_RE, NEW_AUTH)
next = next.replace(CODE_RE, (_whole, before) => `${String(before)}${NEW_CODE_LINE}`)

// Prove the write did what was claimed: the marker landed, and exactly the two
// CodeArts lines changed — the others are counted, not assumed, so a future edit
// that touches a different adapter fails here instead of shipping.
const before = (source.match(/status === 401 \|\| status === 403/g) ?? []).length
const after = (next.match(/status === 401 \|\| status === 403/g) ?? []).length
if (after !== before - 2) {
  throw new Error(`expected exactly 2 rules rewritten, ${String(before - after)} changed (of ${String(before)})`)
}
if (!next.includes(MARKER)) throw new Error('the marker did not land — the write was a no-op')

writeFileSync(PATH, next)
console.log(`403-classification patch applied (CodeArts lane only; ${String(after)} of ${String(before)} rules left untouched)`)
