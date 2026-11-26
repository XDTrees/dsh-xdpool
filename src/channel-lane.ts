/**
 * The channel lane: 扫码登录 vendors served through the host's own LLM seam.
 *
 * ## Why this is a separate lane
 *
 * Every other lane reaches its upstream over HTTP this plugin owns: the pool
 * posts to WorkBuddy, the aggregate lane posts to a provider the user keyed, the
 * free lane posts to a pooled gateway. The login channels do not work that way.
 * `vendor/channel-pack` registers each one as a HOST adapter
 * (`llm.registerAdapter([product.id], adapter)`) — the credential, the wire
 * dialect and the endpoint all belong to the pack, and there is no
 * OpenAI-compatible port for a client to point at.
 *
 * So this lane opens no socket. It calls `ctx.llm`, which already knows how to
 * reach every registered provider, and translates between the two vocabularies.
 * The listing is built the same way, from `llm.listModels`, which is what the
 * card's own model list already calls: a channel that is not signed in throws,
 * the throw becomes "contributes nothing", and the gateway therefore cannot
 * advertise a channel the card would not show.
 *
 * ## What is translated
 *
 * The host stream vocabulary is `block-start | text-delta | reasoning-delta |
 * tool-call-delta | block-end | usage | finish` (dsh-llm `types.d.ts`), and each
 * of the four that carry content has an OpenAI spelling, so nothing is dropped on
 * the way out — including tool calls, which a gateway that silently swallowed
 * them would make look like a model that refuses to use tools.
 *
 * On the way in, every message becomes the host's `content: ContentBlock[]`;
 * a bare string is rejected by the host's own validation, which is the exact bug
 * fixed in `model-probe.ts`, so this lane does not repeat it.
 *
 * Images must go through the host's durable attachment store, for the same
 * reason: the typed `ImageBlock` (dsh-llm `types.d.ts`) has no `url` field at
 * all — only `attachment: ImageAttachmentRef`. A base64 `image_url` part is
 * therefore decoded and handed to `attachments.saveImage`, and the reference that
 * comes back is what goes into the block. Emitting `{ type: 'image', url }` is
 * the failure mode this note exists for: the host does not reject it, it simply
 * is not an image as far as the host is concerned, so the picture is dropped and
 * the model narrates the text alone — a solid red square came back described as
 * white, with a token count that proved nothing had arrived. A remote `http(s)`
 * URL is refused rather than fetched, matching the pack's own bridge, so the
 * gateway never becomes a fetch primitive on someone else's behalf.
 *
 * ## One deliberate difference from the pool lane
 *
 * The pool forces `stream: true` (`prepareChatBody`), so a client asking for a
 * non-streaming completion still receives SSE from it. This lane honours
 * `stream: false`. Copying the deviation would make the gateway's behaviour
 * depend on which lane a model happens to sit in — the kind of difference a
 * client cannot see coming and discovers as a parse error.
 *
 * @module dsh-xdpool/channel-lane
 */

/** The slice of the host's `llm` service this lane needs. */
import { sanitizeToolSchemas } from './tool-schema.ts'

export interface ChannelLaneLlm {
  listModels: (provider: string) => Promise<readonly { id: string; name?: string }[]>
  stream: (options: Record<string, unknown>) => AsyncIterable<Record<string, unknown>>
}

/**
 * The host's durable attachment store, narrowed to the one call this lane makes.
 *
 * Injected as a getter because the service is resolved from the plugin context
 * per use, exactly as `adapter.ts` does for the pool's own image path.
 */
export interface ChannelLaneAttachments {
  saveImage: (input: { data: Uint8Array; mediaType: string; name?: string }) => Promise<unknown>
}

/**
 * A request this lane will not serve as written, and that is the caller's to fix.
 *
 * Kept as its own type so the route can answer 400 for it: a refused image and a
 * dead upstream must not read the same to a client, and neither must read like a
 * success that quietly dropped the picture.
 */
export class ChannelRequestError extends Error {}

/** The image types the host's attachment store will hold. */
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** Why one `image_url` part cannot be forwarded, or the bytes it carries. */
export type ImagePartReading =
  | { ok: true; data: Uint8Array; mediaType: string }
  | { ok: false; reason: string }

