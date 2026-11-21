import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { liveStoreLockCount, withStoreLock } from '../src/store-lock.ts'

/**
 * The read-modify-write lock.
 *
 * Every credential store does load → replace one → write back. Two of those interleaved lose an
 * entry: the second write starts from a list that predates the first. The `.txt` rename most of
 * them already do makes the FILE consistent, which is a different guarantee from making the
 * CYCLE consistent.
 *
 * Measured before the fix: two channels of the same family saved at the same moment left one
 * credential on disk. A lost credential looks exactly like a sign-in that never worked.
 */
beforeEach(() => {
  process.env['DSH_HOME'] = mkdtempSync(join(tmpdir(), 'xdpool-lock-'))
})

describe('ordering', () => {
  it('runs one cycle at a time, in the order asked', () => {
    return (async (): Promise<void> => {
      const order: number[] = []
      // Each work item records when it starts and ends; an interleaved pair would show
      // start(1) start(2) end(1) end(2).
      const work = (id: number): Promise<void> => withStoreLock('test-a', async () => {
        order.push(id)
        await new Promise(resolve => setTimeout(resolve, 5))
        order.push(id)
      })
      await Promise.all([work(1), work(2), work(3)])
      expect(order).toEqual([1, 1, 2, 2, 3, 3])
    })()
  })

  it('does not let a failure block the queue behind it', () => {
    return (async (): Promise<void> => {
      const done: string[] = []
      const failing = withStoreLock('test-b', async () => {
        throw new Error('boom')
      }).catch(() => { done.push('caught') })
      const after = withStoreLock('test-b', async () => { done.push('after') })
      await Promise.all([failing, after])
      // A rejected cycle must not skip the next one: the chain exists to order writes, not to
      // propagate failures.
      expect(done).toEqual(['caught', 'after'])
    })()
  })

  it('keeps different keys independent', () => {
    return (async (): Promise<void> => {
      const order: string[] = []
      // Two stores are two files; they must not wait on each other.
      const slow = withStoreLock('file-1', async () => {
        await new Promise(resolve => setTimeout(resolve, 20))
        order.push('slow')
      })
      const fast = withStoreLock('file-2', async () => { order.push('fast') })
      await Promise.all([slow, fast])
      expect(order).toEqual(['fast', 'slow'])
    })()
  })
})

describe('the value', () => {
  it('passes the work result through', () => {
    return (async (): Promise<void> => {
      await expect(withStoreLock('test-c', async () => 42)).resolves.toBe(42)
    })()
  })

  it('propagates the failure to its own caller', () => {
    // The queue must survive a failure; the caller that caused it must still see it.
    return (async (): Promise<void> => {
      await expect(withStoreLock('test-d', async () => { throw new Error('nope') }))
        .rejects.toThrow('nope')
    })()
  })
})

describe('the map', () => {
  it('drops a chain once it drains', () => {
    return (async (): Promise<void> => {
      /**
       * A chain kept after it settles would hold a resolved promise for the life of the
       * session, once per store the process ever touched.
       */
      await withStoreLock('test-e', async () => undefined)
      // Let the finally block run.
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(liveStoreLockCount()).toBe(0)
    })()
  })
})

describe('two channels at once', () => {
  it('keeps both when their stores are written concurrently', () => {
    return (async (): Promise<void> => {
      /**
       * The measured failure, in one case: the two AutoClaw sites saved at the same moment used
       * to leave one on disk.
       */
      const { readAutoclawCredentials, saveAutoclawCredential } = await import('../src/autoclaw-store.ts')
      await Promise.all([
        saveAutoclawCredential({ site: 'autoclaw', accessToken: 'a' }),
        saveAutoclawCredential({ site: 'autoclaw-cn', accessToken: 'b' }),
      ])
      const after = await readAutoclawCredentials()
      expect(after.map(entry => entry.site).sort()).toEqual(['autoclaw', 'autoclaw-cn'])
    })()
  })

  it('keeps both when the same store gets two accounts at once', () => {
    return (async (): Promise<void> => {
      const { readAstudioAccounts, saveAstudioAccount } = await import('../src/astudio-store.ts')
      await Promise.all([
        saveAstudioAccount({ accountId: 'one', bearer: 'b1', cookie: 'c1' }),
        saveAstudioAccount({ accountId: 'two', bearer: 'b2', cookie: 'c2' }),
      ])
      const after = await readAstudioAccounts()
      expect(after.map(entry => entry.accountId).sort()).toEqual(['one', 'two'])
    })()
  })
})
