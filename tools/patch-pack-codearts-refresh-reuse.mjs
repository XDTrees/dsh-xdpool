/**
 * Patch channel-pack: a CONSUMED refresh token must reach the reconcile path.
 *
 * The symptom:
 *
 *   CodeArts token request failed: 400 {"error_code":"STS5.1806",
 *   "error_msg":"invalid refresh token: 'the refresh token has been used'"}
 *
 * The defect is not the 400 — it is which branch it falls into. `requestToken` only
 * recognises two shapes as "this refresh can never succeed":
 *
 *   data.error === 'invalid_grant'  ||  errorCode.includes('ExpiredRefreshToken')
 *
 * `STS5.1806` matches neither, so it becomes a plain `throw new Error`. That skipped
 * the ONE handler written for exactly this situation: the caller's
 * `error instanceof RefreshTokenExpiredError` branch, which
 *
 *   - re-reads the stored credential,
 *   - and when the token has CHANGED (another refresh already rotated it — a
 *     concurrent replay), reconciles against the newer value and explicitly does
 *     NOT mark the account unrefreshable.
 *
 * So a recoverable race was being reported as a bare 400, over and over, on every
 * request, with no path to recovery. The existing code already knew how to handle
 * it; the error just never arrived with the right type.
 *
 * Huawei's STS rotates refresh tokens: each is single-use, and presenting one
 * returns a new one (`credentialFromTokenResponse` stores `token.refresh_token`).
 * "Has been used" therefore means one of two things:
 *
 *   - two refreshes raced, and the loser holds a token the winner already spent
 *     → the reconcile branch recovers this;
 *   - a refresh succeeded but its replacement was not persisted
 *     → genuinely terminal, and marking it unrefreshable is the honest answer.
 *
 * Both need `RefreshTokenExpiredError`; only it reads the difference.
 *
 * SCOPED TO THE CODEARTS LANE. `STS5.xxxx` is Huawei's error namespace, and
 * `requestToken` (CLIENT_ID `codearts-agent`) is the only caller. Putting the code in
 * the shared predicate would let another vendor's coincidentally-similar string mark
 * a working credential dead.
 *
 * Idempotent.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const PATH = 'vendor/channel-pack/pack.js'
const MARKER = '[xdpool-local] a consumed refresh token is a dead credential'

const source = readFileSync(PATH, 'utf8')
if (source.includes(MARKER)) {
  console.log('already patched')
  process.exit(0)
}

const EOL = source.includes('\r\n') ? '\r\n' : '\n'
const join = (...lines) => lines.join(EOL)

/**
 * The existing predicate, matched loosely on whitespace so a pack refresh that only
 * reformats cannot silently skip this patch.
 *
 * The `\\s*` before `\\|\\|` matters: the generated file has no space there, while the
 * source it came from does, and a patch that has to be re-anchored on every pack
 * refresh is one that eventually gets skipped by mistake.
 */
const OLD = new RegExp(
  'if \\(data\\?\\.error === "invalid_grant"\\s*\\|\\|\\s*errorCode\\.includes\\("ExpiredRefreshToken"\\)\\) \\{\\r?\\n'
  + '([ \\t]*)throw new RefreshTokenExpiredError\\(message2\\);\\r?\\n'
  + '[ \\t]*\\}',
  'u',
)

const NEW = join(
  'if (data?.error === "invalid_grant" || errorCode.includes("ExpiredRefreshToken")',
  `          // ${MARKER}.`,
  '          //',
  '          // Huawei STS refresh tokens are SINGLE-USE: presenting one returns a',
  '          // new one, and the old value is marked used. "Has been used" is',
  '          // therefore terminal — either two refreshes raced and this is the',
  '          // loser, or a successful refresh failed to persist its replacement.',
  '          // Reporting it as an ordinary error left the account in the pool, so',
  '          // every later request paid for another hopeless refresh and the user',
  '          // saw an opaque 400 instead of "sign in again".',
  '          //',
  '          // Scoped here rather than in the shared predicate on purpose:',
  '          // STS5.* is Huawei\'s namespace, and another vendor could reuse a',
  '          // similar code for something recoverable.',
  '          || errorCode.includes("STS5.1806")',
  '          || /refresh token has been used/iu.test(String(data?.error_msg ?? ""))) {',
  // `$1` keeps the original throw's indentation; it is substituted from the match.
  '$1throw new RefreshTokenExpiredError(message2);',
  // The closing brace must keep the `if` block's own indentation (four spaces at
  // this nesting level). Writing it flush-left parsed fine but made the next line
  // look like a syntax error to a reader.
  '    }',
)

const hit = OLD.exec(source)
if (hit === null) throw new Error('the refresh-token predicate did not match — the pack changed shape')

// The throw's own indentation, so the replacement keeps the file's formatting
// instead of introducing a mixed-indent line.
const indent = hit[1] ?? '      '
let next = source.replace(OLD, NEW.replace('$1', indent))
if (!next.includes(MARKER)) throw new Error('marker did not land')
// The recovery path is what makes this useful; assert it is still wired.
if (!next.includes('RefreshTokenExpiredError')) throw new Error('the expired-token type disappeared')

writeFileSync(PATH, next)
console.log('patched: STS5.1806 / "refresh token has been used" now marks the credential dead')
