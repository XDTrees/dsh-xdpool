/**
 * Message and frame translation between the OpenAI chat wire the plugin speaks
 * downstream and the three wires the免密 free gateway serves upstream.
 *
 * Downstream there is ONE wire. The pool, the third-party aggregate and the
 * co-paid lane all answer OpenAI chat completions, so the harness adapter is
 * configured once with `openAICompletionsApi()` and this file never has to be
 * reached from there. Upstream there are THREE: `/chat/completions`,
 * `/responses` and `/messages`, chosen per model. Everything about that
 * asymmetry lives here — request bodies go chat to responses/messages, and
 * answers come back responses/messages to chat.
 *
 * WHAT IS NOT IN HERE
 *
 * Images. A harness image arrives as an attachment descriptor, and turning one
 * into bytes the gateway can read is the adapter's job (it owns the attachment
 * plane). When no resolver is supplied an image block is dropped and a warning
 * is recorded, because silently forwarding a placeholder URL would make the
 * model answer about a picture it never saw. Everything else — text, tool
 * calls, tool results, reasoning — round-trips.
 *
 * The tool-call index mapping is the subtle part. Anthropic addresses blocks by
 * position in one flat array and Responses by output item, while OpenAI clients
 * expect a per-request sequential index, and a block may stream its argument
 * fragments BEFORE it names itself. So a block is classified the moment it names
 * itself, its argument fragments are held until then, and a held block whose
 * verdict turns out to be "not executable" is dropped instead of handed to a
 * client that cannot run it.
 *
 * @module src/free-messages
 */

/** The wire shapes this file translates between. */
export type FreeWire = 'chat' | 'responses' | 'messages'

/** Upstream refuses a longer tool name. */
export const MAX_TOOL_NAME_LEN = 128

/** Media types an image block may arrive as. */
const IMAGE_MEDIA = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** Resolves a harness attachment descriptor to a URL the gateway can fetch. */
export type ImageResolver = (image: {
  mimeType?: string
  data?: string
  path?: string
  url?: string
}) => string | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** The text of a block list, in order. */
function textOf(blocks: unknown[]): string {
  let out = ''
  for (const block of blocks) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') out += block.text
  }
  return out
}

/** A content value as a block list; a bare string is one text block. */
function blocksOf(content: unknown): Record<string, unknown>[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []
  const out: Record<string, unknown>[] = []
  for (const block of content) {
    if (isRecord(block)) out.push(block)
    else if (typeof block === 'string' && block !== '') out.push({ type: 'text', text: block })
  }
  return out
}

/**
 * Is this block an image, in any of the three wire spellings?
 *
 * The type tag alone is not enough: pi-ai's chat wire emits
 * `{type:'image_url', image_url:{url}}` while the harness's own blocks use
 * `{type:'image', …}`, and a body that already crossed a translation boundary
 * carries `{type:'input_image', image_url:'…'}`. A block that carries a usable
 * URL under any of them is an image, so the URL decides and the tag only
 * disqualifies an obviously non-image block.
 */
function isImageBlock(block: Record<string, unknown>): boolean {
  const type = text(block.type)
  if (type === 'image' || type === 'image_url' || type === 'input_image' || type === 'input_image_url') return true
  if (type !== '') return false
  const nested = block.image_url
  const candidate = typeof nested === 'string'
    ? nested
    : text(block.url ?? block.data ?? (isRecord(nested) ? nested.url : undefined))
  return candidate.startsWith('data:') || candidate.startsWith('http://') || candidate.startsWith('https://')
}

/**
 * The image URL one block can be read at, or undefined.
 *
 * Three spellings are accepted because the block's origin decides its shape:
 * pi-ai's chat wire sends `{type:'image_url', image_url:{url}}`, the harness's
 * own content blocks carry `{type:'image', url|path|data}`, and an already
 * translated Responses block carries `{type:'input_image', image_url:'…'}`.
 *
 * A data URL is passed through untouched. Anything the gateway cannot fetch —
 * a bare filesystem path the model shares no machine with — is dropped and
 * recorded, because forwarding a placeholder would make the model answer about a
 * picture it never saw, which is worse than admitting the image was lost.
 */
