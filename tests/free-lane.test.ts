/**
 * The free lane, pinned from both ends.
 *
 * Three things about this lane are easy to get quietly wrong, so they are what
 * these tests are about:
 *
 * - The gateway gates the free tier on the shape of the request, not on a key.
 *   A turn missing one of the four lowercase quartet names answers
 *   `403 FreeTierError`, so the fingerprint pass is not decoration — and the
 *   pass must also not DISABLE tools the caller declared.
 * - Quota is counted per session id. A harness that mints a fresh session per
 *   turn spends the allowance and then reports the model as broken, so the same
 *   conversation must always produce the same session.
 * - The other two wires are not chat wire. Their streams are translated frame by
 *   frame, and a frame the caller cannot decode is a wrong answer rather than a
 *   missing one, so translation is checked against real payloads of each wire.
 *
 * Nothing here leaves the process: the transport has a seam, and every listing and
 * turn in this file is served by a local loopback listener or by that seam.
 */
import { describe, expect, it } from 'vitest'
import http, { createServer } from 'node:http'
// Our own class, not the global one: `instanceof` against the built-in would
// never match, and a passing test that asserts the wrong class proves nothing.
import { AggregateError } from '../src/aggregate.ts'
import {
  FREE_CLIENT_UA,
  REQUEST_RE,
  SESSION_RE,
  applyFingerprint,
  baseModelId,
  endpointFor,
  fingerprintToolFor,
  freeLane,
  gatewayHeaders,
  mintRequestId,
  mintSessionId,
  postFreeStreamed,
  requestIdFor,
  restoreToolName,
  sessionForConversation,
  wireFor,
} from '../src/free-upstream.ts'
import {
  FreeToolWire,
  chatChunksFor,
  requestBodyFor,
  toolDefsFor,
} from '../src/free-messages.ts'
import {
  FALLBACK_FREE_MODEL_IDS,
  FreeCatalog,
  buildFreeCatalog,
  capabilitiesFor,
  knownCapabilities,
  displayModelName,
  isFreeLane,
  isRegionSensitive,
  parseListing,
} from '../src/free-catalog.ts'

const SLOW = 60_000

/** Feed one wire's event through the translation and return the chat deltas. */
function translate(wire: 'chat' | 'responses' | 'messages', payload: unknown, tools = new FreeToolWire([])) {
  return chatChunksFor(wire, payload, tools)
}

/** The concatenated `content` of every text delta in a delta sequence. */
function textOf(deltas: readonly Record<string, unknown>[]): string {
  return deltas.map(delta => (typeof delta.content === 'string' ? delta.content : '')).join('')
}

/** Every tool-call name a delta sequence emitted. */
function callNames(deltas: readonly Record<string, unknown>[]): string[] {
  const names: string[] = []
  for (const delta of deltas) {
    const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : []
    for (const call of calls) {
      const fn = (call as { function?: { name?: unknown } } | undefined)?.function
      if (typeof fn?.name === 'string') names.push(fn.name)
    }
  }
  return names
}

