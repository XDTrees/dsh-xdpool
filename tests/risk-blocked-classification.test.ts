import { describe, expect, it } from 'vitest'
import { classifyUpstreamError } from '../src/upstream.ts'

/**
 * Risk control is not a bad key — issue #127.
 *
 * A flagged account answers 403 with `code 11140`. The classifier treated every 403 as
 * `session_dead`, which the card renders as "API 密钥无效" and which the pool answers by
 * refreshing the token — neither of which fixes a flag. The user re-signed-in repeatedly
 * against a problem that has nothing to do with their credential.
 */
describe('a risk-flagged account', () => {
  it('is its own kind, not a dead session', () => {
    const body = '403: {"error":{"code":11140,"message":"account restricted"}}'
    expect(classifyUpstreamError(403, body)).toBe('risk_blocked')
  })

  it('is recognised by the code, however the prose is worded', () => {
    // The number outlives the sentence around it, which is why the code is matched rather
    // than any wording.
    expect(classifyUpstreamError(403, '{"code":11140}')).toBe('risk_blocked')
    expect(classifyUpstreamError(403, '{"code": 11140}')).toBe('risk_blocked')
    expect(classifyUpstreamError(403, '{"code":"11140"}')).toBe('risk_blocked')
  })

  it('leaves an ordinary 403 as a dead session', () => {
    // A 403 without the risk code is still "this credential is not accepted", which is what
    // refreshing the token is for.
    expect(classifyUpstreamError(403, '{"message":"forbidden"}')).toBe('session_dead')
  })

  it('does not misfire on a 401 that happens to mention the number', () => {
    // The risk rule is 403-only on purpose: a 401 with a stray 11140 in the body is still an
    // authentication failure, and cooling the account for it would hide a fixable session.
    expect(classifyUpstreamError(401, '{"code":11140}')).toBe('session_dead')
  })

  it('keeps the classes that already worked', () => {
    expect(classifyUpstreamError(402, '{}')).toBe('hard_credit')
    expect(classifyUpstreamError(429, '{}')).toBe('soft_rate')
    expect(classifyUpstreamError(404, '{}')).toBe('not_found')
    expect(classifyUpstreamError(500, '{}')).toBe('server')
  })
})
