/**
 * The "体验XX专家" task family (#98).
 *
 * These tasks accept, claim and pay like any other, but their progress stayed
 * stuck at 0/1 for days on a five-account pool. The cause was structural, not
 * flaky: the task codes were not in `EVENT_CHAIN_BUILDERS`, so `sendEventChains`
 * skipped them, so no event was ever sent, so there was nothing for the scorer to
 * count.
 *
 * The interesting part is where the expert id comes from. These experts are NOT
 * in the marketplace listing — the reporter paged through 500 entries across
 * both `agent` and `team` and found none of them — so the id exists only inside
 * the task's own `jump_url`, percent-encoded inside a `deeplink` parameter. The
 * parser below is the whole fix's load-bearing part: get it wrong and the chain
 * summons the wrong expert, or none, and the task keeps paying nothing while
 * looking like it ran.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { expertFromTask, expertIdFromJumpUrl } from '../src/task-events.ts'

const scheduler = readFileSync(new URL('../src/scheduler.ts', import.meta.url), 'utf8')

/** The exact shape the upstream returned, from the issue's own capture. */
const REAL = 'https://www.workbuddy.cn/work/launch/?deeplink=workbuddy%3A%2F%2Fexperts%3FexpertId%3Dex_GDl31WahyIH0&buddy_type=workbuddy'

/** The four ids the issue tabulated, each paired with its own task code. */
const KNOWN = [
  ['expert_use_maidehao', 'ex_GDl31WahyIH0'],
  ['expert_use_douyinyin', 'ex_FbY5nlWTqDod'],
  ['expert_use_shangjia_xuanchuan', 'ex_Weo3x2EZuSDm'],
  ['expert_use_bowangwang', 'ex_WZY136wV5aMt'],
] as const

describe('the expert id is read out of the task deeplink', () => {
  it('reads the id from the real capture', () => {
    expect(expertIdFromJumpUrl(REAL)).toBe('ex_GDl31WahyIH0')
  })

  it('reads it for every task in the family', () => {
    for (const [code, id] of KNOWN) {
      // Same URL shape, one substitution — which is how the family actually
      // arrives. A parser that only handled the first one would pass a
      // single-sample test and fail in production.
      const url = REAL.replace('ex_GDl31WahyIH0', id).replace('launch', `launch-${code}`)
      expect(expertIdFromJumpUrl(url), code).toBe(id)
    }
  })

  it('returns undefined when there is no id to read', () => {
    // `WorkBuddy_Valorant` points at the bare scheme with no query. Guessing an
    // id here would send a real summon for an expert nobody asked about.
    expect(expertIdFromJumpUrl('workbuddy://expert')).toBeUndefined()
    expect(expertIdFromJumpUrl('')).toBeUndefined()
    expect(expertIdFromJumpUrl('https://www.workbuddy.cn/work/launch/?buddy_type=workbuddy')).toBeUndefined()
    expect(expertIdFromJumpUrl('not a url at all')).toBeUndefined()
  })

  it('decodes a percent-encoded deeplink rather than matching raw text', () => {
    // The id is INSIDE an encoded parameter. A regex over the raw URL finds
    // `expertId%3D...` and has to know the encoding; decoding first means the
    // parse is the same code a plain URL would need.
    const encoded = 'https://example.test/launch/?deeplink=' + encodeURIComponent('workbuddy://experts?expertId=ex_ABC123&x=1')
    expect(expertIdFromJumpUrl(encoded)).toBe('ex_ABC123')
  })

  it('stops at the next parameter', () => {
    // Without the delimiter check the id would swallow `&scene=chat` and the
    // summon would name a nonexistent expert.
    const url = 'https://example.test/launch/?deeplink=' + encodeURIComponent('workbuddy://experts?expertId=ex_XYZ&scene=chat')
    expect(expertIdFromJumpUrl(url)).toBe('ex_XYZ')
  })

  it('accepts a bare deeplink, which is what a fixture or a log line carries', () => {
    expect(expertIdFromJumpUrl('workbuddy://experts?expertId=ex_Bare1')).toBe('ex_Bare1')
  })
})

describe('the chains are wired for the whole family', () => {
  it('lists every code in the builder map', () => {
    // Membership is the filter: a code absent from the map costs zero upstream
    // calls and silently scores nothing, which is exactly the reported bug.
    for (const [code] of KNOWN) {
      expect(scheduler, `${code} not in EVENT_CHAIN_BUILDERS`).toMatch(new RegExp(`^\\s{2}${code}: true,$`, 'mu'))
    }
    expect(scheduler).toMatch(/^\s{2}WorkBuddy_Valorant: true,$/mu)
  })

  it('routes them to a builder that resolves the id from the task', () => {
    // And NOT to `expertChains`, which browses the marketplace — the source that
    // does not contain these experts.
    for (const [code] of KNOWN) {
      expect(scheduler, `${code} has no case`).toContain(`case '${code}':`)
    }
    expect(scheduler).toContain('case \'WorkBuddy_Valorant\':')
    expect(scheduler).toContain('return this.taskExpertChains(credential, task)')
  })

  it('uses the default craft mode, not lighthouse\'s LOCAL shape', () => {
    // The issue measured this: the LOCAL/zero-cost shape is the lighthouse
    // task's own criterion and does not score here. The builder must therefore
    // omit the mode argument entirely.
    const body = scheduler.slice(scheduler.indexOf('private async taskExpertChains'))
    const call = body.slice(body.indexOf('expertActualUseEvent('), body.indexOf('),', body.indexOf('expertActualUseEvent(')) + 2)
    expect(call).toContain('expertActualUseEvent(expert, chat.conversationId, chat.requestId)')
    expect(call).not.toContain("'LOCAL'")
  })

  it('summons before it chats, and reports rather than throws on a missing id', () => {
    const body = scheduler.slice(scheduler.indexOf('private async taskExpertChains'))
    expect(body.indexOf('expertSummonEvents(expert)')).toBeLessThan(body.indexOf('openConversation('))
    // A task shape this build does not understand is information, not a fault:
    // throwing would mark the account failed for the whole job.
    expect(body).toContain('if (expertId === undefined) {')
    expect(body).toContain('return []')
  })
})

describe('a task-named expert is a plausible marketplace record', () => {
  it('carries the id and reuses the task title', () => {
    // Everything except the id is cosmetic — the scorer keys on `expertId` — so
    // the title is reused rather than invented.
    const expert = expertFromTask('ex_ABC', '体验「中国电商运营专家」')
    expect(expert.expertId).toBe('ex_ABC')
    expect(expert.displayName).toBe('体验「中国电商运营专家」')
    // An empty version is what every consumer defaults to 1.0.0; writing a
    // made-up one would be a fabricated fact in the payload.
    expect(expert.version).toBe('')
    expect(expert.expertType).toBe('agent')
  })
})
