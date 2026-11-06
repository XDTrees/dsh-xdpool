/**
 * Tool traffic survives the free lane (#113).
 *
 * The report: with pi as the client, calling a pool model returned "the tool
 * returned no result" while the same model through the aggregate lane worked.
 * The session log showed every bash/read call completing — the model simply
 * never saw the output, so it re-issued the same call forever and then told the
 * user the environment was broken.
 *
 * Two defects, and both had to be fixed for the lane to work:
 *
 *   1. `toolResultsOf()` looked for `type: 'tool-result'` wrapper blocks inside a
 *      `role: 'tool'` message. DSH's own tool messages carry the result AS their
 *      content, with no wrapper, so the filter returned nothing, the call sites
 *      skipped the message, and the whole result vanished from two of the three
 *      wires.
 *   2. Nothing repaired the pairing. Once one turn is interrupted, the history
 *      holds a call with no answer (or an answer with no call) — and upstream
 *      rejects that on EVERY subsequent turn, so a single interruption makes the
 *      conversation permanently unusable.
 *
 * These assertions run the real projection, not a copy of its logic.
 */
import { describe, expect, it } from 'vitest'
import { requestBodyFor } from '../src/free-messages.ts'

/** Minimal wire selection: the two that dropped tool messages. */
const WIRES = ['responses', 'messages'] as const

const TOOLS = [{ name: 'bash', description: 'Run a command', parameters: { type: 'object', properties: {} } }]

function project(wire: 'responses' | 'messages', messages: Record<string, unknown>[]) {
  const warnings: string[] = []
  const body = requestBodyFor(wire, { messages, tools: TOOLS, stream: true }, { modelId: 'test-model', warnings })
  return { body, warnings }
}

/** A completed call/answer pair, spelled the way DSH sends it. */
function paired(): Record<string, unknown>[] {
  return [
    { role: 'user', content: 'list the files' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"cmd":"ls"}' } }],
    },
    // The shape that was dropped: the RESULT is the content, no wrapper block.
    { role: 'tool', tool_call_id: 'call_1', content: 'file-a.txt\nfile-b.txt' },
  ]
}

describe('a tool result reaches the wire (#113)', () => {
  for (const wire of WIRES) {
    it(`carries the result text on the ${wire} wire`, () => {
      const { body, warnings } = project(wire, paired())
      const json = JSON.stringify(body)
      // The actual output the model needs to see.
      expect(json).toContain('file-a.txt')
      expect(json).toContain('file-b.txt')
      // And it is tied to its call, or the model cannot tell what answered what.
      expect(json).toContain('call_1')
      expect(warnings, 'a well-formed history needs no repair').toEqual([])
    })

    it(`keeps a table of contents that mixes text and results (${wire})`, () => {
      // A real session has several rounds. Every result must survive, not just
      // the last one — losing the middle ones is the same failure in slower form.
      const messages = [
        ...paired(),
        {
          role: 'assistant',
          content: 'reading the config',
          tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'bash', arguments: '{"cmd":"cat a"}' } }],
        },
        { role: 'tool', tool_call_id: 'call_2', content: 'FIRST-RESULT-BODY' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'call_3', type: 'function', function: { name: 'bash', arguments: '{"cmd":"cat b"}' } }],
        },
        { role: 'tool', tool_call_id: 'call_3', content: 'SECOND-RESULT-BODY' },
      ]
      const { body } = project(wire, messages)
      const json = JSON.stringify(body)
      expect(json).toContain('FIRST-RESULT-BODY')
      expect(json).toContain('SECOND-RESULT-BODY')
      expect(json).toContain('file-a.txt')
    })
  }

  it('carries an empty result as an explicit marker instead of dropping the call', () => {
    // A tool that legitimately printed nothing must still ANSWER its call: an
    // unanswered call is a 400, and a fabricated "ok" would be a lie.
    const messages = [
      { role: 'user', content: 'run true' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_empty', type: 'function', function: { name: 'bash', arguments: '{"cmd":"true"}' } }],
      },
      { role: 'tool', tool_call_id: 'call_empty', content: '' },
    ]
    for (const wire of WIRES) {
      const { body } = project(wire, messages)
      expect(JSON.stringify(body), `${wire} dropped an empty answer`).toContain('call_empty')
    }
  })

  it('keeps a failed call marked as failed', () => {
    // The model has to be able to tell an error from a successful answer; a stack
    // trace passed off as output makes it retry the wrong thing.
    const messages = [
      { role: 'user', content: 'run the broken thing' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_err', type: 'function', function: { name: 'bash', arguments: '{"cmd":"false"}' } }],
      },
      { role: 'tool', tool_call_id: 'call_err', content: 'command not found', is_error: true },
    ]
    const { body } = project('messages', messages)
    expect(JSON.stringify(body)).toContain('is_error')
  })
})

describe('a broken pairing is repaired instead of killing the session', () => {
  it('drops a call the interrupted turn never answered', () => {
    // The interruption case: the assistant called a tool, the user pressed stop,
    // no result was ever written. Left in place, upstream rejects every turn
    // after this one.
    const messages = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: 'on it',
        tool_calls: [{ id: 'call_orphan', type: 'function', function: { name: 'bash', arguments: '{}' } }],
      },
      { role: 'user', content: 'never mind, do something else' },
    ]
    const { body, warnings } = project('responses', messages)
    expect(JSON.stringify(body)).not.toContain('call_orphan')
    // The assistant's own words survive — they are not tool bookkeeping.
    expect(JSON.stringify(body)).toContain('on it')
    expect(warnings.join(' ')).toMatch(/unanswered tool call/u)
  })

  it('drops a result whose call is gone', () => {
    const messages = [
      { role: 'user', content: 'go' },
      { role: 'tool', tool_call_id: 'call_deleted', content: 'stale output' },
      { role: 'user', content: 'continue' },
    ]
    const { body, warnings } = project('responses', messages)
    expect(JSON.stringify(body)).not.toContain('stale output')
    expect(warnings.join(' ')).toMatch(/orphaned tool result/u)
  })

  it('drops a call with no name, even though a result answers it', () => {
    // It is "answered", so an id-only check keeps it — but it cannot be replayed
    // because upstream validates the name. This is the shape that made #92 in the
    // other project permanent.
    const messages = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_nameless', type: 'function', function: { name: '', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'call_nameless', content: 'output' },
    ]
    const { body } = project('responses', messages)
    const json = JSON.stringify(body)
    expect(json).not.toContain('call_nameless')
  })

  it('leaves a clean history completely alone', () => {
    // The repair must not touch what already works: a false positive here would
    // silently drop a legitimate call.
    const messages = paired()
    const before = JSON.stringify(project('responses', messages).body)
    const after = JSON.stringify(project('responses', paired()).body)
    expect(after).toBe(before)
  })
})
