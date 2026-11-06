/**
 * Patch channel-pack: the CodeArts HTTP-status error must carry the upstream body.
 *
 * `codearts: model request failed with HTTP 403` is undiagnosable on its own. The
 * 403 that prompted this report was a WAF verdict on the User-Agent, and the
 * operator — seeing only a number — reasonably concluded the credential was bad
 * and went looking for a credential problem that did not exist.
 *
 * The body is what names the cause (`TM.00000001 网络繁忙` vs
 * `APIG.0301 verify ak sk signature fail`), so it rides along, truncated so a
 * gateway answering with a full HTML error page cannot flood the message.
 *
 * Idempotent, CRLF-tolerant.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const PATH = 'vendor/channel-pack/pack.js'
const MARKER = '[xdpool-local] error detail on the HTTP-status throw'
const source = readFileSync(PATH, 'utf8')
if (source.includes(MARKER)) {
  console.log('already patched')
  process.exit(0)
}

const EOL = source.includes('\r\n') ? '\r\n' : '\n'
const join = (...lines) => lines.join(EOL)

/** The single-line throw, exactly as it stands. */
const OLD =
  '            throw new LlmError2(`codearts: model request failed with HTTP ${response.status}`, code, { status: response.status });'

const NEW = join(
  `            // ${MARKER}.`,
  '            //',
  '            // "HTTP 403" alone cannot be diagnosed: the 403 in this report was a',
  '            // WAF verdict on the User-Agent, and with no body in the message the',
  '            // operator went looking for a credential problem that did not exist.',
  '            // The body names the cause, truncated so an HTML error page cannot',
  '            // flood the message.',
  '            const failureDetail = errorDetail(errorText).slice(0, 200);',
  '            throw new LlmError2(',
  '              `codearts: model request failed with HTTP ${response.status}`',
  '                + (failureDetail === "" ? "" : ` (${failureDetail})`),',
  '              code,',
  '              { status: response.status },',
  '            );',
)

const count = source.split(OLD).length - 1
if (count !== 1) throw new Error(`expected exactly 1 throw, found ${String(count)}`)

const next = source.replace(OLD, NEW)
if (!next.includes(MARKER)) throw new Error('the marker did not land')
writeFileSync(PATH, next)
console.log('error-detail patch applied')
