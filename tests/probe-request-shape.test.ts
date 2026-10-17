/**
 * The connection probe must hand the host content BLOCKS, never a bare string.
 *
 * Every model in the card answered "输出 0 无应答" with the error line
 * `content.some is not a function`. Nothing on the wire was wrong: the probe
 * died inside the host before the request left the process.
 *
 * `probeModelConnectivity` called `llm.stream()` with
 * `messages: [{ role: 'user', content: PROBE_PROMPT }]`, and the host's
 * `@deepseek-ai/dsh-llm-pi-ai` validates every outgoing message through
 * `assertSupportedHistory`, whose second line is
 *
 *   if (message.content.some(block => block.type === 'tool-addition' || …))
 *
 * unguarded. A string has no `.some`, so the TypeError surfaced as the card's
 * per-model error — which reads as "this model is broken" and is really "this
 * plugin sent the host a shape it does not accept".
 *
 * The host's typed contract is `readonly content: readonly ContentBlock[]`, so
 * the string was out of contract on our side; the host's check being unguarded
 * only decides how unhelpful the message is. Both halves of that are pinned
 * here: our request must be block-shaped, and the shape must survive the host's
 * own walk rather than merely resembling it.
 */

import { describe, expect, it } from 'vitest'
import { probeModelConnectivity } from '../src/model-probe.ts'
import type { ModelProbeStream } from '../src/model-probe.ts'

/** What the probe asked the host to send. */
interface Captured {
  provider: string
  model: string
  system?: string
  messages: Array<{ role: string; content: unknown }>
}

/**
 * A stand-in for the host's `llm` service that records its options.
 *
 * It answers with an empty terminal chunk: the assertion under test is the
 * REQUEST, and waiting for a first character would only add the probe's grace
 * window to the suite for no extra coverage.
 */
function recordingStream(captured: Captured[]): ModelProbeStream {
  return {
    stream(options) {
      captured.push(options as unknown as Captured)
      return (async function* () {
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

/**
 * The host's validation, mirrored from `assertSupportedHistory` in
 * `@deepseek-ai/dsh-llm-pi-ai` — including its missing `Array.isArray` guard,
 * which is precisely what turned our shape error into a cryptic TypeError.
 *
 * Running the real walk beats asserting a field name: a future host that reads
 * more of the block shape still catches us here.
 */
function hostAssertSupportedHistory(messages: Captured['messages']): void {
  for (const message of messages) {
    if (message.role === 'developer') throw new Error('Developer messages are not supported yet')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(message.content as any).some((block: any) => block.type === 'tool-addition' || block.type === 'tool-removal')
  }
}

describe('the model probe request shape', () => {
  it('sends every message as an array of content blocks', async () => {
    const captured: Captured[] = []
    await probeModelConnectivity(recordingStream(captured), 'xdpool', 'deepseek-v4.1-flash')
    expect(captured).toHaveLength(1)
    const messages = captured[0]!.messages
    expect(messages.length).toBeGreaterThan(0)
    for (const message of messages) {
      expect(Array.isArray(message.content), `content for role "${message.role}" must be a block array`).toBe(true)
    }
  })

  it('survives the host walk that used to throw content.some is not a function', async () => {
    const captured: Captured[] = []
    await probeModelConnectivity(recordingStream(captured), 'xdpool', 'deepseek-v4.1-flash')
    expect(() => hostAssertSupportedHistory(captured[0]!.messages)).not.toThrow()
  })

  it('carries the probe prompt as text inside the block', async () => {
    const captured: Captured[] = []
    await probeModelConnectivity(recordingStream(captured), 'xdpool', 'hy3')
    const blocks = captured[0]!.messages[0]!.content as Array<{ type: string; text?: string }>
    expect(blocks[0]!.type).toBe('text')
    // A probe that silently stopped asking anything would pass the two
    // assertions above while measuring nothing at all.
    expect(blocks[0]!.text).toMatch(/\S/)
  })

  it('still reports the provider and model it was asked about', async () => {
    const captured: Captured[] = []
    await probeModelConnectivity(recordingStream(captured), 'xdpool-global', 'step-5-preview')
    expect(captured[0]!.provider).toBe('xdpool-global')
    expect(captured[0]!.model).toBe('step-5-preview')
  })
})