function imageUrlOf(block: Record<string, unknown>, resolveImage: ImageResolver | undefined, warnings: string[]): string | undefined {
  if (resolveImage !== undefined) {
    const resolved = resolveImage({
      ...(typeof block.mimeType === 'string' ? { mimeType: block.mimeType } : {}),
      ...(typeof block.data === 'string' ? { data: block.data } : {}),
      ...(typeof block.path === 'string' ? { path: block.path } : {}),
      ...(typeof block.url === 'string' ? { url: block.url } : {}),
    })
    if (resolved !== undefined && resolved !== '') return resolved
  }
  const nested = block.image_url
  const direct = typeof nested === 'string'
    ? nested
    : text(block.url ?? block.data ?? (isRecord(nested) ? nested.url : undefined))
  if (direct.startsWith('data:')) return direct
  if (direct.startsWith('http://') || direct.startsWith('https://')) return direct
  warnings.push('image-dropped')
  return undefined
}

/** One tool result carried by a message, in the caller's own spelling. */
interface ToolResult {
  callId: string
  content: Record<string, unknown>[]
  /** The call failed, per the caller. Carried to wires that can express it. */
  failed?: boolean
}

/**
 * Drop tool calls nobody answered, and tool results nobody called.
 *
 * Every wire spells tool traffic as a PAIR: an assistant `tool_calls` entry with
 * an id, and a `role: 'tool'` message answering that same id. Upstream rejects a
 * conversation that breaks the pairing — and it rejects it EVERY TURN from then
 * on, because the offending messages stay in the history. A single interrupted
 * turn therefore makes a session permanently unusable, which is exactly what
 * users report as "this conversation broke and won't come back".
 *
 * Three shapes are repaired, all by DROPPING rather than inventing:
 *
 *   1. a `tool_calls` entry with no answer — the model called a tool, the turn
 *      was interrupted, and the result never arrived. Keeping the call and
 *      fabricating an answer would teach the model a lie; dropping the call
 *      leaves the assistant text intact and the conversation legible.
 *   2. a `tool` message whose id answers no call — the call was pruned in an
 *      earlier turn, or the result outlived its call.
 *   3. a `tool_calls` entry with an EMPTY name — it is "answered" by any result
 *      but cannot be replayed: upstream validates the name. Responding side is
 *      already safe (an unknown name is held back rather than streamed), but the
 *      HISTORY would otherwise keep shipping it.
 *
 * Dropping is safe here only because the alternative is a hard 400 that kills
 * every subsequent turn. It is reported through `warnings` so the drop is not
 * silent — the same channel the request body already uses for other repairs.
 */
function repairToolPairing(
  messages: Record<string, unknown>[],
  warnings: string[],
): Record<string, unknown>[] {
  // Which ids does the history actually call, and which does it answer?
  const called = new Set<string>()
  const answered = new Set<string>()
  for (const message of messages) {
    for (const call of toolCallsOf(message)) {
      if (call.id !== '' && call.name !== '') called.add(call.id)
    }
    for (const result of toolResultsOf(message)) {
      if (result.callId !== '') answered.add(result.callId)
    }
  }

  let droppedCalls = 0
  let droppedResults = 0
  const out: Record<string, unknown>[] = []
  for (const message of messages) {
    if (message.role === 'tool') {
      const id = text(message.tool_call_id ?? message.toolCallId ?? message.id)
      // Keep a result only when a call exists for it. An id-less result is kept:
      // some callers omit it and upstream accepts the message positionally.
      if (id !== '' && !called.has(id)) {
        droppedResults += 1
        continue
      }
      out.push(message)
      continue
    }
    const calls = toolCallsOf(message)
    if (calls.length === 0) {
      out.push(message)
      continue
    }
    const kept = calls.filter(call => call.id !== '' && call.name !== '' && answered.has(call.id))
    if (kept.length === calls.length) {
      out.push(message)
      continue
    }
    droppedCalls += calls.length - kept.length
    if (kept.length === 0) {
      // The turn held nothing but unanswered calls. Its text (if any) is still
      // worth keeping — that is the assistant's own words, not a tool record.
      const body = textOf(blocksOf(message.content))
      if (body === '') continue
      const stripped = { ...message }
      delete stripped.tool_calls
      delete stripped.toolCalls
      out.push(stripped)
      continue
    }
    out.push({ ...message, tool_calls: kept })
  }

  if (droppedCalls > 0) {
    warnings.push(`${String(droppedCalls)} unanswered tool call(s) were dropped so the conversation can continue`)
  }
  if (droppedResults > 0) {
    warnings.push(`${String(droppedResults)} orphaned tool result(s) were dropped so the conversation can continue`)
  }
  return out
}

