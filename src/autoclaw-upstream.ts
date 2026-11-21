/**
 * AutoClaw — the chat call, the catalogue, and the wallet.
 *
 * @module dsh-xdpool/autoclaw-upstream
 */
import {
  AUTOCLAW_CONTEXT_WINDOW,
  AUTOCLAW_MODELS,
  AUTOCLAW_SOURCE_ID,
  AUTOCLAW_SYSTEM_PREFIX,
  AUTOCLAW_WALLET_LABELS,
  autoclawHeaders,
  autoclawAuthHeaders,
  autoclawDeviceId,
  autoclawSign,
  AUTOCLAW_LOGIN_PATH,
  AUTOCLAW_SEND_CODE_PATH,
  type AutoclawBucket,
  type AutoclawCredential,
  type AutoclawModel,
  type AutoclawSite,
} from './autoclaw-protocol.ts'
import { failureMessage } from './error-body.ts'

/** What a catalogue read produced. */
export interface AutoclawCatalog {
  models: readonly AutoclawModel[]
  error?: string
}

/** The wallet. */
export interface AutoclawWallet {
  buckets: readonly AutoclawBucket[]
  /** The sum across buckets, which is what the card headlines. */
  total: number
  error?: string
}

/** The wallet endpoints use their own header set, without the chat signature. */
function walletHeaders(credential: Pick<AutoclawCredential, 'accessToken'>): Record<string, string> {
  const timestamp = String(Date.now())
  return {
    authorization: `Bearer ${credential.accessToken}`,
    accept: 'application/json',
    'x-app-id': '100003',
    'x-timestamp': timestamp,
    'x-sign': autoclawSign(timestamp),
    'x-source-id': AUTOCLAW_SOURCE_ID,
  }
}

