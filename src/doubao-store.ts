/**
 * Where the Doubao sessions live between runs.
 *
 * WHY A FILE OF ITS OWN
 *
 * Every other channel's credential is owned by the pack, which writes it wherever the host's
 * credential store keeps things. Doubao's session is this plugin's whole lane — one cookie
 * jar, no refresh token, no key — so it belongs beside the plugin's other state and not in a
 * store that would try to interpret it.
 *
 * WHY THERE IS MORE THAN ONE
 *
 * A Doubao session is a browser jar, and one browser profile holds exactly one signed-in
 * account: signing a second account into the same profile overwrites the first account's
 * `sessionid`, so the lane could only ever serve the account that signed in last (#171).
 * Signing out of the second one then left the first one dead as well, because the jar that
 * had been stored described a session the browser no longer held.
 *
 * So the store is a LIST, one entry per account, and each entry carries the browser slot its
 * jar was harvested from — the slot is what keeps a re-sign-in from landing on top of an
 * account it is not.
 *
 * THE FILE IS STILL ONE DOCUMENT
 *
 * `doubao-session.json` keeps its name and its single-account shape on disk. A file written by
 * 2.7.5 and earlier parses as a list of one, so an existing install keeps working without a
 * migration step, and a downgrade finds a document it understands.
 *
 * The file is written atomically and is readable only by the user: it holds live sessions, and
 * a half-written jar would present as "signed in" while every request failed.
 *
 * @module dsh-xdpool/doubao-store
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DoubaoSession } from './doubao-auth.ts'
import { pluginDataDir } from './ignored.ts'

/** The file the sessions are kept in. */
export const DOUBAO_SESSION_FILE = 'doubao-session.json'

/** The absolute path of the session file. */
export function doubaoSessionPath(): string {
  return join(pluginDataDir(), DOUBAO_SESSION_FILE)
}

/**
 * One stored account.
 *
 * `id` is stable for the life of the account: it is derived from the account's own identity
 * when the vendor reports one, so the same person signing in twice refines one row instead of
 * adding a second.
 */
export interface DoubaoAccountEntry {
  id: string
  session: DoubaoSession
  /** The browser slot the jar came from, so a re-sign-in replaces THIS account. */
  slot: number
  /** The vendor's name for the user, when a read has succeeded. */
  name?: string
  /** Epoch ms this entry was last written. */
  savedAtMs: number
  /** The card's per-account switch. A disabled account keeps its jar and is skipped. */
  disabled?: boolean
}

/** Whether a value has the shape of a session this plugin can use. */
function sessionOf(raw: unknown): DoubaoSession | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const parsed = raw as Partial<DoubaoSession>
  if (typeof parsed.cookies !== 'object' || parsed.cookies === null) return undefined
  const cookies: Record<string, string> = {}
  for (const [name, value] of Object.entries(parsed.cookies)) {
    if (typeof value === 'string') cookies[name] = value
  }
  if (typeof cookies['sessionid'] !== 'string' || cookies['sessionid'] === '') return undefined
  return {
    cookies,
    userAgent: typeof parsed.userAgent === 'string' && parsed.userAgent !== ''
      ? parsed.userAgent
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 SamanthaDoubao/2.31.4',
    savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date(0).toISOString(),
  }
}

/**
 * The account id a session belongs to.
 *
 * `uid_tt` is the stable per-user value in the jar: `sid_tt` and `sessionid` rotate on every
 * sign-in, so keying on either would file one person as several accounts. A jar missing it
 * falls back to the browser slot, which is unique while the entries are being written but may
 * collide with a genuinely different account later — the card's name read is what separates
 * them at that point.
 */
export function accountIdOf(session: DoubaoSession, slot: number): string {
  const uid = session.cookies['uid_tt']
  if (typeof uid === 'string' && uid !== '') return `doubao:${uid}`
  const sid = session.cookies['sid_tt']
  if (typeof sid === 'string' && sid !== '') return `doubao:${sid}`
  return `doubao:slot-${String(slot)}`
}

