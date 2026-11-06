/**
 * Write a file that holds credentials, without leaving it world-readable.
 *
 * Every credential this plugin keeps on disk — the durable account list, the
 * ignore list, any mirrored balance — travelled through a plain `writeFile` with
 * the process umask as the only protection. On a POSIX host that typically means
 * `0644`: readable by every other user on the machine, and these files carry
 * `accessToken` / `refreshToken` verbatim.
 *
 * Two rules, and the order matters:
 *
 * 1. **Create, don't patch.** `mode` on `writeFile` only applies when the file is
 *    created. The atomic-write pattern already writes a fresh temp file and
 *    renames it over the target, so the temp is created with `0600` and the
 *    rename carries that permission to the destination. Chmod'ing afterwards
 *    would also work but leaves a window where the file exists with the old
 *    mode.
 * 2. **Still chmod best-effort.** A file written by an older version already
 *    exists with `0644`; the rename replaces the inode, so rule 1 covers it —
 *    but a host that keeps the target in place (or a future caller that writes
 *    directly) would not be covered, and `chmod` is cheap.
 *
 * WINDOWS: `mode` is ignored by Node on win32, and there is no ACL equivalent in
 * the standard library. The honest statement is what actually protects these
 * files there: they live under the user's own profile (%USERPROFILE%, %LOCALAPPDATA%),
 * whose inherited ACL excludes other standard users by default. Calling `icacls`
 * per write would spawn a process on every balance update to re-apply a
 * protection the parent directory already provides, so this module does not. A
 * profile relocated to a shared directory is outside what this code can detect —
 * the README says where the files live so the user can check.
 *
 * @module dsh-xdpool/file-perms
 */
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Owner-only, for a file that holds a secret. */
const SECRET_FILE_MODE = 0o600
/** Owner-only, for the directory that holds them. */
const SECRET_DIR_MODE = 0o700

/**
 * True on a platform where POSIX modes are meaningful.
 *
 * Computed through a `typeof process` guard rather than read straight off the
 * global: this module is host-only in intent, but `store.ts` imports it and the
 * browser bundle imports `store.ts` for its row types, so the module body DOES
 * get bundled for the browser. A bare `process.platform` there throws
 * `ReferenceError: process is not defined` at first render — and it is the kind
 * of failure that only shows up in the packaged app.
 */
const POSIX = typeof process === 'undefined' ? false : process.platform !== 'win32'

/**
 * Create the directory a secret lives in, owner-only.
 *
 * `recursive` so a fresh install works, and the mode applies to every directory
 * this call creates. An existing directory keeps its mode — `mkdir` does not
 * change what is already there — so `chmod` runs too, best-effort: tightening a
 * directory that a previous version created permissively is exactly the case
 * worth fixing, and a failure is not worth aborting a save over.
 */
export async function ensureSecretDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, ...POSIX ? { mode: SECRET_DIR_MODE } : {} })
  if (!POSIX) return
  try {
    await chmod(dir, SECRET_DIR_MODE)
  } catch {
    // A directory we do not own, or a filesystem without modes. The file mode
    // below is the protection that matters; a directory that cannot be tightened
    // must not fail the write.
  }
}

/**
 * Write `contents` to `path` with owner-only permissions.
 *
 * Not atomic on its own — callers that need the crash-safe temp+rename dance keep
 * doing it and just route the temp write through here, which is why the mode is
 * applied at creation: the rename then carries it to the final file.
 */
export async function writeSecretFile(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, POSIX ? { encoding: 'utf8', mode: SECRET_FILE_MODE } : 'utf8')
  if (!POSIX) return
  try {
    // Covers a destination that already existed with looser permissions, and a
    // filesystem that ignored the creation mode.
    await chmod(path, SECRET_FILE_MODE)
  } catch {
    // Best effort, as above.
  }
}

/**
 * Prepare `path`'s parent directory and write it as a secret.
 *
 * The common case in this plugin is "make sure the folder exists, then write the
 * file", so the two steps live together rather than being repeated at each call
 * site and eventually forgotten at one of them.
 */
export async function writeSecretAt(path: string, contents: string): Promise<void> {
  await ensureSecretDir(dirname(path))
  await writeSecretFile(path, contents)
}
