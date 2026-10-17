import { describeError } from './diagnostics.ts'
import type { PoolWebModelProbeResult } from './status-paths.ts'

/**
 * One real streaming call, measured.
 *
 * ## What this is allowed to report
 *
 * Exactly three facts: whether anything came back, how long the wait was, and
 * how many characters arrived. The card offers a button labelled "test
 * connection", so the only question a user clicking it has is "can this model
 * answer right now" — and every additional field would be a claim this module
 * cannot support.
 *
 * ## What this refuses to do
 *
 *  - **It does not report a token count.** This plugin cannot tokenize for a
 *    model it does not own, so a "tokens" figure would be a guess with a number
 *    attached. `outputChars` is characters, and is named that way everywhere.
 *  - **It does not judge quality.** A model that replies "I cannot help" is a
 *    working connection, and this reports it as one.
 *  - **It does not report zero on failure.** A refused stream and a silent one
 *    both surface as `ok: false` with the reason attached, because printing
 *    `0 characters` for a connection that never opened would read as "the model
 *    chose to say nothing".
 *  - **It spends as little as possible.** `maxTokens` is capped and the read
 *    stops at the first character plus a short grace window, so a probe costs
 *    a few tokens rather than a paragraph. The user paid for this by clicking,
 *    but "they clicked it" is not a licence to spend a dollar.
 */

/** Hard ceiling on what a probe may generate, in tokens. */
export const PROBE_MAX_TOKENS = 24

/**
 * How long to keep reading after the first character arrives.
 *
 * Long enough that a model which emits a space and then thinks still produces a
 * second chunk worth counting, short enough that the button does not feel like
 * it is waiting on a real answer.
 */
export const PROBE_GRACE_MS = 900

/** Hard ceiling on the whole probe, so a hung upstream cannot wedge the card. */
export const PROBE_TIMEOUT_MS = 30_000

/**
 * The smallest prompt that makes a model answer in a few characters.
 *
 * Deliberately a counting question rather than a greeting: "how many r's are in
 * strawberry" forces real generation on any model, whereas "hi" can be answered
 * from a cache or a canned reply on some gateways, which would make the probe
 * report a working connection to a model that is not actually reachable.
 */
const PROBE_PROMPT = 'Reply with the single word: ready'

/** One chunk of the host's streaming protocol, narrowed to what we read. */
interface ProbeChunk {
  type?: unknown
  text?: unknown
  reason?: unknown
}

/** The slice of the host's `llm` service this module needs. */
export interface ModelProbeStream {
  stream(options: {
    provider: string
    model: string
    messages: unknown[]
    system?: string
    maxTokens?: number
    signal?: AbortSignal
  }): AsyncIterable<ProbeChunk>
}

/** Text a chunk actually carries, ignoring its type. */
function chunkText(chunk: ProbeChunk): string {
  if (typeof chunk.text === 'string') return chunk.text
  return ''
}

/**
 * Run one probe and report what came back.
 *
 * Never throws. A probe exists to be clicked during setup, and a thrown error
 * here would surface in the card as a route failure with no explanation, which
 * is indistinguishable from "your key is wrong" — the one misdiagnosis this
 * button must not cause.
 */
export async function probeModelConnectivity(
  llm: ModelProbeStream,
  provider: string,
  model: string,
  options: { signal?: AbortSignal | undefined } = {},
): Promise<PoolWebModelProbeResult> {
  const startedAt = Date.now()
  const timeout = new AbortController()
  const timer = setTimeout(() => { timeout.abort() }, PROBE_TIMEOUT_MS)
  // The request's own abort is chained rather than swapped for the timeout, so
  // closing the settings card stops the probe AND the ceiling still applies.
  const onCallerAbort = (): void => { timeout.abort() }
  if (options.signal !== undefined) {
    if (options.signal.aborted) timeout.abort()
    else options.signal.addEventListener('abort', onCallerAbort, { once: true })
  }
  let characters = 0
  let firstFrameMs: number | undefined
  try {
    const stream = llm.stream({
      provider,
      model,
      system: 'You are being called by a connection test. Answer in one short word.',
      // Content blocks, never a bare string. The host's typed contract is
      // `content: readonly ContentBlock[]`, and `@deepseek-ai/dsh-llm-pi-ai`
      // validates every outgoing message with `message.content.some(...)`.
      // A string has no `.some`, so the probe died inside the host before the
      // request left the process, and the card printed
      // `content.some is not a function` — a shape error of ours wearing the
      // costume of a broken model.
      messages: [{ role: 'user', content: [{ type: 'text', text: PROBE_PROMPT }] }],
      maxTokens: PROBE_MAX_TOKENS,
      signal: timeout.signal,
    })
    for await (const chunk of stream) {
      // A terminal failure chunk is the host telling us the call did not
      // succeed. Its reason is more useful than a character count of zero.
      if (chunk.type === 'finish' && chunk.reason !== undefined) {
        const kind = (chunk.reason as { kind?: unknown }).kind
        if (kind === 'error' || kind === 'aborted') {
          const failure = (chunk.reason as { failure?: { message?: unknown } }).failure
          const message = typeof failure?.message === 'string' ? failure.message : `stream ended: ${kind}`
          return {
            ok: false,
            outputChars: characters,
            error: message,
            ...firstFrameMs === undefined ? {} : { firstFrameMs },
          }
        }
        break
      }
      const text = chunkText(chunk)
      if (text === '') continue
      characters += text.length
      if (firstFrameMs === undefined) {
        firstFrameMs = Date.now() - startedAt
        // Give the model a moment to finish its thought so the character count
        // reflects a real answer, then stop reading regardless.
        if (characters > 0) {
          await Promise.race([
            sleep(PROBE_GRACE_MS).then(() => 'grace' as const),
            waitForAbort(timeout.signal),
          ])
          break
        }
      }
    }
    return {
      ok: characters > 0,
      outputChars: characters,
      ...firstFrameMs === undefined
        ? {}
        : { firstFrameMs },
      ...characters > 0 ? {} : { error: 'the model returned no output' },
    }
  } catch (error: unknown) {
    return {
      ok: false,
      outputChars: characters,
      ...firstFrameMs === undefined ? {} : { firstFrameMs },
      error: describeError(error),
    }
  } finally {
    clearTimeout(timer)
    if (options.signal !== undefined) options.signal.removeEventListener('abort', onCallerAbort)
    timeout.abort()
  }
}

/** Resolve after `ms`, or immediately when the signal aborts. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

/** Resolve when the signal aborts. Never resolves otherwise. */
function waitForAbort(signal: AbortSignal): Promise<'aborted'> {
  if (signal.aborted) return Promise.resolve('aborted')
  return new Promise(resolve => {
    signal.addEventListener('abort', () => { resolve('aborted') }, { once: true })
  })
}