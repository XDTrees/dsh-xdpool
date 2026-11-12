/**
 * `stream: false` on every lane, wired end to end.
 *
 * The upstream pool lane always speaks SSE (`prepareChatBody` forces it), and
 * three of the four buffering lanes used to forward those frames verbatim no
 * matter what the caller asked for. An OpenAI client that sent `stream: false`
 * then tried to parse `data: {...}` as JSON and failed with
 * `Unexpected token 'd'` — a 200 response that no client could read.
 *
 * Two properties matter and pull in opposite directions, so both are pinned
 * here: an explicit `stream: false` must produce ONE `chat.completion`
 * document, and an ABSENT `stream` must keep the SSE body byte for byte,
 * because that is what every existing caller (including the Harness) receives.
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkBuddyAccountPool } from '../src/accounts.ts'
import { WorkBuddyCatalog } from '../src/catalog.ts'
import {
  bufferedFramesToCompletion,
  createTurnAccumulator,
  drainSsePayloads,
  foldPayload,
  mergeTurnToolCall,
  turnToCompletion,
  wantsNonStreaming,
} from '../src/non-streaming.ts'
import { createWorkBuddyShim } from '../src/shim.ts'
import { UsageRecorder } from '../src/stats.ts'
import { WorkBuddyUpstreamClient } from '../src/upstream.ts'

const shims: { close(): Promise<void> }[] = []

afterEach(async () => {
  while (shims.length > 0) await shims.pop()?.close()
})

async function fakeAuthDir(count: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wbnonstream-'))
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

async function shimWith(
  recorder: UsageRecorder,
  fetchImpl: (url: unknown, init: RequestInit) => Promise<Response>,
): Promise<{ shim: { baseUrl(): string; token(): string } }> {
  const pool = new WorkBuddyAccountPool({ authDirs: [await fakeAuthDir(1)] })
  await pool.scan()
  const shim = createWorkBuddyShim({
    pool,
    client: new WorkBuddyUpstreamClient({ fetchImpl: fetchImpl as never }),
    catalog: new WorkBuddyCatalog(),
    region: 'cn',
    usageRecorder: recorder,
  })
  shims.push(shim)
  await shim.ready
  return { shim }
}

/** Ask the shim one turn with an explicit body and read it as text. */
async function call(
  shim: { baseUrl(): string; token(): string },
  body: Record<string, unknown>,
): Promise<{ status: number; contentType: string; text: string }> {
  const response = await fetch(`${shim.baseUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${shim.token()}` },
    body: JSON.stringify(body),
  })
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    text: await response.text(),
  }
}

/** An answer frame, a usage trailer and the sentinel — the usual pool stream. */
function poolStream(): string {
  return 'data: {"choices":[{"delta":{"content":"早"}}]}\n\n'
    + 'data: {"choices":[{"delta":{"content":"上好"}}]}\n\n'
    + 'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":5}}\n\n'
    + 'data: [DONE]\n\n'
}

describe('wantsNonStreaming', () => {
  it('reads an explicit false as "one JSON document"', () => {
    expect(wantsNonStreaming('{"model":"buddy:m","stream":false}')).toBe(true)
  })

  it('keeps streaming when the flag is absent, because callers omit it', () => {
    expect(wantsNonStreaming('{"model":"buddy:m"}')).toBe(false)
  })

  it('keeps streaming for an explicit true and for bodies it cannot read', () => {
    expect(wantsNonStreaming('{"stream":true}')).toBe(false)
    expect(wantsNonStreaming('not json')).toBe(false)
    expect(wantsNonStreaming('[]')).toBe(false)
    expect(wantsNonStreaming('null')).toBe(false)
  })
})

