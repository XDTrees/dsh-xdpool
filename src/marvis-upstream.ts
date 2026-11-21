/**
 * Marvis upstream: one chat turn, and the wallet behind it.
 *
 * The chat endpoint is OpenAI-shaped, so the request body is ordinary. Two details are not:
 *
 *   - `model` takes a SLOT name (`main-auto`), and the reply's `model` field reports the real
 *     model the service routed to. Passing a real model id is answered `400 无效模型id`.
 *   - `uskey` inside `Ual-Access-MarvisExt` is good for two requests. It is minted per request
 *     here, which is why the header is built fresh rather than cached.
 *
 * @module dsh-xdpool/marvis-upstream
 */
import {
  MARVIS_BASE,
  MARVIS_CHAT_URL,
  MARVIS_WALLET_PATH,
  businessHeaders,
  chatHeaders,
  ualSignature,
  type MarvisAccount,
} from './marvis-protocol.ts'
import { failureMessage } from './error-body.ts'

/** One chunk as this lane reports it. */
export interface MarvisDelta {
  type: 'text' | 'reasoning'
  text: string
}

/** What a completed turn produced. */
export interface MarvisResult {
  text: string
  reasoning: string
  /** The real model the service routed to, when it said. */
  servedModel?: string
  /** Token accounting as the upstream reported it. */
  usage?: { input: number; output: number; cached: number }
  /** The conversation id, so the next turn can continue it. */
  conversationId?: string
}

/** A failure the caller can classify. */
export class MarvisError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
    this.name = 'MarvisError'
  }
}

/** The text of a host content value. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'string') { parts.push(block); continue }
    if (typeof block !== 'object' || block === null) continue
    const text = (block as Record<string, unknown>)['text']
    if (typeof text === 'string') parts.push(text)
  }
  return parts.join('\n')
}

/**
 * Run one chat turn and collect it.
 *
 * Streamed, but collected: the caller decides how to present it, and a non-streamed answer here
 * would make a long reply arrive in one lump after a silence.
 */
