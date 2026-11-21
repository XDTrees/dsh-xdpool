/**
 * Accio (阿里) — the call shape, the catalogue, and the quota.
 *
 * WHY THIS DOES NOT LOOK LIKE OPENAI
 *
 * The gateway takes a Gemini-shaped body (`contents[].parts[]`, snake_case) and wants the token
 * INSIDE the body — putting it in an `Authorization` header is answered `402 unauthorized` in
 * the middle of the stream, which reads like an expired session rather than a misplaced field.
 *
 * Two query parameters matter:
 *
 *   - `sg_k` = `md5(requestId)`. It is not a signature the plugin invents; it is derived from
 *     the request id the same way the client does.
 *   - `utdid` is a device id the gateway treats as a risk-control baseline. Sending none gets a
 *     200 carrying a risk-control page instead of a stream.
 *
 * THE MODEL ID IS SENT AS `modelCode`
 *
 * The catalogue's public id is a slug of the display name, but the wire takes the opaque
 * `modelCode`. Sending the slug is answered with an empty response — the symptom is "the model
 * does not reply", which looks like a broken account.
 *
 * @module dsh-xdpool/accio-upstream
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { failureMessage } from './error-body.ts'
import { explainFailure } from './credential-errors.ts'
import {
  ACCIO_APP_KEY,
  ACCIO_APP_VERSION,
  ACCIO_CATALOG_PATH,
  ACCIO_GATEWAY,
  ACCIO_LLM_PATH,
  ACCIO_QUOTA_PATH,
  ACCIO_BUCKETS,
  normalizeAccioModel,
  type AccioCredential,
  type AccioModel,
  type AccioQuotaBucket,
} from './accio-protocol.ts'

/** The request id this call uses, and the `sg_k` derived from it. */
function requestIdOf(): string {
  return `req-${String(Date.now())}-${randomUUID().slice(0, 8)}`
}

/** `sg_k` is the md5 of the request id, as the client computes it. */
function sgKOf(requestId: string): string {
  return createHash('md5').update(requestId, 'utf8').digest('hex')
}

/**
 * A device id for risk control.
 *
 * Derived from this machine rather than generated per call: a new device id on every request is
 * worse than none, because the gateway reads a rotating id as a script.
 */
function utdidOf(): string {
  const seed = `${process.env['COMPUTERNAME'] ?? ''}|${process.env['USERNAME'] ?? ''}|accio`
  return createHash('md5').update(seed, 'utf8').digest('hex')
}

/** One streamed piece. */
export interface AccioDelta {
  type: 'text' | 'reasoning'
  text: string
}

/** What a completed turn produced. */
export interface AccioResult {
  text: string
  reasoning: string
  finishReason?: string
  usage?: { input: number; output: number }
}

/** Convert one host message into the Gemini part shape. */
function partsOf(content: unknown): unknown[] {
  if (typeof content === 'string') return [{ text: content }]
  if (!Array.isArray(content)) return []
  const parts: unknown[] = []
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push({ text: block })
      continue
    }
    if (block === null || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    if (typeof record['text'] === 'string') {
      parts.push({ text: record['text'] })
    }
  }
  return parts
}

/** Map one host role onto the vendor's. */
function roleOf(role: unknown): string {
  if (role === 'assistant' || role === 'model') return 'model'
  return 'user'
}

/**
 * Read the catalogue.
 *
 * The token travels in the body here too, for the same reason as the chat call.
 */
