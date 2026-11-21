/**
 * AStudio — the live catalogue, and the inference call.
 *
 * THE TWO THINGS THAT MAKE THIS CHANNEL FAIL SILENTLY
 *
 *   1. The inference BASE URL is per-row, delivered with the credentials. Hard-coding
 *      `astronstudio-api-volces-prod` returns `404 API endpoint not found` on every call while
 *      the CATALOGUE — which does still live there — keeps answering. The result looks like
 *      "the models load but nothing works".
 *   2. The `api_key` is short-lived and differs between two consecutive reads of the same
 *      endpoint. A credential captured once works for a while and then stops; it has to be
 *      re-minted from the SSO session.
 *
 * So a chat call resolves its own endpoint first, and a 401/404 is treated as "re-mint and try
 * once more" rather than as a dead account.
 *
 * @module dsh-xdpool/astudio-upstream
 */
import {
  ASTUDIO_CATALOG_PATH,
  ASTUDIO_CHAT_PATH,
  ASTUDIO_GATEWAY,
  ASTUDIO_MODELS,
  ASTUDIO_STUDIO_VERSION,
  ASTUDIO_WEB,
  type AstudioModel,
} from './astudio-models.ts'
import { failureMessage } from './error-body.ts'

/** Where one model can be reached, as the vendor describes it. */
export interface AstudioEndpoint {
  model: string
  baseUrl: string
  apiKey: string
}

/** What a fetch of the live catalogue produced. */
export interface AstudioCatalog {
  models: readonly AstudioModel[]
  endpoints: readonly AstudioEndpoint[]
  /** Why the read fell back, when it did. */
  error?: string
}

/** The bearer the catalogue and the gateway accept. */
export interface AstudioCredential {
  bearer: string
}

/** Read the envelope code. */
function codeOf(body: unknown): number | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const raw = (body as Record<string, unknown>)['code']
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** One catalogue row → the shape the card uses. */
function toModel(row: Record<string, unknown>): AstudioModel | undefined {
  /**
   * The bare slug only.
   *
   * `builtin/<base64>` is an internal alias of the desktop kernel; sending it to the gateway
   * is answered 502.
   */
  const raw = row['slug'] ?? row['model'] ?? row['id']
  const id = typeof raw === 'string' ? raw : ''
  if (id === '' || id.startsWith('builtin/')) return undefined
  // A row the vendor marked off-API is not callable even though it is listed.
  if (row['supported_in_api'] === false) return undefined
  const name = typeof row['display_name'] === 'string' && row['display_name'] !== ''
    ? row['display_name']
    : typeof row['name'] === 'string' && row['name'] !== '' ? row['name'] : id
  const context = Number(row['context_window'] ?? row['contextWindow'])
  const output = Number(row['max_output_tokens'] ?? row['maxOutputTokens'])
  const efforts = Array.isArray(row['thinking_efforts'])
    ? (row['thinking_efforts'] as unknown[]).filter((e): e is string => typeof e === 'string' && e !== '')
    : undefined
  const out: AstudioModel = {
    id,
    name,
    contextWindow: Number.isFinite(context) && context > 0 ? context : 128_000,
    ...Number.isFinite(output) && output > 0 ? { maxOutputTokens: Math.floor(output) } : {},
    ...efforts === undefined || efforts.length === 0 ? {} : { efforts },
    ...row['free'] === true || row['limited_free'] === true ? { free: true } : {},
  }
  return out
}

/** One endpoint row → where a model can be reached. */
function toEndpoint(row: Record<string, unknown>): AstudioEndpoint | undefined {
  const model = row['model'] ?? row['slug'] ?? row['id']
  const baseUrl = row['base_url'] ?? row['baseUrl']
  const apiKey = row['api_key'] ?? row['apiKey']
  if (typeof model !== 'string' || model === '') return undefined
  if (typeof baseUrl !== 'string' || baseUrl === '') return undefined
  if (typeof apiKey !== 'string' || apiKey === '') return undefined
  return { model, baseUrl: baseUrl.replace(/\/+$/u, ''), apiKey }
}

/**
 * Read the live catalogue.
 *
 * The endpoint list is fetched alongside it because the gateway address travels WITH the
 * credentials rather than being a constant.
 */
