import { describe, expect, it } from 'vitest'
import { accountIdOf, freeSlotOf, parseAccountsDocument, type DoubaoAccountEntry } from '../src/doubao-store.ts'
import { createDoubaoRoster, entriesOf } from '../src/doubao-roster.ts'
import { browserProfileDir, debugPortOf, sessionUsable } from '../src/doubao-auth.ts'
import type { DoubaoSession } from '../src/doubao-auth.ts'

/**
 * Two Doubao accounts at once (#171).
 *
 * THE BUG
 *
 * The lane held ONE browser profile, ONE `sessionid` and ONE `doubao-session.json`. Signing a
 * second account into the same Chromium profile overwrites the first account's cookies inside
 * the browser, and the harvest that followed stored the second jar over the first — so the pool
 * could only ever serve the account that signed in last, and the first one looked "kicked out".
 *
 * WHAT THESE TESTS PIN
 *
 *   1. the store keeps a LIST, and a 2.7.5 single-session file still reads as one account;
 *   2. every account owns its own browser slot, so a re-sign-in lands on its own profile;
 *   3. adopting the same person twice refines one row instead of adding a second;
 *   4. the roster steps over a fatigued account instead of retrying into it;
 *   5. removing one account leaves the others alone.
 */

/** A session whose stable identity is `uid`. */
function sessionOf(uid: string, sid = `${uid}-sid`): DoubaoSession {
  return {
    cookies: { sessionid: sid, sessionid_ss: sid, sid_tt: sid, uid_tt: uid },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SamanthaDoubao/2.31.4',
    savedAt: '2026-11-16T00:00:00.000Z',
  }
}

/** A stored entry, as the file holds it. */
function entryOf(uid: string, slot: number, savedAtMs = 1): DoubaoAccountEntry {
  return { id: `doubao:${uid}`, slot, session: sessionOf(uid), savedAtMs }
}

describe('the Doubao account store', () => {
  it('keys an account on the cookie that survives a rotation', () => {
    // `sessionid` and `sid_tt` rotate on every sign-in; `uid_tt` is the person. Keying on the
    // rotating one files one human as several accounts, which is how a second sign-in turns
    // into a duplicate row instead of a replacement.
    expect(accountIdOf(sessionOf('u1'), 0)).toBe('doubao:u1')
    const rotated: DoubaoSession = { ...sessionOf('u1'), cookies: { ...sessionOf('u1').cookies, sessionid: 'new' } }
    expect(accountIdOf(rotated, 0)).toBe(accountIdOf(sessionOf('u1'), 0))
  })

  it('falls back to the slot when a jar carries no uid', () => {
    const bare: DoubaoSession = { cookies: { sessionid: 'x' }, userAgent: 'ua', savedAt: 'now' }
    expect(accountIdOf(bare, 3)).toBe('doubao:slot-3')
    expect(sessionUsable(bare)).toBe(true)
  })

  it('never hands a new sign-in a slot an account already owns', () => {
    // Two accounts in one profile cannot both stay signed in: signing the second overwrites
    // the first's cookies INSIDE the browser. The slot is what keeps them apart.
    expect(freeSlotOf([entryOf('a', 0)])).toBe(1)
    expect(freeSlotOf([entryOf('a', 0), entryOf('b', 1)])).toBe(2)
    expect(freeSlotOf([])).toBe(0)
  })

  it('gives slot 0 the profile and port an install already uses', () => {
    // An upgrade must not present as "signed out" to everyone: the existing account's jar
    // lives in slot 0's directory, and its window listens on the port it always did.
    expect(browserProfileDir(0)).toBe(browserProfileDir())
    expect(debugPortOf(0)).toBe(9333)
    expect(browserProfileDir(1)).not.toBe(browserProfileDir(0))
    expect(debugPortOf(1)).toBe(9334)
  })

  it('reads a 2.7.5 single-session file as one account', () => {
    // The account a user already had must survive the upgrade. That file has `cookies` at the
    // TOP level and no `accounts` array, so a reader that only knew the new shape would report
    // "signed out" to every existing install.
    const legacy = {
      cookies: { sessionid: 's1', sid_tt: 't1', uid_tt: 'u1' },
      userAgent: 'ua SamanthaDoubao/2.31.4',
      savedAt: '2026-11-16T10:02:44.589Z',
    }
    const entries = parseAccountsDocument(legacy)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.id).toBe('doubao:u1')
    expect(entries[0]?.slot).toBe(0)
    expect(entries[0]?.session.cookies['sessionid']).toBe('s1')
  })

  it('reads this build\'s list and keeps the newest write of a duplicate', () => {
    const document = {
      version: 2,
      accounts: [
        { id: 'doubao:u1', slot: 0, savedAtMs: 100, session: sessionOf('u1', 'old') },
        { id: 'doubao:u2', slot: 1, savedAtMs: 200, session: sessionOf('u2') },
        { id: 'doubao:u1', slot: 0, savedAtMs: 300, session: sessionOf('u1', 'new'), name: '苏明歌' },
      ],
    }
    const entries = parseAccountsDocument(document)
    expect(entries.map(entry => entry.id)).toEqual(['doubao:u2', 'doubao:u1'])
    expect(entries[1]?.session.cookies['sessionid']).toBe('new')
    expect(entries[1]?.name).toBe('苏明歌')
  })

  it('treats a corrupt or empty document as "no accounts"', () => {
    expect(parseAccountsDocument({})).toEqual([])
    expect(parseAccountsDocument({ accounts: 'nope' })).toEqual([])
    expect(parseAccountsDocument({ accounts: [{ id: 'x' }, 42, null] })).toEqual([])
  })

  it('keeps a sibling entry when one is malformed', () => {
    // One bad row must not cost the others: a half-written entry is a file-level accident, not
    // a reason to sign everybody out.
    const document = {
      accounts: [
        { id: 'broken', session: { cookies: { uid_tt: 'no-sessionid' } } },
        { id: 'doubao:u1', slot: 0, session: sessionOf('u1') },
      ],
    }
    expect(parseAccountsDocument(document).map(entry => entry.id)).toEqual(['doubao:u1'])
  })
})