/**
 * Every tool result a message carries, in order.
 *
 * The `role: 'tool'` case is the one that was silent and expensive: DSH's own
 * tool messages carry the RESULT as their content — there is no `tool-result`
 * block wrapper to find. Filtering for that wrapper therefore returned `[]`, and
 * the call sites skip a tool message with no results (`continue`), so the whole
 * result vanished from all three wires. The model then saw a conversation in
 * which it had called a tool and never learned the outcome, and re-issued the
 * same call forever — reported as "the tool returned no result" (#113).
 *
 * So: a tool message's content IS the result. Only a non-tool message is
 * searched for the wrapper blocks (that is the Anthropic-shaped spelling, where
 * a `user` turn can carry `tool-result` blocks).
 */
function toolResultsOf(message: Record<string, unknown>): ToolResult[] {
  if (message.role === 'tool') {
    const callId = text(message.tool_call_id ?? message.toolCallId ?? message.id)
    const blocks = blocksOf(message.content)
    const content = blocks.length > 0
      ? blocks
      : [{ type: 'text', text: typeof message.content === 'string' ? message.content : '' }]
    const failed = message.is_error === true || message.isError === true
    return [{ callId, content, ...failed ? { failed: true } : {} }]
  }
  const blocks = blocksOf(message.content).filter(block => block.type === 'tool-result')
  if (blocks.length === 0) return []
  const callId = text(message.tool_call_id ?? message.toolCallId ?? message.id)
  return [{ callId, content: blocks }]
}

/** The tool call a message's `tool_calls` array holds, when it holds one. */
function toolCallsOf(message: Record<string, unknown>): { id: string; name: string; arguments: string }[] {
  const calls = message.tool_calls ?? message.toolCalls
  if (!Array.isArray(calls)) return []
  const out: { id: string; name: string; arguments: string }[] = []
  for (const raw of calls) {
    if (!isRecord(raw)) continue
    const fn = isRecord(raw.function) ? raw.function : {}
    out.push({
      id: text(raw.id),
      name: text(fn.name ?? raw.name),
      arguments: typeof fn.arguments === 'string' ? fn.arguments : typeof raw.arguments === 'string' ? raw.arguments : '{}',
    })
  }
  return out
}

/** Harness tool schemas into the shape each upstream wire expects. */
export function toolDefsFor(tools: unknown, wire: FreeWire): Record<string, unknown>[] {
  if (!Array.isArray(tools)) return []
  const out: Record<string, unknown>[] = []
  for (const raw of tools) {
    if (!isRecord(raw)) continue
    // Both spellings must work: the harness hands over flat `{name, description,
    // parameters}` defs, while anything already speaking OpenAI re-feeds
    // `{type:'function', function:{…}}`. Reading only one spelling silently
    // strips every tool off the request.
    const fn = isRecord(raw.function) ? raw.function : raw
    const name = text(fn.name).trim()
    if (name === '') continue
    const parameters = isRecord(fn.parameters) ? fn.parameters : { type: 'object', properties: {} }
    const description = typeof fn.description === 'string' ? fn.description : ''
    const clipped = name.slice(0, MAX_TOOL_NAME_LEN)
    if (wire === 'messages') out.push({ name: clipped, description, input_schema: parameters })
    else if (wire === 'responses') out.push({ type: 'function', name: clipped, description, parameters })
    else out.push({ type: 'function', function: { name: clipped, description, parameters } })
  }
  return out
}

/**
 * The request body one upstream wire expects.
 *
 * The caller's `stream`, `model` and `tools` are honoured; the message list is
 * re-spelled. Fields the gateway does not know are dropped rather than forwarded,
 * because an unknown field on the Responses or Messages wire is a 400 and the
 * user would be reading an error about a parameter the plugin invented.
 */
export function requestBodyFor(
  wire: FreeWire,
  body: Record<string, unknown>,
  options: { modelId: string; resolveImage?: ImageResolver | undefined; warnings: string[] },
): Record<string, unknown> {
  const { modelId, resolveImage, warnings } = options
  const messages = repairToolPairing(Array.isArray(body.messages) ? body.messages.filter(isRecord) : [], warnings)
  const stream = body.stream === true
  const reasoningEffort = text(body.reasoning_effort)
  const out: Record<string, unknown> = { model: modelId, stream }
  if (reasoningEffort !== '') out.reasoning_effort = reasoningEffort
  const maxTokens = body.max_tokens ?? body.max_completion_tokens
  if (typeof maxTokens === 'number') {
    if (wire === 'responses') out.max_output_tokens = maxTokens
    else if (wire === 'messages') out.max_tokens = maxTokens
    else out.max_tokens = maxTokens
  }
  const temperature = body.temperature
  if (typeof temperature === 'number') out.temperature = temperature
  const topP = body.top_p
  if (typeof topP === 'number') out.top_p = topP
  const stop = body.stop ?? body.stop_sequences
  if (typeof stop === 'string' && stop !== '') {
    if (wire === 'responses') out.stop = stop
    else out.stop = stop
  } else if (Array.isArray(stop) && stop.length > 0 && stop.every(entry => typeof entry === 'string')) {
    if (wire === 'responses') out.stop = stop
    else out.stop = stop
  }
  const tools = toolDefsFor(body.tools, wire)
  if (tools.length > 0) {
    out.tools = tools
    const choice = body.tool_choice
    if (typeof choice === 'string' && choice !== '') out.tool_choice = choice
    else if (isRecord(choice) && text(choice.type) !== '') out.tool_choice = choice.type === 'function' ? { name: text(choice.function === undefined ? undefined : (choice.function as Record<string, unknown>).name) } : choice
  }
  if (wire === 'chat') {
    out.messages = messages
    return out
  }
  if (wire === 'responses') {
    out.input = responsesInput(messages, resolveImage, warnings)
    const system = systemTextOf(messages)
    if (system !== '') out.instructions = system
    return out
  }
  const { system, turns } = claudeTurns(messages, resolveImage, warnings)
  if (system !== '') out.system = system
  out.messages = turns
  return out
}