/** Read the live catalogue, keeping the measured table as a floor. */
export async function autoclawCatalog(
  site: AutoclawSite,
  credential: AutoclawCredential,
  signal?: AbortSignal,
): Promise<AutoclawCatalog> {
  try {
    const response = await fetch(`${site.apiBase}/autoclaw-proxy/proxy/autoclaw-model-config`, {
      headers: autoclawHeaders(credential),
      signal: signal ?? AbortSignal.timeout(20_000),
    })
    if (!response.ok) return { models: AUTOCLAW_MODELS, error: `HTTP ${String(response.status)}` }
    const body = await response.json() as Record<string, unknown>
    const rows = Array.isArray(body['data'])
      ? body['data'] as unknown[]
      : Array.isArray((body['data'] as Record<string, unknown> | undefined)?.['models'])
        ? ((body['data'] as Record<string, unknown>)['models'] as unknown[])
        : []
    const models: AutoclawModel[] = []
    const seen = new Set<string>()
    for (const row of rows) {
      if (row === null || typeof row !== 'object') continue
      const record = row as Record<string, unknown>
      const id = String(record['routeModelId'] ?? record['id'] ?? record['model'] ?? '')
      if (id === '' || seen.has(id)) continue
      seen.add(id)
      const name = String(record['name'] ?? record['displayName'] ?? id)
      models.push({ id, name: name === '' ? id : name, free: record['free'] === true })
    }
    /**
     * The free flash model is absent from the remote catalogue.
     *
     * It is the only free option, so dropping it would leave the card with nothing that costs
     * zero — the measured table fills that gap rather than being replaced.
     */
    for (const fallback of AUTOCLAW_MODELS) {
      if (!seen.has(fallback.id)) models.push(fallback)
    }
    return { models }
  } catch (error: unknown) {
    return { models: AUTOCLAW_MODELS, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Read the wallet across every bucket. */
export async function autoclawWallet(
  site: AutoclawSite,
  credential: AutoclawCredential,
  signal?: AbortSignal,
): Promise<AutoclawWallet> {
  try {
    const response = await fetch(
      `${site.apiBase}/agent-assetmgr/api/v2/wallets?biz_app_id=${AUTOCLAW_SOURCE_ID}`,
      { headers: walletHeaders(credential), signal: signal ?? AbortSignal.timeout(20_000) },
    )
    if (!response.ok) return { buckets: [], total: 0, error: `HTTP ${String(response.status)}` }
    const body = await response.json() as Record<string, unknown>
    const data = body['data']
    const rows = Array.isArray(data)
      ? data as unknown[]
      : Array.isArray((data as Record<string, unknown> | undefined)?.['wallets'])
        ? ((data as Record<string, unknown>)['wallets'] as unknown[])
        : []
    const buckets: AutoclawBucket[] = []
    for (const row of rows) {
      if (row === null || typeof row !== 'object') continue
      const record = row as Record<string, unknown>
      const type = String(record['walletType'] ?? record['type'] ?? 'other')
      const raw = Number(record['balance'] ?? record['amount'] ?? 0)
      if (!Number.isFinite(raw)) continue
      buckets.push({
        type,
        // The label comes from the vendor's own vocabulary; renaming it would make the card
        // disagree with the console a user compares it against.
        label: AUTOCLAW_WALLET_LABELS[type] ?? type,
        balance: raw,
      })
    }
    const total = buckets.reduce((sum, bucket) => sum + bucket.balance, 0)
    return { buckets, total }
  } catch (error: unknown) {
    return { buckets: [], total: 0, error: error instanceof Error ? error.message : String(error) }
  }
}

/** One streamed piece. */
export interface AutoclawDelta {
  type: 'text' | 'reasoning'
  text: string
}

/** What a completed turn produced. */
export interface AutoclawResult {
  text: string
  reasoning: string
  servedModel?: string
  usage?: { input: number; output: number }
}

/** Run one chat turn. */
export async function autoclawChat(input: {
  site: AutoclawSite
  credential: AutoclawCredential
  model: string
  messages: readonly unknown[]
  system?: string
  effort?: string
  signal: AbortSignal
  onDelta?: (delta: AutoclawDelta) => void
}): Promise<AutoclawResult> {
  const messages = [...input.messages]
  /**
   * The vendor's proxy looks for its own system prefix.
   *
   * A request without it is refused in a way that reads like a broken account, so it is
   * prepended to whatever the caller sent rather than replacing it.
   */
  const system = input.system === undefined || input.system === ''
    ? AUTOCLAW_SYSTEM_PREFIX
    : `${AUTOCLAW_SYSTEM_PREFIX}\n\n${input.system}`
  messages.unshift({ role: 'system', content: system })

  const body: Record<string, unknown> = {
    model: input.model,
    messages: messages.map(message => {
      if (message === null || typeof message !== 'object') return message
      const record = message as Record<string, unknown>
      return { role: record['role'], content: record['content'] }
    }),
    stream: true,
  }
  if (input.effort !== undefined && input.effort !== '') body['reasoning_effort'] = input.effort

  const response = await fetch(`${input.site.apiBase}/autoclaw-proxy/proxy/autoclaw/chat/completions`, {
    method: 'POST',
    headers: { ...autoclawHeaders(input.credential), accept: 'text/event-stream' },
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
  let servedModel: string | undefined
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
        const model = parsed['model']
        if (typeof model === 'string' && model !== '') servedModel = model
        const used = parsed['usage']
        if (used !== null && typeof used === 'object') {
          const u = used as Record<string, unknown>
          if (typeof u['prompt_tokens'] === 'number') usage.input = u['prompt_tokens']
          if (typeof u['completion_tokens'] === 'number') usage.output = u['completion_tokens']
        }
        const choices = parsed['choices']
        if (!Array.isArray(choices)) continue
        for (const choice of choices) {
          if (choice === null || typeof choice !== 'object') continue
          const delta = (choice as Record<string, unknown>)['delta']
          if (delta === null || typeof delta !== 'object') continue
          const d = delta as Record<string, unknown>
          const piece = typeof d['content'] === 'string' ? d['content'] : ''
          if (piece !== '') {
            text += piece
            input.onDelta?.({ type: 'text', text: piece })
          }
          const thought = typeof d['reasoning_content'] === 'string'
            ? d['reasoning_content']
            : typeof d['reasoning'] === 'string' ? d['reasoning'] : ''
          if (thought !== '') {
            reasoning += thought
            input.onDelta?.({ type: 'reasoning', text: thought })
          }
        }
      }
    }
  }

  return {
    text,
    reasoning,
    ...(servedModel === undefined ? {} : { servedModel }),
    ...(usage.input === 0 && usage.output === 0 ? {} : { usage }),
  }
}

/** The window every model on this gateway declares. */
export const AUTOCLAW_WINDOW = AUTOCLAW_CONTEXT_WINDOW

/**
 * Send a login code to a phone number.
 *
 * `source_id` and `device_id` both travel in the body: the endpoint refuses a request without
 * them, and the device id is what ties the eventual session to this machine.
 */
export async function autoclawSendCode(
  site: AutoclawSite,
  phone: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = phone.trim()
  if (!/^1[3-9]\d{9}$/u.test(trimmed)) return { ok: false, error: '手机号格式不正确' }
  try {
    const response = await fetch(`${site.apiBase}${AUTOCLAW_SEND_CODE_PATH}`, {
      method: 'POST',
      headers: autoclawAuthHeaders(),
      body: JSON.stringify({
        phone: trimmed,
        source_id: AUTOCLAW_SOURCE_ID,
        device_id: autoclawDeviceId(),
      }),
      signal: signal ?? AbortSignal.timeout(25_000),
    })
    const text = await response.text()
    if (!response.ok) return { ok: false, error: failureMessage(response.status, text) }
    const body = JSON.parse(text) as { code?: number; msg?: string }
    if (typeof body.code === 'number' && body.code !== 0) {
      return { ok: false, error: body.msg ?? `验证码发送失败（code ${String(body.code)}）` }
    }
    return { ok: true }
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Exchange phone + code for the credential pair.
 *
 * ⚠️ The expiry is taken from the vendor or from the token's own `exp` — never invented. Writing
 * a guessed seven-day life when the real token lasts a day means the refresh logic never fires,
 * and the account shows 「凭据失效」 a day after a sign-in that looked successful.
 */
export async function autoclawLoginWithCode(
  site: AutoclawSite,
  phone: string,
  code: string,
  signal?: AbortSignal,
): Promise<{ accessToken: string; refreshToken?: string; nickname?: string; expiresAt?: number }> {
  const trimmedPhone = phone.trim()
  const trimmedCode = code.trim()
  if (!/^1[3-9]\d{9}$/u.test(trimmedPhone)) throw new Error('手机号格式不正确')
  if (!/^\d+$/u.test(trimmedCode)) throw new Error('验证码必须是纯数字')

  const response = await fetch(`${site.apiBase}${AUTOCLAW_LOGIN_PATH}`, {
    method: 'POST',
    headers: autoclawAuthHeaders(),
    body: JSON.stringify({
      phone: trimmedPhone,
      code: Number(trimmedCode),
      source_id: AUTOCLAW_SOURCE_ID,
      device_id: autoclawDeviceId(),
    }),
    signal: signal ?? AbortSignal.timeout(25_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(failureMessage(response.status, text))

  const body = JSON.parse(text) as {
    code?: number
    msg?: string
    data?: {
      access_token?: string
      refresh_token?: string
      user_name?: string
      user_phone?: string
      expires_in?: number
      expires_at?: number
    }
  }
  if (typeof body.code === 'number' && body.code !== 0) {
    throw new Error(body.msg ?? `登录失败（code ${String(body.code)}）`)
  }
  const data = body.data
  if (data === undefined || typeof data.access_token !== 'string' || data.access_token === '') {
    throw new Error('登录响应里没有 access_token')
  }
  const accessToken = data.access_token.replace(/^Bearer\s+/iu, '').trim()
  const refreshToken = typeof data.refresh_token === 'string'
    ? data.refresh_token.replace(/^Bearer\s+/iu, '').trim()
    : undefined

  /**
   * The token's own `exp` is the authority.
   *
   * The vendor sometimes omits `expires_in`/`expires_at` entirely, and a guessed lifetime is
   * worse than none: the refresh check compares against this number, so an over-long guess
   * silently skips every refresh until the account breaks.
   */
  let expiresAt: number | undefined
  const declared = typeof data.expires_at === 'number'
    ? data.expires_at
    : typeof data.expires_in === 'number'
      ? Math.floor(Date.now() / 1000) + data.expires_in
      : undefined
  if (declared !== undefined) {
    // The vendor sends seconds; a value that large cannot be milliseconds.
    expiresAt = declared < 10_000_000_000 ? declared * 1000 : declared
  } else {
    expiresAt = jwtExpiry(accessToken)
  }

  const nickname = typeof data.user_name === 'string' && data.user_name !== ''
    ? data.user_name
    : typeof data.user_phone === 'string' && data.user_phone !== ''
      ? data.user_phone
      : undefined

  return {
    accessToken,
    ...(refreshToken === undefined || refreshToken === '' ? {} : { refreshToken }),
    ...(nickname === undefined ? {} : { nickname }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  }
}

/**
 * Read `exp` out of a JWT, in milliseconds.
 *
 * Undefined when the token is not a JWT or carries no `exp` — "unknown" is a real answer, and the
 * caller treats it as "refresh when needed" rather than as "valid forever".
 */
function jwtExpiry(token: string): number | undefined {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return undefined
    const payload = JSON.parse(Buffer.from(parts[1] ?? '', 'base64').toString('utf8')) as { exp?: unknown }
    return typeof payload.exp === 'number' ? payload.exp * 1000 : undefined
  } catch {
    return undefined
  }
}
