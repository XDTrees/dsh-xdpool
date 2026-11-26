/**
 * `/plugins/dsh-xdpool/session` 这条路。
 *
 * 钉四件事，每一件都能在用户那边看出来：
 *
 *   - 只挂一次（挂 `ctx.effect` 上，插件重载时替换而不是叠加两个 handler）；
 *   - `?sessionId=` 缺了或不像 id 就 400 —— 500 会读成「插件坏了」，而这个请求
 *     本来就是错的；
 *   - 没见过的会话是 `known:false` 而不是 404：一个刚打开、还没说过话的会话是
 *     正常状态，不是一条错误；
 *   - 不许被缓存。缓存命中的轮询会把上一个会话的归属画到当前聊天旁边，比不显示
 *     更糟。
 *
 * 这条路由回答的是「现在是谁」，所以它只读内存表；落盘那一层不在它的职责里。
 */

import { describe, expect, it } from 'vitest'
import { registerSessionRoute } from '../src/session-route-handler.ts'
import { SessionRouteBook } from '../src/session-route.ts'

interface Captured {
  kind?: string
  path: string
  handler: (req: unknown, res: unknown) => Promise<void> | void
}

/** A fake cordis context that captures the registered route. */
function fakeCtx(): {
  ctx: never
  captured: Captured
  effects: number
} {
  let captured: Captured | undefined
  let effects = 0
  const ctx = {
    effect(fn: () => unknown) { effects += 1; return fn() },
    webServer: {
      register(route: Captured) { captured = route; return () => {} },
    },
  }
  return {
    ctx: ctx as never,
    get captured() { return captured as Captured },
    get effects() { return effects },
  } as unknown as { ctx: never; captured: Captured; effects: number }
}

/** One HTTP exchange against the captured handler. */
async function call(
  captured: Captured,
  method: string,
  options: { query?: string; origin?: string } = {},
): Promise<{ status: number; body: Record<string, unknown>; cacheControl: string }> {
  const req = {
    method,
    url: `/plugins/dsh-xdpool/session${options.query ?? ''}`,
    headers: {
      ...options.origin === undefined ? {} : { origin: options.origin },
      host: '127.0.0.1:3080',
    },
  }
  let status = 0
  let text = ''
  let cacheControl = ''
  const res = {
    writeHead(code: number, headers?: Record<string, string>) {
      status = code
      cacheControl = headers?.['Cache-Control'] ?? ''
      return this
    },
    end(chunk?: string) { if (typeof chunk === 'string') text = chunk },
  }
  await captured.handler(req, res)
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    body = {}
  }
  return { status, body, cacheControl }
}

describe('注册', () => {
  it('挂在 context effect 上，路径是那条会话路由', () => {
    const handle = fakeCtx()
    registerSessionRoute(handle.ctx, { book: () => new SessionRouteBook() })
    expect(handle.effects).toBe(1)
    expect(handle.captured.path).toBe('/plugins/dsh-xdpool/session')
  })

  it('书还没建好（这个部署没有面板）时不是 500', () => {
    // `book()` 返回 undefined 是合法状态：装上插件但没装面板的部署也能被读到，
    // 它只是永远回答「未知」。
    const handle = fakeCtx()
    registerSessionRoute(handle.ctx, { book: () => undefined })
    return expect(call(handle.captured, 'GET', { query: '?sessionId=abc' }))
      .resolves.toMatchObject({ status: 200, body: { known: false } })
  })
})

describe('读', () => {
  it('认得的会话给出渠道、地区、模型、账号、时间', async () => {
    const book = new SessionRouteBook()
    book.record({
      sessionId: 'session-1',
      channel: 'workbuddy',
      region: 'cn',
      model: 'hy4-preview',
      account: 'Account0',
      at: 1_700_000_000_000,
    })
    const handle = fakeCtx()
    registerSessionRoute(handle.ctx, { book: () => book })

    const answer = await call(handle.captured, 'GET', { query: '?sessionId=session-1' })
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({
      sessionId: 'session-1',
      known: true,
      channel: 'workbuddy',
      region: 'cn',
      model: 'hy4-preview',
      account: 'Account0',
      at: 1_700_000_000_000,
    })
  })

  it('没见过的会话是 known:false，而不是 404', async () => {
    const handle = fakeCtx()
    registerSessionRoute(handle.ctx, { book: () => new SessionRouteBook() })
    const answer = await call(handle.captured, 'GET', { query: '?sessionId=brand-new' })
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({ sessionId: 'brand-new', known: false })
  })

  it('回答里回显问的那个 id，晚到的答复不会被贴到别的聊天上', async () => {
    const handle = fakeCtx()
    registerSessionRoute(handle.ctx, { book: () => new SessionRouteBook() })
    const answer = await call(handle.captured, 'GET', { query: '?sessionId=asked-for' })
    expect(answer.body['sessionId']).toBe('asked-for')
  })

  it('不许缓存', async () => {
    const handle = fakeCtx()
    registerSessionRoute(handle.ctx, { book: () => new SessionRouteBook() })
    const answer = await call(handle.captured, 'GET', { query: '?sessionId=session-1' })
    expect(answer.cacheControl).toBe('no-store')
  })
})

describe('拒绝', () => {
  it('缺 sessionId 是 400', async () => {
    const handle = fakeCtx()
    registerSessionRoute(handle.ctx, { book: () => new SessionRouteBook() })
    const answer = await call(handle.captured, 'GET')
    expect(answer.status).toBe(400)
    expect(String(answer.body['error'])).toContain('sessionId')
  })

  it('不像 id 的值也是 400', async () => {
    const handle = fakeCtx()
    registerSessionRoute(handle.ctx, { book: () => new SessionRouteBook() })
    for (const bad of ['%20', 'two%20words', 'x'.repeat(201)]) {
      const answer = await call(handle.captured, 'GET', { query: `?sessionId=${bad}` })
      expect(answer.status).toBe(400)
    }
  })

  it('只有 GET：写方法一律 405', async () => {
    const handle = fakeCtx()
    registerSessionRoute(handle.ctx, { book: () => new SessionRouteBook() })
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const answer = await call(handle.captured, method, { query: '?sessionId=session-1' })
      expect(answer.status).toBe(405)
    }
  })

  it('外站 origin 拒绝', async () => {
    const handle = fakeCtx()
    registerSessionRoute(handle.ctx, { book: () => new SessionRouteBook() })
    const answer = await call(handle.captured, 'GET', {
      query: '?sessionId=session-1',
      origin: 'https://evil.example',
    })
    expect(answer.status).toBe(403)
  })

  it('本机 origin 放行（这是插件自己的页面在轮询）', async () => {
    const handle = fakeCtx()
    registerSessionRoute(handle.ctx, { book: () => new SessionRouteBook() })
    const answer = await call(handle.captured, 'GET', {
      query: '?sessionId=session-1',
      origin: 'http://127.0.0.1:3080',
    })
    expect(answer.status).toBe(200)
  })
})
