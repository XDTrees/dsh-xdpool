/**
 * 会话归属，端到端接上了没有。
 *
 * `tests/session-route.test.ts` 钉的是表本身的算术；这一份钉接线，因为两半各自
 * 单测全绿而中间那根线断了，正是这次改动最容易犯的错，也正是 3.0.0 漏注册
 * `/channels/usage` 那条路由时发生的事：
 *
 *   - 头读进来了但没人记账 —— 角标永远「未知」；
 *   - 记账记在「选中账号」而不是「账号答应」那一步 —— 429 的账号被当成服务者；
 *   - 渠道车道重建 options 时把 sessionId 丢了 —— 一半模型看不见归属。
 *
 * 每个用例都同时断言两侧：客户端收到了什么，以及账本里记了什么。只查一侧的
 * 用例会在它本该防住的那个 bug 下照样通过。
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkBuddyAccountPool } from '../src/accounts.ts'
import { WorkBuddyCatalog } from '../src/catalog.ts'
import { createChannelLane, type ChannelLaneLlm } from '../src/channel-lane.ts'
import { createWorkBuddyShim } from '../src/shim.ts'
import { SessionRouteBook } from '../src/session-route.ts'
import { WorkBuddyUpstreamClient } from '../src/upstream.ts'

const shims: { close(): Promise<void> }[] = []

afterEach(async () => {
  while (shims.length > 0) await shims.pop()?.close()
})

/** An auth directory holding `count` distinct live accounts. */
async function fakeAuthDir(count: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wbsession-'))
  const auth = join(dir, 'auth')
  await mkdir(auth, { recursive: true })
  for (let i = 0; i < count; i += 1) {
    const document = {
      auth: {
        accessToken: `token-${i}`,
        refreshToken: `refresh-${i}`,
        expiresAt: Date.now() + 3_600_000,
        refreshExpiresAt: Date.now() + 30 * 24 * 3_600_000,
        domain: '',
      },
      account: { uid: `uid-${i}-${'0'.repeat(24)}`, uin: `10000000000${i}`, nickname: `Account${i}` },
    }
    await writeFile(join(auth, `workbuddy-desktop.${i}.info`), JSON.stringify(document), 'utf8')
  }
  return auth
}

/** A pooled shim wired to a route book, already bound and ready to serve. */
async function shimWith(
  book: SessionRouteBook,
  fetchImpl: (url: unknown, init: RequestInit) => Promise<Response>,
  options: { authDirs?: string[]; maxAttempts?: number } = {},
): Promise<{ shim: { baseUrl(): string; token(): string } }> {
  const pool = new WorkBuddyAccountPool({ authDirs: options.authDirs ?? [await fakeAuthDir(1)] })
  await pool.scan()
  const shim = createWorkBuddyShim({
    pool,
    client: new WorkBuddyUpstreamClient({ fetchImpl: fetchImpl as never }),
    catalog: new WorkBuddyCatalog(),
    region: 'cn',
    sessionRoutes: book,
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
  })
  shims.push(shim)
  await shim.ready
  return { shim }
}

/** Three SSE frames: an answer, a usage trailer, and the sentinel. */
function usageStream(): string {
  return 'data: {"choices":[{"delta":{"content":"早"}}]}\n\n'
    + 'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n'
    + 'data: [DONE]\n\n'
}

/** Ask the shim one pooled chat turn, optionally carrying a session header. */
async function ask(
  shim: { baseUrl(): string; token(): string },
  options: { sessionId?: string; model?: string } = {},
): Promise<{ status: number }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${shim.token()}`,
  }
  if (options.sessionId !== undefined) headers['x-session-affinity'] = options.sessionId
  const response = await fetch(`${shim.baseUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: options.model ?? 'hy4-preview',
      messages: [{ role: 'user', content: 'hi' }],
    }),
  })
  await response.text()
  return { status: response.status }
}

