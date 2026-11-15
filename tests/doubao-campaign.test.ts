import { describe, expect, it } from 'vitest'
import { tasksFrom } from '../src/doubao-campaign.ts'

/**
 * Reading Doubao's campaign document.
 *
 * Every shape here was read off a live account. The fields are not the obvious ones: a task
 * is identified by a `campaign_code` SLUG (not a `task_id`), and its state is a NUMBER
 * (`task_status`) where 0 is "not started" and 1 or 3 are "done". Assuming the intuitive names
 * produced zero rows against an account that had eleven.
 */
describe('the campaign document', () => {
  /** One task row, in the shape the endpoint actually returns. */
  const task = (code: string, status: number, title: string) => ({
    campaign_code: code,
    task_status: status,
    title,
    task_kind: code,
  })

  it('reads a task by its campaign code', () => {
    const tasks = tasksFrom({ data: { tasks: [task('daily_signin', 1, '每日签到')] } })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.itemCode).toBe('daily_signin')
    expect(tasks[0]?.title).toBe('每日签到')
  })

  it('offers a completed task as claimable', () => {
    const tasks = tasksFrom({ data: { tasks: [task('daily_signin', 1, '每日签到')] } })
    expect(tasks[0]?.claimable).toBe(true)
  })

  it('does not offer an unstarted task', () => {
    const tasks = tasksFrom({ data: { tasks: [task('c2b_guide', 0, '带团队的人')] } })
    expect(tasks[0]?.claimable).toBe(false)
  })

  it('never offers a task the server already marked collected', () => {
    const tasks = tasksFrom({
      data: { tasks: [{ ...task('daily_signin', 1, '每日签到'), claimed: true }] },
    })
    expect(tasks[0]?.claimable).toBe(false)
    expect(tasks[0]?.claimed).toBe(true)
  })

  /**
   * The nesting is why the walk exists: the tasks sit under `data.tasks`, and a node that is
   * not itself a task must not stop the descent. A `return` there skipped the whole subtree
   * and reported "no tasks" for an account with eleven.
   */
  it('finds tasks through nested wrappers', () => {
    const tasks = tasksFrom({
      data: { progress: { total_amount: 1300 }, tasks: [task('a', 1, 'A'), task('b', 0, 'B')] },
      extra: { deeper: { tasks: [task('c', 3, 'C')] } },
    })
    expect(tasks.map(entry => entry.itemCode).sort()).toEqual(['a', 'b', 'c'])
  })

  it('ignores a wrapper that is not a task', () => {
    expect(tasksFrom({ data: { progress: { total_amount: 1300 } } })).toEqual([])
  })

  it('records the subtitle as progress text', () => {
    const tasks = tasksFrom({
      data: { tasks: [{ ...task('x', 1, 'X'), subtitle: '额外领 1300 点额度' }] },
    })
    expect(tasks[0]?.progress).toBe('额外领 1300 点额度')
  })

  it('does not list the same task twice when the document repeats it', () => {
    const row = task('daily_signin', 1, '每日签到')
    expect(tasksFrom({ data: { tasks: [row] }, mirror: { tasks: [row] } })).toHaveLength(1)
  })

  it('survives a document with no tasks at all', () => {
    expect(tasksFrom({})).toEqual([])
    expect(tasksFrom(null)).toEqual([])
    expect(tasksFrom({ data: { tasks: null } })).toEqual([])
  })
})