export async function marvisChat(input: {
  account: MarvisAccount
  model: string
  messages: readonly unknown[]
  system?: string
  reasoningEffort?: string
  signal: AbortSignal
  onDelta?: (delta: MarvisDelta) => void
  /** Continue an earlier exchange, when the caller kept one. */
  conversationId?: string
}): Promise<MarvisResult> {
  const { account, model, messages, system, reasoningEffort, signal, onDelta } = input
  const body: Record<string, unknown> = {
    model,
    messages: messages.map(message => {
      if (typeof message !== 'object' || message === null) return message
      const record = message as Record<string, unknown>
      return { role: record['role'], content: textOf(record['content']) || record['content'] }
    }),
    stream: true,
  }
  if (system !== undefined && system !== '') {
    body['messages'] = [{ role: 'system', content: system }, ...(body['messages'] as unknown[])]
  }
  if (reasoningEffort !== undefined && reasoningEffort !== '') {
    body['reasoning_effort'] = reasoningEffort
  }

  const response = await fetch(MARVIS_CHAT_URL, {
    method: 'POST',
    headers: chatHeaders(account, input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    /**
     * Two statuses mean different things here, and neither means "the account is wrong".
     *
     *   `403` — the daily quota is spent, or the account is on a risk-control list. The caller
     *           should move to another account rather than ask the user to sign in again.
     *   `401` — the session really is gone (`710012001`), and a re-login is the fix.
     */
    throw new MarvisError(
      failureMessage(response.status, text),
      response.status,
    )
  }
  if (response.body === null) {
    throw new MarvisError('上游没有返回内容', response.status)
  }

  let text = ''
  let reasoning = ''
  let servedModel: string | undefined
  let conversationId: string | undefined
  const usage = { input: 0, output: 0, cached: 0 }
  const decoder = new TextDecoder()
  let buffer = ''

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    // SSE frames are separated by a blank line; a frame may be split across chunks.
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '' || payload === '[DONE]') continue
        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(payload) as Record<string, unknown>
        } catch {
          continue
        }
        if (typeof parsed['model'] === 'string' && parsed['model'] !== '') servedModel = parsed['model']
        const conversation = parsed['conversation_id'] ?? parsed['conversationId']
        if (typeof conversation === 'string' && conversation !== '') conversationId = conversation

        const usageIn = parsed['usage']
        if (usageIn !== null && typeof usageIn === 'object') {
          const u = usageIn as Record<string, unknown>
          const details = u['prompt_tokens_details']
          usage.input = typeof u['prompt_tokens'] === 'number' ? u['prompt_tokens'] : usage.input
          usage.output = typeof u['completion_tokens'] === 'number' ? u['completion_tokens'] : usage.output
          usage.cached = details !== null && typeof details === 'object'
            && typeof (details as Record<string, unknown>)['cached_tokens'] === 'number'
            ? (details as Record<string, number>)['cached_tokens'] ?? 0
            : usage.cached
        }

        const choices = parsed['choices']
        if (!Array.isArray(choices)) continue
        for (const choice of choices) {
          if (typeof choice !== 'object' || choice === null) continue
          const delta = (choice as Record<string, unknown>)['delta']
          if (delta === null || typeof delta !== 'object') continue
          const d = delta as Record<string, unknown>
          const piece = typeof d['content'] === 'string' ? d['content'] : ''
          if (piece !== '') {
            text += piece
            onDelta?.({ type: 'text', text: piece })
          }
          /**
           * The thinking channel has its own field.
           *
           * `reasoning_content` is what Marvis returns; reporting it as answer text would put the
           * model's deliberation in front of the user as if it were the reply.
           */
          const thought = typeof d['reasoning_content'] === 'string'
            ? d['reasoning_content']
            : typeof d['reasoning'] === 'string' ? d['reasoning'] : ''
          if (thought !== '') {
            reasoning += thought
            onDelta?.({ type: 'reasoning', text: thought })
          }
        }
      }
    }
  }

  return {
    text,
    reasoning,
    ...(servedModel === undefined ? {} : { servedModel }),
    ...(conversationId === undefined ? {} : { conversationId }),
    ...(usage.input === 0 && usage.output === 0 ? {} : { usage }),
  }
}

/** The account's wallet. */
export interface MarvisWallet {
  /** The charging allowance for the day, in charged tokens. */
  total: number
  used: number
  available: number
  frozen: number
  /** Why it could not be read, when it could not. */
  error?: string
}

/**
 * Read the wallet.
 *
 * The endpoint is a `/v3` business route, so it needs the md5 signature — and it must NOT carry
 * `Ual-Access-MarvisExt`, which belongs to the model gateway only.
 */
export async function marvisWallet(account: MarvisAccount, signal?: AbortSignal): Promise<MarvisWallet> {
  const query = JSON.stringify({})
  try {
    /**
     * A timeout is NOT optional here.
     *
     * Callers pass no signal — the card just asks for the number — and a hung connection would
     * leave it saying 「加载中」 forever with no way to retry. Fifteen seconds is far longer than
     * the endpoint needs and short enough that a dead one is reported rather than waited on.
     */
    const response = await fetch(`${MARVIS_BASE}${MARVIS_WALLET_PATH}`, {
      method: 'POST',
      headers: businessHeaders(account, query),
      body: query,
      signal: signal ?? AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      return { total: 0, used: 0, available: 0, frozen: 0, error: `HTTP ${String(response.status)}` }
    }
    const payload = await response.json() as { data?: Record<string, unknown>; code?: unknown }
    const data = payload.data ?? {}
    const num = (key: string): number => {
      const value = data[key]
      if (typeof value === 'number') return value
      if (typeof value === 'string') {
        const parsed = Number(value.replace(/,/gu, ''))
        return Number.isFinite(parsed) ? parsed : 0
      }
      return 0
    }
    const total = num('total_tokens')
    const used = num('used_tokens')
    const available = num('avail_tokens') || Math.max(0, total - used)
    return { total, used, available, frozen: num('frozen_tokens') }
  } catch (error: unknown) {
    return {
      total: 0,
      used: 0,
      available: 0,
      frozen: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export { ualSignature }
