/**
 * The growth task board as the card shows it.
 *
 * WHY THIS EXISTS
 *
 * The automation ledger answers "how much did it earn today". It does not answer
 * the question a person actually asks — WHICH rewards are still sitting there —
 * and the two are not close enough to confuse:
 *
 * - A pass that reports `claimed: 0 / credit: 0` looks identical whether the
 *   board is fully collected or every row is stuck. Measured live: after the
 *   expert-task fix, the first pass claimed 5 tasks and a second pass minutes
 *   later legitimately reported 0, because there was nothing left.
 * - A board can be 18/19 claimed while the ledger says nothing at all about the
 *   19th.
 *
 * So the card needs the board itself, per account, with each row's state.
 *
 * THE STATE MAPPING IS THE LOAD-BEARING PART
 *
 * `claimable` is the only state with work left for the automation, and `todo`
 * splits into "the pass will finish this" versus "a human must" — measured:
 * `wb_wechat_oa_subscribe_task` (follow an official WeChat account) is `todo`
 * and NOT in `EVENT_CHAIN_BUILDERS`, so it will sit there forever. Reporting it
 * as "pending" without that distinction is what makes a working automation look
 * broken.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { EVENT_CHAIN_BUILDERS } from '../src/scheduler.ts'

const webStatus = readFileSync(new URL('../src/web-status.ts', import.meta.url), 'utf8')
const poolCard = readFileSync(new URL('../src/client/PoolCard.tsx', import.meta.url), 'utf8')
const statusPaths = readFileSync(new URL('../src/status-paths.ts', import.meta.url), 'utf8')
const locales = readFileSync(new URL('../src/client/locales.ts', import.meta.url), 'utf8')

/** The body of `taskBoardOf`, up to the next top-level declaration. */
const boardFn = (() => {
  const start = webStatus.indexOf('async function taskBoardOf(')
  if (start === -1) return ''
  const end = webStatus.indexOf('\nfunction ', start)
  return end === -1 ? webStatus.slice(start) : webStatus.slice(start, end)
})()

describe('the account row carries per-task state', () => {
  it('declares the task board on the account row', () => {
    expect(statusPaths).toContain('tasks?: PoolWebTaskBoard')
  })

  it('carries an error field, so a failed read is not drawn as an empty board', () => {
    // "Bridge failed" and "you have nothing" must not render identically —
    // that exact collapse was issue #95 on this same card.
    expect(statusPaths).toContain('tasksError?: string')
  })

  it('defines the four states the card acts on', () => {
    for (const state of ["'claimed'", "'claimable'", "'todo'", "'locked'"]) {
      expect(statusPaths).toContain(state)
    }
  })

  it('carries per-row credit and progress, so the card can print 0/1', () => {
    expect(statusPaths).toContain('current: number')
    expect(statusPaths).toContain('target: number')
    expect(statusPaths).toContain('credit: number')
  })
})

describe('the board is classified from the upstream vocabulary', () => {
  it('treats accept_status claimed as collected', () => {
    expect(boardFn).toContain("task.acceptStatus === 'claimed'")
  })

  it('checks locked BEFORE claimable', () => {
    // A locked row must never be offered as collectable: the pass would try,
    // fail, and record a failure against a healthy account.
    const lockedAt = boardFn.indexOf('const isLocked = task.locked')
    const claimableAt = boardFn.indexOf('const isClaimable')
    expect(lockedAt).toBeGreaterThan(-1)
    expect(claimableAt).toBeGreaterThan(lockedAt)
  })

  it('only calls a row claimable when it is neither claimed nor locked', () => {
    expect(boardFn).toContain('!isClaimed && !isLocked && task.claimable')
  })

  it('sums credits separately for collected and outstanding rows', () => {
    // Two totals, not one: "collectable now" is the actionable number and it is
    // not derivable from a single sum.
    expect(boardFn).toContain('claimableCredit += task.credit')
    expect(boardFn).toContain('claimedCredit += task.credit')
  })
})

describe('a todo row says whether the automation can ever finish it', () => {
  it('marks automatability from the scheduler\'s own builder map', () => {
    // Duplicating the list here would let the two drift, and the card would
    // then promise work the pass never does.
    expect(boardFn).toContain('task.taskCode in EVENT_CHAIN_BUILDERS')
  })

  it('exports the builder map so the card reads the real one', () => {
    expect(statusPaths).toBeDefined()
    const schedulerSrc = readFileSync(new URL('../src/scheduler.ts', import.meta.url), 'utf8')
    expect(schedulerSrc).toContain('export const EVENT_CHAIN_BUILDERS')
  })

  it('knows the wechat task is NOT automatable (it needs a human)', () => {
    // Measured: it is accepted and 0/1 on every CN account, and no chain can
    // follow an official account on the user's behalf.
    expect(EVENT_CHAIN_BUILDERS['wb_wechat_oa_subscribe_task']).toBeUndefined()
  })

  it('knows the expert family IS automatable (the fix that unblocked them)', () => {
    for (const code of ['expert_use_maidehao', 'expert_use_douyinyin', 'expert_use_shangjia_xuanchuan', 'expert_use_bowangwang', 'WorkBuddy_Valorant']) {
      expect(EVENT_CHAIN_BUILDERS[code], `${code} missing from the builder map`).toBe(true)
    }
  })
})

describe('the card renders the board', () => {
  it('renders one row per task', () => {
    expect(poolCard).toContain('account.tasks.rows.map(')
  })

  it('renders nothing when the board is absent', () => {
    expect(poolCard).toContain('account.tasks === undefined')
  })

  it('shows the claimed/total tally and the outstanding count', () => {
    expect(poolCard).toContain("t?.('row.taskTally'")
  })

  it('distinguishes auto from manual in words, not only in colour', () => {
    // Colour alone fails a colour-blind reader and a monochrome screenshot, and
    // this is the one fact the numbers above cannot convey.
    expect(poolCard).toContain("t?.('row.taskAuto')")
    expect(poolCard).toContain("t?.('row.taskManual')")
  })

  it('gives every state its own class, so the styling can differ', () => {
    expect(poolCard).toContain('dsm-xdpool-task-${row.state}')
  })
})

describe('both locales carry the new strings', () => {
  it('has the board label, tally, and the two automation words', () => {
    for (const key of ['row.taskBoard', 'row.taskTally', 'row.taskAuto', 'row.taskManual']) {
      const hits = locales.split(key).length - 1
      // One EN + one ZH. A single hit means one language was forgotten.
      expect(hits, `${key} defined ${hits} time(s)`).toBeGreaterThanOrEqual(2)
    }
  })
})
