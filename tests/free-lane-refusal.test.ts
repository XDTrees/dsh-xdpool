/**
 * A 403 on the free lane must not read as "your quota is used up" (#96).
 *
 * The reporter never got a successful call on 「XD Pool · 免费模型」 and was told
 * "当前请求的额度已用尽" — which is the host's wording for a bare refusal, and is
 * wrong in the one way that matters: it tells the user to wait. The actual cause
 * was a fingerprint mismatch (403, never billed), which is fixed by updating the
 * plugin. Waiting and updating are opposite moves, so the message has to name
 * the right one.
 *
 * The lane cannot see which of the two it is: both arrive as a thin refusal. So
 * the contract asserted here is not "it classifies correctly" — it is "it says
 * both, leads with the actionable one, and never claims the quota is spent".
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/free-upstream.ts', import.meta.url), 'utf8')

/**
 * The `withFreeTierHint` body, brace-matched.
 *
 * Not `indexOf('\n}\n')`: the body holds a nested block and a template literal,
 * and the naive search landed inside the SIGNATURE — so every assertion below
 * compared against an empty string and "passed" for the wrong reason. Matching
 * braces from the opening `{` is the only bound that follows the code.
 */
function functionBody(text, signature) {
  const start = text.indexOf(signature)
  if (start === -1) throw new Error(`${signature} not found`)
  let depth = 0
  for (let index = text.indexOf('{', start); index < text.length; index += 1) {
    if (text[index] === '{') depth += 1
    else if (text[index] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  throw new Error(`${signature} body is not balanced`)
}
const hint = functionBody(source, 'function withFreeTierHint')
// A guard on the guard: an empty or truncated slice would make every assertion
// below vacuous, which is exactly the failure mode this file exists to catch.
if (!hint.includes('provider said') || hint.length < 400) {
  throw new Error(`withFreeTierHint body did not isolate correctly (${String(hint.length)} chars)`)
}

describe('the free lane explains a refusal instead of guessing', () => {
  it('routes every non-ok answer through the hint', () => {
    // A single call site is what guarantees no path bypasses the wording — the
    // streamed POST and the non-streamed JSON answer both end here.
    expect(source).toContain('withFreeTierHint(response.status, refusal, retryAfter)')
    expect(source).not.toMatch(/throw withSessionQuotaHint\(classifyUpstream\(/u)
  })

  it('leads with the fingerprint reading and says waiting will not help', () => {
    expect(hint).toContain('request fingerprint no longer matches')
    expect(hint).toContain('NOT an exhausted quota')
    expect(hint).toContain('waiting will not help')
    // The action the user can actually take.
    expect(hint).toContain('update dsh-xdpool')
  })

  it('still mentions the per-conversation budget, because a 403 can be that too', () => {
    // Both readings are real; dropping either would send half of the affected
    // users down the wrong path.
    expect(hint).toContain('metered per conversation')
    expect(hint).toContain('fresh conversation')
  })

  it('keeps the provider\'s own sentence for the next diagnosis', () => {
    expect(hint).toContain('provider said')
    expect(hint).toContain('base.message.slice(separator + 2)')
  })

  it('leaves 429 to its own hint', () => {
    // A 429 genuinely is quota. Mixing the two would blur a distinction that
    // decides whether a retry is worth anything.
    expect(hint).toContain('if (status !== 403) return base')
    expect(source).toContain('withSessionQuotaHint')
  })

  it('does not downgrade a 403 into a dead session', () => {
    // `session_dead` makes the pool penalize a credential that is fine: the
    // free lane has no credential at all, only a shared public one.
    expect(hint).toContain('classifyUpstream(status, refusal, retryAfterMs, \'\')')
    expect(hint).not.toContain("new AggregateError('session_dead'")
  })
})
