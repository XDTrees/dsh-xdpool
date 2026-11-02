/**
 * Which jobs a `global` (`workbuddy.ai`) account runs.
 *
 * The rule this replaces was one line — "the growth system is CN-only, skip
 * global accounts for every job" — and it was wrong on both halves. Measured
 * against the live .ai gateway with a real global token:
 *
 * - `/activity/growth/heatmap`             200, `today.is_active:false`
 * - `/activity/growth/streak`              200, tiers pay 0 / 50 / 150 credits
 * - `/v2/activity/growth/tasks`            200, but a LEVEL-UP board: every entry
 *                                          has `code`/`status`, none has
 *                                          `task_code` or a reward field
 * - `POST /v2/report` (one chat event)     200, and heatmap flips to
 *                                          `is_active:true`, score 0 → 2
 * - `POST /v2/billing/meter/daily-checkin` 400 code 10001
 *                                          「签到活动未开启或已过期」
 * - `/activity/growth/buddy/info`          200, `{buddy:null}` — nothing to walk
 * - `/billing/meter/compensation-status`   200, `active:false`
 *
 * So "CN-only" was false (two jobs work) and "skip everything" was too broad
 * (it threw away the streak credits).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const scheduler = readFileSync(new URL('../src/scheduler.ts', import.meta.url), 'utf8')

/** The body of `eligible`, up to the next top-level declaration. */
const eligibleBody = (() => {
  const start = scheduler.indexOf('function eligible(')
  if (start === -1) return ''
  const end = scheduler.indexOf('\nconst GLOBAL_JOB_KINDS', start)
  return end === -1 ? scheduler.slice(start) : scheduler.slice(start, end)
})()

const globalKinds = (() => {
  const start = scheduler.indexOf('const GLOBAL_JOB_KINDS')
  if (start === -1) return ''
  const end = scheduler.indexOf(')', scheduler.indexOf('new Set<JobKind>(', start))
  return end === -1 ? scheduler.slice(start) : scheduler.slice(start, end + 1)
})()

describe('eligible() is job-aware, not region-blanket', () => {
  it('takes the job as a parameter', () => {
    // A blanket region test cannot express "this account runs report and streak
    // but not tasks", which is the whole finding.
    expect(eligibleBody).toContain('kind: JobKind')
  })

  it('no longer returns false for every global account', () => {
    // The defect, verbatim: an unconditional early return on region.
    expect(eligibleBody).not.toMatch(/regionOf\([^)]*\)\s*===\s*'global'\)\s*return false/)
  })

  it('routes the decision through a job set instead', () => {
    expect(eligibleBody).toContain('GLOBAL_JOB_KINDS.has(kind)')
  })

  it('still excludes cooling accounts for every region', () => {
    // The cooldown gate is not region-specific and must survive the rewrite.
    expect(eligibleBody).toContain('account.cooldownUntilMs > now')
  })
})

describe('the global job set is exactly what the .ai gateway pays for', () => {
  it('includes the activity report, which lights the heatmap', () => {
    // Verified live: one POST /v2/report flipped today.is_active false → true.
    expect(globalKinds).toContain("'report'")
  })

  it('includes streak redemption, which pays the real credits', () => {
    // The .ai tiers pay 0 / 50 / 150 credits; leaving them unredeemed is the
    // concrete loss the old blanket skip caused.
    expect(globalKinds).toContain("'streak'")
  })

  it('excludes checkin, which answers 400 活动未开启 on .ai', () => {
    // Not a no-op: the CN "already checked in" markers do not match this
    // message, so it would count as a failure on every account every day.
    expect(globalKinds).not.toContain("'checkin'")
  })

  it('excludes tasks, whose .ai entries carry no reward fields at all', () => {
    // `parseTask` drops entries without `task_code`; the .ai board uses `code`,
    // so a task pass on a global account is a guaranteed no-op.
    expect(globalKinds).not.toContain("'tasks'")
  })

  it('excludes travel and compensation, which have nothing to collect', () => {
    expect(globalKinds).not.toContain("'travel'")
    expect(globalKinds).not.toContain("'compensation'")
  })
})

describe('the job actually reaches the account list', () => {
  it('passes the job through to accountsInOrder', () => {
    // A job-aware predicate that the caller never tells the job about is dead
    // code: `accountsInOrder()` with no argument would use `undefined` and the
    // set lookup would answer false for every global account — silently
    // restoring the exact behaviour this change removes.
    expect(scheduler).toContain('private accountsInOrder(kind: JobKind)')
    expect(scheduler).toContain('this.accountsInOrder(kind)')
    expect(scheduler).not.toContain('this.accountsInOrder()')
  })
})
