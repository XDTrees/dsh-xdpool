/**
 * 百智云 — the Anthropic-shaped call, the wallet, and the daily credit.
 *
 * @module dsh-xdpool/baizhi-upstream
 */

import { explainFailure } from './credential-errors.ts'
import { failureMessage } from './error-body.ts'
import {
  BAIZHI_ANTHROPIC_VERSION,
  BAIZHI_API_BASE,
  BAIZHI_PLATFORM,
  baizhiSolve,
  normalizeBaizhiModel,
  readBaizhiChallenge,
  type BaizhiCredential,
  type BaizhiModel,
  type BaizhiWallet,
} from './baizhi-protocol.ts'

/** What a catalogue read produced. */
export interface BaizhiCatalog {
  models: readonly BaizhiModel[]
  error?: string
}

/** What a check-in produced. */
export interface BaizhiCheckin {
  outcome: 'claimed' | 'done' | 'inactive' | 'failed'
  credit?: number
  message?: string
}

/** Read a finite number out of a record. */
function numberOf(record: Record<string, unknown>, key: string): number | undefined {
  const value = Number(record[key])
  return Number.isFinite(value) ? value : undefined
}

/** Unwrap the platform's envelope. */
function unwrap(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object') return {}
  const record = body as Record<string, unknown>
  const data = record['data']
  return data !== null && typeof data === 'object' ? data as Record<string, unknown> : record
}

/** Read the live catalogue. */
export async function baizhiCatalog(
  credential: BaizhiCredential,
  signal?: AbortSignal,
): Promise<BaizhiCatalog> {
  try {
    const response = await fetch(`${BAIZHI_API_BASE}/v1/models`, {
      headers: {
        'x-api-key': credential.apiKey,
        'anthropic-version': BAIZHI_ANTHROPIC_VERSION,
        accept: 'application/json',
      },
      signal: signal ?? AbortSignal.timeout(10_000),
    })
    if (!response.ok) return { models: [], error: explainFailure({ status: response.status, channel: '百智云' }) }
    const body = await response.json() as Record<string, unknown>
    const rows = Array.isArray(body['data']) ? body['data'] as unknown[] : []
    const models: BaizhiModel[] = []
    for (const row of rows) {
      const model = normalizeBaizhiModel(row)
      if (model !== undefined) models.push(model)
    }
    return models.length === 0 ? { models: [], error: '接口没有返回模型' } : { models }
  } catch (error: unknown) {
    return { models: [], error: error instanceof Error ? error.message : String(error) }
  }
}