/** The concatenated system/developer text of a message list. */
function systemTextOf(messages: Record<string, unknown>[]): string {
  let out = ''
  for (const message of messages) {
    const role = text(message.role)
    if (role !== 'system' && role !== 'developer') continue
    const body = textOf(blocksOf(message.content))
    if (body === '') continue
    out += out === '' ? body : `\n\n${body}`
  }
  return out
}

/** The Responses input list: a flat array of messages and calls. */
function responsesInput(
  messages: Record<string, unknown>[],
  resolveImage: ImageResolver | undefined,
  warnings: string[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const followUp: Record<string, unknown>[] = []
  const flush = (): void => {
    if (followUp.length === 0) return
    out.push({ type: 'message', role: 'user', content: followUp.splice(0) })
  }
  for (const message of messages) {
    const results = toolResultsOf(message)
    if (results.length === 0) flush()
    for (const result of results) {
      const images: Record<string, unknown>[] = []
      for (const block of result.content) {
        if (!isImageBlock(block)) continue
        const url = imageUrlOf(block, resolveImage, warnings)
        if (url !== undefined) images.push({ type: 'input_image', image_url: url })
      }
      const body = textOf(result.content)
      out.push({
        type: 'function_call_output',
        call_id: result.callId,
        // `output` is text on this wire, so a returned image has to travel as the
        // user item after it rather than being dropped on the floor.
        output: body !== '' ? body : images.length > 0 ? '(see attached image)' : '(no output)',
      })
      if (images.length > 0) {
        followUp.push(
          { type: 'input_text', text: `The result of tool call ${result.callId} is ${images.length} image(s), attached below.` },
          ...images,
        )
      }
    }
    const role = text(message.role)
    if (role === 'tool') continue
    if (role === 'system' || role === 'developer') {
      const body = textOf(blocksOf(message.content))
      if (body !== '') out.push({ type: 'message', role: 'system', content: [{ type: 'input_text', text: body }] })
      continue
    }
    if (role === 'assistant') {
      const body = textOf(blocksOf(message.content))
      if (body !== '') out.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: body }] })
      for (const call of toolCallsOf(message)) {
        out.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments })
      }
      continue
    }
    const parts: Record<string, unknown>[] = []
    for (const block of blocksOf(message.content)) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text !== '') {
        parts.push({ type: 'input_text', text: block.text })
        continue
      }
      if (isImageBlock(block)) {
        const url = imageUrlOf(block, resolveImage, warnings)
        if (url !== undefined) parts.push({ type: 'input_image', image_url: url })
      }
    }
    if (parts.length === 0) continue
    // A user turn that answers a tool result belongs AFTER that result, or the
    // wire rejects a function call with no output before it.
    if (results.length > 0) followUp.push(...parts)
    else out.push({ type: 'message', role: 'user', content: parts })
  }
  flush()
  // Reasoning items from earlier turns carry encrypted content only the issuing
  // account can open, and the pooled credential rotates accounts, so echoing
  // them back is a guaranteed 400. They are dropped here by construction.
  return out
}

