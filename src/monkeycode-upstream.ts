/**
 * MonkeyCode — the Anthropic-shaped call, the key exchange, and the wallet.
 *
 * THREE THINGS THAT MAKE THIS CHANNEL FAIL QUIETLY
 *
 *   1. `max_tokens` is mandatory under the Anthropic protocol; omitting it is a 400.
 *   2. `X-OhMyAgent-Signature` is an HMAC over the PROMPT TEXT — not over the request body.
 *      Signing the wrong thing is answered as an auth failure, which sends the reader looking
 *      for an expired key.
 *   3. The platform's `balance` is in THOUSANDTHS of a credit. Displaying it raw makes an
 *      account look a thousand times richer than it is.
 *
 * @module dsh-xdpool/monkeycode-upstream
 */
import { createHmac } from 'node:crypto'
import { failureMessage } from './error-body.ts'
import { explainFailure } from './credential-errors.ts'
import {
  MONKEYCODE_ANTHROPIC_VERSION,
  type MonkeycodeCredential,
  type MonkeycodeSite,
  type MonkeycodeWallet,
} from './monkeycode-protocol.ts'

/** The prompt text the signature covers. */
export function signingPromptOf(input: {
  system?: string
  messages: readonly unknown[]
}): string {
  const parts: string[] = []
  if (input.system !== undefined && input.system !== '') parts.push(input.system)
  for (const message of input.messages) {
    if (message === null || typeof message !== 'object') continue
    const record = message as Record<string, unknown>
    const role = record['role']
    // The signature covers the system and developer blocks wherever they appear.
    if (role !== 'system' && role !== 'developer') continue
    const content = record['content']
    if (typeof content === 'string') parts.push(content)
    else if (Array.isArray(content)) {
      for (const block of content) {
        if (block !== null && typeof block === 'object') {
          const text = (block as Record<string, unknown>)['text']
          if (typeof text === 'string') parts.push(text)
        }
      }
    }
  }
  // The user turns go in as well — the reference implementation joins the whole prompt.
  for (const message of input.messages) {
    if (message === null || typeof message !== 'object') continue
    const record = message as Record<string, unknown>
    if (record['role'] !== 'user') continue
    const content = record['content']
    if (typeof content === 'string') parts.push(content)
    else if (Array.isArray(content)) {
      for (const block of content) {
        if (block !== null && typeof block === 'object') {
          const text = (block as Record<string, unknown>)['text']
          if (typeof text === 'string') parts.push(text)
        }
      }
    }
  }
  return parts.join('\n')
}

/** `v1=<hex hmac-sha256(secret, prompt)>`. */
export function signatureOf(secret: string, prompt: string): string {
  return `v1=${createHmac('sha256', secret).update(prompt, 'utf8').digest('hex')}`
}

/** Read an envelope, refusing anything that reports an error. */
function unwrap(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object') return {}
  const record = body as Record<string, unknown>
  const data = record['data']
  return data !== null && typeof data === 'object' ? data as Record<string, unknown> : record
}