/**
 * Read one OpenAI `image_url` value into the store's input form.
 *
 * Every rejection names itself, because the alternative — dropping the part and
 * continuing — is what let a model answer about an image it never received.
 */
export function interpretImagePart(url: string): ImagePartReading {
  const target = url.trim()
  if (/^https?:\/\//iu.test(target)) {
    return { ok: false, reason: 'remote image URLs are not fetched by this gateway; send a base64 data URL' }
  }
  if (!target.startsWith('data:')) {
    return { ok: false, reason: 'only base64 data URLs can be forwarded as images' }
  }
  const comma = target.indexOf(',')
  if (comma < 0) return { ok: false, reason: 'image data URL has no payload' }
  const meta = target.slice(5, comma)
  if (!meta.toLowerCase().includes(';base64')) {
    return { ok: false, reason: 'image data URL must be base64-encoded' }
  }
  const declared = meta.split(';')[0]?.toLowerCase() ?? ''
  const mediaType = declared === 'image/jpg' ? 'image/jpeg' : declared
  if (!mediaType.startsWith('image/')) {
    return { ok: false, reason: `image part carries a ${mediaType || 'unnamed'} payload, not an image` }
  }
  if (!IMAGE_MEDIA_TYPES.has(mediaType)) {
    return { ok: false, reason: `unsupported image type ${mediaType}; the host stores png, jpeg, webp or gif` }
  }
  const bytes = Buffer.from(target.slice(comma + 1), 'base64')
  if (bytes.length === 0) return { ok: false, reason: 'image payload is empty' }
  return { ok: true, data: new Uint8Array(bytes), mediaType }
}

/** One model as the gateway lists and routes it. */
export interface ChannelLaneRow {
  /** The composite id a client sends: `<channel>:<model>`. */
  id: string
  channel: string
  modelId: string
  name: string
}

/** One translated event, so the caller decides how to frame it as SSE. */
export type ChannelLaneEvent =
  | { kind: 'delta'; delta: Record<string, unknown> }
  | { kind: 'usage'; usage: Record<string, number> }
  | { kind: 'done'; finishReason: string }
  /**
   * The turn ended in a failure the host reported — issue #195.
   *
   * Without this, `mapFinishReason` folded `kind:'error'` into `'stop'`, the
   * gateway answered `finish_reason:"stop"` with empty content, and the host read
   * that as `EMPTY_RESPONSE` — a *retryable* code. A genuine upstream failure
   * therefore looked like a flaky model: the client retried until backoff ran
   * out and the user never saw the reason. `message` carries the host's own text
   * (the status included) so it can reach the client verbatim.
   */
  | { kind: 'failed'; message: string; status: number | undefined }

/** How long a listing is reused before it is asked again. */
const LISTING_TTL_MS = 60_000

export interface ChannelLane {
  rows: () => Promise<readonly ChannelLaneRow[]>
  resolve: (id: string) => { channel: string; modelId: string } | undefined
  turn: (input: {
    channel: string
    modelId: string
    body: Record<string, unknown>
    signal: AbortSignal
    /**
     * The DSH Session this turn belongs to, when the caller knows it.
     *
     * Forwarded onto the host call as `sessionId`. The host's own `LlmAdapter`
     * seam already carries that field (`GenerateOptions.sessionId`), and dropping
     * it here was the reason a channel model's turn could not be attributed to
     * the conversation that caused it: the pool lanes get the id from pi-ai's
     * affinity header, and this lane — which rebuilds the request by hand — has
     * to pass it explicitly.
     */
    sessionId?: string | undefined
  }) => AsyncGenerator<ChannelLaneEvent>
}

/**
 * Build the channel lane.
 *
 * `providers` is supplied rather than derived here: the caller knows which
 * channels are mounted and which are pool-owned, and importing `channels.ts`
 * would pull the pack mount into this module.
 */