/** The Anthropic turn list plus the system prompt, from a chat message list. */
function claudeTurns(
  messages: Record<string, unknown>[],
  resolveImage: ImageResolver | undefined,
  warnings: string[],
): { system: string; turns: Record<string, unknown>[] } {
  const system = systemTextOf(messages)
  const turns: Record<string, unknown>[] = []
  for (const message of messages) {
    const role = text(message.role)
    if (role === 'system' || role === 'developer') continue
    for (const result of toolResultsOf(message)) {
      const content: Record<string, unknown>[] = []
      for (const block of result.content) {
        if (!isImageBlock(block)) continue
        const url = imageUrlOf(block, resolveImage, warnings)
        if (url !== undefined) content.push(claudeImage(url))
      }
      const body = textOf(result.content)
      turns.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: result.callId,
            content: body !== '' ? body : content.length > 0 ? content : '(no output)',
            // A failed call must be marked as failed. Passed through only when
            // the caller said so: an `is_error: false` on every result is noise,
            // and some upstreams treat the presence of the field as the signal.
            ...result.failed === true ? { is_error: true } : {},
          },
        ],
      })
    }
    if (role === 'tool') continue
    if (role === 'assistant') {
      const content: Record<string, unknown>[] = []
      const body = textOf(blocksOf(message.content))
      if (body !== '') content.push({ type: 'text', text: body })
      for (const call of toolCallsOf(message)) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: safeJson(call.arguments) })
      }
      if (content.length > 0) turns.push({ role: 'assistant', content })
      continue
    }
    const content: Record<string, unknown>[] = []
    for (const block of blocksOf(message.content)) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text !== '') {
        content.push({ type: 'text', text: block.text })
        continue
      }
      if (isImageBlock(block)) {
        const url = imageUrlOf(block, resolveImage, warnings)
        if (url !== undefined) content.push(claudeImage(url))
      }
    }
    if (content.length > 0) turns.push({ role: 'user', content })
  }
  return { system, turns }
}

/** Parse a tool argument string, so a malformed one cannot 400 the turn. */
function safeJson(value: string): unknown {
  try {
    return JSON.parse(value === '' ? '{}' : value) as unknown
  } catch {
    return {}
  }
}

/** The Anthropic shape for one image URL. */
function claudeImage(url: string): Record<string, unknown> {
  const matched = /^data:([^;,]+)/.exec(url)
  if (matched === null) return { type: 'image', source: { type: 'url', url } }
  return {
    type: 'image',
    source: { type: 'base64', media_type: matched[1] ?? 'image/png', data: url.slice(url.indexOf(',') + 1) },
  }
}

/**
 * What the fingerprint pass did to a request's tool list, so the response side
 * can undo exactly that much.
 *
 * Both halves are needed and neither can be derived from the other. The sent
 * tool list says WHICH names went out and the caller's list says what they were
 * called before, but only this record says which of those names are the gate's
 * own decoys: `read` is in the sent list both when the gate declared it and when
 * the caller declared OpenCode's real `read`, and the two calls are opposite in
 * whether anyone can run them.
 *
 * Produced by `applyFingerprint` in `free-upstream.ts`; declared here because
 * the wire that consumes it lives in this module.
 */
export interface FingerprintPlan {
  /** Sent spelling to caller spelling, for tools the pass renamed. */
  readonly rename: Map<string, string>
  /** Gate names the pass added because the caller declared no tool of that name. */
  readonly injected: readonly string[]
}

/**
 * Admit and translate one stream's tool calls.
 *
 * A block is classified the moment it NAMES itself. Until then its argument
 * fragments are held, because a provider that streams arguments before the name
 * is rare but real, and forwarding them optimistically would leak a dropped
 * block's fragments to a client that cannot run the call.
 */
export class FreeToolWire {
  private readonly declared: Set<string>
  /** Gate tool names the fingerprint pass had to inject; nobody can run those. */
  private readonly injected: Set<string>
  private readonly slots = new Map<string, number>()
  private readonly verdicts = new Map<string, boolean>()
  private readonly held = new Map<string, { id: string; args: string[] }>()
  private readonly rename: Map<string, string>
  private survivedCalls = 0
  private next = 0

  /**
   * @param tools - the tool list as it went OUT (fingerprint pass applied)
   * @param plan - what that pass did: renames, and which gate names it had to
   *   inject because the caller declared no tool of that name
   */
  constructor(tools: unknown, plan?: FingerprintPlan) {
    this.declared = new Set<string>()
    this.rename = plan?.rename ?? new Map<string, string>()
    this.injected = new Set(plan?.injected ?? [])
    if (!Array.isArray(tools)) return
    for (const raw of tools) {
      const name = toolNameOf(raw)
      if (name !== '') this.declared.add(name)
    }
  }

