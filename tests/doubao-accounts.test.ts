import { describe, expect, it, beforeEach } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { accountIdOf, readStoredAccounts, removeStoredAccount, writeStoredAccount } from '../src/doubao-store.ts'
import type { DoubaoSession } from '../src/doubao-auth.ts'

/**
 * Several Doubao accounts, each its own cookie jar.
 *
 * The first version kept ONE session in `doubao-session.json`, so signing in a second account
 * overwrote the first — reported as "logging in the second Doubao kicks out the first" (#171).
 * Doubao's own sign-in is per-browser-profile, so every account is a separate jar and the plugin
 * has to keep them all.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/147.0.0.0 SamanthaDoubao/2.31.4'

function session(sessionId: string, uin?: string): DoubaoSession {
  return {
    cookies: { sessionid: sessionId, ...(uin === undefined ? {} : { uin }) },
    userAgent: UA,
    savedAt: new Date().toISOString(),
  }
}

let store: string
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), 'xdpool-doubao-'))
  process.env['DSH_HOME'] = store
  // The store writes into `<DSH_HOME>/.xdpool`; the directory is created on write, but two of
  // these cases plant a file there FIRST to exercise the migration paths.
  mkdirSync(join(store, '.xdpool'), { recursive: true })
})

describe('the account list', () => {
  it('keeps the first account when a second is added', () => {
    // The reported defect, in one assertion.
    return (async (): Promise<void> => {
      await writeStoredAccount(session('aaa', '111'), '第一个')
      await writeStoredAccount(session('bbb', '222'), '第二个')
      const accounts = await readStoredAccounts()
      expect(accounts).toHaveLength(2)
      expect(accounts.map(a => a.nickname)).toEqual(['第一个', '第二个'])
    })()
  })

  it('replaces the same account instead of duplicating it', () => {
    // Re-signing into the SAME account is what a user does when a session expires; it must
    // refresh the entry, not append a second copy of it.
    return (async (): Promise<void> => {
      await writeStoredAccount(session('aaa', '111'), '第一个')
      await writeStoredAccount(session('aaa-new', '111'), '第一个')
      const accounts = await readStoredAccounts()
      expect(accounts).toHaveLength(1)
      expect(accounts[0]?.session.cookies['sessionid']).toBe('aaa-new')
    })()
  })

  it('derives an id from uin when the vendor provides one', () => {
    // `uin` is the vendor's own account number and survives a re-login.
    expect(accountIdOf(session('x', '777'))).toBe('uin-777')
    expect(accountIdOf(session('abcdefghijkl'))).toBe('sid-abcdefghijkl')
  })

  it('forgets only the account it was asked about', () => {
    return (async (): Promise<void> => {
      await writeStoredAccount(session('aaa', '111'))
      await writeStoredAccount(session('bbb', '222'))
      await removeStoredAccount('uin-111')
      const accounts = await readStoredAccounts()
      expect(accounts.map(a => a.id)).toEqual(['uin-222'])
    })()
  })

  it('folds an old single-session file in, rather than orphaning it', () => {
    return (async (): Promise<void> => {
      // A user updating from an earlier build has one flat `doubao-session.json`.
      writeFileSync(
        join(store, '.xdpool', 'doubao-session.json'),
        JSON.stringify(session('legacy', '900')),
        'utf8',
      )
      const accounts = await readStoredAccounts()
      expect(accounts.map(a => a.id)).toContain('uin-900')
    })()
  })

  it('reports no accounts rather than throwing on a corrupt file', () => {
    return (async (): Promise<void> => {
      writeFileSync(join(store, '.xdpool', 'doubao-sessions.json'), '{not json', 'utf8')
      await expect(readStoredAccounts()).resolves.toEqual([])
    })()
  })

  it('skips an entry with no sessionid', () => {
    return (async (): Promise<void> => {
      writeFileSync(
        join(store, '.xdpool', 'doubao-sessions.json'),
        JSON.stringify([{ id: 'broken', session: { cookies: {} }, savedAt: '' }]),
        'utf8',
      )
      // A session with no `sessionid` is not a session; keeping the row would make the caller
      // believe an account exists and then fail every request against it.
      await expect(readStoredAccounts()).resolves.toEqual([])
    })()
  })
})
