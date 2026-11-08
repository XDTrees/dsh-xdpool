/**
 * The backup file is not a summary — it carries every account's credential value,
 * which is enough to sign in as those accounts. An unencrypted file in a downloads
 * folder or a chat window is a credential leak with extra steps.
 *
 * The arithmetic of enforcement, therefore:
 *
 *   - the export REFUSES to run without a password of a sensible length;
 *   - the payload is encrypted here, in the browser, so the plaintext never leaves
 *     this process — the pack's own RPC comment commits to the same split;
 *   - a wrong password and a damaged file are ONE message, because distinguishing them
 *     would confirm a guess about which it was, and the next step is the same.
 *
 * The primitives are checked structurally rather than by running WebCrypto: a unit
 * test cannot honestly exercise a KDF, and asserting the parameters is what catches
 * the regression that matters (someone lowering the iteration count).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const crypto = readFileSync(new URL('../src/client/backup-crypto.ts', import.meta.url), 'utf8')
const panel = readFileSync(new URL('../src/client/BackupPanel.tsx', import.meta.url), 'utf8')

describe('the encrypted backup envelope', () => {
  it('uses PBKDF2-SHA256 at a defensible iteration count', () => {
    // The iteration count is the only thing between a leaked file and an offline
    // dictionary attack, so it is asserted rather than left to drift.
    expect(crypto).toContain("hash: 'SHA-256'")
    expect(crypto).toContain('ITERATIONS = 310_000')
  })

  it('uses AES-GCM, which authenticates rather than only concealing', () => {
    // CBC would decrypt a tampered file to plausible-looking garbage; GCM fails hard,
    // which is what lets a wrong password be reported as a wrong password.
    expect(crypto).toContain("name: 'AES-GCM'")
    expect(crypto).toContain('length: 256')
  })

  it('generates a fresh salt and IV per export', () => {
    // Reusing either across exports is the actual mistake; both travel in the header
    // because neither is a secret.
    expect(crypto).toContain('getRandomValues(new Uint8Array(16))')
    expect(crypto).toContain('getRandomValues(new Uint8Array(12))')
  })

  it('gives one message for a wrong password and a damaged file', () => {
    // Telling them apart would confirm a guess about which it was.
    expect(crypto).toContain('wrong password, or the file is damaged')
    const start = crypto.indexOf('export async function decryptBackup')
    const body = crypto.slice(start, start + 900)
    expect(body).toContain('catch {')
    // And the tag failure never leaks a partial plaintext.
    expect(body).not.toContain('partial')
  })

  it('refuses a password that is obviously too short to be a secret', () => {
    expect(crypto).toContain('MIN_PASSWORD = 8')
    expect(panel).toContain('MIN_PASSWORD')
  })
})

describe('the export/import flow', () => {
  it('refuses to export without an acceptable password', () => {
    // Encryption is not optional: the payload is credentials.
    const start = panel.indexOf('const exportBackup = useCallback')
    const body = panel.slice(start, start + 1600)
    expect(body).toContain('if (tooShort)')
    expect(body).toContain('encryptBackup(')
  })

  it('encrypts before writing anything to disk', () => {
    // The order matters: the plaintext must not be the thing handed to the Blob.
    const start = panel.indexOf('const exportBackup = useCallback')
    const body = panel.slice(start, start + 2200)
    const encryptAt = body.indexOf('encryptBackup(')
    const blobAt = body.indexOf('new Blob(')
    expect(encryptAt).toBeGreaterThan(-1)
    expect(blobAt).toBeGreaterThan(encryptAt)
  })

  it('warns how many accounts an import would REPLACE', () => {
    // Import replaces rather than merges (the pack's design), so a wrong file must be
    // caught before the accounts are gone, not after.
    const start = panel.indexOf('const importBackup = useCallback')
    const body = panel.slice(start, start + 3200)
    expect(body).toContain("callPack('backup.status'")
    expect(body).toContain('window.confirm(message)')
    const statusAt = body.indexOf("callPack('backup.status'")
    const importAt = body.indexOf("callPack('backup.import'")
    expect(importAt).toBeGreaterThan(statusAt)
  })

  it('still accepts an older unencrypted payload', () => {
    // Refusing it would strand anyone who exported before encryption existed.
    const start = panel.indexOf('const importBackup = useCallback')
    const body = panel.slice(start, start + 3200)
    expect(body).toContain('isEncryptedEnvelope(parsed)')
    expect(body).toContain('payload = parsed')
  })

  it('clears the file input so the same file can be chosen twice', () => {
    // A file input keeps its value, so re-picking the same file fires no change event —
    // which looks like a dead button after a failed password.
    expect(panel).toContain('fileRef.current.value = ')
  })
})