describe('the free lane request', () => {
  it('routes each model to the wire its endpoint speaks', () => {
    // A model answered on the wrong wire is a 404 or a silently different answer,
    // and the mapping is by model, so it is checked model by model.
    expect(wireFor('muse-spark-1.3-contributor-free')).toBe('responses')
    expect(wireFor('union-alpha')).toBe('messages')
    expect(wireFor('space-bunny-free')).toBe('chat')
    // An unknown id falls to chat, which is the shape everything starts as.
    expect(wireFor('some-model-nobody-has-heard-of')).toBe('chat')
    // The suffix a reasoning label adds must not move a model off its wire.
    expect(wireFor('muse-spark-1.3-contributor-free (high)')).toBe('responses')
    expect(baseModelId('muse-spark-1.3-contributor-free (high)')).toBe('muse-spark-1.3-contributor-free')
  })

  it('keeps one conversation on one session', () => {
    // Quota is counted per session id, so a fresh id per turn would spend the
    // allowance and then read as a broken model.
    const first = sessionForConversation('conversation-a')
    const second = sessionForConversation('conversation-a')
    expect(first).toBe(second)
    expect(SESSION_RE.test(first)).toBe(true)
    // Different conversations must NOT share, or one user's turns spend another's
    // allowance.
    expect(sessionForConversation('conversation-b')).not.toBe(first)
    // A session the caller already minted is honoured as-is: the harness owns
    // that id, and re-deriving it would split the conversation's history.
    const caller = mintSessionId()
    expect(sessionForConversation(caller)).toBe(caller)
    // No id at all still produces a valid one rather than an empty header.
    expect(SESSION_RE.test(sessionForConversation(undefined))).toBe(true)
  })

  it('keeps one turn on one request id', () => {
    const session = sessionForConversation('conversation-a')
    const first = requestIdFor(session, 'turn-1')
    expect(first).toBe(requestIdFor(session, 'turn-1'))
    expect(REQUEST_RE.test(first)).toBe(true)
    expect(requestIdFor(session, 'turn-2')).not.toBe(first)
    expect(REQUEST_RE.test(mintRequestId())).toBe(true)
    expect(REQUEST_RE.test(mintSessionId().replace('ses_', 'msg_'))).toBe(true)
  })

  it('identifies itself as a v2 client the gateway accepts', () => {
    const headers = gatewayHeaders({ session: 'ses_x', requestId: 'msg_x', stream: true })
    // The pooled credential. A real key here reads as an unknown one.
    expect(headers.authorization).toBe('Bearer public')
    // The shape is `opencode/<channel>/<version>/<client>` with major >= 2; the
    // v1 `opencode/1.18.x` is refused by name since 2026-10-14.
    expect(headers['user-agent']).toBe(FREE_CLIENT_UA)
    expect(FREE_CLIENT_UA.startsWith('opencode/')).toBe(true)
    expect(/^opencode\/[^/]+\/2\./u.test(FREE_CLIENT_UA)).toBe(true)
    expect(headers['x-opencode-client']).toBe('cli')
    // Four names, one value — the gateway checks more than one of them.
    expect(headers['x-opencode-session']).toBe('ses_x')
    expect(headers['x-opencode-session-id']).toBe('ses_x')
    expect(headers['x-session-affinity']).toBe('ses_x')
    expect(headers['x-session-id']).toBe('ses_x')
    // ⚠️ The v1-only request header is fatal under v2, not merely ignored. It is
    // still accepted as an argument so callers keep passing their per-turn id,
    // but it must never reach the wire.
    expect(headers['x-opencode-request']).toBeUndefined()
    expect(Object.keys(headers).some(key => key.includes('opencode-request'))).toBe(false)
    expect(headers.accept).toBe('text/event-stream')
    // A listing is JSON, and it asks for it explicitly.
    expect(gatewayHeaders({ session: 'ses_x', requestId: 'msg_x', stream: false, accept: 'application/json' }).accept).toBe(
      'application/json',
    )
  })

  it('serves every model from the /inference path', () => {
    // `/zen/*` answers every free model with 403 FreeTierError no matter how good
    // the fingerprint is, so the prefix moved together with the User-Agent.
    expect(endpointFor('deepseek-v4.1-flash-free')).toBe('/inference/v1/chat/completions')
    expect(endpointFor('muse-spark-1.3-contributor-free')).toBe('/inference/v1/responses')
    expect(endpointFor('union-alpha')).toBe('/inference/v1/messages')
    // And no path under the old prefix is reachable any more.
    for (const model of ['deepseek-v4.1-flash-free', 'muse-spark-1.3-contributor-free', 'union-alpha']) {
      expect(endpointFor(model).startsWith('/zen/')).toBe(false)
      expect(wireFor(model)).not.toBe('')
    }
  })
})

/** The names one tool-definition list declares, in whichever wire's spelling. */
function declaredNames(tools: unknown): string[] {
  return toolDefsFor(tools, 'chat').map(tool => {
    const fn = (tool as { function?: { name?: unknown } }).function
    return String(fn?.name ?? '')
  })
}