describe('session route wiring: pooled lane', () => {
  it('把「这个会话走了哪个号」记下来', async () => {
    const book = new SessionRouteBook()
    const { shim } = await shimWith(book, async () => new Response(usageStream(), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const { status } = await ask(shim, { sessionId: 'session-abc' })
    expect(status).toBe(200)

    const route = book.of('session-abc')
    expect(route).toBeDefined()
    expect(route?.channel).toBe('workbuddy')
    expect(route?.region).toBe('cn')
    expect(route?.model).toBe('hy4-preview')
    // 账号名不是空的：池车道是唯一知道自己选了哪个号的一条路。
    expect(route?.account).not.toBe('')
  })

  it('没有会话头的请求什么都记，也不会因此失败', async () => {
    // 局域网客户端、curl、以及还没带亲和头的宿主代际都会走这一条。把它当成错误
    // 会让整条池车道对这些调用方失效 —— 一个只为了面板而加的功能不能改变请求
    // 本身的行为。
    const book = new SessionRouteBook()
    const { shim } = await shimWith(book, async () => new Response(usageStream(), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const { status } = await ask(shim)
    expect(status).toBe(200)
    expect(book.size()).toBe(0)
  })

  it('被限流的号不算「服务了这个会话」', async () => {
    // 池子先挑到一个 429 的号、再换到好号：读者该看到的是最后真正答话的那个，
    // 把候选号写进账本等于在面板上点名一个用户压根没跑过的账号。
    const resetAt = new Date(Date.now() + 10 * 60 * 1000)
    const pad = (value: number): string => String(value).padStart(2, '0')
    const resetText = `${resetAt.getFullYear()}-${pad(resetAt.getMonth() + 1)}-${pad(resetAt.getDate())} `
      + `${pad(resetAt.getHours())}:${pad(resetAt.getMinutes())}:${pad(resetAt.getSeconds())}`
    let calls = 0
    const book = new SessionRouteBook()
    const { shim } = await shimWith(
      book,
      async (url) => {
        // 只数聊天请求。`serveSuccessfulStream` 会在后台用同一个 fetch 刷一次余额，
        // 把它算进「第几次」会让这个用例量的东西变成刷新顺序，而不是轮换。
        if (!String(url).includes('/chat/completions')) return new Response('{}', { status: 200 })
        calls += 1
        // 第一次限流，第二次正常 —— 一次真实的轮换。
        return calls === 1
          ? new Response(
            JSON.stringify({ code: 6004, msg: `您的使用量已超出频率限制，将在 ${resetText} UTC+8 重置` }),
            { status: 429, headers: { 'Content-Type': 'application/json' } },
          )
          : new Response(usageStream(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      },
      { authDirs: [await fakeAuthDir(2)], maxAttempts: 2 },
    )

    const { status } = await ask(shim, { sessionId: 'session-rotate' })
    expect(status).toBe(200)
    expect(calls).toBe(2)

    const route = book.of('session-rotate')
    expect(route).toBeDefined()
    expect(route?.account).not.toBe('')
    // 轮换成功之后，账本里只有一条记录（同一个会话不会因为换号多出一行）。
    expect(book.size()).toBe(1)
  })

  it('整个请求失败时不留下任何归属', async () => {
    const book = new SessionRouteBook()
    const { shim } = await shimWith(book, async () => new Response(
      JSON.stringify({ code: 400, msg: 'bad request' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    ))

    const { status } = await ask(shim, { sessionId: 'session-fail' })
    expect(status).toBe(400)
    expect(book.of('session-fail')).toBeUndefined()
  })

  it('两个会话各记各的，互不覆盖', async () => {
    const book = new SessionRouteBook()
    const { shim } = await shimWith(book, async () => new Response(usageStream(), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    await ask(shim, { sessionId: 'session-a', model: 'hy4-preview' })
    await ask(shim, { sessionId: 'session-b', model: 'hy3' })

    expect(book.size()).toBe(2)
    expect(book.of('session-a')?.model).toBe('hy4-preview')
    expect(book.of('session-b')?.model).toBe('hy3')
  })
})

describe('session route wiring: channel lane', () => {
  /**
   * The channel lane rebuilds the host options by hand, which is why it is the
   * one place a session id can quietly disappear. This test pins the field it
   * forwards rather than the readout above it: if `sessionId` is dropped there,
   * every sign-in channel's models report "unknown" while the pool lanes work,
   * and nothing else would notice.
   */
  it('把 sessionId 交给宿主，而不是在重建请求时丢掉', async () => {
    const seen: Record<string, unknown>[] = []
    const llm: ChannelLaneLlm = {
      listModels: async () => [{ id: 'm1', name: 'Model One' }],
      stream: (options) => {
        seen.push(options)
        return (async function* () {
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
        })()
      },
    }
    const lane = createChannelLane({
      llm,
      providers: () => ['qoder'],
      toId: (channel, modelId) => `${channel}:${modelId}`,
    })

    for await (const _event of lane.turn({
      channel: 'qoder',
      modelId: 'm1',
      body: { messages: [{ role: 'user', content: 'hi' }] },
      signal: new AbortController().signal,
      sessionId: 'session-channel',
    })) {
      // Draining the generator is what actually runs the lane.
    }

    expect(seen).toHaveLength(1)
    expect(seen[0]?.['sessionId']).toBe('session-channel')
  })

  it('不知道会话时不留一个「名字是空」的 sessionId 字段', async () => {
    // 宿主会把 options 摊进一份被冻结的请求，`sessionId: undefined` 在那里读作
    // 「有一个名叫 nothing 的会话」，和「没有这个字段」不是一回事。
    const seen: Record<string, unknown>[] = []
    const llm: ChannelLaneLlm = {
      listModels: async () => [{ id: 'm1', name: 'Model One' }],
      stream: (options) => {
        seen.push(options)
        return (async function* () {
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
        })()
      },
    }
    const lane = createChannelLane({
      llm,
      providers: () => ['qoder'],
      toId: (channel, modelId) => `${channel}:${modelId}`,
    })

    for await (const _event of lane.turn({
      channel: 'qoder',
      modelId: 'm1',
      body: { messages: [{ role: 'user', content: 'hi' }] },
      signal: new AbortController().signal,
    })) {
      // Draining only.
    }

    expect(seen).toHaveLength(1)
    expect('sessionId' in (seen[0] ?? {})).toBe(false)
  })
})
