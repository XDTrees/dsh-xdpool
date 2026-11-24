/**
 * 签到的两个上游细节 —— 请求头与业务码。
 *
 * 用户反馈「积分领取全部失败」，对上游实测的两条线索：
 *
 *  1. **产品身份头**。网页/IDE 的每个 billing 请求都带 `X-Product: SaaS`、
 *     `X-Product-Code: workbuddy` 和一个桌面版 User-Agent，而我们只发了
 *     Authorization / X-Domain / X-User-Id。上游收紧校验后，缺这几个头会得到一个
 *     没有任何细节的失败。
 *  2. **业务码**。上游用 `code` 表达「不是成功也不是故障」的几种结果，我们此前一律
 *     当失败抛出：今天已领（1001/10001）会让每次自动领取都记一条失败；活动未开放
 *     （1002/1003/40901/41000）会一直重试一个永远不会成功的结果。
 *
 * 这里把两件事都钉住：头必须在，码必须按语义分别处理。
 */

import { describe, expect, it } from 'vitest'
import { WorkBuddyUpstreamClient, type WorkBuddyCredential } from '../src/upstream.ts'

/** The minimum a credential needs for these two calls. */
const CREDENTIAL = {
  accessToken: 'token-abc',
  refreshToken: 'refresh',
  expiresAt: Date.now() + 3_600_000,
  refreshExpiresAt: Date.now() + 86_400_000,
  domain: 'www.workbuddy.cn',
  uid: 'uid-1',
} as unknown as WorkBuddyCredential

/** A client whose fetch answers one scripted envelope and records the request. */
function clientReturning(code: number, data: Record<string, unknown> = {}): {
  client: WorkBuddyUpstreamClient
  sent: () => { url: string; headers: Record<string, string> }
} {
  let sent = { url: '', headers: {} as Record<string, string> }
  const client = new WorkBuddyUpstreamClient({
    fetchImpl: (async (url: string, init: RequestInit) => {
      sent = { url, headers: (init.headers ?? {}) as Record<string, string> }
      return new Response(JSON.stringify({ code, msg: 'scripted', data }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as never,
  })
  return { client, sent: () => sent }
}

describe('billing 请求带产品身份头', () => {
  it('签到状态请求带 X-Product / X-Product-Code / User-Agent', async () => {
    const { client, sent } = clientReturning(0, { active: true })
    await client.fetchCheckinStatus(CREDENTIAL)
    const headers = sent().headers
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    expect(lower['x-product']).toBe('SaaS')
    expect(lower['x-product-code']).toBe('workbuddy')
    expect(lower['user-agent']).toMatch(/^WorkBuddy\//u)
    expect(lower['x-user-id']).toBe('uid-1')
    expect(lower['x-domain']).toBe('www.workbuddy.cn')
  })

  it('领取请求用的是 POST 和同一个计费域名', async () => {
    const { client, sent } = clientReturning(0, { credit: 100 })
    await client.claimDailyCheckin(CREDENTIAL)
    expect(sent().url).toContain('/v2/billing/meter/daily-checkin')
  })
})

describe('业务码按语义处理', () => {
  it('今天已领（1001）不是失败：返回 0 分而不是抛错', async () => {
    const { client } = clientReturning(1001, { streak_days: 3 })
    const claim = await client.claimDailyCheckin(CREDENTIAL)
    expect(claim.credit).toBe(0)
    expect(claim.streakDays).toBe(3)
  })

  it('已领的国际版码（10001）同样不抛', async () => {
    const { client } = clientReturning(10001)
    await expect(client.claimDailyCheckin(CREDENTIAL)).resolves.toBeDefined()
  })

  it('活动未开放（41000）不是故障：状态回答 active=false', async () => {
    const { client } = clientReturning(41000)
    const status = await client.fetchCheckinStatus(CREDENTIAL)
    expect(status.active).toBe(false)
  })

  it('任务暂不可领取（40901）也不抛', async () => {
    const { client } = clientReturning(40901)
    await expect(client.fetchCheckinStatus(CREDENTIAL)).resolves.toBeDefined()
  })

  it('风控（11140）仍然算失败，不能被吞掉', async () => {
    const { client } = clientReturning(11140)
    await expect(client.claimDailyCheckin(CREDENTIAL)).rejects.toThrow()
  })

  it('正常领取（0）照旧把分与连登带回来', async () => {
    const { client } = clientReturning(0, { credit: 100, streak_days: 7, is_streak_day: true })
    const claim = await client.claimDailyCheckin(CREDENTIAL)
    expect(claim).toEqual({ credit: 100, streakDays: 7, isStreakDay: true })
  })
})