describe('the free lane fingerprint pass', () => {
  it('declares read and shell with OpenCode’s own definitions', () => {
    const body: Record<string, unknown> = { tools: [{ name: 'search_docs' }] }
    applyFingerprint(body, 'chat')
    // v2 requires exactly these two, and it COMPARES the definition: the v1
    // quartet of self-disabling stubs with empty `properties` is refused.
    expect(declaredNames(body.tools)).toEqual(expect.arrayContaining(['read', 'shell']))
    expect(declaredNames(body.tools)).toContain('search_docs')
    // The gate is two tools wide now — `bash`/`glob`/`grep` are no longer asked
    // for, and declaring them would only add names the gate does not know.
    expect(declaredNames(body.tools)).not.toContain('glob')
    expect(declaredNames(body.tools)).not.toContain('grep')
    for (const tool of toolDefsFor(body.tools, 'chat')) {
      const fn = (tool as { function?: { name?: unknown } }).function
      if (fn?.name === 'read' || fn?.name === 'shell') {
        // A stub description is what v1 shipped; v2 answers 403 to it.
        expect(String(fn.description)).not.toMatch(/unavailable|must not be used/iu)
        expect(String(fn.description).length).toBeGreaterThan(200)
        expect((fn as { parameters?: { properties?: unknown } }).parameters).toHaveProperty('properties')
        expect((fn as { parameters?: { additionalProperties?: unknown } }).parameters).toMatchObject({
          additionalProperties: false,
        })
      }
    }
  })

  it('leaves the caller’s own read and shell alone when they match the gate', () => {
    // A caller that happens to declare OpenCode's real definitions keeps them
    // under their own names — no alias, no second copy.
    const body: Record<string, unknown> = { tools: [] }
    applyFingerprint(body, 'chat')
    const declared = toolDefsFor(body.tools, 'chat') as Array<{ function?: { name?: string } }>
    const read = declared.find(tool => tool.function?.name === 'read')
    expect(read).toBeDefined()
  })

  it('renames a caller tool that squats a gate name, and rewrites its history', () => {
    // A harness `read` that is NOT OpenCode’s read cannot keep the name: the gate
    // compares definitions, so both under one name is a 403. The caller’s tool is
    // renamed instead, the history is rewritten to match, and the response side
    // restores the caller’s spelling.
    const body: Record<string, unknown> = {
      tools: [{ type: 'function', function: { name: 'read', description: 'our own reader' } }],
      messages: [
        { role: 'assistant', tool_calls: [{ function: { name: 'read', arguments: '{}' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_name: 'read' }] },
      ],
      tool_choice: { type: 'function', function: { name: 'read' } },
    }
    const plan = applyFingerprint(body, 'chat')
    expect(plan.rename.get('read_client')).toBe('read')
    expect(declaredNames(body.tools)).toContain('read_client')
    // The official definition is still injected, because the caller’s squat was
    // renamed out of the way — this is the `present` vs `seen` distinction.
    expect(declaredNames(body.tools)).toContain('read')
    expect(plan.injected).toContain('read')
    // History and choice follow the rename, or the model compares its own earlier
    // `read` call against the official definition and the two disagree.
    // Found by role, not by index: the pass also prepends the placeholder note as
    // a system message, so position 0 is no longer the caller's turn.
    const messages = body.messages as Array<{
      role?: string
      tool_calls?: Array<{ function?: { name?: string } }>
      content?: Array<{ type?: string; tool_name?: string }>
    }>
    const spoken = messages.find(message => message.role === 'assistant')
    expect(spoken?.tool_calls?.[0]?.function?.name).toBe('read_client')
    const answered = messages.find(message => message.role === 'user')
    expect(answered?.content?.[0]?.tool_name).toBe('read_client')
    expect((body.tool_choice as { function?: { name?: string } }).function?.name).toBe('read_client')
    // And the response side can put the caller's own name back.
    expect(restoreToolName('read_client', plan.rename)).toBe('read')
  })

  it('never renames a case variant — only the exact gate names are gated', () => {
    // `Read` and `Bash` are the caller's own tools, not gate tools. v1 lowercased
    // them into the gate, which collided with OpenCode’s definitions.
    const body: Record<string, unknown> = {
      tools: [
        { type: 'function', function: { name: 'Bash', description: 'x' } },
        { type: 'function', function: { name: 'Read', description: 'x' } },
      ],
    }
    const plan = applyFingerprint(body, 'chat')
    expect(declaredNames(body.tools)).toContain('Bash')
    expect(declaredNames(body.tools)).toContain('Read')
    expect(plan.rename.size).toBe(0)
  })

  it('never emits tool_choice none — v2 refuses it outright', () => {
    // With the caller's tools present, an invented `tool_choice` would force a
    // call the caller never asked for.
    const withTools: Record<string, unknown> = { tools: [{ name: 'search_docs' }] }
    applyFingerprint(withTools, 'chat')
    expect(withTools.tool_choice).toBeUndefined()

    // Even with nothing but gate tools declared, `none` is fatal now. The Messages
    // wire's spelling of it is fatal too.
    const noTools: Record<string, unknown> = { tools: [] }
    applyFingerprint(noTools, 'chat')
    expect(noTools.tool_choice).toBeUndefined()

    const claude: Record<string, unknown> = { tools: [] }
    applyFingerprint(claude, 'messages')
    expect(claude.tool_choice).toBeUndefined()

    // The Responses wire asks the gateway to pick — that is the one exception.
    const responses: Record<string, unknown> = { tools: [] }
    applyFingerprint(responses, 'responses')
    expect(responses.tool_choice).toBe('auto')

    // And a `none` the CALLER left behind is cleared rather than forwarded.
    const leftover: Record<string, unknown> = { tools: [], tool_choice: 'none' }
    applyFingerprint(leftover, 'chat')
    expect(leftover.tool_choice).toBeUndefined()
    const leftoverObject: Record<string, unknown> = { tools: [], tool_choice: { type: 'none' } }
    applyFingerprint(leftoverObject, 'messages')
    expect(leftoverObject.tool_choice).toBeUndefined()
  })

  it('tells the model the injected gate tools are placeholders', () => {
    // v2's definitions are real tools and the model calls them, so the only lever
    // is the prompt. The wording matters: "unavailable" made the model refuse the
    // caller's own tools too.
    const chat: Record<string, unknown> = { messages: [{ role: 'user', content: 'hi' }] }
    applyFingerprint(chat, 'chat')
    const first = (chat.messages as Array<{ role?: string; content?: unknown }>)[0]
    expect(first?.role).toBe('system')
    expect(String(first?.content)).toMatch(/placeholders that do nothing/u)
    expect(String(first?.content)).not.toMatch(/unavailable/iu)

    const flat: Record<string, unknown> = {}
    applyFingerprint(flat, 'responses')
    expect(String(flat.instructions)).toMatch(/placeholders that do nothing/u)

    const claude: Record<string, unknown> = {}
    applyFingerprint(claude, 'messages')
    expect(String(claude.system)).toMatch(/placeholders that do nothing/u)
  })

  it('makes an aliased tool callable rather than merely present', () => {
    // The pass renamed the caller’s `read` to `read_client`. If the response side
    // judged the incoming call without restoring it first, the call would be
    // judged unrunnable and dropped — visible to the model, unreachable by the
    // harness. The wire is given the rename map for exactly this.
    const body: Record<string, unknown> = {
      tools: [{ type: 'function', function: { name: 'read', description: 'x' } }],
    }
    const plan = applyFingerprint(body, 'chat')
    const tools = new FreeToolWire(body.tools, plan)
    // The model calls the injected official tool.
    expect(tools.admit('c0', 'read', '{"path":"/etc"}')).toEqual([])
    expect(tools.suppressed()).toBe(true)
    // The renamed caller tool comes back under its own name, and runs.
    expect(callNames(tools.admit('c1', 'read_client', '{}', 'call_1'))).toEqual(['read'])
    expect(tools.calls()).toBe(1)
  })

  it('drops a gate call the caller cannot run', () => {
    const tools = new FreeToolWire([{ type: 'function', function: { name: 'search_docs' } }])
    expect(tools.admit('c0', 'shell', '{}')).toEqual([])
    expect(tools.calls()).toBe(0)
    // The call the caller CAN run survives.
    expect(callNames(tools.admit('c1', 'search_docs', '{}', 'call_2'))).toEqual(['search_docs'])
    expect(tools.calls()).toBe(1)
  })

  it('holds arguments that arrive before the name, then releases them', () => {
    // A provider that streams arguments before naming the block is rare but real.
    // Forwarding them optimistically would leak a dropped block's fragments.
    const tools = new FreeToolWire([{ name: 'search_docs' }])
    expect(tools.admit('c0', undefined, '{"q":')).toEqual([])
    const frames = tools.admit('c0', 'search_docs', '"cats"}', 'call_1')
    const args = frames
      .flatMap(delta => (Array.isArray(delta.tool_calls) ? delta.tool_calls : []))
      .map(call => (call as { function?: { arguments?: unknown } }).function?.arguments)
      .filter((value): value is string => typeof value === 'string')
      .join('')
    expect(args).toBe('{"q":"cats"}')
  })
})

describe('the free lane request translation', () => {
  it('reads tool definitions in both spellings', () => {
    // The Responses wire spells a tool flat; the other two nest it under
    // `function`. Reading only one shape silently drops every tool of the other
    // wire, and the turn then answers as if the model had no tools at all.
    const flat = toolDefsFor([{ type: 'function', name: 'search_docs', parameters: {} }], 'responses')
    expect(flat).toEqual([{ type: 'function', name: 'search_docs', description: '', parameters: {} }])
    const nested = toolDefsFor([{ type: 'function', function: { name: 'search_docs', parameters: {} } }], 'chat')
    expect(nested).toEqual([
      { type: 'function', function: { name: 'search_docs', description: '', parameters: {} } },
    ])
    // And the Messages wire names the schema its own way.
    expect(toolDefsFor([{ name: 'search_docs' }], 'messages')[0]).toHaveProperty('input_schema')
  })

  it('re-spells a request for the Messages wire', () => {
    const warnings: string[] = []
    const out = requestBodyFor(
      'messages',
      {
        messages: [
          { role: 'system', content: 'be brief' },
          { role: 'user', content: 'hi' },
        ],
        max_tokens: 64,
        temperature: 0.2,
      },
      { modelId: 'union-alpha', warnings },
    )
    expect(out.system).toBe('be brief')
    expect(Array.isArray(out.messages)).toBe(true)
    expect(out.max_tokens).toBe(64)
    // The field name is the wire's, not the caller's.
    expect(out.max_output_tokens).toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('re-spells a request for the Responses wire', () => {
    const warnings: string[] = []
    const out = requestBodyFor(
      'responses',
      {
        messages: [
          { role: 'system', content: 'be brief' },
          { role: 'user', content: 'hi' },
        ],
        max_tokens: 64,
      },
      { modelId: 'muse-spark-1.3-contributor-free', warnings },
    )
    expect(out.instructions).toBe('be brief')
    expect(Array.isArray(out.input)).toBe(true)
    // Same field, the other wire's name.
    expect(out.max_output_tokens).toBe(64)
    expect(out.max_tokens).toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('leaves the chat wire alone', () => {
    const warnings: string[] = []
    const body = { messages: [{ role: 'user', content: 'hi' }] }
    const out = requestBodyFor('chat', body, { modelId: 'space-bunny-free', warnings })
    // Re-encoding the chat wire risks splitting a multi-byte character at a
    // frame boundary, so its message list is passed straight through.
    expect(out.messages).toEqual(body.messages)
    expect(out.model).toBe('space-bunny-free')
  })
})

describe('the free lane stream translation', () => {
  it('passes the chat wire through', () => {
    const event = translate('chat', {
      choices: [{ delta: { content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    })
    expect(textOf(event.frames)).toBe('hello')
    expect(event.finish).toBe('stop')
    expect(event.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2 })
  })

  it('translates a Messages stream', () => {
    const tools = new FreeToolWire([{ name: 'search_docs' }])
    const start = translate('messages', {
      type: 'message_start',
      message: { usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 2 } },
    }, tools)
    // Anthropic reports cache reads separately; the chat spelling counts them as
    // prompt tokens, because the model was actually read.
    expect(start.usage?.prompt_tokens).toBe(12)

    const block = translate('messages', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text' },
    }, tools)
    expect(block.frames).toEqual([])

    const text = translate('messages', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hi' },
    }, tools)
    expect(textOf(text.frames)).toBe('hi')

    const thinking = translate('messages', {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'thinking_delta', thinking: 'hmm' },
    }, tools)
    expect(thinking.frames[0]).toEqual({ reasoning_content: 'hmm' })

    const end = translate('messages', { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }, tools)
    expect(end.finish).toBe('length')

    const stop = translate('messages', { type: 'message_stop' }, tools)
    // Its own end frame: a stream that carried it was closed on purpose, so it
    // must not read as a cut one.
    expect(stop.done).toBe(true)
    expect(stop.frames).toEqual([])
  })

  it('names a Messages tool call for the harness', () => {
    const tools = new FreeToolWire([{ name: 'search_docs' }])
    const opened = translate('messages', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', name: 'search_docs', id: 'call_1' },
    }, tools)
    expect(callNames(opened.frames)).toEqual(['search_docs'])
    const args = translate('messages', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"q":"cats"}' },
    }, tools)
    expect(tools.calls()).toBe(1)
    expect(args.frames.length).toBeGreaterThan(0)
  })

  it('reads every terminal frame of the Responses wire', () => {
    // Only reading `response.completed` made `response.incomplete` — the frame a
    // turn that hit the output ceiling ends on — look like a stream the gateway
    // cut, so a finished turn got retried and then failed.
    for (const type of ['response.completed', 'response.incomplete', 'response.failed', 'response.done']) {
      const event = translate('responses', {
        type,
        response: { status: type === 'response.incomplete' ? 'incomplete' : 'completed', usage: { input_tokens: 5, output_tokens: 1 } },
      })
      expect(event.done, `${type} must end the turn`).toBe(true)
    }
    const incomplete = translate('responses', {
      type: 'response.incomplete',
      response: { status: 'incomplete', usage: { input_tokens: 5, output_tokens: 1 } },
    })
    // Hit the ceiling: reported as such, not as a clean stop.
    expect(incomplete.finish).toBe('length')
    expect(incomplete.usage?.prompt_tokens).toBe(5)
  })

  it('translates Responses text, reasoning and tool calls', () => {
    const tools = new FreeToolWire([{ name: 'search_docs' }])
    const text = translate('responses', { type: 'response.output_text.delta', delta: 'hi' }, tools)
    expect(textOf(text.frames)).toBe('hi')

    const reasoning = translate('responses', { type: 'response.reasoning_summary_text.delta', delta: 'hmm' }, tools)
    expect(reasoning.frames[0]).toEqual({ reasoning_content: 'hmm' })

    const opened = translate('responses', {
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', name: 'search_docs', call_id: 'call_1' },
    }, tools)
    expect(callNames(opened.frames)).toEqual(['search_docs'])

    const args = translate('responses', {
      type: 'response.function_call_arguments.delta',
      output_index: 0,
      delta: '{"q":"cats"}',
    }, tools)
    expect(args.frames.length).toBeGreaterThan(0)
    expect(tools.calls()).toBe(1)
  })

  it('takes reasoning from whichever field the gateway used', () => {
    // Four spellings exist in the wild. Taking the first non-empty one avoids
    // double-counting a thought that arrives under two names.
    for (const field of ['reasoning', 'reasoning_content', 'reasoning_text', 'thinking']) {
      const event = translate('chat', { choices: [{ delta: { [field]: 'hmm' } }] })
      expect(event.frames[0], `${field} must be read`).toEqual({ reasoning_content: 'hmm' })
    }
  })
})