/** Read one entry out of whatever the file holds. */
function entryOf(raw: unknown, fallbackSlot: number): DoubaoAccountEntry | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  /**
   * A 2.7.5 document has no `session` wrapper: the cookies, the UA and the timestamp are the
   * entry itself. Reading the record as its own session is what makes that generation parse.
   */
  const session = record['session'] === undefined ? sessionOf(record) : sessionOf(record['session'])
  if (session === undefined) return undefined
  const slot = typeof record['slot'] === 'number' && Number.isFinite(record['slot'])
    ? Math.max(0, Math.trunc(record['slot']))
    : fallbackSlot
  const id = typeof record['id'] === 'string' && record['id'] !== ''
    ? record['id']
    : accountIdOf(session, slot)
  const savedAtMs = typeof record['savedAtMs'] === 'number' && Number.isFinite(record['savedAtMs'])
    ? record['savedAtMs']
    : Date.parse(session.savedAt) || 0
  /**
   * A legacy document carries no `enabled` flag, and an absent switch means ON — that is the
   * state every existing install is in, and defaulting to off would silently take a working
   * account out of service on upgrade.
   */
  return {
    id,
    session,
    slot,
    savedAtMs,
    ...(typeof record['name'] === 'string' && record['name'] !== '' ? { name: record['name'] } : {}),
    ...(record['disabled'] === true ? { disabled: true } : {}),
  }
}

/**
 * Read the stored accounts, oldest first.
 *
 * Tolerant on purpose: a malformed file is "not signed in" rather than a crash, and one bad
 * entry does not cost the others. Duplicate ids collapse onto the newest write, because that is
 * the one whose credential the server is most likely to still accept.
 *
 * `path` is injectable so the two document generations can be exercised against synthetic
 * bytes: the real file is a live credential, and a test that can only run against it proves
 * nothing about either shape.
 */
export async function readStoredAccounts(path = doubaoSessionPath()): Promise<DoubaoAccountEntry[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return []
  }
  try {
    return parseAccountsDocument(JSON.parse(text) as unknown)
  } catch {
    return []
  }
}

/**
 * Turn a parsed document into entries.
 *
 * TWO GENERATIONS, ONE READER. `accounts` is this build's list. A document with a top-level
 * `cookies` map is the single-session file 2.7.5 and earlier wrote; it becomes a one-account
 * list, which is what lets an upgrade keep the account the user already had — and what lets a
 * downgrade find a document it understands.
 */
export function parseAccountsDocument(parsed: unknown): DoubaoAccountEntry[] {
  const document = typeof parsed === 'object' && parsed !== null
    ? parsed as Record<string, unknown>
    : {}
  const raw: unknown[] = Array.isArray(document['accounts'])
    ? document['accounts'] as unknown[]
    : sessionOf(document) === undefined ? [] : [document]

  const byId = new Map<string, DoubaoAccountEntry>()
  let nextSlot = 0
  for (const entry of raw) {
    const read = entryOf(entry, nextSlot)
    if (read === undefined) continue
    nextSlot = Math.max(nextSlot, read.slot + 1)
    const kept = byId.get(read.id)
    if (kept === undefined || kept.savedAtMs <= read.savedAtMs) byId.set(read.id, read)
  }
  return [...byId.values()].sort((a, b) => a.savedAtMs - b.savedAtMs)
}

/** The oldest browser slot no account claims — where a new sign-in opens its window. */
export function freeSlotOf(entries: readonly DoubaoAccountEntry[]): number {
  const used = new Set(entries.map(entry => entry.slot))
  let slot = 0
  while (used.has(slot)) slot += 1
  return slot
}

/** Write the whole list atomically, readable only by its owner. */
export async function writeStoredAccounts(entries: readonly DoubaoAccountEntry[]): Promise<void> {
  const target = doubaoSessionPath()
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  const document = {
    version: 2,
    accounts: entries.map(entry => ({
      id: entry.id,
      slot: entry.slot,
      savedAtMs: entry.savedAtMs,
      ...(entry.name === undefined ? {} : { name: entry.name }),
      ...(entry.disabled === true ? { disabled: true } : {}),
      session: entry.session,
    })),
  }
  await writeFile(temporary, JSON.stringify(document, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, target)
}

/** Remove the session file entirely: the state "no Doubao account" is stored as absence. */
export async function removeStoredAccounts(): Promise<void> {
  try {
    await unlink(doubaoSessionPath())
  } catch {
    // Nothing to remove is the state the caller wanted.
  }
}

/**
 * The first stored account, for the callers that still speak of "the" session.
 *
 * Kept as a one-argument view over the list rather than a second concept: the lane holds a
 * roster now, and a helper that answered "the session" while a roster existed would be the
 * first thing to reintroduce the single-account assumption.
 */
export function primaryOf(entries: readonly DoubaoAccountEntry[]): DoubaoAccountEntry | undefined {
  return entries[0]
}