export function createChannelLane(options: {
  llm: ChannelLaneLlm
  providers: () => readonly string[]
  /** Id builder, injected so the reserved-prefix rule stays in `shim.ts`. */
  toId: (channel: string, modelId: string) => string
  /** The host attachment store, resolved per turn; absent means "no images". */
  attachments?: () => ChannelLaneAttachments | undefined
  logger?: { warn?: (...args: unknown[]) => void }
}): ChannelLane {
  const { llm, providers, toId, attachments, logger } = options
  const cache = new Map<string, { at: number; rows: readonly ChannelLaneRow[] }>()
  const inflight = new Map<string, Promise<readonly ChannelLaneRow[]>>()

  const fetchRows = (channel: string): Promise<readonly ChannelLaneRow[]> => {
    const hit = cache.get(channel)
    if (hit !== undefined && Date.now() - hit.at < LISTING_TTL_MS) return Promise.resolve(hit.rows)
    const running = inflight.get(channel)
    if (running !== undefined) return running
    const pending = llm.listModels(channel)
      .then(models => models.map(model => ({
        id: toId(channel, model.id),
        channel,
        modelId: model.id,
        name: model.name ?? model.id,
      })))
      .catch((error: unknown) => {
        // Not signed in, no adapter, or the listing needs a network that is
        // down. All three read as "nothing to show for this one", which is what
        // the card already says; cached briefly so a client refreshing the
        // picker does not re-pay a known-dead listing on every request.
        logger?.warn?.(`dsh-xdpool: channel ${channel} listed no models: ${String(error)}`)
        return [] as readonly ChannelLaneRow[]
      })
    const tracked = pending.then(rows => {
      cache.set(channel, { at: Date.now(), rows })
      inflight.delete(channel)
      return rows
    })
    inflight.set(channel, tracked)
    return tracked
  }

  return {
    rows: async () => (await Promise.all(providers().map(fetchRows))).flat(),
    resolve: (id: string) => {
      const separator = id.indexOf(':')
      if (separator <= 0 || separator === id.length - 1) return undefined
      const channel = id.slice(0, separator)
      if (!providers().includes(channel)) return undefined
      return { channel, modelId: id.slice(separator + 1) }
    },
    turn: (input) => runTurn({ llm, attachments: attachments?.(), sessionId: input.sessionId, ...input }),
  }
}

/**
 * One OpenAI message, narrowed to the fields this lane forwards.
 */
interface IncomingMessage {
  role?: unknown
  content?: unknown
}

/** The roles the host understands; anything else is a user turn. */
const KNOWN_ROLES = new Set(['system', 'user', 'assistant', 'tool'])

/**
 * Normalise one OpenAI role — issue #195, third defect.
 *
 * The converters below used exact, case-sensitive comparisons (`role ===
 * 'assistant'`), so `Assistant` / `ASSISTANT` / `assistant ` fell through to
 * the catch-all branch and went upstream as USER turns. The reporter's control
 * experiment read that as "the uppercase spelling works" — it did not; the model
 * was being told its own history was the user talking, and tool results lost
 * their pairing. One normalisation here fixes every downstream comparison.
 */
export function normalizeRole(value: unknown): string {
  if (typeof value !== 'string') return 'user'
  const role = value.trim().toLowerCase()
  return KNOWN_ROLES.has(role) ? role : 'user'
}

/**
 * Forward one OpenAI message as the host's typed content blocks.
 *
 * Text and image parts carry over. Anything else is dropped rather than
 * guessed at: inventing a block shape the provider was never told about fails
 * upstream with an error that names neither the message nor the part.
 *
 * An image that cannot be carried is a refusal, not a drop — see the module
 * note on why `{ type: 'image', url }` was the wrong answer.
 */
async function toHostMessage(
  message: IncomingMessage,
  attachments: ChannelLaneAttachments | undefined,
): Promise<{ role: string; content: Record<string, unknown>[] }> {
  const role = normalizeRole(message.role)
  const content = message.content
  if (typeof content === 'string') {
    return { role, content: content === '' ? [] : [{ type: 'text', text: content }] }
  }
  if (!Array.isArray(content)) return { role, content: [] }
  const blocks: Record<string, unknown>[] = []
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue
    const block = part as Record<string, unknown>
    if (block.type === 'text' && typeof block.text === 'string') {
      blocks.push({ type: 'text', text: block.text })
      continue
    }
    if (block.type === 'image_url' && typeof block.image_url === 'object' && block.image_url !== null) {
      const url = (block.image_url as Record<string, unknown>).url
      if (typeof url !== 'string' || url.trim() === '') continue
      if (attachments === undefined) {
        throw new ChannelRequestError('this gateway build has no attachment store, so images cannot be forwarded')
      }
      const reading = interpretImagePart(url)
      if (!reading.ok) throw new ChannelRequestError(reading.reason)
      // The reference, never the bytes: the adapter re-reads them from the store
      // when it builds the provider request.
      const ref = await attachments.saveImage({ data: reading.data, mediaType: reading.mediaType })
      blocks.push({ type: 'image', attachment: ref })
    }
  }
  return { role, content: blocks }
}