export async function astudioCatalog(
  credential: AstudioCredential,
  signal?: AbortSignal,
): Promise<AstudioCatalog> {
  const models: AstudioModel[] = []
  const endpoints: AstudioEndpoint[] = []
  let error: string | undefined

  try {
    const response = await fetch(`${ASTUDIO_GATEWAY}${ASTUDIO_CATALOG_PATH}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${credential.bearer}`,
        clientType: '21',
        studioVersion: ASTUDIO_STUDIO_VERSION,
      },
      signal: signal ?? AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      error = `HTTP ${String(response.status)}`
    } else {
      const body = await response.json() as Record<string, unknown>
      const code = codeOf(body)
      if (code !== undefined && code !== 0) {
        const message = body['message'] ?? body['desc']
        error = typeof message === 'string' && message !== '' ? message : `code=${String(code)}`
      } else {
        /**
         * The envelope is `{code, message, data: {models: [...]}}`.
         *
         * Testing `Array.isArray(body.data)` misses it (data is an object, models is the
         * array), which left the catalogue permanently empty and the card stuck on the
         * fallback rows.
         */
        const data = body['data']
        const rows = Array.isArray((data as Record<string, unknown> | undefined)?.['models'])
          ? ((data as Record<string, unknown>)['models'] as unknown[])
          : Array.isArray(data) ? data : Array.isArray(body) ? body : []
        for (const row of rows) {
          if (row === null || typeof row !== 'object') continue
          const model = toModel(row as Record<string, unknown>)
          if (model !== undefined) models.push(model)
          const endpoint = toEndpoint(row as Record<string, unknown>)
          if (endpoint !== undefined) endpoints.push(endpoint)
        }
      }
    }
  } catch (cause: unknown) {
    error = cause instanceof Error ? cause.message : String(cause)
  }

  /**
   * Models the gateway serves while the catalogue has not listed them yet.
   *
   * A measured case is kept in the static table; the live row wins the moment it appears.
   */
  const known = new Set(models.map(model => model.id))
  for (const model of ASTUDIO_MODELS) {
    if (!known.has(model.id)) models.push(model)
  }

  return {
    models,
    endpoints,
    ...(error === undefined ? {} : { error }),
  }
}

/**
 * Read the endpoint rows that carry a fresh `api_key`.
 *
 * Called on its own when a chat request is refused: the credential is short-lived, and this is
 * the cheap way to find out whether the session is still alive.
 */
export async function astudioEndpoints(
  credential: AstudioCredential,
  signal?: AbortSignal,
): Promise<readonly AstudioEndpoint[]> {
  try {
    const response = await fetch(`${ASTUDIO_WEB}/bot/models/configs`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${credential.bearer}`,
        'Content-Type': 'application/json',
        clientType: '21',
        studioVersion: ASTUDIO_STUDIO_VERSION,
      },
      signal: signal ?? AbortSignal.timeout(20_000),
    })
    if (!response.ok) return []
    const body = await response.json() as Record<string, unknown>
    const code = codeOf(body)
    if (code !== undefined && code !== 0) return []
    const data = body['data']
    const rows = Array.isArray((data as Record<string, unknown> | undefined)?.['models'])
      ? ((data as Record<string, unknown>)['models'] as unknown[])
      : Array.isArray(data) ? data : []
    const out: AstudioEndpoint[] = []
    for (const row of rows) {
      if (row === null || typeof row !== 'object') continue
      const endpoint = toEndpoint(row as Record<string, unknown>)
      if (endpoint !== undefined) out.push(endpoint)
    }
    return out
  } catch {
    return []
  }
}

/** One streamed piece. */
export interface AstudioDelta {
  type: 'text' | 'reasoning'
  text: string
}

/** What a completed turn produced. */
export interface AstudioResult {
  text: string
  reasoning: string
  servedModel?: string
  usage?: { input: number; output: number }
}

/**
 * Run one chat turn.
 *
 * `endpoint` must come from a fresh read — the base URL moves and the key rotates. The default
 * gateway is used only when the vendor published no row for this model.
 */
export async function astudioChat(input: {
  bearer: string
  model: string
  messages: readonly unknown[]
  system?: string
  reasoningEffort?: string
  endpoint?: AstudioEndpoint
  signal: AbortSignal
  onDelta?: (delta: AstudioDelta) => void
}): Promise<AstudioResult> {
  const baseUrl = input.endpoint?.baseUrl ?? ASTUDIO_GATEWAY
  const apiKey = input.endpoint?.apiKey ?? input.bearer
  const messages = [...input.messages]
  if (input.system !== undefined && input.system !== '') {
    messages.unshift({ role: 'system', content: input.system })
  }
  const body: Record<string, unknown> = {
    model: input.model,
    messages: messages.map(message => {
      if (message === null || typeof message !== 'object') return message
      const record = message as Record<string, unknown>
      return { role: record['role'], content: record['content'] }
    }),
    stream: true,
  }
  if (input.reasoningEffort !== undefined && input.reasoningEffort !== '') {
    body['reasoning_effort'] = input.reasoningEffort
  }

  const response = await fetch(`${baseUrl}${ASTUDIO_CHAT_PATH}`, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      clientType: '21',
      studioVersion: ASTUDIO_STUDIO_VERSION,
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
