import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readStoredAccounts, writeStoredAccounts, removeStoredAccounts } from '../src/doubao-store.ts'
import { createDoubaoRoster, entriesOf } from '../src/doubao-roster.ts'
import type { DoubaoAccountEntry } from '../src/doubao-store.ts'
import type { DoubaoSession } from '../src/doubao-auth.ts'

/**
 * The restart race that ate a session file.
 *
 * WHAT HAPPENED
 *
 * `apply()` restored the roster with `void readStoredAccounts().then(...)` 鈥?deliberately not
 * awaited, so the plugin would not block its own start on disk. The card polls the session
 * route within milliseconds of the window opening, and that poll ran against the EMPTY starting
 * roster. It then persisted: `entriesOf([])` is `[]`, and an empty list means "delete the
 * session file" (`removeStoredAccounts`) 鈥?because an empty roster is how a user who signed
 * every account out is stored.
 *
 * The two states are indistinguishable at persist time and have opposite consequences. The fix
 * is ordering: every read and every mutation awaits the restore first, and the persist path
 * refuses to run before it. These tests pin that ordering with the real store on a temp file.
 */
function sessionOf(uid: string): DoubaoSession {
  return {
    cookies: { sessionid: `${uid}-sid`, sessionid_ss: `${uid}-sid`, sid_tt: `${uid}-sid`, uid_tt: uid },
    userAgent: 'ua SamanthaDoubao/2.31.4',
    savedAt: '2026-11-17T00:00:00.000Z',
  }
}

function entryOf(uid: string, slot: number): DoubaoAccountEntry {
  return { id: `doubao:${uid}`, slot, session: sessionOf(uid), savedAtMs: 1 }
}

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-doubao-race-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('restoring the roster before touching the file', () => {
  it('reports what is ON DISK once the restore resolves', async () => {
    const file = join(dir, 'doubao-session.json')
    await writeStoredAccounts([entryOf('a', 0), entryOf('b', 1)], join(dir, 'doubao-session.json'))

    // The restore is asynchronous on purpose, so the roster STARTS empty.
    const roster = createDoubaoRoster()
    expect(roster.list()).toHaveLength(0)

    const restored = await readStoredAccounts(join(dir, 'doubao-session.json'))
    roster.replace(restored)

    expect(roster.list().map(account => account.id)).toEqual(['doubao:a', 'doubao:b'])
    expect(readFileSync(file, 'utf8')).toContain('doubao:a')
  })

  it('a persist that runs BEFORE the restore must not delete the file', async () => {
    // The exact failure: an early poll persists the empty starting roster. Guarding the persist
    // on the restore is what stops `entriesOf([])` from becoming `removeStoredAccounts()`.
    const file = join(dir, 'doubao-session.json')
    await writeStoredAccounts([entryOf('a', 0)], join(dir, 'doubao-session.json'))

    const roster = createDoubaoRoster()
    let restored = false
    const ready = async (): Promise<void> => {
      // Simulate the real ordering: the restore has not landed yet.
      await Promise.resolve()
      roster.replace(await readStoredAccounts(join(dir, 'doubao-session.json')))
      restored = true
    }

    // A persist requested before `ready` resolves is held until it does.
    const persist = (async (): Promise<void> => {
      await ready()
      const entries = entriesOf(roster.list())
      if (entries.length === 0) {
        await removeStoredAccounts(join(dir, 'doubao-session.json'))
        return
      }
      await writeStoredAccounts(entries, join(dir, 'doubao-session.json'))
    })()
    await persist

    expect(restored).toBe(true)
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('doubao:a')
  })

  it('deletes the file only when the user really removed every account', async () => {
    // The other half: an empty roster IS the "signed out" state, so removal must still work.
    const file = join(dir, 'doubao-session.json')
    await writeStoredAccounts([entryOf('a', 0)], join(dir, 'doubao-session.json'))
    expect(existsSync(file)).toBe(true)

    const roster = createDoubaoRoster()
    roster.replace(await readStoredAccounts(join(dir, 'doubao-session.json')))
    roster.replace([])
    const entries = entriesOf(roster.list())
    expect(entries).toHaveLength(0)

    await removeStoredAccounts(join(dir, 'doubao-session.json'))
    expect(existsSync(file)).toBe(false)
  })

  it('keeps a 2.7.5 single-session file intact through a restore', async () => {
    // An upgrade reads the old shape; the first persist writes the new one. Nothing may be lost
    // in between, and the old file must never be treated as "no accounts".
    const file = join(dir, 'doubao-session.json')
    writeFileSync(file, JSON.stringify({
      cookies: { sessionid: 'legacy-sid', sid_tt: 'legacy-t', uid_tt: 'legacy-uid' },
      userAgent: 'ua SamanthaDoubao/2.31.4',
      savedAt: '2026-11-16T10:02:44.589Z',
    }), 'utf8')

    const restored = await readStoredAccounts(join(dir, 'doubao-session.json'))
    expect(restored).toHaveLength(1)
    expect(restored[0]?.id).toBe('doubao:legacy-uid')

    const roster = createDoubaoRoster()
    roster.replace(restored)
    await writeStoredAccounts(entriesOf(roster.list()), join(dir, 'doubao-session.json'))

    const after = JSON.parse(readFileSync(file, 'utf8')) as { version?: number; accounts?: unknown[] }
    expect(after.version).toBe(2)
    expect(after.accounts).toHaveLength(1)
    expect(readFileSync(file, 'utf8')).toContain('legacy-sid')
  })
})