/**
 * The host's finish reason, in the OpenAI spelling — or undefined for a failure.
 *
 * `undefined` is not "unknown": it means the host ended the turn with an ERROR,
 * and the caller must answer with an error rather than a completion — issue #195.
 * This function used to end with `return 'stop'`, which folded `kind:'error'`
 * into a successful empty answer; the host then reported `EMPTY_RESPONSE` (a
 * retryable code), retried until backoff ran out, and the user saw "the model
 * said nothing" instead of the upstream's own message.
 */
export function mapFinishReason(reason: unknown): string | undefined {
  const kind = typeof reason === 'object' && reason !== null
    ? (reason as Record<string, unknown>).kind
    : reason
  if (kind === 'toolUse' || kind === 'tool_use') return 'tool_calls'
  if (kind === 'length') return 'length'
  if (kind === 'aborted') return 'abort'
  if (kind === 'error' || kind === 'failed') return undefined
  return 'stop'
}

/**
 * The message and status a host error carries, for the client.
 *
 * The host's `finish` reason for a failure is `{ kind: 'error', error?: … }`,
 * with the detail in one of a few shapes depending on where it was raised
 * (`LlmError` carries code/status, a raw rejection carries only a message).
 * Reading it here keeps `toChannelEvent` free of that branching, and it is
 * deliberately lossless-ish: whatever text the host produced is what the client
 * gets, because a failure the user cannot read is the bug being fixed.
 */
function failureOf(reason: unknown): { message: string; status: number | undefined } {
  const record = typeof reason === 'object' && reason !== null ? reason as Record<string, unknown> : {}
  const inner = typeof record.error === 'object' && record.error !== null
    ? record.error as Record<string, unknown>
    : record
  const message = typeof inner.message === 'string' && inner.message !== ''
    ? inner.message
    : typeof record.message === 'string' && record.message !== ''
      ? record.message
      : 'the channel reported a failure without a message'
  const rawStatus = inner.status ?? inner.code ?? record.status
  const status = typeof rawStatus === 'number' && Number.isFinite(rawStatus) ? rawStatus : undefined
  return { message, status }
}

/** Fold host chunks into OpenAI delta objects. */
export function toChannelEvent(chunk: Record<string, unknown>): ChannelLaneEvent | undefined {
  switch (chunk.type) {
    case 'text-delta':
      return { kind: 'delta', delta: { content: String(chunk.text ?? '') } }
    case 'reasoning-delta':
      // The pool's own upstream already spells this `reasoning_content`, so a
      // client with a thinking panel keeps working across lanes.
      return { kind: 'delta', delta: { reasoning_content: String(chunk.text ?? '') } }
    case 'tool-call-delta': {
      const id = String(chunk.id ?? '')
      const name = typeof chunk.name === 'string' ? chunk.name : undefined
      const fn: Record<string, unknown> = { arguments: String(chunk.argumentsDelta ?? '') }
      // OpenAI sends the function name once, on the first fragment of a call.
      if (name !== undefined && name !== '') fn.name = name
      const call: Record<string, unknown> = { index: 0, function: fn }
      if (id !== '') call.id = id
      return { kind: 'delta', delta: { tool_calls: [call] } }
    }
    case 'usage': {
      const usage = chunk.usage as Record<string, unknown> | undefined
      if (usage === undefined) return undefined
      const prompt = Number(usage.input ?? usage.inputTokens ?? 0)
      const completion = Number(usage.output ?? usage.outputTokens ?? 0)
      // The host reports input/output only; a `total` of its own is honoured if a
      // future generation adds one, but the sum is computed rather than defaulted
      // to 0 — a client that meters spend off `total_tokens` would otherwise read
      // every channel turn as free.
      const total = Number(usage.total ?? usage.totalTokens ?? prompt + completion)
      return { kind: 'usage', usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total } }
    }
    case 'finish': {
      const finishReason = mapFinishReason(chunk.reason)
      // A failure is not a completion: `undefined` hands it to the caller as one.
      if (finishReason === undefined) return { kind: 'failed', ...failureOf(chunk.reason) }
      return { kind: 'done', finishReason }
    }
    default:
      // block-start / block-end have no OpenAI equivalent and carry nothing the
      // deltas above do not already express.
      return undefined
  }
}

