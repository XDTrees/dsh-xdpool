/**
 * Patch channel-pack: a rejected credential must also rotate the account, and the
 * error must carry what the upstream actually said.
 *
 * Two defects in the CodeArts lane, both of which turn one bad account into a
 * whole-platform failure:
 *
 * 1. **Auth failure never rotates.** The 401/403 branch does
 *    `refresh() → resolveCredential() → continue`, which re-reads the SAME
 *    account. Every other failure class (rate limit, quota) goes through
 *    `accountPool.getAvailableAccount(...)` and tries a different account; auth
 *    alone does not. So with two accounts in the pool, a credential the gateway
 *    rejects for the first one fails the whole request even though the second
 *    works.
 *
 * 2. **The upstream body is dropped.** The throw is
 *    `codearts: model request failed with HTTP ${status}` — the caller's only
 *    evidence is a number. When that number is 403 TM.00000001 (a WAF verdict on
 *    the User-Agent, per the UA patch beside this one) the operator has nothing
 *    to go on and reasonably concludes the key is bad.
 *
 * The rotation is one-shot per account: `rateLimitTried` already tracks the ids
 * this request has spent, so a pool of N accounts gets N-1 extra attempts at most
 * and cannot loop.
 *
 * Idempotent.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const PATH = 'vendor/channel-pack/pack.js'
const MARKER = '[xdpool-local] auth failure rotates the account'
const source = readFileSync(PATH, 'utf8')
if (source.includes(MARKER)) {
  console.log('already patched')
  process.exit(0)
}

const EOL = source.includes('\r\n') ? '\r\n' : '\n'
const join = (...lines) => lines.join(EOL)

/** The CodeArts auth branch, matched with CRLF tolerance. */
const OLD = new RegExp(
  '        if \\(isAuthError\\(response\\.status, errorText\\) && !authRefreshed\\) \\{\\r?\\n'
  + '          authRefreshed = true;\\r?\\n'
  + '          await this\\.options\\.refresh\\(\\);\\r?\\n'
  + '          credential = await this\\.options\\.resolveCredential\\(\\);\\r?\\n'
  + '          if \\(credential === void 0 \\|\\| !credential\\.access_key_id \\|\\| '
  + '!credential\\.secret_access_key \\|\\| !credential\\.security_token\\) \\{\\r?\\n'
  + '            throw new LlmError2\\("codearts: credential missing after refresh; log in again", '
  + '"MISSING_CREDENTIAL"\\);\\r?\\n'
  + '          \\}\\r?\\n'
  + '          continue;\\r?\\n'
  + '        \\}',
  'g',
)

const NEW = join(
  '        if (isAuthError(response.status, errorText) && !authRefreshed) {',
  '          authRefreshed = true;',
  `          // ${MARKER}, not just refresh it.`,
  '          //',
  '          // This branch used to refresh and continue, which re-reads the SAME',
  '          // account — so with two accounts in the pool, a credential the gateway',
  '          // rejects for the first one failed the whole request while the second',
  '          // would have worked. Every other failure class already rotates via',
  '          // accountPool.getAvailableAccount; auth was the one exception.',
  '          //',
  '          // One shot per account: `rateLimitTried` holds the ids this request has',
  '          // already spent, so a pool of N accounts gets at most N-1 extra',
  '          // attempts and the loop cannot spin.',
  '          if (this.options.accountPool) {',
  '            const next = await this.options.accountPool.getAvailableAccount(',
  '              "codearts", options.model, rateLimitTried,',
  '            );',
  '            if (next && !rateLimitTried.has(next.entry.id)) {',
  '              rateLimitTried.add(next.entry.id);',
  '              credential = next.credential;',
  '              currentAccountId = next.entry.id;',
  '              continue;',
  '            }',
  '          }',
  '          await this.options.refresh();',
  '          credential = await this.options.resolveCredential();',
  '          if (credential === void 0 || !credential.access_key_id || !credential.secret_access_key || !credential.security_token) {',
  '            throw new LlmError2("codearts: credential missing after refresh; log in again", "MISSING_CREDENTIAL");',
  '          }',
  '          continue;',
  '        }',
)

const count = (source.match(OLD) ?? []).length
if (count !== 1) throw new Error(`expected exactly 1 CodeArts auth branch, found ${String(count)}`)

/**
 * And the throw that used to discard the body.
 *
 * Same reason: `HTTP 403` alone cannot be diagnosed. The detail is truncated so a
 * gateway that answers with a full HTML error page cannot flood the message.
 */
const OLD_THROW = new RegExp(
  '        throw new LlmError2\\(`codearts: model request failed with HTTP \\$\\{response\\.status\\}`, '
  + 'code, \\{\\r?\\n          status: response\\.status  \\/\\/ 透传 HTTP 状态，便于上层归类\\r?\\n        \\}\\);',
  'g',
)

const NEW_THROW = join(
  '        // [xdpool-local] Carry what the upstream actually said. "HTTP 403" alone',
  '        // is undiagnosable: it was a WAF verdict on the User-Agent, and the',
  '        // operator had no way to see that from a bare status code.',
  '        const authDetail = errorDetail(errorText).slice(0, 200);',
  '        throw new LlmError2(',
  '          `codearts: model request failed with HTTP ${response.status}`',
  '            + (authDetail === "" ? "" : ` (${authDetail})`),',
  '          code,',
  '          {',
  '            status: response.status,',
  '          },',
  '        );',
)

let next = source.replace(OLD, NEW)

if (OLD_THROW.test(source)) {
  if ((source.match(OLD_THROW) ?? []).length !== 1) {
    throw new Error('the CodeArts throw anchor matched more than once')
  }
  next = next.replace(OLD_THROW, NEW_THROW)
} else {
  // Not fatal: the throw may have been rewritten by another local patch. Say so
  // rather than claim a change that did not happen.
  console.log('note: the HTTP-status throw anchor did not match; leaving it as-is')
}

if (!next.includes(MARKER)) throw new Error('the marker did not land — the write was a no-op')
writeFileSync(PATH, next)
console.log('auth-rotation + error-detail patch applied')