/** Exchange the platform session for a gateway key and its signing secret. */
export async function monkeycodeExchangeKey(
  site: MonkeycodeSite,
  cookie: string,
  signal?: AbortSignal,
): Promise<{ apiKey?: string; signingSecret?: string; error?: string }> {
  try {
    const response = await fetch(`${site.platformBaseUrl}${site.apiKeysPath}`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: '{}',
      signal: signal ?? AbortSignal.timeout(20_000),
    })
    if (!response.ok) return { error: explainFailure({ status: response.status, channel: 'MonkeyCode' }) }
    const data = unwrap(await response.json() as unknown)
    const apiKey = typeof data['api_key'] === 'string' ? data['api_key'] : ''
    const signingSecret = typeof data['signing_secret'] === 'string' ? data['signing_secret'] : ''
    if (apiKey === '' || signingSecret === '') {
      return { error: '兑换响应缺少 api_key / signing_secret（上游形态可能已变）' }
    }
    return { apiKey, signingSecret }
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Read the wallet.
 *
 * The platform session is what this needs — a gateway key alone can send messages but cannot
 * read a balance, and saying so is better than a card stuck on "loading".
 */
export async function monkeycodeWallet(
  site: MonkeycodeSite,
  credential: MonkeycodeCredential,
  signal?: AbortSignal,
): Promise<MonkeycodeWallet> {
  if (credential.cookie === '') {
    return { error: '只有 API Key 的账号查不到余额（余额接口只认网页登录态）' }
  }
  try {
    const response = await fetch(`${site.platformBaseUrl}/api/v1/users/wallet`, {
      headers: { cookie: credential.cookie, accept: 'application/json' },
      signal: signal ?? AbortSignal.timeout(20_000),
    })
    if (!response.ok) return { error: explainFailure({ status: response.status, channel: 'MonkeyCode' }) }
    const data = unwrap(await response.json() as unknown)
    const milli = Number(data['balance'])
    if (!Number.isFinite(milli)) return { error: '钱包报文里没有 balance 字段（上游形态可能已变）' }
    /**
     * `balance` is in thousandths.
     *
     * The web frontend divides by 1000 before showing it; reporting the raw number would make
     * the account look a thousand times richer.
     */
    const out: MonkeycodeWallet = { credits: Math.round(milli) / 1000 }
    const dailyBalance = Number(data['daily_token_balance'])
    const dailyLimit = Number(data['daily_token_limit'])
    if (Number.isFinite(dailyBalance) && Number.isFinite(dailyLimit) && dailyLimit > 0) {
      out.plan = `今日 token ${String(Math.round(dailyBalance))}/${String(Math.round(dailyLimit))}`
    }
    return out
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** One streamed piece. */
export interface MonkeycodeDelta {
  type: 'text' | 'reasoning'
  text: string
}

/** What a completed turn produced. */
export interface MonkeycodeResult {
  text: string
  reasoning: string
  finishReason?: string
  usage?: { input: number; output: number }
}

/** Convert one host message into an Anthropic content block list. */
function contentOf(content: unknown): unknown {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const blocks: unknown[] = []
  for (const block of content) {
    if (typeof block === 'string') {
      blocks.push({ type: 'text', text: block })
      continue
    }
    if (block === null || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    if (typeof record['text'] === 'string') blocks.push({ type: 'text', text: record['text'] })
  }
  return blocks
}

/** Run one chat turn. */
export async function monkeycodeChat(input: {
  site: MonkeycodeSite
  apiKey: string
  signingSecret: string
  model: string
  messages: readonly unknown[]
  system?: string
  effort?: string
  maxTokens?: number
  signal: AbortSignal
  onDelta?: (delta: MonkeycodeDelta) => void
}): Promise<MonkeycodeResult> {
  const messages: Record<string, unknown>[] = []
  for (const message of input.messages) {
    if (message === null || typeof message !== 'object') continue
    const record = message as Record<string, unknown>
    const role = record['role']
    // Anthropic takes system as a top-level field, not as a message.
    if (role === 'system' || role === 'developer') continue
    messages.push({
      role: role === 'assistant' ? 'assistant' : 'user',
      content: contentOf(record['content']),
    })
  }

  const prompt = signingPromptOf({ ...(input.system === undefined ? {} : { system: input.system }), messages: input.messages })
  const body: Record<string, unknown> = {
    model: input.model,
    messages,
    // `max_tokens` is REQUIRED by this protocol; omitting it is a 400.
    max_tokens: input.maxTokens ?? 8_192,
    stream: true,
  }
  if (input.system !== undefined && input.system !== '') body['system'] = input.system
  if (input.effort !== undefined && input.effort !== '' && input.effort !== 'none') {
    /**
     * A thinking budget, in tokens.
     *
     * The rung is translated here because the protocol takes a number, not a name; `none` is
     * handled by omitting the field entirely rather than sending a zero budget.
     */
    const budgets: Record<string, number> = { low: 1_024, medium: 4_096, high: 16_384 }
    body['thinking'] = { type: 'enabled', budget_tokens: budgets[input.effort] ?? 4_096 }
  }

  const response = await fetch(`${input.site.gatewayBaseUrl}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': input.apiKey,
      'anthropic-version': MONKEYCODE_ANTHROPIC_VERSION,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      // The signature covers the PROMPT, not the body.
      'X-OhMyAgent-Signature': signatureOf(input.signingSecret, prompt),
    },
    body: JSON.stringify(body),
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
        const payload = line.slice(5).trim()
        if (payload === '' || payload === '[DONE]') continue
        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(payload) as Record<string, unknown>
        } catch {
          continue
        }
        const kind = parsed['type']
        if (kind === 'error') {
          const error = parsed['error']
          const message = error !== null && typeof error === 'object'
            ? (error as Record<string, unknown>)['message']
            : undefined
          throw new Error(typeof message === 'string' && message !== '' ? message : '上游返回错误')
        }
        if (kind === 'message_delta') {
          const delta = parsed['delta']
          if (delta !== null && typeof delta === 'object') {
            const stop = (delta as Record<string, unknown>)['stop_reason']
            if (typeof stop === 'string' && stop !== '') finishReason = stop
          }
          const used = parsed['usage']
          if (used !== null && typeof used === 'object') {
            const output = Number((used as Record<string, unknown>)['output_tokens'])
            if (Number.isFinite(output)) usage.output = output
          }
          continue
        }
        if (kind === 'message_start') {
          const message = parsed['message']
          if (message !== null && typeof message === 'object') {
            const used = (message as Record<string, unknown>)['usage']
            if (used !== null && typeof used === 'object') {
              const input = Number((used as Record<string, unknown>)['input_tokens'])
              if (Number.isFinite(input)) usage.input = input
            }
          }
          continue
        }
        if (kind !== 'content_block_delta') continue
        const delta = parsed['delta']
        if (delta === null || typeof delta !== 'object') continue
        const d = delta as Record<string, unknown>
        if (d['type'] === 'text_delta' && typeof d['text'] === 'string' && d['text'] !== '') {
          text += d['text']
          input.onDelta?.({ type: 'text', text: d['text'] })
        }
        // A thought arrives as its own block type.
        if (d['type'] === 'thinking_delta' && typeof d['thinking'] === 'string' && d['thinking'] !== '') {
          reasoning += d['thinking']
          input.onDelta?.({ type: 'reasoning', text: d['thinking'] })
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