/** Drive one turn through the host seam. */
async function* runTurn(input: {
  llm: ChannelLaneLlm
  channel: string
  modelId: string
  body: Record<string, unknown>
  signal: AbortSignal
  attachments: ChannelLaneAttachments | undefined
  sessionId: string | undefined
}): AsyncGenerator<ChannelLaneEvent> {
  const { llm, channel, modelId, body, signal, attachments, sessionId } = input
  const incoming = Array.isArray(body.messages) ? body.messages as IncomingMessage[] : []
  // Awaited one message at a time rather than mapped: an image part has to be
  // written to the store before the block can name it, and a lost write must
  // surface here instead of reaching the model as a message with no picture.
  const converted: { role: string; content: Record<string, unknown>[]; source?: Record<string, unknown> }[] = []
  for (const message of incoming) {
    const host = await toHostMessage(message, attachments)
    /**
     * Give an assistant turn a `source` — issue #195.
     *
     * The host's `LlmRuntime.forAdapter` does `const source = message.source;
     * if (source.replayState === void 0) …` with no null check, so a bare OpenAI
     * history — which is exactly what comes in over this gateway — throws
     * `TypeError: Cannot read properties of undefined (reading 'replayState')`
     * on the second turn of every conversation (the first has no assistant
     * message to walk). The throw lands inside the adapter stream's try and
     * surfaces as a failure with no content.
     *
     * `kind: 'model'` without `replayState` is the honest answer for a message
     * this plugin never produced: "this came from a model, and there is no
     * replay state for it". The host's own next line then leaves the message
     * alone, which is what a multi-turn history needs.
     */
    converted.push(host.role === 'assistant'
      ? { ...host, source: { kind: 'model', provider: channel, model: modelId } }
      : host)
  }
  const system = converted.filter(message => message.role === 'system')
  const options: Record<string, unknown> = {
    provider: channel,
    model: modelId,
    messages: converted.filter(message => message.role !== 'system'),
    signal,
  }
  /**
   * Carry the Session id through to the host adapter.
   *
   * This lane rebuilds the request from an OpenAI body, so every host field has
   * to be re-attached by hand — and `sessionId` was the one nobody had a reason
   * to add until the composer started reporting which account a conversation
   * runs on. Without it, a channel model's turn reaches the host with no session
   * identity at all, and half the picker's models would be invisible to that
   * readout.
   *
   * Assigned only when known: `sessionId: undefined` is not the same as omitting
   * the key on this seam, because the host spreads the options into a request it
   * freezes and a present-but-undefined field reads as a session named nothing.
   */
  if (sessionId !== undefined) options.sessionId = sessionId
  if (system.length > 0) options.system = system[0]!.content
  if (typeof body.max_tokens === 'number') options.maxTokens = body.max_tokens
  if (typeof body.temperature === 'number') options.temperature = body.temperature
  /**
   * The tool schemas go out cut of their own cycles.
   *
   * They arrive from the calling agent, and a tool whose parameters refer to themselves have
   * no finite JSON encoding — the upstream validator walks them and never terminates, so the
   * request is refused with a path (`properties.show`) the caller cannot act on. Cutting the
   * cycle here keeps the tool callable and the request sendable.
   */
  if (Array.isArray(body.tools) && body.tools.length > 0) options.tools = sanitizeToolSchemas(body.tools)

  for await (const chunk of llm.stream(options)) {
    const event = toChannelEvent(chunk)
    if (event !== undefined) yield event
  }
}
