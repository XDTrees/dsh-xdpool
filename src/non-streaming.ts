/**
 * Reassemble a streamed turn into one `chat.completion` document.
 *
 * The pool lane (and every other lane that buffers before answering) asks the
 * upstream for SSE and forwards it; it cannot ask for JSON because
 * `prepareChatBody` forces streaming. A caller that sent `stream: false`
 * therefore used to receive `text/event-stream` anyway, and an OpenAI client
 * parsing that body as JSON failed with `Unexpected token 'd'`.
 *
 * The channel lane already honours the flag (see `serveChannelCompletion`). This
 * module gives the other lanes the same behaviour without touching their wire
 * contract when the caller did NOT ask for it: `wantsNonStreaming` is true only
 * for an explicit `stream: false`, so an absent flag keeps today's SSE reply.
 *
 * @module dsh-xdpool/non-streaming
 */
import { randomBytes } from 'node:crypto'
import { parseUsage } from './stats.ts'

/**
 * True only when the caller asked for JSON by saying so.
 *
 * `stream` absent must stay streaming: the Harness omits the flag and reads
 * SSE, and a missing field silently means "false" to plenty of JSON parsers —
 * honouring that reading would break every existing client.
 */
export function wantsNonStreaming(raw: string): boolean {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return false
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false
  return (body as Record<string, unknown>)['stream'] === false
}

/** One assistant turn accumulated from SSE deltas, ready to spell as a message. */
export interface TurnAccumulator {
  id: string
  created: number
  model: string
  text: string
  reasoning: string
  /** Sparse by index, exactly as the upstream numbers its tool-call slots. */
  toolCalls: (Record<string, unknown> | undefined)[]
  /** Usage in the panel's shape; kept only to feed the tracker. */
  usage: ReturnType<typeof parseUsage>
  /** Usage exactly as the upstream sent it, which is what a client expects. */
  rawUsage: unknown
  finish: string
}

export function createTurnAccumulator(modelId?: string): TurnAccumulator {
  return {
    id: `chatcmpl-xdpool-${randomBytes(6).toString('base64url')}`,
    created: Math.floor(Date.now() / 1000),
    model: modelId ?? '',
    text: '',
    reasoning: '',
    toolCalls: [],
    usage: undefined,
    rawUsage: undefined,
    finish: 'stop',
  }
}

/**
 * Merge one tool-call fragment into its slot.
 *
 * The upstream streams a call as an opening fragment carrying `name` and then
 * argument deltas that do NOT: a plain spread would erase the name on the
 * second fragment and leave the caller with `tool_calls[0].function.name ===
 * undefined`. An empty or missing name therefore means "no opinion here", never
 * "clear what you have".
 */
export function mergeTurnToolCall(
  existing: Record<string, unknown>,
  fragment: Record<string, unknown>,
): Record<string, unknown> {
  const before = (existing['function'] ?? {}) as Record<string, unknown>
  const next = (fragment['function'] ?? {}) as Record<string, unknown>
  const name = typeof next['name'] === 'string' && next['name'] !== '' ? next['name'] : before['name']
  const merged: Record<string, unknown> = {
    ...existing,
    ...fragment,
    function: {
      ...before,
      ...next,
      ...(name === undefined ? {} : { name }),
      arguments: `${String(before['arguments'] ?? '')}${String(next['arguments'] ?? '')}`,
    },
  }
  if (typeof fragment['id'] === 'string' && fragment['id'] !== '') merged['id'] = fragment['id']
  else if (typeof existing['id'] === 'string') merged['id'] = existing['id']
  return merged
}

/** Merge one delta/message object (content, reasoning, tool calls) into the turn. */
function absorbDelta(turn: TurnAccumulator, delta: Record<string, unknown>): void {
  if (typeof delta['content'] === 'string') turn.text += delta['content']
  const reasoning = delta['reasoning_content'] ?? delta['reasoning']
  if (typeof reasoning === 'string') turn.reasoning += reasoning
  const calls = delta['tool_calls']
  if (!Array.isArray(calls)) return
  for (const call of calls as unknown[]) {
    if (typeof call !== 'object' || call === null) continue
    const fragment = call as Record<string, unknown>
    const index = Number(fragment['index'] ?? turn.toolCalls.length)
    const slot = Number.isInteger(index) && index >= 0 ? index : turn.toolCalls.length
    turn.toolCalls[slot] = mergeTurnToolCall(turn.toolCalls[slot] ?? {}, fragment)
  }
}