export async function accioCatalog(
  credential: AccioCredential,
  signal?: AbortSignal,
): Promise<{ models: readonly AccioModel[]; error?: string }> {
  try {
    const response = await fetch(`${ACCIO_GATEWAY}${ACCIO_CATALOG_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        version: ACCIO_APP_VERSION,
        appKey: ACCIO_APP_KEY,
      },
      body: JSON.stringify({ token: credential.accessToken }),
      signal: signal ?? AbortSignal.timeout(25_000),
    })
    if (!response.ok) return { models: [], error: explainFailure({ status: response.status, channel: 'Accio' }) }
    const body = await response.json() as Record<string, unknown>
    const data = body['data']
    if (!Array.isArray(data)) return { models: [] }
    const models: AccioModel[] = []
    for (const group of data) {
      if (group === null || typeof group !== 'object') continue
      const list = (group as Record<string, unknown>)['modelList']
      if (!Array.isArray(list)) continue
      for (const raw of list) {
        const model = normalizeAccioModel(raw)
        if (model !== undefined) models.push(model)
      }
    }
    /**
     * Cheapest first.
     *
     * A model without a published multiplier sorts last: `Infinity - Infinity` is NaN, which
     * makes the comparison unstable and can shuffle the whole list.
     */
    models.sort((a, b) => {
      const left = a.multiple ?? Number.POSITIVE_INFINITY
      const right = b.multiple ?? Number.POSITIVE_INFINITY
      if (left === right) return 0
      return left < right ? -1 : 1
    })
    return { models }
  } catch (error: unknown) {
    return { models: [], error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Read the quota.
 *
 * A failure here is not fatal: the points are context, not the thing the card exists for.
 */
export async function accioQuota(
  credential: AccioCredential,
  signal?: AbortSignal,
): Promise<{ buckets: readonly AccioQuotaBucket[]; error?: string }> {
  try {
    const response = await fetch(`${ACCIO_GATEWAY}${ACCIO_QUOTA_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        version: ACCIO_APP_VERSION,
        appKey: ACCIO_APP_KEY,
      },
      body: JSON.stringify({ token: credential.accessToken }),
      signal: signal ?? AbortSignal.timeout(20_000),
    })
    if (!response.ok) return { buckets: [], error: explainFailure({ status: response.status, channel: 'Accio' }) }
    const body = await response.json() as Record<string, unknown>
    const data = (body['data'] ?? body) as Record<string, unknown>
    const buckets: AccioQuotaBucket[] = []
    for (const spec of ACCIO_BUCKETS) {
      const raw = data[spec.key]
      if (raw === null || typeof raw !== 'object') continue
      const record = raw as Record<string, unknown>
      const total = Number(record['total'] ?? record['quota'] ?? 0)
      const usedRaw = Number(record['used'] ?? 0)
      const remainingRaw = Number(record['remaining'] ?? record['left'] ?? Number.NaN)
      /**
       * The vendor may report either "used" or "remaining", and they are not always both
       * present. Whichever is there is taken; the percentage is derived only when it can be.
       */
      const remaining = Number.isFinite(remainingRaw) ? remainingRaw : (Number.isFinite(total) ? Math.max(0, total - usedRaw) : undefined)
      const used = Number.isFinite(total) && total > 0 && remaining !== undefined
        ? Math.round(((total - remaining) / total) * 100)
        : Number.isFinite(usedRaw) ? Math.min(100, Math.max(0, usedRaw)) : 0
      const bucket: AccioQuotaBucket = { key: spec.key, label: spec.label, used }
      if (remaining !== undefined) bucket.remaining = remaining
      /**
       * Only the daily bucket carries a refresh moment, and it is when the allowance RESETS —
       * not when the points expire. Saying "expires" would be wrong in the other direction.
       */
      const seconds = Number(data['refreshCountdownSeconds'])
      if (spec.key === 'daily' && Number.isFinite(seconds) && seconds > 0) {
        bucket.resetsAt = new Date(Date.now() + seconds * 1000).toISOString()
      }
      buckets.push(bucket)
    }
    return { buckets }
  } catch (error: unknown) {
    return { buckets: [], error: error instanceof Error ? error.message : String(error) }
  }
}

