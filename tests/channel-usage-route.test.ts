/**
 * 「账号使用方式」这条路由 —— 3.0.0 漏注册的那一条。
 *
 * 用户点下去看到的是：
 *
 *   账号使用方式没保存上：HTTP 405
 *
 * 405 而不是 500，因为请求根本没进插件：客户端 `setChannelMode` 往
 * `/plugins/dsh-xdpool/channels/usage` 发 POST，而服务端只写了进程内方法
 * `api.channelUsage()`，从来没把这条路径挂到 HTTP 上，请求落到宿主的兜底处理。
 *
 * 这条测试直接驱动 handler（不启端口、不发网络），断言四件事：
 * 读得出来、写得进去、脏值拒绝、清除可用。挂在 `ctx.effect` 上也断言，
 * 因为它决定插件重载时会不会在同一条路径上堆两个 handler。
 */

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerChannelUsageRoute } from '../src/channel-usage-route.ts'

let store: string
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), 'xdpool-usage-route-'))
  process.env['DSH_HOME'] = store
  delete process.env['DSH_XDPOOL_CHANNEL_USAGE']
})

interface Captured {
  path: string
  handler: (req: unknown, res: unknown) => Promise<void> | void
}

/** A fake cordis context that captures the registered route. */
function fakeCtx(): { ctx: never; captured: Captured; effects: number } {
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
  options: { body?: unknown; origin?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = options.body === undefined ? '' : JSON.stringify(options.body)
  const req = {
    method,
    headers: {
      ...options.origin === undefined ? {} : { origin: options.origin },
      host: '127.0.0.1:3080',
    },
    async *[Symbol.asyncIterator]() {
      if (payload !== '') yield Buffer.from(payload, 'utf8')
    },
  }
  let status = 0
  let text = ''
  const res = {
    writeHead(code: number) { status = code; return this },
    end(chunk?: string) { if (typeof chunk === 'string') text = chunk },
  }
  await captured.handler(req, res)
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    body = {}
  }
  return { status, body }
}

describe('路由注册', () => {
  it('挂在 context effect 上（重载时替换而不是叠加）', () => {
    const handle = fakeCtx()
    registerChannelUsageRoute(handle.ctx, { pool: () => 'priority' })
    expect(handle.effects).toBe(1)
    expect(handle.captured.path).toBe('/plugins/dsh-xdpool/channels/usage')
  })
})

describe('读', () => {
  it('GET 给出池默认 + 各渠道覆盖', async () => {
    const handle = fakeCtx()
    registerChannelUsageRoute(handle.ctx, { pool: () => 'balanced' })
    const answer = await call(handle.captured, 'GET')
    expect(answer.status).toBe(200)
    expect(answer.body['pool']).toBe('balanced')
    expect(answer.body['channels']).toEqual({})
  })
})

describe('写', () => {
  it('POST 存下一个渠道，并把新状态回给卡片', async () => {
    const handle = fakeCtx()
    registerChannelUsageRoute(handle.ctx, { pool: () => 'priority' })
    const answer = await call(handle.captured, 'POST', { body: { channel: 'codearts', strategy: 'sticky' } })
    expect(answer.status).toBe(200)
    expect(answer.body['channels']).toEqual({ codearts: 'sticky' })
    // 落盘了：不是只改了内存。
    const stored = JSON.parse(readFileSync(join(store, '.xdpool', 'channel-usage.json'), 'utf8')) as Record<string, string>
    expect(stored).toEqual({ codearts: 'sticky' })
  })

  it('空 strategy 是「清除」，渠道回到跟随池默认', async () => {
    const handle = fakeCtx()
    registerChannelUsageRoute(handle.ctx, { pool: () => 'priority' })
    await call(handle.captured, 'POST', { body: { channel: 'codearts', strategy: 'sticky' } })
    const cleared = await call(handle.captured, 'POST', { body: { channel: 'codearts', strategy: '' } })
    expect(cleared.status).toBe(200)
    expect(cleared.body['channels']).toEqual({})
  })

  it('不认识的策略拒绝，且什么都没写', async () => {
    // 存进去也只会在请求时被忽略 —— 那正好表现为「点了没反应」，也就是这条路由要修的现象。
    const handle = fakeCtx()
    registerChannelUsageRoute(handle.ctx, { pool: () => 'priority' })
    const answer = await call(handle.captured, 'POST', { body: { channel: 'codearts', strategy: 'fastest' } })
    expect(answer.status).toBe(400)
    expect(answer.body['channels']).toBeUndefined()
    expect(() => readFileSync(join(store, '.xdpool', 'channel-usage.json'), 'utf8')).toThrow()
  })

  it('缺 channel 拒绝', async () => {
    const handle = fakeCtx()
    registerChannelUsageRoute(handle.ctx, { pool: () => 'priority' })
    const answer = await call(handle.captured, 'POST', { body: { strategy: 'balanced' } })
    expect(answer.status).toBe(400)
  })
})

describe('方法与来源', () => {
  it('PUT 之类返回 405，不再是「点了没反应」', async () => {
    const handle = fakeCtx()
    registerChannelUsageRoute(handle.ctx, { pool: () => 'priority' })
    expect((await call(handle.captured, 'PUT')).status).toBe(405)
  })

  it('跨站来源拒绝', async () => {
    const handle = fakeCtx()
    registerChannelUsageRoute(handle.ctx, { pool: () => 'priority' })
    const answer = await call(handle.captured, 'POST', {
      body: { channel: 'codearts', strategy: 'sticky' },
      origin: 'https://evil.example',
    })
    expect(answer.status).toBe(403)
  })

  it('本机来源放行（浏览器同源请求不带 Origin 也算）', async () => {
    const handle = fakeCtx()
    registerChannelUsageRoute(handle.ctx, { pool: () => 'priority' })
    const answer = await call(handle.captured, 'POST', {
      body: { channel: 'codearts', strategy: 'sticky' },
      origin: 'http://127.0.0.1:3080',
    })
    expect(answer.status).toBe(200)
  })
})
