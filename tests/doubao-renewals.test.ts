import { describe, expect, it, beforeEach } from 'vitest'
import { absorbSetCookies, applyRenewals, credentialsOf, invalidateRenewals } from '../src/doubao-upstream.ts'
import type { DoubaoSession } from '../src/doubao-auth.ts'

/**
 * Rotated cookies, per account.
 *
 * THE BUG THIS PINS
 *
 * `renewals` used to be one flat map. With a single account that was invisible; with two it
 * is a correctness bug — a `set-cookie` the server sends to account A would be overlaid onto
 * account B's cookie header, sending A's freshly rotated `sessionid` while B's own jar still
 * claimed otherwise. Both accounts then answer "session expired" and the user is told to sign
 * in again for a problem the plugin caused.
 *
 * These tests exercise the merge itself, because the observable symptom (a rejected session)
 * cannot be reproduced without a live second account.
 */
function sessionOf(uid: string, sid: string): DoubaoSession {
  return {
    cookies: { sessionid: sid, sessionid_ss: sid, sid_tt: sid, uid_tt: uid },
    userAgent: 'ua SamanthaDoubao/2.31.4',
    savedAt: '2026-11-16T00:00:00.000Z',
  }
}

/** The credentials two different accounts produce. */
function credentialsOfUid(uid: string): ReturnType<typeof credentialsOf> {
  return credentialsOf(sessionOf(uid, `${uid}-sid`))
}

beforeEach(() => {
  invalidateRenewals()
})

describe('rotated cookies', () => {
  it('files each account under its own uid', () => {
    // The key is what keeps one jar's refresh out of the other's header.
    expect(credentialsOfUid('a').key).toBe('a')
    expect(credentialsOfUid('b').key).toBe('b')
    expect(credentialsOfUid('a').key).not.toBe(credentialsOfUid('b').key)
  })

  it('leaves another account\'s header untouched', () => {
    const a = credentialsOfUid('a')
    const b = credentialsOfUid('b')
    // What the server rotated onto A, recorded against A's key.
    absorbSetCookies(
      new Headers({ 'x-ms-token': 'a-rotated', 'set-cookie': 'sessionid=a-new; Path=/; Domain=.doubao.com' }),
      a.key,
    )
    // A sees its own rotation...
    expect(applyRenewals(a.header, a.key)).toContain('msToken=a-rotated')
    expect(applyRenewals(a.header, a.key)).toContain('sessionid=a-new')
    // ...and B sees none of it. This is the assertion the flat map could not pass.
    expect(applyRenewals(b.header, b.key)).toBe(b.header)
    expect(applyRenewals(b.header, b.key)).not.toContain('a-rotated')
    expect(applyRenewals(b.header, b.key)).not.toContain('a-new')
  })

  it('overlays an account\'s own values', () => {
    const a = credentialsOfUid('a')
    // An unmapped account is the identity overlay: nothing recorded, nothing changed.
    expect(applyRenewals(a.header, a.key)).toBe(a.header)
    expect(applyRenewals(a.header, a.key)).toContain('sessionid=a-sid')
  })

  it('treats an unnamed account as "no overlay" rather than "all of them"', () => {
    // A caller that does not know whose cookies these are must not be handed somebody else's.
    const a = credentialsOfUid('a')
    expect(applyRenewals(a.header)).toBe(a.header)
  })

  it('refuses to build credentials without a session', () => {
    expect(() => credentialsOf(undefined)).toThrow(/登录/)
    expect(() => credentialsOf({ cookies: {}, userAgent: 'ua', savedAt: 'now' })).toThrow(/登录/)
  })

  it('keeps an account\'s own rotation across a re-read', () => {
    // The same person signing in again produces new credentials; the rotation recorded for
    // their uid still applies, which is what keeps a long-lived session alive.
    const before = credentialsOfUid('a')
    absorbSetCookies(new Headers({ 'x-ms-token': 'kept' }), before.key)
    const after = credentialsOfUid('a')
    expect(applyRenewals(after.header, after.key)).toContain('msToken=kept')
  })

  it('drops one account\'s renewals without touching the others', () => {
    const a = credentialsOfUid('a')
    const b = credentialsOfUid('b')
    absorbSetCookies(new Headers({ 'x-ms-token': 'a-token' }), a.key)
    absorbSetCookies(new Headers({ 'x-ms-token': 'b-token' }), b.key)
    invalidateRenewals(a.key)
    // A fresh sign-in for A must not carry the previous rotation...
    expect(applyRenewals(a.header, a.key)).toBe(a.header)
    // ...while B is untouched.
    expect(applyRenewals(b.header, b.key)).toContain('msToken=b-token')
  })
})