  /**
   * Is the tool the gateway NAMED one the caller can actually execute?
   *
   * Judged on the sent spelling, before it is restored: under v2 a caller's own
   * `read` never goes out under that name (the fingerprint pass renamed it to
   * `read_client`), so any surviving `read`/`shell` is the gate's own tool. The
   * model calls those — it was observed calling `read` to answer "what files are
   * in /etc" — and nobody can run them, so they are dropped and the turn is not
   * left ending on a tool the caller cannot execute.
   *
   * `injected` is the list the fingerprint pass actually added. It matters: when
   * the caller declares OpenCode's REAL `read`, that name is not injected and the
   * call is executable. Older callers that pass nothing get the name-only rule.
   */
  executable(sent: string): boolean {
    if (this.injected.size > 0) return !this.injected.has(sent)
    return !(FINGERPRINT_TOOLS.includes(sent) && !this.declared.has(sent))
  }

  /** How many calls survived the decoy filter, for the turn's finish reason. */
  calls(): number {
    return this.survivedCalls
  }

  /** The per-request sequential index for a wire block. */
  indexOf(key: string): number {
    const known = this.slots.get(key)
    if (known !== undefined) return known
    const assigned = this.next
    this.next += 1
    this.slots.set(key, assigned)
    return assigned
  }

  /**
   * Route one tool-call fragment.
   *
   * @returns the frames to send, or `null` when the fragment is held or dropped
   */
  admit(key: string, sentName: string | undefined, argsDelta: string, id?: string | undefined): Record<string, unknown>[] {
    const verdict = this.verdicts.get(key)
    if (verdict === false) return []
    if (verdict === true) {
      return argsDelta === ''
        ? []
        : [{ tool_calls: [{ index: this.indexOf(key), function: { arguments: argsDelta } }] }]
    }
    // The verdict is taken on the SENT spelling, then the name is restored. The
    // two facts are different questions: "did the gateway ask for the gate's own
    // tool" (which nothing can run) and "what does the caller call it" (which it
    // can). Judging the restored name answered the first question with the
    // second's data, which under v2 reads a caller's `read` as the gate's.
    const sent = sentName === undefined || sentName === '' ? undefined : sentName
    if (sent !== undefined) {
      const keep = this.executable(sent)
      this.verdicts.set(key, keep)
      // Park whatever arrived early for this block before deciding, so a block
      // that turns out to be unrunnable is still remembered as suppressed. The
      // verdict decides whether those fragments are FORWARDED, never whether
      // they existed: a call that carried its own arguments was a real attempt,
      // and a turn whose only output was an unrunnable call has to say so.
      const parked = this.held.get(key)
      if (parked !== undefined) {
        this.held.set(key, { id: id !== undefined && id !== '' ? id : parked.id, args: [...parked.args, argsDelta] })
      } else {
        this.held.set(key, { id: id ?? '', args: argsDelta === '' ? [] : [argsDelta] })
      }
      if (!keep) return []
      const name = this.restore(sent)
      this.survivedCalls += 1
      this.held.delete(key)
      const held = [...parked?.args ?? [], argsDelta].join('')
      return [{
        tool_calls: [{
          index: this.indexOf(key),
          id: id !== undefined && id !== '' ? id : parked?.id ?? '',
          type: 'function',
          function: { name, arguments: '' },
        }],
      }, ...(held === '' ? [] : [{
        tool_calls: [{ index: this.indexOf(key), function: { arguments: held } }],
      }])]
    }
    const parked = this.held.get(key) ?? { id: '', args: [] }
    if (id !== undefined && id !== '') parked.id = id
    if (argsDelta !== '') parked.args.push(argsDelta)
    this.held.set(key, parked)
    return []
  }

  /** Did the turn ask for a tool the caller cannot run? */
  suppressed(): boolean {
    for (const [key, verdict] of this.verdicts) {
      if (verdict === false && this.held.has(key)) return true
    }
    return false
  }

  /** The caller's own spelling for a name that went out under another one. */
  private restore(sent: string): string {
    return this.rename.size === 0 ? sent : this.rename.get(sent) ?? sent
  }
}

/** The declared tool name of one tool definition, in either spelling. */
function toolNameOf(tool: unknown): string {
  if (!isRecord(tool)) return ''
  if (typeof tool.name === 'string' && tool.name.trim() !== '') return tool.name.trim()
  const fn = tool.function
  if (isRecord(fn) && typeof fn.name === 'string') return fn.name.trim()
  return ''
}

/**
 * The tool names the v2 free tier requires to be declared.
 *
 * Duplicated from the wire module on purpose: this file must stay importable on
 * its own so the translation can be tested without the transport.
 *
 * v2 narrowed this from the v1 quartet (`bash`, `glob`, `grep`, `read`) to two,
 * and — unlike v1 — case variants are NOT gate tools: a caller that declares
 * `Read` or `Bash` keeps those names untouched, which is why this list is
 * compared exactly rather than lowercased.
 */
