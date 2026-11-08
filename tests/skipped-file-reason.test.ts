/**
 * "not a credential file" was the wrong label for a credential that had merely aged out.
 *
 * The reported case: three `workbuddy-desktop.2026-10-08….info` snapshots were listed as
 * "不是凭据文件". They WERE credential files — correctly formed, real accounts, tokens
 * intact — whose 30-day `refreshExpiresAt` had just passed (created 10-08, expired 11-07).
 * The label sent the reader looking for a format problem that did not exist.
 *
 * The old code made this unavoidable: `skipReasonFor` returned `'malformed'` from BOTH
 * arms of the try/catch, so *every* rejection — parse failure, wrong shape, expired
 * window — collapsed into one message.
 *
 * The four reasons now have four remedies, which is the only thing that makes the label
 * worth showing:
 *
 *   encrypted  → start the desktop app (or set the executable override)
 *   expired    → sign in again, or delete the snapshot; nothing to fix
 *   unreadable → permissions / the file vanished
 *   malformed  → genuinely not a credential
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const accounts = readFileSync(new URL('../src/accounts.ts', import.meta.url), 'utf8')
const card = readFileSync(new URL('../src/client/PoolCard.tsx', import.meta.url), 'utf8')

describe('why a credential file was skipped', () => {
  it('has four reasons, not three', () => {
    expect(accounts).toContain("reason: 'encrypted' | 'expired' | 'unreadable' | 'malformed'")
  })

  it('tells an EXPIRED credential apart from a malformed file', () => {
    // The distinction the report was about: a document that carries a token and a closed
    // refresh window is expired, not malformed.
    const start = accounts.indexOf('async function skipReasonFor')
    const body = accounts.slice(start, start + 2200)
    expect(body).toContain("return 'expired'")
    // It must actually inspect the token and the window, not just the JSON validity.
    expect(body).toContain("auth['accessToken']")
    expect(body).toContain("auth['refreshExpiresAt']")
  })

  it('keeps "no token at all" as malformed', () => {
    // A file that parses but holds no credential really is not one; calling it expired
    // would invite a pointless sign-in.
    const start = accounts.indexOf('async function skipReasonFor')
    const body = accounts.slice(start, start + 2200)
    const noToken = body.indexOf("if (typeof token !== 'string' || token === '')")
    expect(noToken).toBeGreaterThan(-1)
    expect(body.slice(noToken, noToken + 200)).toContain("return 'malformed'")
  })

  it('does not report an unknown expiry as expired', () => {
    // "We cannot read the window" is not evidence that it has closed.
    const start = accounts.indexOf('async function skipReasonFor')
    const body = accounts.slice(start, start + 2200)
    expect(body).toContain("if (typeof refreshRaw === 'number')")
  })

  it('no longer returns one reason from both arms of a try/catch', () => {
    // The shape that made the defect invisible.
    const start = accounts.indexOf('async function skipReasonFor')
    const body = accounts.slice(start, start + 2200)
    expect(body).not.toMatch(/JSON\.parse\(text\)\s*\n\s*return 'malformed'\s*\n\s*\}\s*catch\s*\{\s*\n\s*return 'malformed'/u)
  })

  it('gives the reader the right remedy in the card', () => {
    expect(card).toContain("entry.reason === 'expired'")
    expect(card).toContain('row.skippedExpired')
  })
})