/** Run one chat turn. */
export async function accioChat(input: {
  credential: AccioCredential
  /** The `modelCode`, not the slug. */
  modelCode: string
  modelName?: string
  messages: readonly unknown[]
  system?: string
  reasoningEffort?: string
  signal: AbortSignal
  onDelta?: (delta: AccioDelta) => void
}): Promise<AccioResult> {
  const contents: Record<string, unknown>[] = []
  const systemParts: string[] = []
  if (input.system !== undefined && input.system !== '') systemParts.push(input.system)
  for (const message of input.messages) {
    if (message === null || typeof message !== 'object') continue
    const record = message as Record<string, unknown>
    const role = roleOf(record['role'])
    if (role === 'user' && typeof record['role'] === 'string' && record['role'] === 'system') {
      systemParts.push(String(record['content'] ?? ''))
      continue
    }
    const parts = partsOf(record['content'])
    if (parts.length === 0) continue
    contents.push({ role, parts })
  }

  const payload: Record<string, unknown> = {
    // The token is a BODY field here; a header is answered 402 mid-stream.
    token: input.credential.accessToken,
    model: input.modelCode,
    contents,
    stream: true,
  }
  if (systemParts.length > 0) {
    payload['systemInstruction'] = { parts: [{ text: systemParts.join('\n') }] }
  }
  if (input.reasoningEffort !== undefined && input.reasoningEffort !== '') {
    payload['reasoningEffort'] = input.reasoningEffort
  }

  const requestId = requestIdOf()
  const response = await fetch(`${ACCIO_GATEWAY}${ACCIO_LLM_PATH}?sg_k=${sgKOf(requestId)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      utdid: utdidOf(),
      version: ACCIO_APP_VERSION,
      appKey: ACCIO_APP_KEY,
    },
    body: JSON.stringify(payload),
    signal: input.signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(failureMessage(response.status, text))
  }
  if (response.body === null) throw new Error('上游没有返回内容')

  let text = ''
  let reasoning = ''
  let finishReason: string | undefined
  const usage = { input: 0, output: 0 }
  const decoder = new TextDecoder()
  let buffer = ''

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (raw === '' || raw === '[DONE]') continue
        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(raw) as Record<string, unknown>
        } catch {
          continue
        }
        /**
         * A streamed error arrives as an ordinary frame with HTTP 200.
         *
         * `402 unauthorized` here means the token was not where the gateway wanted it, not that
         * the account is gone — but it must be raised, or the turn ends silently empty.
         */
        const errorCode = parsed['error_code']
        if (errorCode !== undefined) {
          const message = parsed['error_message']
          throw new Error(
            typeof message === 'string' && message !== ''
              ? `${message}（code=${String(errorCode)}）`
              : `上游错误 code=${String(errorCode)}`,
          )
        }
        const usageRaw = (parsed['usage_metadata'] ?? parsed['usageMetadata']) as Record<string, unknown> | undefined
        if (usageRaw !== undefined && usageRaw !== null) {
          const prompt = Number(usageRaw['prompt_token_count'] ?? usageRaw['promptTokenCount'])
          const candidates = Number(usageRaw['candidates_token_count'] ?? usageRaw['candidatesTokenCount'])
          if (Number.isFinite(prompt)) usage.input = prompt
          if (Number.isFinite(candidates)) usage.output = candidates
        }
        const finish = parsed['finish_reason'] ?? parsed['finishReason']
        if (typeof finish === 'string' && finish !== '') finishReason = finish
        const content = parsed['content']
        if (content === null || typeof content !== 'object') continue
        const parts = (content as Record<string, unknown>)['parts']
        if (!Array.isArray(parts)) continue
        for (const part of parts) {
          if (part === null || typeof part !== 'object') continue
          const record = part as Record<string, unknown>
          const piece = typeof record['text'] === 'string' ? record['text'] : ''
          if (piece !== '') {
            text += piece
            input.onDelta?.({ type: 'text', text: piece })
          }
          // A thought arrives on its own flag; reporting it as answer text would put the
          // model's deliberation in front of the user.
          if (record['thought'] === true && piece !== '') {
            reasoning += piece
            input.onDelta?.({ type: 'reasoning', text: piece })
          }
        }
      }
    }
  }

  return {
    text,
    reasoning,
    ...(finishReason === undefined ? {} : { finishReason }),
    ...(usage.input === 0 && usage.output === 0 ? {} : { usage }),
  }
}

/** A message id, which the vendor uses to deduplicate a replayed turn. */
export function accioMessageId(requestId: string): string {
  return createHash('md5').update(`${requestId}:${randomBytes(16).toString('hex')}`, 'utf8').digest('hex')
}
