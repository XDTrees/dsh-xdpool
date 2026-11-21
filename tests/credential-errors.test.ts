import { describe, expect, it } from 'vitest'
import { credentialMessage, explainFailure } from '../src/credential-errors.ts'

/**
 * What a failed status says to a user.
 *
 * Every channel used to report the bare `HTTP 401`, which reads as "the request failed" when it
 * actually means "this credential is no longer accepted, sign in again". The two are different
 * actions, and the wrong one wastes a user's time on their network.
 */
describe('the two statuses that mean something', () => {
  it('names a dead credential by its channel', () => {
    expect(credentialMessage(401, '百智云')).toContain('百智云')
    expect(credentialMessage(401, '百智云')).toContain('重新登录')
  })

  it('separates a refusal from an expiry', () => {
    /**
     * A 403 is not "sign in again" — the credential may be fine and the account blocked. Saying
     * so is what stops a user pasting the same key twice.
     */
    const denied = credentialMessage(403, 'Accio')
    expect(denied).toContain('Accio')
    expect(denied).not.toBe(credentialMessage(401, 'Accio'))
  })

  it('recognises a rate limit', () => {
    expect(credentialMessage(429, 'Qiniu')).toContain('限流')
  })
})

describe('everything else', () => {
  it('leaves an ordinary status alone', () => {
    // A 500 is genuinely "the upstream broke", and dressing it up as an auth problem would lie.
    expect(credentialMessage(500, 'x')).toBeUndefined()
    expect(credentialMessage(404, 'x')).toBeUndefined()
  })

  it('keeps the vendor\'s own words when there are any', () => {
    /**
     * A vendor's message is often more specific than anything generic — "Invalid token" names
     * the problem better than "sign in again" does.
     */
    const message = explainFailure({ status: 401, channel: 'AutoClaw', body: 'Invalid token' })
    expect(message).toContain('AutoClaw')
    expect(message).toContain('重新登录')
    expect(message).toContain('Invalid token')
  })

  it('falls back to the bare status when nothing is known', () => {
    expect(explainFailure({ status: 502, channel: 'x' })).toBe('HTTP 502')
  })

  it('caps a long vendor body', () => {
    // An HTML error page can be hundreds of kilobytes; the message is one line on a card.
    const message = explainFailure({ status: 502, channel: 'x', body: 'a'.repeat(5_000) })
    expect(message.length).toBeLessThan(300)
  })

  it('trims a body before using it', () => {
    expect(explainFailure({ status: 502, channel: 'x', body: '  spare  ' })).toBe('HTTP 502：spare')
  })
})