describe('tool-call reassembly', () => {
  it('keeps the name from the opening fragment when argument deltas arrive', () => {
    const opening = mergeTurnToolCall({}, { index: 0, function: { name: 'get_weather', arguments: '' } })
    // Every later fragment carries `function.name: ""`; spreading it would
    // erase the name and leave the caller with an uncallable tool.
    const merged = mergeTurnToolCall(opening, { index: 0, function: { name: '', arguments: '{"city":' } })
    const tail = mergeTurnToolCall(merged, { index: 0, function: { arguments: '"北京"}' } })
    const fn = tail['function'] as Record<string, unknown>
    expect(fn['name']).toBe('get_weather')
    expect(fn['arguments']).toBe('{"city":"北京"}')
  })

  it('collects calls by index and never invents an empty one', () => {
    const turn = createTurnAccumulator('buddy:m')
    foldPayload(turn, JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 1, function: { name: 'b', arguments: '{}' } }] } }] }))
    foldPayload(turn, JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'a', arguments: '{}' } }] } }] }))
    const completion = turnToCompletion(turn)
    const choices = completion['choices'] as { message: Record<string, unknown> }[]
    const calls = choices[0]?.message['tool_calls'] as Record<string, unknown>[]
    // Index order, not arrival order: the upstream may fill slot 1 first.
    expect(calls.map(call => (call['function'] as Record<string, unknown>)['name'])).toEqual(['a', 'b'])
  })

  it('reports content null — not "" — for a turn that only called tools', () => {
    const turn = createTurnAccumulator('buddy:m')
    foldPayload(turn, JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'a', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }))
    const choices = turnToCompletion(turn)['choices'] as { message: Record<string, unknown>; finish_reason: string }[]
    expect(choices[0]?.message['content']).toBeNull()
    expect(choices[0]?.finish_reason).toBe('tool_calls')
  })
})

describe('drainSsePayloads', () => {
  it('emits only complete frames and hands the remainder back', () => {
    const buffer = Buffer.from('data: {"a":1}\n\ndata: {"b":', 'utf8')
    const drained = drainSsePayloads(buffer)
    expect(drained.payloads).toEqual(['{"a":1}'])
    expect(drained.rest.toString('utf8')).toBe('data: {"b":')
  })

  it('understands CRLF separators', () => {
    const drained = drainSsePayloads(Buffer.from('data: {"a":1}\r\n\r\ndata: [DONE]\r\n\r\n', 'utf8'))
    expect(drained.payloads).toEqual(['{"a":1}', '[DONE]'])
    expect(drained.rest.length).toBe(0)
  })
})

describe('buffered lanes honour the flag', () => {
  it('folds buffered frames into one document with the upstream usage intact', () => {
    const completion = bufferedFramesToCompletion(
      ['{"choices":[{"delta":{"content":"你好"}}]}', '{"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}', '[DONE]'],
      'combo:x',
    )
    expect(completion['object']).toBe('chat.completion')
    expect(completion['model']).toBe('combo:x')
    const choices = completion['choices'] as { message: Record<string, unknown>; finish_reason: string }[]
    expect(choices[0]?.message['content']).toBe('你好')
    expect(choices[0]?.finish_reason).toBe('stop')
    expect(completion['usage']).toEqual({ prompt_tokens: 3, completion_tokens: 2 })
  })
})

describe('pool lane, wired', () => {
  it('answers stream:false with one chat.completion document', async () => {
    const recorder = new UsageRecorder()
    const { shim } = await shimWith(recorder, async () => new Response(poolStream(), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const { status, contentType, text } = await call(shim, {
      model: 'hy4-preview',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    })
    expect(status).toBe(200)
    expect(contentType).toContain('application/json')
    // The whole point: a client parsing this as JSON must succeed.
    const body = JSON.parse(text) as Record<string, unknown>
    expect(body['object']).toBe('chat.completion')
    const choices = body['choices'] as { message: Record<string, unknown> }[]
    expect(choices[0]?.message['content']).toBe('早上好')
    expect(body['usage']).toEqual({ prompt_tokens: 12, completion_tokens: 5 })
    // A non-streaming answer must not carry SSE sentinels inside its text.
    expect(text).not.toContain('data:')
    expect(text).not.toContain('[DONE]')

    // The same physical call costs the same whichever way it is read.
    const summary = recorder.summary()
    expect(summary.calls).toBe(1)
    expect(summary.turns).toBe(1)
    expect(summary.rows[0]?.inputTokens).toBe(12)
    expect(summary.rows[0]?.outputTokens).toBe(5)
  })

  it('keeps the SSE body byte for byte when the flag is absent', async () => {
    const recorder = new UsageRecorder()
    const { shim } = await shimWith(recorder, async () => new Response(poolStream(), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const { status, contentType, text } = await call(shim, {
      model: 'hy4-preview',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(status).toBe(200)
    expect(contentType).toContain('text/event-stream')
    // The usage trailer is stripped for the host, exactly as before.
    expect(text).not.toContain('usage')
    expect(text).toContain('[DONE]')
    // Frames are forwarded verbatim, so the answer still arrives as deltas.
    expect(text).toContain('早')
    expect(text).toContain('上好')
    expect(recorder.summary().rows[0]?.inputTokens).toBe(12)
  })
})