/**
 * Fold one SSE `data:` payload into the accumulator.
 *
 * Reads the same three shapes the forwarding path already tolerates upstream:
 * OpenAI `choices[].delta`, a non-streaming `choices[].message`, and the
 * gateway's `data.content` wrapper.
 */
export function foldPayload(turn: TurnAccumulator, payload: string): void {
  if (payload === '' || payload === '[DONE]') return
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
  const frame = parsed as Record<string, unknown>
  const usage = parseUsage(frame['usage'])
  if (usage !== undefined) {
    turn.usage = usage
    // A client wants the upstream's own document; `turn.usage` is only the
    // panel's normalised view of it.
    turn.rawUsage = frame['usage']
  }
  const choices = frame['choices']
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0]
    if (typeof choice === 'object' && choice !== null) {
      const entry = choice as Record<string, unknown>
      const delta = entry['delta']
      if (typeof delta === 'object' && delta !== null) absorbDelta(turn, delta as Record<string, unknown>)
      const message = entry['message']
      if (typeof message === 'object' && message !== null) absorbDelta(turn, message as Record<string, unknown>)
      const reason = entry['finish_reason']
      if (typeof reason === 'string' && reason !== '') turn.finish = reason
    }
  }
  const wrapper = frame['data']
  if (typeof wrapper === 'object' && wrapper !== null) {
    const content = (wrapper as Record<string, unknown>)['content']
    if (typeof content === 'string') turn.text += content
    const reason = (wrapper as Record<string, unknown>)['finish_reason']
    if (typeof reason === 'string' && reason !== '') turn.finish = reason
  }
}

/** Spell the accumulated turn as one non-streaming `chat.completion` document. */
export function turnToCompletion(turn: TurnAccumulator): Record<string, unknown> {
  const calls = turn.toolCalls.filter((call): call is Record<string, unknown> => call !== undefined)
  return {
    id: turn.id,
    object: 'chat.completion',
    created: turn.created,
    model: turn.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          // A turn that only called tools has no text, and `null` is what the
          // OpenAI schema says for it — an empty string would read as an answer
          // that happened to be blank.
          content: turn.text === '' && calls.length > 0 ? null : turn.text,
          ...(turn.reasoning === '' ? {} : { reasoning_content: turn.reasoning }),
          ...(calls.length === 0 ? {} : { tool_calls: calls }),
        },
        finish_reason: turn.finish,
      },
    ],
    ...(turn.rawUsage === undefined ? {} : { usage: turn.rawUsage }),
  }
}

/**
 * Split a growing text buffer into complete SSE `data:` payloads.
 *
 * A frame's own blank line is the only reliable boundary — JSON can contain
 * anything, but it cannot contain an unescaped newline — so nothing is parsed
 * out of a partial frame.
 */
export function drainSsePayloads(buffer: Buffer): { payloads: string[]; rest: Buffer } {
  const payloads: string[] = []
  let rest = buffer
  for (;;) {
    const span = sseFrameSpan(rest)
    if (span === undefined) break
    const frame = rest.subarray(0, span.contentEnd).toString('utf8')
    rest = rest.subarray(span.frameEnd)
    for (const line of frame.split(/\r?\n/u)) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      payloads.push(trimmed.slice(5).trim())
    }
  }
  return { payloads, rest }
}

/**
 * Where one SSE frame ends inside a buffer.
 *
 * Both offsets come back because a frame's CONTENT ends before its SEPARATOR
 * does. This is the same rule `frameSpan` in `shim.ts` applies; it lives here
 * too so the reassembler does not have to reach into the shim's closure.
 */
function sseFrameSpan(buf: Buffer): { contentEnd: number; frameEnd: number } | undefined {
  const bare = buf.indexOf('\n\n')
  const crlf = buf.indexOf('\r\n\r\n')
  if (bare === -1 && crlf === -1) return undefined
  if (crlf !== -1 && (bare === -1 || crlf < bare)) return { contentEnd: crlf, frameEnd: crlf + 4 }
  return { contentEnd: bare, frameEnd: bare + 2 }
}

/**
 * Fold a buffered lane's frames into the one document `stream: false` asked for.
 *
 * The buffering lanes (aggregate, free/co-paid extras, chain members) already
 * hold their whole answer before writing, so honouring the flag there costs one
 * pass and no wire change for streaming callers.
 */
export function bufferedFramesToCompletion(
  frames: readonly string[],
  modelId: string,
): Record<string, unknown> {
  const turn = createTurnAccumulator(modelId)
  for (const payload of frames) foldPayload(turn, payload)
  return turnToCompletion(turn)
}