describe('the Doubao roster', () => {
  it('holds two accounts at once', () => {
    const roster = createDoubaoRoster()
    roster.replace([entryOf('a', 0), entryOf('b', 1)])
    expect(roster.list().map(account => account.id)).toEqual(['doubao:a', 'doubao:b'])
    expect(roster.usable()).toHaveLength(2)
  })

  it('refines one row when the same person signs in again', () => {
    // The whole "kicked out" symptom: a re-sign-in must UPDATE an account, never add a
    // duplicate and never touch the other one.
    const roster = createDoubaoRoster()
    roster.replace([entryOf('a', 0)])
    roster.adopt({ session: sessionOf('a', 'a-sid-2'), slot: 0, name: '苏明歌' })
    expect(roster.list()).toHaveLength(1)
    expect(roster.list()[0]?.name).toBe('苏明歌')
    expect(roster.list()[0]?.session.cookies['sessionid']).toBe('a-sid-2')
  })

  it('keeps a name through a re-sign-in that could not read one', () => {
    const roster = createDoubaoRoster()
    roster.replace([{ ...entryOf('a', 0), name: '苏明歌' }])
    roster.adopt({ session: sessionOf('a', 'a-sid-2'), slot: 0 })
    expect(roster.list()[0]?.name).toBe('苏明歌')
  })

  it('adds a different person as a new row, on a new slot', () => {
    const roster = createDoubaoRoster()
    roster.replace([entryOf('a', 0)])
    roster.adopt({ session: sessionOf('b'), slot: roster.freeSlot() })
    expect(roster.list().map(account => account.id)).toEqual(['doubao:a', 'doubao:b'])
    expect(roster.freeSlot()).toBe(2)
  })

  it('removes one account without touching the others', () => {
    // Deleting the second row used to sign the first one out, because there was one slot for
    // one session and `clear()` emptied it.
    const roster = createDoubaoRoster()
    roster.replace([entryOf('a', 0), entryOf('b', 1)])
    expect(roster.remove('doubao:b')).toBe(true)
    expect(roster.list().map(account => account.id)).toEqual(['doubao:a'])
    expect(roster.remove('doubao:b')).toBe(false)
  })

  it('steps over a fatigued account instead of retrying into it', () => {
    const roster = createDoubaoRoster()
    roster.replace([entryOf('a', 0), entryOf('b', 1)])
    const first = roster.next()
    expect(first?.id).toBe('doubao:a')
    // A spent 5-hour window is a fact about THAT account, and the point of a second one is
    // that its quota is still there.
    roster.penalise('doubao:a', 'quota_exhausted', '额度已用尽')
    expect(roster.next()?.id).toBe('doubao:b')
    expect(roster.healthOf('doubao:a').coolingDown).toBe(true)
  })

  it('does not blame the account for a network failure', () => {
    // Stepping aside on a transport error would spend the second account's quota to fail the
    // same way, and would tell the user the wrong account was at fault.
    const roster = createDoubaoRoster()
    roster.replace([entryOf('a', 0), entryOf('b', 1)])
    roster.penalise('doubao:a', 'network', '连接失败')
    expect(roster.healthOf('doubao:a').coolingDown).toBe(false)
    expect(roster.next()?.id).toBe('doubao:a')
  })

  it('treats a rejected cookie as needing a new sign-in, not a wait', () => {
    const roster = createDoubaoRoster()
    roster.replace([entryOf('a', 0), entryOf('b', 1)])
    roster.penalise('doubao:a', 'session_dead')
    expect(roster.healthOf('doubao:a').coolingDown).toBe(true)
    expect(roster.healthOf('doubao:a').kind).toBe('session_dead')
    // Still answers with SOMETHING rather than reporting an empty pool: a cooldown is a guess
    // and the request may succeed.
    roster.penalise('doubao:b', 'session_dead')
    expect(roster.next()).toBeDefined()
  })

  it('skips a disabled account and clears its health on a fresh sign-in', () => {
    const roster = createDoubaoRoster()
    roster.replace([entryOf('a', 0), entryOf('b', 1)])
    roster.penalise('doubao:a', 'session_dead')
    roster.setDisabled('doubao:a', false)
    roster.adopt({ session: sessionOf('a'), slot: 0 })
    expect(roster.healthOf('doubao:a').coolingDown).toBe(false)
    expect(roster.usable()).toHaveLength(2)
  })

  it('round-trips through the persisted entry shape', () => {
    const roster = createDoubaoRoster()
    roster.replace([entryOf('a', 0), entryOf('b', 1)])
    roster.setName('doubao:a', '苏明歌')
    roster.setDisabled('doubao:b', true)
    const entries = entriesOf(roster.list())
    expect(entries.map(entry => entry.id)).toEqual(['doubao:a', 'doubao:b'])
    expect(entries[0]?.name).toBe('苏明歌')
    expect(entries[1]?.disabled).toBe(true)
    // Slots travel with the entries, or a restart would hand the same profile to a new account
    // and overwrite the one living in it.
    expect(entries.map(entry => entry.slot)).toEqual([0, 1])
  })
})
