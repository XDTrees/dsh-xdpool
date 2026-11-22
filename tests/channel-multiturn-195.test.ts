/**
 * 渠道车道的多轮对话与失败透出 —— issue #195。
 *
 * 两个独立缺陷，一条根因链：
 *
 *  1. 网关把裸 OpenAI 历史转给宿主时，assistant 消息没有 `source`。宿主的
 *     `LlmRuntime.forAdapter` 直接读 `source.replayState`（没有判空），于是
 *     第二轮必然抛 TypeError —— 第一轮没有 assistant 历史，所以只有多轮才崩。
 *  2. `mapFinishReason` 把 `kind:'error'` 也归成 `'stop'`，于是宿主的异常被翻译成
 *     「正常结束 + 空内容」，宿主按可重试的 `EMPTY_RESPONSE` 一直重试到退避耗尽，
 *     用户只看到「模型没反应」。
 *
 * 这里用真实的 `createChannelLane` 跑一遍假宿主（记录收到的 messages），
 * 所以断言的是「发给宿主的东西长什么样」，而不是代码里有没有某句话。
 */

import { describe, expect, it } from 'vitest'
import {
  createChannelLane,
  mapFinishReason,
  normalizeRole,
  toChannelEvent,
  type ChannelLaneEvent,
} from '../src/channel-lane.ts'

/** A fake host seam that records what the lane sent and replays a scripted stream. */
function fakeLlm(script: Record<string, unknown>[]): {
  llm: { listModels: () => Promise<never[]>; stream: (options: Record<string, unknown>) => AsyncIterable<Record<string, unknown>> }
  sent: () => Record<string, unknown>[]
} {
  let sent: Record<string, unknown>[] = []
  return {
    sent: () => sent,
    llm: {
      listModels: async () => [],
      stream: (options) => {
        sent = (options['messages'] as Record<string, unknown>[]) ?? []
        return (async function* () {
          for (const chunk of script) yield chunk
        })()
      },
    },
  }
}

/** Drive one turn and collect the events. */
async function run(
  body: Record<string, unknown>,
  script: Record<string, unknown>[],
): Promise<{ events: ChannelLaneEvent[]; sent: Record<string, unknown>[] }> {
  const { llm, sent } = fakeLlm(script)
  const lane = createChannelLane({
    llm,
    providers: () => ['trae'],
    toId: (channel, modelId) => `${channel}:${modelId}`,
  })
  const controller = new AbortController()
  const events: ChannelLaneEvent[] = []
  for await (const event of lane.turn({ channel: 'trae', modelId: 'deepseek-v4.1-flash', body, signal: controller.signal })) {
    events.push(event)
  }
  return { events, sent: sent() }
}

describe('assistant 历史必须带 source', () => {
  it('多轮里那条 assistant 消息带上了 source', async () => {
    const { sent } = await run({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'yo' },
        { role: 'user', content: '2+2?' },
      ],
    }, [{ type: 'text-delta', text: '4' }, { type: 'finish', reason: { kind: 'stop' } }])

    expect(sent).toHaveLength(3)
    const assistant = sent[1] as Record<string, unknown>
    expect(assistant['role']).toBe('assistant')
    // 宿主只读 `source.replayState`；有 source 对象就够了，replayState 缺席正是
    // 「这条消息没有可回放状态」的正确表达。
    expect(assistant['source']).toEqual({
      kind: 'model',
      provider: 'trae',
      model: 'deepseek-v4.1-flash',
    })
  })

  it('user / system 消息不加（宿主也不会为它们读 source）', async () => {
    const { sent } = await run({
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ],
    }, [{ type: 'finish', reason: { kind: 'stop' } }])

    // system 单独走 options.system，不进 messages。
    expect(sent).toHaveLength(1)
    expect(sent[0]?.['source']).toBeUndefined()
  })
})

describe('role 大小写先归一化', () => {
  it('Assistant / ASSISTANT / 带空格 都变成 assistant', () => {
    for (const spelling of ['Assistant', 'ASSISTANT', ' assistant ', 'assistant']) {
      expect(normalizeRole(spelling)).toBe('assistant')
    }
  })

  it('未知角色退回 user，不抛', () => {
    expect(normalizeRole('weird_role_xyz')).toBe('user')
    expect(normalizeRole(undefined)).toBe('user')
    expect(normalizeRole(42)).toBe('user')
  })

  it('大写写法在链路里也真的被当成 assistant 发出', async () => {
    // 报告里的对照实验把这条读成「大写能用」，其实它被静默降级成了 user。
    const { sent } = await run({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'Assistant', content: 'yo' },
        { role: 'user', content: '2+2?' },
      ],
    }, [{ type: 'finish', reason: { kind: 'stop' } }])

    expect(sent[1]?.['role']).toBe('assistant')
    expect(sent[1]?.['source']).toBeDefined()
  })
})

describe('失败不许伪装成完成', () => {
  it('mapFinishReason 对 error 返回 undefined', () => {
    expect(mapFinishReason({ kind: 'error' })).toBeUndefined()
    expect(mapFinishReason({ kind: 'failed' })).toBeUndefined()
  })

  it('其它 kind 的翻译保持不变', () => {
    expect(mapFinishReason({ kind: 'stop' })).toBe('stop')
    expect(mapFinishReason({ kind: 'toolUse' })).toBe('tool_calls')
    expect(mapFinishReason({ kind: 'length' })).toBe('length')
    expect(mapFinishReason({ kind: 'aborted' })).toBe('abort')
  })

  it('finish 带 error 时转成 failed 事件，并带上宿主自己的话', () => {
    const event = toChannelEvent({
      type: 'finish',
      reason: { kind: 'error', error: { message: 'trae: HTTP 403 Forbidden', status: 403 } },
    })
    expect(event).toEqual({ kind: 'failed', message: 'trae: HTTP 403 Forbidden', status: 403 })
  })

  it('没有 message 时也给一句能读的，而不是空串', () => {
    const event = toChannelEvent({ type: 'finish', reason: { kind: 'error' } })
    expect(event?.kind).toBe('failed')
    if (event?.kind === 'failed') expect(event.message.length).toBeGreaterThan(0)
  })

  it('整轮走完时，失败出现在事件流里（不是 stop）', async () => {
    const { events } = await run({
      messages: [{ role: 'user', content: 'hi' }],
    }, [
      { type: 'text-delta', text: '' },
      { type: 'finish', reason: { kind: 'error', error: { message: 'upstream said no', status: 400 } } },
    ])
    const failed = events.find(event => event.kind === 'failed')
    expect(failed).toBeDefined()
    expect(events.some(event => event.kind === 'done')).toBe(false)
  })
})