describe('the free lane transport', () => {
  interface Seen {
    method: string
    url: string
    headers: Record<string, unknown>
    body: string
  }

  /**
   * Serve one scripted answer from loopback.
   *
   * The module's own transport reads its base URL once at import, so pointing the
   * suite at a random port would need an import hook. The transport already
   * carries a seam for exactly this, so the seam is what routes the request — and
   * the request it forwards is a real one over a real socket, so the bytes under
   * test are the bytes the gateway would receive.
   */
  async function withGateway(
    answers: { listing?: string; turn: { status?: number; headers?: Record<string, string>; body: string } },
    run: (seen: Seen[]) => Promise<void>,
  ): Promise<void> {
    const seen: Seen[] = []
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk as Buffer))
      req.on('end', () => {
        seen.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers as Record<string, unknown>,
          body: Buffer.concat(chunks).toString('utf8'),
        })
        if (req.url?.includes('/models')) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(answers.listing ?? '{"data":[{"id":"space-bunny-free"}]}')
          return
        }
        res.writeHead(answers.turn.status ?? 200, {
          'content-type': 'text/event-stream',
          ...(answers.turn.headers ?? {}),
        })
        res.end(answers.turn.body)
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    const previous = freeLane.fetch
    freeLane.fetch = {
      fetch: async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
        const target = new URL(url)
        return httpRequest(
          {
            hostname: '127.0.0.1',
            port,
            path: `${target.pathname}${target.search}`,
            method: init.method ?? 'GET',
            headers: init.headers ?? {},
          },
          init.body,
        )
      },
    }
    try {
      await run(seen)
    } finally {
      freeLane.fetch = previous
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }

  /** One loopback request, answered as a WHATWG `Response`. */
  function httpRequest(
    options: {
      hostname: string
      port: number
      path: string
      method: string
      headers: Record<string, string>
    },
    body: string | undefined,
  ): Promise<Response> {
    return new Promise((resolve, reject) => {
      const request = http.request(options, response => {
        const chunks: Buffer[] = []
        response.on('data', chunk => chunks.push(chunk as Buffer))
        response.on('end', () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 0,
              statusText: response.statusMessage ?? '',
              headers: response.headers as unknown as HeadersInit,
            }),
          )
        })
      })
      request.on('error', reject)
      if (body !== undefined) request.write(body, 'utf8')
      request.end()
    })
  }

  it('answers a chat-wire turn with deltas', async () => {
    const deltas: Record<string, unknown>[] = []
    let seen: Seen[] = []
    await withGateway(
      {
        turn: {
          body: [
            'data: {"choices":[{"delta":{"content":"hi"}}],"usage":{"prompt_tokens":3,"completion_tokens":2}}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
            'data: [DONE]',
            '',
          ].join('\n'),
        },
      },
      async requestLog => {
        seen = requestLog
        const result = await postFreeStreamed({
          modelId: 'space-bunny-free',
          body: { messages: [{ role: 'user', content: 'hi' }] },
          session: 'ses_0000000000000000000000000000',
          requestId: 'msg_0000000000000000000000000000',
          hooks: { onDelta: delta => deltas.push(delta) },
        })
        expect(result.status).toBe(200)
        expect(result.finishReason).toBe('stop')
        // The usage frame goes last and carries no choices, so a decoder reading
        // choices does not trip over it.
        expect(deltas[deltas.length - 1]).toEqual({
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        })
        expect(textOf(deltas)).toBe('hi')
      },
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]?.method).toBe('POST')
    // v1 spoke to `/zen/v1`; since 2026-10-14 that path answers 403 FreeTierError
    // for every free id, so the lane moved to the inference path.
    expect(seen[0]?.url).toBe('/inference/v1/chat/completions')
    // The pooled credential, on the wire, not just in the helper.
    expect(seen[0]?.headers.authorization).toBe('Bearer public')
    expect(seen[0]?.headers['x-opencode-session']).toBe('ses_0000000000000000000000000000')
    expect(JSON.parse(seen[0]?.body ?? '{}')).toMatchObject({ model: 'space-bunny-free', stream: true })
  }, SLOW)

  it('says the free quota is counted per conversation, not per lane', async () => {
    /*
      The gateway's own sentence is "the provider asked to wait 74558s" — twenty
      hours, which reads as a ban on the whole free tier. It is per upstream
      session, so a new conversation starts with its own budget. Without that
      clause the only sane reading of the message is "stop using the free lane".
    */
    await withGateway(
      { turn: { status: 429, headers: { 'retry-after': '74558' }, body: '{"error":{"message":"Rate limit exceeded. Please try again later."}}' } },
      async () => {
        const failure = await postFreeStreamed({
          modelId: 'space-bunny-free',
          body: { messages: [{ role: 'user', content: 'hi' }] },
          session: 'ses_0000000000000000000000000000',
          requestId: 'msg_0000000000000000000000000000',
          hooks: { onDelta: () => undefined },
        }).then(
          () => undefined,
          (error: unknown) => error,
        )
        expect(failure).toBeInstanceOf(AggregateError)
        const error = failure as AggregateError
        expect(error.kind).toBe('soft_rate')
        expect(error.message).toContain('74558s')
        expect(error.message).toContain('per conversation')
      },
    )
  }, SLOW)

  it('holds the finish reason to what the caller can run', async () => {
    const deltas: Record<string, unknown>[] = []
    await withGateway(
      {
        turn: {
          body: [
            // v2's gate tool, which nobody can run. v1's decoy was `bash`; the
            // lane declares `read` and `shell` now.
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"shell","arguments":"{}"}}]}}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
            'data: [DONE]',
            '',
          ].join('\n'),
        },
      },
      async () => {
        const result = await postFreeStreamed({
          modelId: 'space-bunny-free',
          // Only `search_docs` is declared and no plan is passed, so `shell` is a
          // decoy on the name-only rule.
          body: { messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'search_docs' }] },
          session: 'ses_0000000000000000000000000000',
          requestId: 'msg_0000000000000000000000000000',
          hooks: { onDelta: delta => deltas.push(delta) },
        })
        // The gateway reported a call nobody can run. Echoing `tool_calls` would
        // leave the turn demanding a retry forever.
        expect(result.finishReason).toBe('stop')
        expect(result.suppressedOnly).toBe(true)
        expect(callNames(deltas)).toEqual([])
      },
    )
  }, SLOW)

  it('keeps a call to a gate name the caller declared itself', async () => {
    // The opposite verdict from the test above, and the reason `injected` exists.
    // This body went through the fingerprint pass with no `read` of the caller's
    // own, so the pass INJECTED OpenCode's `read` — the call is unrunnable. Here
    // the pass KEPT the caller's `read` because its definition matched, so the
    // call is real and must be forwarded under the caller's own name.
    const caller: Record<string, unknown> = {
      tools: [fingerprintToolFor('read', 'chat')],
      messages: [{ role: 'user', content: 'hi' }],
    }
    const plan = applyFingerprint(caller, 'chat')
    expect(plan.injected).not.toContain('read')
    expect(plan.rename.size).toBe(0)

    const deltas: Record<string, unknown>[] = []
    await withGateway(
      {
        turn: {
          body: [
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read","arguments":"{}"}}]}}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
            'data: [DONE]',
            '',
          ].join('\n'),
        },
      },
      async () => {
        const result = await postFreeStreamed({
          modelId: 'space-bunny-free',
          body: caller,
          session: 'ses_0000000000000000000000000000',
          requestId: 'msg_0000000000000000000000000000',
          plan,
          hooks: { onDelta: delta => deltas.push(delta) },
        })
        expect(result.suppressedOnly).toBe(false)
        expect(result.finishReason).toBe('tool_calls')
        expect(callNames(deltas)).toEqual(['read'])
      },
    )
  }, SLOW)

  it('answers a JSON body to a stream request as a delta sequence', async () => {
    // A front proxy that mislabels a JSON body as an event stream is common.
    // Believing the header truncates real answers.
    const deltas: Record<string, unknown>[] = []
    await withGateway(
      {
        turn: {
          // Declared as text/event-stream, delivered as JSON.
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] }),
        },
      },
      async () => {
        const result = await postFreeStreamed({
          modelId: 'space-bunny-free',
          body: { messages: [{ role: 'user', content: 'hi' }] },
          session: 'ses_0000000000000000000000000000',
          requestId: 'msg_0000000000000000000000000000',
          hooks: { onDelta: delta => deltas.push(delta) },
        })
        expect(textOf(deltas)).toBe('hi')
        expect(result.finishReason).toBe('stop')
      },
    )
  }, SLOW)

  it('answers a Responses document to a stream request as a delta sequence', async () => {
    const deltas: Record<string, unknown>[] = []
    let seen: Seen[] = []
    await withGateway(
      {
        turn: {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'response',
            response: {
              status: 'completed',
              usage: { input_tokens: 4, output_tokens: 2 },
              output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }],
            },
          }),
        },
      },
      async requestLog => {
        seen = requestLog
        const result = await postFreeStreamed({
          modelId: 'muse-spark-1.3-contributor-free',
          body: { messages: [{ role: 'user', content: 'hi' }] },
          session: 'ses_0000000000000000000000000000',
          requestId: 'msg_0000000000000000000000000000',
          hooks: { onDelta: delta => deltas.push(delta) },
        })
        expect(textOf(deltas)).toBe('hi')
        expect(result.finishReason).toBe('stop')
        // The document's own usage survives the replay.
        expect(deltas[deltas.length - 1]).toHaveProperty('usage')
      },
    )
    expect(seen[0]?.url).toBe('/inference/v1/responses')
  }, SLOW)
}, SLOW)

