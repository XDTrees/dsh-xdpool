/**
 * Files that hold credentials must not be world-readable.
 *
 * The defect this covers is quiet: every secret this plugin writes — the durable
 * account list with `accessToken`/`refreshToken`, the aggregate settings with
 * pasted third-party keys, the ignore list, the pinned account — went through a
 * plain `writeFile`, so the process umask decided the mode and on POSIX that is
 * typically `0644`. Readable by every other user on the host, with no error and
 * nothing in the UI to suggest it.
 *
 * Two levels of assertion, because either alone would be weak:
 *   - the helper actually sets the mode (behavioural, on a real temp dir);
 *   - every call site routes through it (structural), since a new writer that
 *     forgets is exactly how the gap reappears.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, statSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureSecretDir, writeSecretFile, writeSecretAt } from '../src/file-perms.ts'

const POSIX = process.platform !== 'win32'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'xdpool-perms-'))
}

/** Mode bits only (`stat.mode` also carries the file type). */
function modeOf(path: string): number {
  return statSync(path).mode & 0o777
}

describe('a secret file is created owner-only', () => {
  it('writes with 0600 on a POSIX host', () => {
    if (!POSIX) return
    const dir = tempDir()
    try {
      const path = join(dir, 'secret.json')
      return (async () => {
        await writeSecretFile(path, '{"token":"x"}\n')
        expect(modeOf(path)).toBe(0o600)
        // And the content is intact — a permissions helper that mangles the file
        // would be a worse trade than the bug it fixes.
        expect(readFileSync(path, 'utf8')).toBe('{"token":"x"}\n')
      })()
    } finally {
      // Cleanup runs after the promise above settles in the caller's scope; the
      // directory is small and the test process is short-lived, so a synchronous
      // removal here is enough.
      process.once('beforeExit', () => { rmSync(dir, { recursive: true, force: true }) })
    }
  })

  it('tightens a file that already existed with looser permissions', async () => {
    if (!POSIX) return
    const dir = tempDir()
    try {
      const path = join(dir, 'preexisting.json')
      // Stand in for a file the previous version wrote at the umask default.
      await writeSecretFile(path, 'old\n')
      const { chmod } = await import('node:fs/promises')
      await chmod(path, 0o644)
      expect(modeOf(path)).toBe(0o644)
      // Rewriting must not leave it looser than before.
      await writeSecretFile(path, 'new\n')
      expect(modeOf(path)).toBe(0o600)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates the containing directory owner-only, and does not fail on an existing one', async () => {
    if (!POSIX) return
    const parent = tempDir()
    try {
      const dir = join(parent, 'nested', '.xdpool')
      await ensureSecretDir(dir)
      expect(modeOf(dir)).toBe(0o700)
      // Idempotent: a second call on an existing directory is a no-op, not an
      // EEXIST failure. Every save calls this.
      await ensureSecretDir(dir)
      expect(modeOf(dir)).toBe(0o700)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('writeSecretAt prepares the parent and writes in one step', async () => {
    const parent = tempDir()
    try {
      const path = join(parent, 'a', 'b', 'file.json')
      await writeSecretAt(path, 'hi\n')
      expect(readFileSync(path, 'utf8')).toBe('hi\n')
      if (POSIX) {
        expect(modeOf(path)).toBe(0o600)
        expect(modeOf(join(parent, 'a', 'b'))).toBe(0o700)
      }
      // And a stray temp file was not left behind — the atomic writers rename it
      // away, and a helper that wrote `<path>.tmp` without renaming would be a
      // new leak.
      expect(readdirSync(join(parent, 'a', 'b'))).toEqual(['file.json'])
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})

describe('every credential writer goes through the helper', () => {
  const files = ['account-store.ts', 'ignored.ts', 'preferred.ts', 'store.ts']

  it.each(files)('%s does not call writeFile directly', (name) => {
    const source = readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
    // A bare `writeFile(` here would recreate the original defect: umask decides,
    // and the file lands at 0644 on a POSIX host.
    expect(source, `${name} still writes with a bare writeFile`).not.toMatch(/[^A-Za-z]writeFile\(/u)
  })

  it.each(files)('%s imports the helper', (name) => {
    const source = readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
    expect(source).toMatch(/from '\.\/file-perms\.ts'/u)
    expect(source).toMatch(/writeSecretFile|writeSecretAt/u)
  })

  it('the Windows gap is documented rather than hidden', () => {
    // Node ignores `mode` on win32 and the standard library has no ACL call. The
    // honest position — stated in the module — is that the files live under the
    // user's own profile, whose inherited ACL already excludes other standard
    // users. A comment that claimed Windows protection would be the lie.
    const source = readFileSync(new URL('../src/file-perms.ts', import.meta.url), 'utf8')
    expect(source).toContain('WINDOWS')
    expect(source).toMatch(/mode` is ignored by Node on win32|mode is ignored/u)
  })
})
