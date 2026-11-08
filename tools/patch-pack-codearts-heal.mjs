/**
 * Patch channel-pack: heal an expired CodeArts STS credential before reporting it.
 *
 * Ported from the unmerged PR #114 (`fix/codearts-expired-credential-label`), whose
 * `pack.js` half was never applied to `main` — the PR is `CONFLICTING` and its branch
 * has drifted. The reasoning there is sound and worth keeping verbatim in spirit:
 *
 *   A Huawei STS credential lives ~2 hours; the refresh_token behind it lives ~30
 *   days. The gateway answers an expired one with
 *   `APIG.0602 Bad request: the security token has expired`, which reads like a
 *   sign-in failure and sends the user off to re-scan a QR code they never needed
 *   to touch. Worse, an account that a model request has failed over AWAY from never
 *   enters the scheduler's "expiring within the hour" window again, so it sits
 *   expired indefinitely.
 *
 * Three RPC families read that credential and any of them can be the first call
 * after it runs out (`credits.balances`, `credits.status`, `credits.claimAll`), so
 * the heal goes on the shared `handleMethod` entry point rather than in one branch.
 *
 * WHY THIS AND THE STS5.1806 PATCH ARE BOTH NEEDED
 *
 *   - this one PREVENTS the expiry that makes a refresh necessary;
 *   - the companion patch (`patch-pack-codearts-refresh-reuse.mjs`) handles the
 *     case where a refresh already failed because the token was consumed.
 *
 * They are complementary halves of the same defect class, and the failure this
 * patch heals is also how a credential gets into the "used refresh token" state in
 * the first place: an expiry that nobody healed invites a refresh, and two refreshes
 * of one single-use token leave one of them holding a spent value.
 *
 * Idempotent.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const PATH = 'vendor/channel-pack/pack.js'
const MARKER = '[xdpool-local] Whether this CodeArts credential\'s own STS expiry has passed'

const source = readFileSync(PATH, 'utf8')
if (source.includes(MARKER)) {
  console.log('already patched')
  process.exit(0)
}

const EOL = source.includes('\r\n') ? '\r\n' : '\n'
const lines = source.split(/\r?\n/)

// ---------------------------------------------------------------- helpers
/** Insert `block` immediately before the first line that starts with `anchor`. */
function insertBefore(anchor, block) {
  const index = lines.findIndex(line => line.startsWith(anchor))
  if (index === -1) throw new Error('anchor not found: ' + anchor)
  lines.splice(index, 0, ...block)
}

/** Replace one exact line, failing loudly when the pack has moved on. */
function replaceLine(exact, replacement) {
  const index = lines.findIndex(line => line === exact)
  if (index === -1) throw new Error('line not found: ' + exact.slice(0, 70))
  lines[index] = replacement
}

// ---------------------------------------------------------------- 1. the predicate
insertBefore('async function fetchCodeArtsAccountInfoDetailed(', [
  '// ' + MARKER + '.',
  '//',
  '// Huawei mints these AK/SK/security-token triples with a two-hour life, so a',
  '// stored credential very often IS expired while its refresh_token still has',
  '// weeks left. The gateway answers that with',
  '// `APIG.0602 Bad request: the security token has expired` — accurate, but it',
  '// reads like a sign-in failure and sends people off to re-scan a QR code they',
  '// never needed to re-scan. Callers use this to name the condition, and to',
  '// decide whether a re-mint is worth trying before reporting it at all.',
  'function codeartsCredentialExpired(credential) {',
  '  const raw = credential === null || credential === void 0 ? "" : credential.expires_at;',
  '  if (typeof raw !== "string" || raw.length === 0) return false;',
  '  const parsed = Date.parse(raw);',
  '  return Number.isFinite(parsed) ? parsed <= Date.now() : false;',
  '}',
])