/**
 * Run `fn` with the free lane's transport answering with a canned response.
 *
 * No loopback server here on purpose. The listing half of this file only needs
 * one response object, and building a server for it meant reaching for a helper
 * that lives inside the transport `describe` below -- a cross-scope call that
 * throws a ReferenceError the catalog's own catch swallows, so a broken stub
 * looks exactly like a working one. The seam takes a `Response`, which is all
 * `freeFetch` ever returns, and nothing outside this closure is involved.
 */
/**
 * A catalog with the lane switched ON.
 *
 * The lane defaults off (it is a shared third-party endpoint nobody asked for),
 * so every test that asserts something about the ROSTER has to say so. Using the
 * factory instead of repeating `setEnabled(true)` keeps the intent at the call
 * site: these tests are about what the lane does when it is in use.
 */
function enabledCatalog(): FreeCatalog {
  const catalog = new FreeCatalog()
  catalog.setEnabled(true)
  return catalog
}

async function withListing(
  answer: () => Response | (() => Promise<Response>),
  run: () => Promise<void>,
): Promise<void> {
  const previous = freeLane.fetch
  freeLane.fetch = {
    fetch: async () => (typeof answer === 'function' ? await answer() : answer),
  }
  try {
    await run()
  } finally {
    freeLane.fetch = previous
  }
}