/** Read the wallet. */
export async function baizhiWallet(
  credential: BaizhiCredential,
  signal?: AbortSignal,
): Promise<BaizhiWallet> {
  if (credential.sessionCookie === undefined || credential.sessionCookie === '') {
    return { error: '只有 API Key，读不到余额（钱包接口只认控制台登录态）' }
  }
  try {
    const response = await fetch(`${BAIZHI_PLATFORM}/api/v1/user/wallet/balance`, {
      headers: { cookie: credential.sessionCookie, accept: 'application/json' },
      signal: signal ?? AbortSignal.timeout(15_000),
    })
    if (!response.ok) return { error: explainFailure({ status: response.status, channel: '百智云' }) }
    const data = unwrap(await response.json() as unknown)
    /**
     * Amounts arrive in CENTS.
     *
     * The console divides by 100 before showing yuan; reporting cents would make an account
     * look a hundred times richer.
     */
    const cents = numberOf(data, 'balance') ?? numberOf(data, 'balance_credit_cents')
    return {
      ...cents === undefined ? {} : { balance: Math.round(cents) / 100 },
      ...data['daily_temporary_credit_claimed'] === true ? { dailyClaimed: true } : {},
    }
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** Post to the platform with the console session. */
async function platformPost(
  path: string,
  cookie: string,
  body: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  try {
    const response = await fetch(`${BAIZHI_PLATFORM}${path}`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body,
      signal: signal ?? AbortSignal.timeout(30_000),
    })
    if (!response.ok) return { ok: false, error: `HTTP ${String(response.status)}` }
    return { ok: true, data: unwrap(await response.json() as unknown) }
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Claim today's temporary credit.
 *
 * Four steps, and the last one cannot be judged from its own response: `claimed: false` means
 * either "already taken" or "not granted", and only the wallet can tell them apart.
 */
export async function baizhiCheckin(
  credential: BaizhiCredential,
  signal?: AbortSignal,
): Promise<BaizhiCheckin> {
  if (credential.sessionCookie === undefined || credential.sessionCookie === '') {
    // A key-only account cannot claim. That is "inactive", not "failed" — painting the card
    // red for a state the user cannot change is worse than saying nothing.
    return { outcome: 'inactive', message: '每日积分需要控制台登录态（浏览器登录后可领）' }
  }
  const cookie = credential.sessionCookie

  // 1. A challenge.
  const challengeResult = await platformPost('/api/v1/public/captcha/challenge', cookie, '{}', signal)
  if (!challengeResult.ok || challengeResult.data === undefined) {
    return { outcome: 'failed', message: `获取验证题失败：${challengeResult.error ?? '空响应'}` }
  }
  const challenge = readBaizhiChallenge(challengeResult.data)
  if ('error' in challenge) return { outcome: 'failed', message: challenge.error }

  // 2. Solve it here — the work is real, and the comparison is on hex text.
  let solutions: number[]
  try {
    solutions = baizhiSolve(challenge)
  } catch (error: unknown) {
    return { outcome: 'failed', message: error instanceof Error ? error.message : String(error) }
  }

  // 3. Redeem the solutions for a captcha token.
  const redeemResult = await platformPost(
    '/api/v1/public/captcha/redeem',
    cookie,
    JSON.stringify({ token: challenge.token, solutions }),
    signal,
  )
  if (!redeemResult.ok || redeemResult.data === undefined) {
    return { outcome: 'failed', message: `提交验证答案失败：${redeemResult.error ?? '空响应'}` }
  }
  const captchaToken = typeof redeemResult.data['token'] === 'string' ? redeemResult.data['token'] : ''
  if (captchaToken === '') {
    return { outcome: 'failed', message: '验证没有通过（redeem 响应里没有 token）—— 可能是题目已过期，请重试' }
  }

  // 4. Claim.
  const claimResult = await platformPost(
    '/api/v1/user/wallet/daily-temporary-credit',
    cookie,
    JSON.stringify({ captcha_token: captchaToken }),
    signal,
  )
  if (!claimResult.ok || claimResult.data === undefined) {
    return { outcome: 'failed', message: `领取失败：${claimResult.error ?? '空响应'}` }
  }
  const record = claimResult.data
  const cents = numberOf(record, 'amount_credit_cents')
  const credit = cents === undefined ? undefined : Math.round(cents) / 100
  if (record['claimed'] === false) {
    /**
     * `claimed: false` is ambiguous — resolve it against the wallet.
     *
     * `daily_temporary_credit_claimed: true` means today's credit is in and the vendor is just
     * declining a second one. Otherwise it genuinely was not granted.
     */
    const after = await baizhiWallet(credential, signal)
    if (after.dailyClaimed === true) {
      return {
        outcome: 'claimed',
        ...(credit === undefined ? {} : { credit }),
        message: '今日每日积分已领取（上游报 claimed:false，钱包确认已入账）',
      }
    }
    return { outcome: 'failed', message: '上游没有发放每日积分（claimed:false 且钱包未确认入账）' }
  }
  return {
    outcome: 'claimed',
    ...(credit === undefined ? {} : { credit }),
  }
}

/** One streamed piece. */
export interface BaizhiDelta {
  type: 'text' | 'reasoning'
  text: string
}

/** What a completed turn produced. */
export interface BaizhiResult {
  text: string
  reasoning: string
  finishReason?: string
  usage?: { input: number; output: number }
}

/** Run one chat turn over the Anthropic wire. */
export async function baizhiChat(input: {
  apiKey: string
  model: string
  messages: readonly unknown[]
  system?: string
  effort?: string
  maxTokens?: number
  signal: AbortSignal
  onDelta?: (delta: BaizhiDelta) => void
}): Promise<BaizhiResult> {
  const messages: Record<string, unknown>[] = []
  for (const message of input.messages) {
    if (message === null || typeof message !== 'object') continue
    const record = message as Record<string, unknown>
    const role = record['role']
    if (role === 'system' || role === 'developer') continue
    const content = record['content']
    messages.push({
      role: role === 'assistant' ? 'assistant' : 'user',
      content: typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.flatMap(block => {
            if (typeof block === 'string') return [{ type: 'text', text: block }]
            if (block !== null && typeof block === 'object') {
              const text = (block as Record<string, unknown>)['text']
              if (typeof text === 'string') return [{ type: 'text', text }]
            }
            return []
          })
          : '',
    })
  }

  const body: Record<string, unknown> = {
    model: input.model,
    messages,
    // The Anthropic protocol requires this field.
    max_tokens: input.maxTokens ?? 8_192,
    stream: true,
  }
  if (input.system !== undefined && input.system !== '') body['system'] = input.system
  if (input.effort !== undefined && input.effort !== '' && input.effort !== 'none') {
    const budgets: Record<string, number> = { low: 1_024, medium: 4_096, high: 16_384 }
    body['thinking'] = { type: 'enabled', budget_tokens: budgets[input.effort] ?? 4_096 }
  }

  const response = await fetch(`${BAIZHI_API_BASE}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': input.apiKey,
      'anthropic-version': BAIZHI_ANTHROPIC_VERSION,
      'content-type': 'application/json',
      accept: 'text/event-stream',
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
        if (kind === 'message_start') {
          const message = parsed['message']
          if (message !== null && typeof message === 'object') {
            const used = (message as Record<string, unknown>)['usage']
            if (used !== null && typeof used === 'object') {
              const value = Number((used as Record<string, unknown>)['input_tokens'])
              if (Number.isFinite(value)) usage.input = value
            }
          }
          continue
        }
        if (kind === 'message_delta') {
          const delta = parsed['delta']
          if (delta !== null && typeof delta === 'object') {
            const stop = (delta as Record<string, unknown>)['stop_reason']
            if (typeof stop === 'string' && stop !== '') finishReason = stop
          }
          const used = parsed['usage']
          if (used !== null && typeof used === 'object') {
            const value = Number((used as Record<string, unknown>)['output_tokens'])
            if (Number.isFinite(value)) usage.output = value
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
