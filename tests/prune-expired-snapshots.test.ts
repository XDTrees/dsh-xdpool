/**
 * Expired snapshots are deleted once a newer sign-in covers the same account.
 *
 * The desktop app writes a fresh `workbuddy-desktop.<ts>.<pid>.<uuid>.info` on every
 * sign-in and never removes the previous one. A month later each of them passes its
 * `refreshExpiresAt` and the card fills with "expired" files the user cannot act on —
 * dead weight from sign-ins that already succeeded.
 *
 * Deleting a credential file is destructive and the directory belongs to another
 * application, so the rule is deliberately narrow. Each of these is a reason to KEEP a
 * file, and each is asserted:
 *
 *   - it is not classified `expired` (an `encrypted` or `unreadable` file may be the one
 *     holding a working key);
 *   - no loaded credential carries the same `uin`;
 *   - it is one of the live files the running app owns.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const accounts = readFileSync(new URL('../src/accounts.ts', import.meta.url), 'utf8')

describe('pruning superseded expired snapshots', () => {
  it('runs after a scan, and only on `expired` entries', () => {
    expect(accounts).toContain('pruneExpiredSnapshots')
    const start = accounts.indexOf('private async pruneExpiredSnapshots')
    expect(start).toBeGreaterThan(-1)
    const body = accounts.slice(start, start + 1500)
    expect(body).toContain("reason === 'expired'")
  })

  it('requires a LOADED credential for the same uin before deleting anything', () => {
    // Without a replacement there is nothing to serve the account, and deleting its only
    // credential would turn a recoverable state into a lost account.
    const start = accounts.indexOf('private async pruneExpiredSnapshots')
    const body = accounts.slice(start, start + 1500)
    expect(body).toContain('servedUins')
    expect(body).toContain('!servedUins.has(uin)')
  })

  it('uses uin, the billing identity, not uid', () => {
    // Two sign-ins of one person must match even when the desktop app wrote them from
    // different installs.
    const start = accounts.indexOf('private async pruneExpiredSnapshots')
    const body = accounts.slice(start, start + 1500)
    expect(body).toContain('credential.uin')
    expect(body).not.toContain('credential.uid')
  })

  it('never deletes the live files the running app owns', () => {
    const start = accounts.indexOf('private async pruneExpiredSnapshots')
    const body = accounts.slice(start, start + 1500)
    expect(body).toContain('liveNames')
    expect(body).toContain('WORKBUDDY_LIVE_FILENAME')
    expect(body).toContain("'workbuddy-desktop-ai.info'")
  })

  it('reads the identity past the expiry gate', () => {
    // `parseWorkBuddyAuth` refuses an expired document by design, so the uin has to come
    // from the raw JSON — reading it through the parser would find nothing to match on.
    expect(accounts).toContain('cheapUinFromFile')
    const start = accounts.indexOf('async function cheapUinFromFile')
    const body = accounts.slice(start, start + 900)
    expect(body).toContain("identity['uin']")
    // No expiry check here, unlike parseWorkBuddyAuth.
    expect(body).not.toContain('refreshExpiresAt')
  })

  it('drops the removed entries from the skipped list, not just the disk', () => {
    // Otherwise the card keeps reporting files that no longer exist.
    expect(accounts).toContain('this.skippedFiles = skipped.filter(entry => !cleaned.includes(entry.path))')
  })

  it('survives a delete that fails', () => {
    // A permission error on one file must not abort the scan.
    const start = accounts.indexOf('private async pruneExpiredSnapshots')
    const body = accounts.slice(start, start + 2600)
    expect(body).toContain('catch (error: unknown)')
    expect(body).toContain('could not remove expired snapshot')
  })
})
