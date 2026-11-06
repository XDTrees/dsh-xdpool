/**
 * Durable copy of the discovered accounts, inside the plugin's data directory.
 *
 * The pool's account list is otherwise pure memory: the desktop app keeps only
 * the CURRENT sign-in on disk (each login overwrites the one auth file), so
 * accounts gathered by switching sign-ins evaporated on every restart. This
 * store is the fix — `scan()` seeds from it and writes the merged list back, so
 * the pool now survives restarts.
 *
 * JSON only, atomic rename on write: a crash mid-write leaves the previous
 * generation intact, and the pool never reads a half-written account again.
 *
 * @module dsh-xdpool/account-store
 */

import { readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkBuddyAccount, WorkBuddyCredential } from './accounts.ts'
import { ensureSecretDir, writeSecretFile } from './file-perms.ts'
import { PLUGIN_DATA_DIR_NAME, dshHome } from './ignored.ts'

/** File name of the durable account list, inside the plugin data directory. */
export const ACCOUNTS_FILE_NAME = 'accounts.json'

/**
 * State files that live in the same directory but are NOT account snapshots.
 *
 * The snapshot importer (`dsh-xdpool import <key>`) writes `<md5prefix>.json`
 * into this directory, and the pool scans it — so every other `.json` file here
 * is treated as an imported snapshot. These three are the plugin's own
 * bookkeeping and must never be parsed as credentials.
 */
export const NON_SNAPSHOT_FILES = [ACCOUNTS_FILE_NAME, 'ignored.json', 'preferred.json'] as const

/** One durably stored account: identity plus the credential that worked. */
export interface StoredAccount {
  id: string
  label: string
  credential: WorkBuddyCredential
  savedAtMs: number
}

/** Absolute path of the durable account list. */
export function accountStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(dshHome(env), PLUGIN_DATA_DIR_NAME, ACCOUNTS_FILE_NAME)
}

/** The directory the pool scans for imported `<md5prefix>.json` snapshots. */
export function snapshotDirPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(dshHome(env), PLUGIN_DATA_DIR_NAME)
}

/**
 * True when a file name in the snapshot directory is plugin bookkeeping rather
 * than an imported snapshot.
 */
export function isStateFile(name: string): boolean {
  return (NON_SNAPSHOT_FILES as readonly string[]).includes(name)
}

/** True when a value has the shape of a stored account. */
function isStoredAccount(value: unknown): value is StoredAccount {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  const credential = record['credential']
  return typeof record['id'] === 'string'
    && typeof record['label'] === 'string'
    && typeof credential === 'object' && credential !== null
    && typeof (credential as Record<string, unknown>)['accessToken'] === 'string'
    && typeof (credential as Record<string, unknown>)['refreshToken'] === 'string'
}

/**
 * Read the durable list. Tolerant on purpose: a malformed or half-written file
 * yields `[]` and the pool simply rediscovers from disk, rather than a corrupt
 * store taking the whole pool down.
 */
export async function loadStoredAccounts(path: string): Promise<StoredAccount[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const entries = (parsed as { accounts?: unknown } | null)?.['accounts']
  if (!Array.isArray(entries)) return []
  const out: StoredAccount[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!isStoredAccount(entry)) continue
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    out.push(entry)
  }
  return out
}

/**
 * Atomically write the durable list: `${path}.tmp` first, then rename. A crash
 * mid-write leaves the previous generation intact.
 */
export async function saveStoredAccounts(path: string, accounts: readonly WorkBuddyAccount[]): Promise<void> {
  const stored: StoredAccount[] = accounts.map(account => ({
    id: account.id,
    label: account.label,
    credential: account.credential,
    savedAtMs: Date.now(),
  }))
  const document = JSON.stringify({ version: 1, accounts: stored }, null, 2) + '\n'
  // Owner-only: this file carries `accessToken` / `refreshToken` verbatim, and a
  // plain writeFile leaves it at the process umask (typically 0644, readable by
  // every other user on the host). The mode is applied when the TEMP file is
  // created, so the rename carries it to the destination — no window where the
  // real path exists with the old permissions.
  await ensureSecretDir(join(path, '..'))
  const tmp = `${path}.tmp`
  await writeSecretFile(tmp, document)
  await rename(tmp, path)
}