/** One canned listing response, as the gateway's own JSON shape. */
function listingReply(ids: readonly string[]): Response {
  return new Response(JSON.stringify({ object: 'list', data: ids.map(id => ({ id })) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('the free lane catalog', () => {
  it('contributes NOTHING until it is switched on', () => {
    // The lane is a shared third-party endpoint with no credential of the user's
    // own, so it defaults off — it used to drop a group into the model picker
    // that nothing in the UI could remove (the "关不掉" report). `current()` is
    // the offering; the roster the page explains is still available.
    const catalog = new FreeCatalog()
    expect(catalog.enabled()).toBe(false)
    expect(catalog.current()).toEqual([])
    // …and the roster is not lost: the aggregate page still lists what it could
    // serve, which is what makes "off" a choice rather than an erasure.
    expect(catalog.allRows().length).toBeGreaterThan(0)

    catalog.setEnabled(true)
    expect(catalog.enabled()).toBe(true)
    expect(catalog.current().length).toBeGreaterThan(0)

    catalog.setEnabled(false)
    expect(catalog.current()).toEqual([])
  })

  it('tells listeners when the switch flips, so a picker updates without a poll', () => {
    const catalog = new FreeCatalog()
    let changes = 0
    const off = catalog.onChange(() => { changes += 1 })
    catalog.setEnabled(true)
    catalog.setEnabled(true) // idempotent: no second notification
    catalog.setEnabled(false)
    expect(changes).toBe(2)
    off()
  })

  it('advertises only the免密 ids, prefixed for routing', () => {
    // The prefix is what the shim routes on, so it is applied in one place.
    expect(isFreeLane('space-bunny-free')).toBe(true)
    expect(isFreeLane('union-alpha')).toBe(true)
    expect(isFreeLane('some-paid-model')).toBe(false)
    const rows = buildFreeCatalog(['space-bunny-free', 'some-paid-model', 'union-alpha', 'space-bunny-free'])
    expect(rows.map(row => row.modelId)).toEqual(['free:space-bunny-free', 'free:union-alpha'])
    // The bare id stays beside the prefixed one: the wire needs the bare name.
    expect(rows[0]?.id).toBe('space-bunny-free')
    expect(rows[0]?.name).toBe(displayModelName('space-bunny-free'))
  })

  it('reads capabilities off the model, with a baseline for unknown ids', () => {
    expect(capabilitiesFor('union-alpha').vision).toBe(true)
    // An id no table names falls back rather than claiming a window of zero,
    // which would make the picker unusable.
    const unknown = capabilitiesFor('model-nobody-has-heard-of')
    expect(unknown.contextWindow).toBeGreaterThan(0)
    expect(unknown.maxOutput).toBeGreaterThan(0)
    // Region-sensitive models answer differently depending on where the request
    // leaves from, so the row says so.
    expect(isRegionSensitive('muse-spark-1.3-contributor-free')).toBe(true)
    expect(isRegionSensitive('union-alpha')).toBe(false)
  })

  it('answers undefined rather than a guess for an id the table never names', () => {
    // The serving contract must always be answerable, so `capabilitiesFor`
    // fabricates a baseline for an id it has never seen. Anything that PRINTS a
    // window next to a real model name must not do that: a blank is a gap the
    // user can see, a made-up "128K" is a lie they cannot. So the table has a
    // second door, and it says "I don't know".
    expect(knownCapabilities('union-alpha')?.vision).toBe(true)
    expect(knownCapabilities('model-nobody-has-heard-of')).toBeUndefined()
    // Both doors agree wherever the table does have an answer, so the split is
    // about unknown ids and nothing else.
    expect(knownCapabilities('union-alpha')).toEqual(capabilitiesFor('union-alpha'))
  })

  it('starts from a static roster so an unreachable gateway still answers', () => {
    // An empty group is the one shape a user reads as "the plugin is broken".
    const catalog = enabledCatalog()
    expect(catalog.current().length).toBeGreaterThan(0)
    expect(catalog.hasRows()).toBe(true)
    expect(FALLBACK_FREE_MODEL_IDS.length).toBeGreaterThan(0)
  })

  /**
 * The regression this guards is "a failed refresh empties the picker".
 *
 * Previously this test called the real gateway and swallowed the result, so it
 * passed whether the refresh worked or failed -- it never exercised the branch
 * it was named for, and it inherited the network's latency, which is what made
 * it time out under a parallel run. Both answers are now served by a loopback
 * server, so the failure path is the one under test and the duration is ours.
 */
it('keeps its rows when a listing refresh fails', async () => {
  const catalog = enabledCatalog()
  const before = catalog.current().length
  expect(before).toBeGreaterThan(0)

  for (const reply of [
    new Response('upstream is unwell', { status: 500 }),
    // A 200 that is HTML: the gateway answering with a landing page is a real
    // failure mode, and JSON.parse has to be what rejects it.
    new Response('<!doctype html><title>not json</title>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
    new Response(JSON.stringify({ data: 'not-a-list' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ]) {
    await withListing(() => reply, async () => {
      await catalog.refresh({ session: 'ses_0000000000000000000000000000' }).catch(() => null)
      // Whatever the gateway did, the picker must still have models in it: an
      // empty group is the one shape a user reads as "the plugin is broken".
      expect(catalog.current().length).toBeGreaterThanOrEqual(1)
    })
  }
})

it('takes a working listing when one arrives, and keeps it through a later failure', async () => {
  const catalog = enabledCatalog()
  await withListing(() => listingReply(['space-bunny-free', 'union-alpha']), async () => {
    await catalog.refresh({ session: 'ses_0000000000000000000000000000' })
  })
  const live = catalog.current().map(row => row.modelId)
  // A live listing REPLACES the static roster rather than merging into it: the
  // gateway is the authority on what is free right now, and a roster kept
  // alongside it would keep offering models the upstream has already retired.
  // The static list is the offline fallback, not a second source of truth.
  expect(live).toEqual(['free:space-bunny-free', 'free:union-alpha'])
  expect(catalog.updatedAt()).toBeTruthy()
  expect(catalog.error()).toBeUndefined()

  // And a later failure must not roll any of that back to the static list.
  await withListing(() => new Response('gone', { status: 503 }), async () => {
    await catalog.refresh({ session: 'ses_0000000000000000000000000000' }).catch(() => null)
  })
  expect(catalog.current().map(row => row.modelId)).toEqual(live)
  expect(catalog.error()).toBeTruthy()
})

it('records why a refresh failed, without clearing the rows it already had', async () => {
  const catalog = enabledCatalog()
  const before = catalog.current().length
  await withListing(() => new Response('gone', { status: 503 }), async () => {
    await catalog.refresh({ session: 'ses_0000000000000000000000000000' }).catch(() => null)
  })
  expect(catalog.current().length).toBe(before)
  // The error is kept so the page can say why the numbers may be stale, rather
  // than silently showing a roster nobody can verify.
  expect(catalog.error()).toBeTruthy()
})
})