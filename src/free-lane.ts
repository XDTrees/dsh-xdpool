/**
 * Assembly for the免密 free lane.
 *
 * It is exposed to the shim as an `ExtraLaneSource` — a roster plus one `run` —
 * so the shim stays ignorant of sessions, wires and tool bookkeeping. That
 * boundary is the whole point of the design: the shim speaks exactly one wire
 * downstream, and everything that differs per lane lives here.
 *
 * The sealed co-paid lane that sat beside this one was removed on the user's
 * instruction; the credential-free lane is the one that stays.
 *
 * Every turn gets a session identity derived from the CONVERSATION, not from the
 * request. Free-tier quota is accounted per session, so minting a fresh id per
 * request exhausts it; a digest of the conversation keeps the same turn billed
 * to the same session across restarts, which is how the real client behaves.
 *
 * @module src/free-lane
 */

import crypto from 'node:crypto'
import type { ExtraLaneSource } from './shim.ts'
import {
  applyFingerprint,
  postFreeStreamed,
  requestIdFor,
  sessionForConversation,
  wireFor,
} from './free-upstream.ts'
import { requestBodyFor } from './free-messages.ts'
import { StreamTracker, parseUsage, type UsageRecorder } from './stats.ts'
import type { FreeCatalog } from './free-catalog.ts'
import type { ShimLogger } from './shim.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * The conversation identity one request belongs to.
 *
 * The first user turn's text, hashed. Reading it from the body rather than from a
 * header is what makes this work for a caller that knows nothing about this
 * lane: pi-ai sends an ordinary chat body and the identity is simply a fact about
 * the conversation in it.
 */
function conversationKeyOf(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : []
  for (const raw of messages) {
    if (!isRecord(raw) || text(raw.role) !== 'user') continue
    const content = typeof raw.content === 'string'
      ? raw.content
      : JSON.stringify(raw.content ?? '')
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 32)
  }
  return crypto.createHash('sha256').update('xdpool-free-conversation', 'utf8').digest('hex').slice(0, 32)
}

/** The envelope one chat chunk carries, so frames from different lanes match. */
function chatChunk(model: string, delta: Record<string, unknown>, finishReason: string | null): string {
  return JSON.stringify({
    id: `chatcmpl-${crypto.randomBytes(8).toString('hex')}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })
}

/**
 * The pooled免密 lane.
 *
 * `logger` is optional so the offline suite can build a source with no shim
 * around it; the dropped-image warning is the only thing it says.
 */
export function createFreeLaneSource(
  catalog: FreeCatalog,
  logger?: ShimLogger,
  usageRecorder?: UsageRecorder,
): ExtraLaneSource {
  return {
    current: () => catalog.current(),
    async run({ modelId, body, signal, onFrame }) {
      const caller = parseBody(body)
      const session = sessionForConversation(conversationKeyOf(caller))
      const requestId = requestIdFor(session, String(caller.user ?? ''))
      const wire = wireFor(modelId)
      const warnings: string[] = []
      const payload = requestBodyFor(wire, caller, { modelId, warnings })
      // The fingerprint gate is the free tier's own requirement and applies to
      // THIS lane only — renaming a tool on the aggregate or co-paid lanes would
      // hand the caller back a name it cannot run. The plan it returns is what
      // makes a promoted tool callable again on the way out.
      const plan = applyFingerprint(payload, wire)
      if (warnings.length > 0) {
        logger?.warn?.(`free lane: ${warnings.length} image block(s) could not be forwarded; they were dropped`)
      }
      // Time the turn so the dashboard shows real first-token and decode numbers
      // even when the gateway stays silent on token counts. One fresh turn id per
      // call: the free lane has no account rotation, so a turn is exactly one
      // upstream call.
      const startedAt = Date.now()
      const tracker = new StreamTracker(startedAt)
      const turnId = `free-${crypto.randomBytes(8).toString('hex')}`
      let ok = false
      let recordedUsage: ReturnType<typeof parseUsage> = undefined
      try {
        onFrame(chatChunk(modelId, { role: 'assistant', content: '' }, null))
        const result = await postFreeStreamed({
          modelId,
          body: payload,
          session,
          requestId,
          plan,
          signal,
          hooks: {
            onDelta: delta => {
              tracker.markFirstByte(Date.now())
              onFrame(chatChunk(modelId, delta, null))
            },
          },
        })
        ok = true
        recordedUsage = result.usage === undefined ? undefined : parseUsage(result.usage)
        if (result.suppressedOnly === true) {
          // A turn whose only answer was a decoy call has nothing for the caller to
          // run. The status line is already spent, so the only honest place left
          // for the explanation is the stream itself.
          onFrame(JSON.stringify({
            error: { message: 'the model asked for a tool this session cannot run', type: 'server_error' },
          }))
        }
        onFrame(chatChunk(modelId, {}, result.finishReason ?? (result.truncated === true ? 'length' : 'stop')))
        return result
      } finally {
        // Filed exactly once, whether the turn succeeded or threw: a broken stream
        // is a failed call from the user's side of the wire, and the panel must
        // count it rather than pretend nothing happened.
        tracker.finish(Date.now())
        usageRecorder?.record({
          // The channel, not the region: this lane is not on either WorkBuddy
          // gateway, and the ledger's first column now names the channel so the
          // free models stop being filed as `国内版`.
          channel: 'free',
          region: 'free',
          model: modelId,
          account: 'free',
          turnId,
          at: Date.now(),
          ok,
          ...(tracker.ttftMs === undefined ? {} : { ttftMs: tracker.ttftMs }),
          ...(tracker.decodeMs === undefined ? {} : { decodeMs: tracker.decodeMs }),
          ...(recordedUsage === undefined ? {} : { usage: recordedUsage }),
        })
      }
    },
  }
}

/** Parse the caller's body, or refuse with something the caller can act on. */
function parseBody(body: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(body) as unknown
    if (isRecord(parsed)) return parsed
  } catch {
    // Fall through to the shared refusal below.
  }
  throw new Error('the request body was not a JSON object')
}