// ---------------------------------------------------------------- 2. the heal
insertBefore('async function collectCreditBalances(', [
  '// [xdpool-local] Re-mint any CodeArts credential whose own STS expiry has',
  '// already passed, before the caller reports it as a failure.',
  '//',
  '// Best-effort by design: every failure is logged and swallowed. A refresh that',
  '// was rejected (`invalid_grant` — the token was rotated away by another client)',
  '// must still let the caller run, because the resulting balance error is the only',
  '// place that can tell the user to sign in again.',
  '//',
  '// It goes through `refreshAccountCredential`, which is the same per-ref serial',
  '// queue the 30-minute scheduler uses, so an on-demand heal can never race the',
  '// scheduler into consuming one refresh_token twice.',
  'async function healExpiredCodeArtsCredentials(accounts, pool, auth, resolve, warn) {',
  '  if (auth === void 0 || pool === void 0) return;',
  '  for (const entry of accounts) {',
  '    if (entry.enabled === false) continue;',
  '    try {',
  '      const resolved = await resolve(credentialRef13(entry.credentialRef));',
  '      if (resolved === void 0) continue;',
  '      const credential = JSON.parse(resolved.value);',
  '      if (!codeartsCredentialExpired(credential)) continue;',
  '      if (!isCodeArtsRefreshable(credential)) continue;',
  '      warn?.(`[channel-pack] codearts 账号 ${entry.id} 的临时凭证已过期，先自动续期`);',
  '      await auth.refreshAccountCredential(entry.credentialRef, pool, entry.id);',
  '    } catch (error) {',
  '      warn?.(`[channel-pack] codearts 账号 ${entry.id} 自动续期失败（仍继续查询）：${String(error)}`);',
  '    }',
  '  }',
  '}',
])

// ---------------------------------------------------------------- 3. the entry point
// The heal must run INSIDE `handleMethod`, before the method switch, so every one of
// the three RPC families that touch a CodeArts credential gets it. Inserted after the
// declaration line, not before it.
const HEAL_BLOCK = [
  '    // [xdpool-local] One heal for every CodeArts entry point, before the switch.',
  '    //',
  '    // A CodeArts credential lives two hours; its refresh_token behind it lives',
  '    // ~30 days. Three separate RPC families read that credential and each of',
  '    // them can be the FIRST call after it has run out: `credits.balances` (the',
  '    // panel opening), `credits.status` and `credits.claimAll` (the 09:00 daily',
  '    // check-in, which then fails silently in a scheduler log nobody reads).',
  '    // Patching one branch would have left the other two reporting a dead',
  '    // sign-in for a credential that one refresh fixes, so the heal sits here,',
  '    // on the path they all share. It is idempotent and cheap when healthy:',
  '    // nothing is refreshed unless the credential\'s own stamp is already past.',
  '    if (typeof payload === "object" && payload !== null && payload.provider === "codearts") {',
  '      try {',
  '        await healExpiredCodeArtsCredentials(',
  '          await pool.listAccounts("codearts"),',
  '          pool,',
  '          codearts,',
  '          (ref) => ctx.credentials.resolve(ref),',
  '          (msg) => ctx.logger?.warn?.(msg)',
  '        );',
  '      } catch (error) {',
  '        ctx.logger?.warn?.(`[channel-pack] codearts 凭证对账失败（继续处理该请求）：${String(error)}`);',
  '      }',
  '    }',
]
{
  const anchor = '  async function handleMethod(method, payload, _signal) {'
  const index = lines.findIndex(line => line === anchor)
  if (index === -1) throw new Error('handleMethod not found')
  lines.splice(index + 1, 0, ...HEAL_BLOCK)
}

// ---------------------------------------------------------------- 4. the wording
// The pack stores its Chinese as `\uXXXX` escapes (it is a build artifact), so the
// anchor must be written the same way — a literal 账户信息查询失败 would never match.
const OLD_ERR = '              if (!result.ok) return { balance: null, error: `\\u8D26\\u6237\\u4FE1\\u606F\\u67E5\\u8BE2\\u5931\\u8D25\\uFF1A${result.message}` };'
const ESC = (s) => s.replace(/[^\x20-\x7e]/gu, ch => '\\u' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'))
const NEW_ERR = [
  '              if (!result.ok) {',
  '                // [xdpool-local] An expired STS token is the commonest CodeArts',
  '                // failure, and the raw APIG message does not say what to do about',
  '                // it. Name the condition, then name the one action that fixes it.',
  '                // Only when it IS expired: a 5xx keeps its original wording.',
  '                const advice = codeartsCredentialExpired(credential) ? "' + ESC('（临时凭证已过期，点「刷新凭据」即可换新，无需重新登录）') + '" : "";',
  '                return { balance: null, error: `' + ESC('账户信息查询失败') + '${advice}' + ESC('：') + '${result.message}` };',
  '              }',
]
replaceLine(OLD_ERR, NEW_ERR.join(EOL))

const text = lines.join(EOL)
if (!text.includes(MARKER)) throw new Error('marker did not land')
if (!text.includes('healExpiredCodeArtsCredentials')) throw new Error('the heal was not inserted')
writeFileSync(PATH, text)
console.log('patched: expired CodeArts STS credentials are healed before being reported')
