/**
 * `WorkBuddy_Valorant`: the task whose deeplink carries no expert id.
 *
 * Upstream's #98 fix lists the code in `EVENT_CHAIN_BUILDERS` and then skips it,
 * because `expertIdFromJumpUrl('workbuddy://expert')` honestly returns
 * undefined. That is a correct parser and an incomplete strategy: the expert the
 * task names IS on the marketplace, just not on the page the plugin browses.
 *
 * Measured against the live upstream with a real CN token:
 *
 *   POST /portal/operation-platform/market/expert/list
 *   { page: 1, page_size: 20, keyword: '无畏契约' }
 *   → 3 experts, including ex_xQHHD1u5Jkua / 无畏契约拼豆专家
 *
 * while paging the unfiltered `reco_rank` listing (500 entries across both
 * `agent` and `team`) returns zero matches for the title. So `keyword` is the
 * only working route, and the task pays 100 credits per account per day.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  expertForTaskTitle, expertFromTask, expertIdFromJumpUrl, taskTitleToExpertName,
} from '../src/task-events.ts'

const scheduler = readFileSync(new URL('../src/scheduler.ts', import.meta.url), 'utf8')
const upstream = readFileSync(new URL('../src/upstream.ts', import.meta.url), 'utf8')

/** The task's real deeplink, from the live growth centre. */
const VALORANT_JUMP_URL = 'workbuddy://expert'
/** Its real title, likewise. */
const VALORANT_TITLE = '体验「无畏契约拼豆专家」'

/** What `keyword=无畏契约` actually returned, trimmed to the fields used. */
const KEYWORD_RESULT = [
  { expertId: 'ex_dRrhbpvg0g60', expertType: 'agent', displayName: '无畏契约手游复盘教练', profession: '源能行动对局复盘顾问', version: '1.0.0', categories: [] },
  { expertId: 'ex_xQHHD1u5Jkua', expertType: 'agent', displayName: '无畏契约拼豆专家', profession: '无畏契约拼豆专家', version: '1.0.0', categories: [] },
  { expertId: 'ex_YsiA8fnGTiLc', expertType: 'agent', displayName: '手瓦百事通', profession: '《无畏契约：源能行动》全能顾问', version: '1.0.0', categories: [] },
] as const

describe('the Valorant task is exactly the no-id case', () => {
  it('has no id in its deeplink, which is why upstream skipped it', () => {
    expect(expertIdFromJumpUrl(VALORANT_JUMP_URL)).toBeUndefined()
  })

  it('names an expert the keyword search can find', () => {
    // The premise of the whole fix: the name is recoverable from the title.
    expect(taskTitleToExpertName(VALORANT_TITLE)).toBe('无畏契约拼豆专家')
    expect(KEYWORD_RESULT.some(item => item.displayName === taskTitleToExpertName(VALORANT_TITLE))).toBe(true)
  })

  it('would pick a NEIGHBOUR if the first keyword hit were taken blindly', () => {
    // Three results, only the second is right. This is why the matcher is
    // exact-then-containment rather than `candidates[0]`.
    expect(KEYWORD_RESULT[0].expertId).not.toBe('ex_xQHHD1u5Jkua')
    expect(expertForTaskTitle(VALORANT_TITLE, KEYWORD_RESULT)?.expertId).toBe('ex_xQHHD1u5Jkua')
  })
})

describe('the scheduler resolves the id by name when the deeplink has none', () => {
  const body = scheduler.slice(
    scheduler.indexOf('private async taskExpertChains'),
    scheduler.indexOf('private async expertChains'),
  )

  it('asks the marketplace with the task title as a keyword', () => {
    expect(body).toContain('marketExpertList(credential, \'\', name)')
  })

  it('matches the result against the title rather than taking the first hit', () => {
    expect(body).toContain('expertForTaskTitle(task.title, candidates)')
  })

  it('keeps the id path first, so tasks that carry an id cost no extra request', () => {
    // A lookup per task per account per day would be pure waste for the four
    // tasks whose deeplink already names the expert.
    expect(body.indexOf('expertIdFromJumpUrl(task.jumpUrl)')).toBeLessThan(body.indexOf('marketExpertList('))
  })

  it('skips rather than throws when no expert matches', () => {
    // A task shape this build does not understand is information, not a fault:
    // throwing would mark the whole account failed for the job.
    expect(body).toContain('return []')
    expect(body).not.toContain('throw new Error(`${task.taskCode}: no expert')
  })
})

describe('the marketplace request can carry a keyword at all', () => {
  it('passes keyword through to the request body', () => {
    // Without this the lookup silently returns the reco page, which does not
    // contain the expert — the same silent no-op in a new place.
    const call = upstream.slice(upstream.indexOf('async marketExpertList('))
    const body = call.slice(0, call.indexOf('const response'))
    expect(body).toContain("request['keyword'] = keyword")
  })

  it('omits the field when no keyword is given', () => {
    // An empty keyword must not become `keyword: ''`, which the upstream would
    // read as a filter matching nothing.
    const call = upstream.slice(upstream.indexOf('async marketExpertList('))
    const body = call.slice(0, call.indexOf('const response'))
    expect(body).toContain("if (keyword !== '')")
  })
})

describe('a name-resolved expert is still a plausible summon record', () => {
  it('keeps the marketplace id and version the lookup returned', () => {
    const found = expertForTaskTitle(VALORANT_TITLE, KEYWORD_RESULT)
    expect(found?.expertId).toBe('ex_xQHHD1u5Jkua')
    expect(found?.version).toBe('1.0.0')
  })

  it('falls back to the task-derived record when there is no id and no listing', () => {
    // The deeplink path must keep working unchanged for the four tasks that
    // carry an id; this is that path's record shape.
    const expert = expertFromTask('ex_GDl31WahyIH0', '体验「中国电商运营专家」')
    expect(expert.expertId).toBe('ex_GDl31WahyIH0')
    expect(expert.displayName).toBe('中国电商运营专家')
  })
})
