/**
 * Where Doubao sessions live between runs.
 *
 * WHY A LIST AND NOT A FILE
 *
 * The first version held one session in `doubao-session.json`, so signing in a second account
 * overwrote the first — the report was "logging in the second Doubao kicks out the first"
 * (#171). Doubao's own sign-in is per-browser-profile, so every account is a separate cookie
 * jar, and the plugin needs to keep them all.
 *
 * So the store is a list keyed by an account id derived from the session's own identity
 * (`uin` when present, otherwise the `sessionid` prefix). Writing an existing account replaces
 * that entry; a new one is appended.
 *
 * THE OLD FILE IS STILL READ
 *
 * A user updating from an earlier build has one flat `doubao-session.json`. It is migrated on
 * first read and then left in place — deleting it would lose the session if the new file failed
 * to write, and the migration is cheap enough to repeat.
 *
 * @module dsh-xdpool/doubao-store
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DoubaoSession } from './doubao-auth.ts'
import { pluginDataDir } from './ignored.ts'

/** The single-session file an earlier version wrote. */
export const DOUBAO_SESSION_FILE = 'doubao-session.json'

/** The multi-account file. */
export const DOUBAO_SESSIONS_FILE = 'doubao-sessions.json'

/** Where the multi-account list lives. */
export function doubaoSessionsPath(): string {
  return join(pluginDataDir(), DOUBAO_SESSIONS_FILE)
}

/** The old single-session path, still read for migration. */
export function doubaoSessionPath(): string {
  return join(pluginDataDir(), DOUBAO_SESSION_FILE)
}

/** One stored account: the session plus the identity the card shows. */
export interface StoredDoubaoAccount {
  /** Derived from the session itself, so the same account never appears twice. */
  id: string
  session: DoubaoSession
  /** The vendor's name for the user, when a read succeeded. */
  nickname?: string
  /** When this entry was last written. */
  savedAt: string
}

/**
 * The stable id for a session.
 *
 * `uin` is the vendor's own account number and survives a re-login; without it the
 * `sessionid` prefix is the only stable thing, and it changes when the session is rotated — which
 * is the case a re-login SHOULD produce a new entry for anyway.
 */
export function accountIdOf(session: DoubaoSession): string {
  const uin = session.cookies['uin']
  if (typeof uin === 'string' && uin !== '') return `uin-${uin}`
  const sessionId = session.cookies['sessionid'] ?? ''
  return `sid-${sessionId.slice(0, 12)}`
}

/** Whether a value looks like a stored session. */
function asSession(value: unknown): DoubaoSession | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Partial<DoubaoSession>
  if (record.cookies === null || typeof record.cookies !== 'object') return undefined
  const cookies: Record<string, string> = {}
  for (const [name, cookie] of Object.entries(record.cookies as Record<string, unknown>)) {
    if (typeof cookie === 'string') cookies[name] = cookie
  }
  if (cookies['sessionid'] === undefined || cookies['sessionid'] === '') return undefined
  return {
    cookies,
    userAgent: typeof record.userAgent === 'string' && record.userAgent !== ''
      ? record.userAgent
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 SamanthaDoubao/2.31.4',
    savedAt: typeof record.savedAt === 'string' ? record.savedAt : new Date(0).toISOString(),
  }
}

/** Read the single-session file an earlier build wrote, if it is still there. */
async function readLegacy(): Promise<DoubaoSession | undefined> {
  try {
    return asSession(JSON.parse(await readFile(doubaoSessionPath(), 'utf8')) as unknown)
  } catch {
    return undefined
  }
}

/**
 * Every stored account.
 *
 * A malformed or missing file answers with an empty list rather than throwing: "no accounts" is
 * a state the caller already handles, and a corrupt file must not stop the plugin loading.
 */
export async function readStoredAccounts(): Promise<readonly StoredDoubaoAccount[]> {
  let rows: unknown
  try {
    rows = JSON.parse(await readFile(doubaoSessionsPath(), 'utf8')) as unknown
  } catch {
    rows = undefined
  }
  const accounts: StoredDoubaoAccount[] = []
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (row === null || typeof row !== 'object') continue
      const record = row as Partial<StoredDoubaoAccount>
      const session = asSession(record.session)
      if (session === undefined) continue
      accounts.push({
        id: typeof record.id === 'string' && record.id !== '' ? record.id : accountIdOf(session),
        session,
        ...(typeof record.nickname === 'string' && record.nickname !== ''
          ? { nickname: record.nickname }
          : {}),
        savedAt: typeof record.savedAt === 'string' ? record.savedAt : session.savedAt,
      })
    }
  }
  /**
   * Fold in the old single session when this is the first run after the update.
   *
   * Merged rather than replaced: a user who already had an account in the new file and an older
   * one in the legacy file should end up with both.
   */
  const legacy = await readLegacy()
  if (legacy !== undefined) {
    const id = accountIdOf(legacy)
    if (!accounts.some(account => account.id === id)) {
      accounts.push({ id, session: legacy, savedAt: legacy.savedAt })
    }
  }
  return accounts
}

/** Write the whole list atomically, readable only by its owner. */
async function writeAccounts(accounts: readonly StoredDoubaoAccount[]): Promise<void> {
  const target = doubaoSessionsPath()
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(accounts, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, target)
}

/**
 * Add or replace one account.
 *
 * Replacing is keyed by identity, so signing into the SAME account again refreshes its cookies
 * instead of appending a duplicate — which is what a user does when a session expires.
 */
export async function writeStoredAccount(
  session: DoubaoSession,
  nickname?: string,
): Promise<StoredDoubaoAccount> {
  const id = accountIdOf(session)
  const existing = await readStoredAccounts()
  const entry: StoredDoubaoAccount = {
    id,
    session,
    ...(nickname === undefined || nickname === '' ? {} : { nickname }),
    savedAt: new Date().toISOString(),
  }
  const next = existing.filter(account => account.id !== id)
  next.push(entry)
  await writeAccounts(next)
  return entry
}

/** Forget one account by id. */
export async function removeStoredAccount(id: string): Promise<void> {
  const existing = await readStoredAccounts()
  await writeAccounts(existing.filter(account => account.id !== id))
  // A legacy single session that names the same account must go too, or the next read would
  // fold it straight back in.
  const legacy = await readLegacy()
  if (legacy !== undefined && accountIdOf(legacy) === id) {
    try {
      await unlink(doubaoSessionPath())
    } catch {
      // Nothing to remove is the state the caller wanted.
    }
  }
}

/** Forget everything. */
export async function removeAllStoredAccounts(): Promise<void> {
  await writeAccounts([])
  for (const path of [doubaoSessionPath()]) {
    try {
      await unlink(path)
    } catch {
      // Already gone.
    }
  }
}

/**
 * The account a request should use.
 *
 * The first stored account is the default. A multi-account picker is a separate feature; what
 * matters for the reported defect is that adding a second account no longer destroys the first.
 */
export async function readStoredSession(): Promise<DoubaoSession | undefined> {
  const accounts = await readStoredAccounts()
  return accounts[0]?.session
}

/** Write one session, keeping the others. Kept for callers that predate the list. */
export async function writeStoredSession(session: DoubaoSession): Promise<void> {
  await writeStoredAccount(session)
}

/** Forget the default session. */
export async function removeStoredSession(): Promise<void> {
  const accounts = await readStoredAccounts()
  const first = accounts[0]
  if (first === undefined) {
    await removeAllStoredAccounts()
    return
  }
  await removeStoredAccount(first.id)
}
