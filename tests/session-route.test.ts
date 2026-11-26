/**
 * 会话归属那一本账：它记什么、不记什么、记满之后怎么办。
 *
 * 这一份只钉纯逻辑（表本身与头解析）。「真的接上了没有」由
 * `session-route-wiring.test.ts` 端到端钉住 —— 两半分开测是刻意的：一个只测表
 * 的用例在接线断掉时照样全绿，那正是 3.0.0 漏注册那条路由时的样子。
 */

import { describe, expect, it } from 'vitest'
import {
  normalizeSessionId,
  SESSION_HEADER_NAMES,
  SESSION_ROUTE_LIMIT,
  SessionRouteBook,
  sessionIdFromHeaders,
  type SessionRoute,
} from '../src/session-route.ts'

const route = (over: Partial<SessionRoute> = {}): SessionRoute => ({
  sessionId: 'session-1',
  channel: 'workbuddy',
  region: 'cn',
  model: 'hy4-preview',
  account: 'Account0',
  at: Date.UTC(2026, 0, 2, 12, 0, 0),
  ...over,
})

describe('normalizeSessionId', () => {
  it('接受一个正常的会话 id', () => {
    expect(normalizeSessionId('2f8c1d40-1c2b-4a1e-9f2c-0d3a4b5c6d7e'))
      .toBe('2f8c1d40-1c2b-4a1e-9f2c-0d3a4b5c6d7e')
  })

  it('两端空白被去掉，因为头值可能被代理加过空白', () => {
    expect(normalizeSessionId('  session-1  ')).toBe('session-1')
  })

  it('非字符串、空白、含空白的都拒绝', () => {
    expect(normalizeSessionId(undefined)).toBeUndefined()
    expect(normalizeSessionId(42)).toBeUndefined()
    expect(normalizeSessionId('')).toBeUndefined()
    expect(normalizeSessionId('   ')).toBeUndefined()
    expect(normalizeSessionId('two words')).toBeUndefined()
    // 中文是可打印的，但会话 id 不会长这样；放进来只会让面板上出现一段不可控的
    // 文本，所以按「像不像 id」而不是「能不能打印」判。
    expect(normalizeSessionId('会话一')).toBeUndefined()
  })

  it('超长值拒绝，因为这是个请求头，不是随便一个字符串', () => {
    expect(normalizeSessionId('a'.repeat(200))).toBe('a'.repeat(200))
    expect(normalizeSessionId('a'.repeat(201))).toBeUndefined()
  })
})

describe('sessionIdFromHeaders', () => {
  it('认 pi-ai 写的三个名字，任意一个出现即可', () => {
    // pi-ai 在 openai 格式下写 x-session-affinity + x-client-request-id，
    // 在 openai 格式且显式要求时还写 session_id。哪一个出现取决于宿主打包的
    // pi-ai 代际，只认一个的实现会在另一条线上静默报「未知」。
    for (const name of SESSION_HEADER_NAMES) {
      expect(sessionIdFromHeaders({ [name]: 'session-1' })).toBe('session-1')
    }
  })

  it('优先 x-session-affinity，因为它是这个插件的契约', () => {
    expect(sessionIdFromHeaders({
      'x-session-affinity': 'wanted',
      'x-client-request-id': 'other',
    })).toBe('wanted')
  })

  it('数组值取第一个（Node 会把重复头收成数组）', () => {
    expect(sessionIdFromHeaders({ 'x-session-affinity': ['first', 'second'] })).toBe('first')
  })

  it('没有头、空头、坏值都返回 undefined', () => {
    expect(sessionIdFromHeaders(undefined)).toBeUndefined()
    expect(sessionIdFromHeaders({})).toBeUndefined()
    expect(sessionIdFromHeaders({ 'x-session-affinity': '' })).toBeUndefined()
    expect(sessionIdFromHeaders({ 'x-session-affinity': 'not an id' })).toBeUndefined()
  })

  it('坏值不会遮住同请求里另一个可用的名字', () => {
    // 一条代理链可能把 x-session-affinity 写坏而 x-client-request-id 仍然正确；
    // 遇到坏值就整条放弃，等于丢掉一次本来能认出来的调用。
    expect(sessionIdFromHeaders({
      'x-session-affinity': 'has spaces',
      'x-client-request-id': 'session-1',
    })).toBe('session-1')
  })
})

describe('SessionRouteBook', () => {
  it('记进去就能按 id 读出来', () => {
    const book = new SessionRouteBook()
    book.record(route())
    expect(book.of('session-1')).toMatchObject({ channel: 'workbuddy', account: 'Account0' })
  })

  it('同一个会话再记一次是覆盖，不是追加', () => {
    const book = new SessionRouteBook()
    book.record(route({ account: 'Account0' }))
    book.record(route({ account: 'Account1', at: 999 }))
    expect(book.size()).toBe(1)
    expect(book.of('session-1')?.account).toBe('Account1')
    expect(book.of('session-1')?.at).toBe(999)
  })

  it('未知会话读出来是 undefined 而不是空记录', () => {
    const book = new SessionRouteBook()
    expect(book.of('never-seen')).toBeUndefined()
    expect(book.of(undefined)).toBeUndefined()
  })

  it('满员之后淘汰最久没被确认的那一条', () => {
    const book = new SessionRouteBook(3)
    book.record(route({ sessionId: 'a' }))
    book.record(route({ sessionId: 'b' }))
    book.record(route({ sessionId: 'c' }))
    // 重新确认 a，让它变成最新的：一个刚说过话的会话最可能是下一个被读的。
    book.record(route({ sessionId: 'a' }))
    book.record(route({ sessionId: 'd' }))
    expect(book.size()).toBe(3)
    expect(book.of('b')).toBeUndefined()
    expect(book.of('a')).toBeDefined()
    expect(book.of('d')).toBeDefined()
  })

  it('默认上限就是导出的那个常量', () => {
    const book = new SessionRouteBook()
    for (let i = 0; i <= SESSION_ROUTE_LIMIT; i += 1) book.record(route({ sessionId: `s-${i}` }))
    expect(book.size()).toBe(SESSION_ROUTE_LIMIT)
    // 最早的那条已经被挤掉，最后一条还在。
    expect(book.of('s-0')).toBeUndefined()
    expect(book.of(`s-${SESSION_ROUTE_LIMIT}`)).toBeDefined()
  })

  it('id 不合格的记录直接被丢弃，不进表也不占位', () => {
    const book = new SessionRouteBook()
    book.record(route({ sessionId: '   ' }))
    book.record(route({ sessionId: 'has spaces' }))
    expect(book.size()).toBe(0)
  })

  it('存进去的是副本：调用方之后改自己的对象不会改到表里', () => {
    const book = new SessionRouteBook()
    const mine = route()
    book.record(mine)
    mine.account = 'mutated'
    expect(book.of('session-1')?.account).toBe('Account0')
  })

  it('list 给出全部记录，clear 清空', () => {
    const book = new SessionRouteBook()
    book.record(route({ sessionId: 'a' }))
    book.record(route({ sessionId: 'b' }))
    expect(book.list().map(r => r.sessionId)).toEqual(['a', 'b'])
    book.clear()
    expect(book.size()).toBe(0)
    expect(book.list()).toEqual([])
  })
})