export const FINGERPRINT_TOOLS: readonly string[] = ['read', 'shell']

/** One decoded event on its way to becoming chat chunks. */
export interface FreeEvent {
  /** Chat chunks to forward, in order. */
  frames: Record<string, unknown>[]
  /** The turn's usage, when the event carried it. */
  usage?: Record<string, unknown>
  /** The wire's finish token, when the event carried one. */
  finish?: string
  /** True once the wire has said the turn is over. */
  done?: boolean
}

/**
 * Translate one upstream event into chat chunks.
 *
 * The chat wire needs no translation at all: its payloads are already what the
 * harness decodes, and re-encoding them would risk splitting a multi-byte
 * character at a frame boundary. The other two are translated frame by frame.
 */
export function chatChunksFor(wire: FreeWire, payload: unknown, tools: FreeToolWire): FreeEvent {
  if (wire === 'chat') return chatEvent(payload, tools)
  if (wire === 'messages') return claudeEvent(payload, tools)
  return responsesEvent(payload, tools)
}

/** The chat wire's own payload, minus the fields the decoder handles elsewhere. */
function chatEvent(payload: unknown, tools: FreeToolWire): FreeEvent {
  const root = isRecord(payload) ? payload : {}
  const out: FreeEvent = { frames: [] }
  if (isRecord(root.usage)) out.usage = root.usage
  const choices = Array.isArray(root.choices) ? root.choices : []
  for (const raw of choices) {
    if (!isRecord(raw)) continue
    const delta = isRecord(raw.delta) ? raw.delta : {}
    const reasoning = reasoningOf(delta)
    if (reasoning !== undefined) out.frames.push({ reasoning_content: reasoning })
    const content = text(delta.content)
    if (content !== '') out.frames.push({ content })
    const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : []
    for (const call of calls) {
      if (!isRecord(call)) continue
      const fn = isRecord(call.function) ? call.function : {}
      const name = typeof fn.name === 'string' && fn.name !== '' ? fn.name : undefined
      const key = `c${text(call.index)}`
      out.frames.push(
        ...tools.admit(key, name, text(fn.arguments), typeof call.id === 'string' ? call.id : undefined),
      )
    }
    const finish = text(raw.finish_reason)
    if (finish !== '') out.finish = finish
  }
  return out
}

/** The thinking one frame carries, in whichever spelling the gateway used. */
function reasoningOf(delta: Record<string, unknown>): string | undefined {
  for (const field of ['reasoning', 'reasoning_content', 'reasoning_text', 'thinking']) {
    const value = delta[field]
    if (typeof value === 'string' && value !== '') return value
  }
  if (Array.isArray(delta.reasoning_details)) {
    let body = ''
    for (const part of delta.reasoning_details) {
      if (isRecord(part) && typeof part.text === 'string') body += part.text
    }
    if (body !== '') return body
  }
  return undefined
}

/** One Anthropic Messages event, translated. */
function claudeEvent(payload: unknown, tools: FreeToolWire): FreeEvent {
  const event = isRecord(payload) ? payload : {}
  const type = text(event.type)
  const out: FreeEvent = { frames: [] }
  if (type === 'content_block_start') {
    const block = isRecord(event.content_block) ? event.content_block : {}
    if (text(block.type) === 'tool_use') {
      out.frames.push(...tools.admit(`b${text(event.index)}`, text(block.name), '', text(block.id)))
    }
    return out
  }
  if (type === 'content_block_delta') {
    const delta = isRecord(event.delta) ? event.delta : {}
    const key = `b${text(event.index)}`
    const kind = text(delta.type)
    if (kind === 'text_delta') {
      const body = text(delta.text)
      if (body !== '') out.frames.push({ content: body })
    } else if (kind === 'thinking_delta') {
      const body = text(delta.thinking)
      if (body !== '') out.frames.push({ reasoning_content: body })
    } else if (kind === 'input_json_delta') {
      out.frames.push(...tools.admit(key, undefined, text(delta.partial_json)))
    }
    return out
  }
  if (type === 'message_start') {
    const message = isRecord(event.message) ? event.message : {}
    const usage = isRecord(message.usage) ? message.usage : {}
    out.usage = anthropicUsage(usage)
    return out
  }
  if (type === 'message_delta') {
    const usage = isRecord(event.usage) ? event.usage : {}
    const output = usage.output_tokens
    if (typeof output === 'number') out.usage = { ...(out.usage ?? {}), completion_tokens: output }
    const delta = isRecord(event.delta) ? event.delta : {}
    const stop = text(delta.stop_reason)
    if (stop !== '') out.finish = anthropicFinish(stop)
    return out
  }
  // `message_stop` is this wire's own end frame. A stream that carried it was
  // closed on purpose, so it must not read as a cut one even when the stop_reason
  // frame is the one that went missing.
  if (type === 'message_stop') {
    out.done = true
  }
  // An `error` event is NOT translated here. The transport classifies it into a
  // typed failure and throws before translation runs, so an error can never
  // arrive as a frame — a stream must not carry one, because the status line is
  // already spent by then and the caller would see a clean end of turn.
  return out
}

/** Anthropic's usage names, in the chat spelling the harness reads. */
function anthropicUsage(usage: Record<string, unknown>): Record<string, unknown> {
  const prompt = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0
  const completion = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0
  const cached = typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0
  const written = typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0
  return {
    prompt_tokens: prompt + cached + written,
    completion_tokens: completion,
    total_tokens: prompt + cached + written + completion,
    ...(cached + written === 0 ? {} : { prompt_tokens_details: { cached_tokens: cached } }),
  }
}

/** Anthropic stop reasons, in the chat finish tokens the harness reads. */
function anthropicFinish(stop: string): string {
  if (stop === 'tool_use') return 'tool_calls'
  if (stop === 'max_tokens') return 'length'
  return 'stop'
}

/** One OpenAI Responses event, translated. */
function responsesEvent(payload: unknown, tools: FreeToolWire): FreeEvent {
  const event = isRecord(payload) ? payload : {}
  const type = text(event.type)
  const out: FreeEvent = { frames: [] }
  if (type === 'response.output_item.added') {
    const item = isRecord(event.item) ? event.item : {}
    if (text(item.type) === 'function_call') {
      out.frames.push(
        ...tools.admit(
          `i${text(event.output_index)}`,
          text(item.name),
          '',
          text(item.call_id ?? item.id),
        ),
      )
    }
    return out
  }
  if (type === 'response.output_text.delta') {
    const body = text(event.delta)
    if (body !== '') out.frames.push({ content: body })
    return out
  }
  if (type === 'response.reasoning_summary_text.delta' || type === 'response.output_reasoning.text.delta') {
    const body = text(event.delta)
    if (body !== '') out.frames.push({ reasoning_content: body })
    return out
  }
  if (type === 'response.function_call_arguments.delta') {
    out.frames.push(...tools.admit(`i${text(event.output_index)}`, undefined, text(event.delta)))
    return out
  }
  // Every deliberate ending this wire has, not only the happy one. Reading just
  // `response.completed` as terminal made `response.incomplete` - the frame a
  // turn that hit the output ceiling ends on - look like a stream the gateway
  // cut, so a finished turn got retried and then failed.
  if (type === 'response.completed' || type === 'response.incomplete' || type === 'response.failed' || type === 'response.done') {
    const response = isRecord(event.response) ? event.response : {}
    const usage = isRecord(response.usage) ? response.usage : {}
    out.usage = responsesUsage(usage)
    const incomplete = isRecord(response.incomplete_details) ? response.incomplete_details : {}
    out.finish = responsesFinish(response, incomplete)
    out.done = true
  }
  return out
}

/** The Responses usage names, in the chat spelling the harness reads. */
function responsesUsage(usage: Record<string, unknown>): Record<string, unknown> {
  const prompt = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0
  const completion = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0
  const cached = isRecord(usage.input_tokens_details)
    && typeof usage.input_tokens_details.cached_tokens === 'number'
    ? usage.input_tokens_details.cached_tokens
    : 0
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    ...(cached === 0 ? {} : { prompt_tokens_details: { cached_tokens: cached } }),
  }
}

/** The Responses status, in a chat finish token. */
function responsesFinish(response: Record<string, unknown>, incomplete: Record<string, unknown>): string {
  const status = text(response.status)
  if (status === 'incomplete' || incomplete.reason === 'max_output_tokens') return 'length'
  if (Array.isArray(response.output)) {
    for (const item of response.output) {
      if (isRecord(item) && text(item.type) === 'function_call') return 'tool_calls'
    }
  }
  return 'stop'
}

/** Whether this content list needs an image-capable model. */
export function needsVision(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false
  return messages.some(message => {
    if (!isRecord(message)) return false
    return blocksOf(message.content).some(block => isImageBlock(block))
  })
}

/** Whether this MIME type may be sent as an image. */
export function imageMimeAccepted(mimeType: string): boolean {
  return IMAGE_MEDIA.has(mimeType)
}
