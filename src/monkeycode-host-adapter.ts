/**
 * MonkeyCode as a host adapter — one class, two sites.
 *
 * The Anthropic wire differs from every other channel here, so the body shape is built in the
 * upstream module and this file only maps the picker's facts onto it.
 *
 * @module dsh-xdpool/monkeycode-host-adapter
 */
import {
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type PreparedAdapterCall,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  MONKEYCODE_DEFAULT_EFFORT,
  MONKEYCODE_EFFORTS,
  MONKEYCODE_MODELS,
  type MonkeycodeCredential,
  type MonkeycodeModel,
  type MonkeycodeSite,
} from './monkeycode-protocol.ts'
import { monkeycodeChat, monkeycodeExchangeKey } from './monkeycode-upstream.ts'
import { monkeycodeSecretFor, rememberMonkeycodeSecret, saveMonkeycodeCredential } from './monkeycode-store.ts'

/** The ladder's display names. */
const EFFORT_LABELS: Readonly<Record<string, string>> = {
  none: '关闭',
  low: '低',
  medium: '中',
  high: '高',
}

export interface MonkeycodeHostAdapterOptions {
  site: MonkeycodeSite
  credential: () => Promise<MonkeycodeCredential | undefined>
}

export class MonkeycodeHostAdapter extends LlmAdapter {
  private readonly options: MonkeycodeHostAdapterOptions

  constructor(options: MonkeycodeHostAdapterOptions) {
    super()
    this.options = options
  }

  override providerInfo(_provider: string): LlmProviderInfo {
    return { id: this.options.site.id, name: this.options.site.displayName }
  }

  override async listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    const credential = await this.options.credential()
    // The catalogue is a fixed table — `/v1/models` answers 405 — so only the sign-in gate
    // decides whether the group appears.
    if (credential === undefined || credential.cookie === '') return []
    return MONKEYCODE_MODELS.map(model => this.describe(model))
  }

  override async resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const known = MONKEYCODE_MODELS.find(row => row.id === model)
    return this.describe(known ?? {
      id: model,
      name: model,
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
      reasoning: false,
    })
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const resolved = await this.resolveModel(provider, model, signal)
    return { model: resolved, stream: (streamOptions: GenerateOptions) => this.stream(streamOptions) }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const credential = await this.options.credential()
    if (credential === undefined || credential.cookie === '') {
      throw new LlmError('还没有登录态。请在 MonkeyCode 卡片里登录一次。', 'auth')
    }
    const keys = await this.keysFor(credential)
    if (keys === undefined) {
      throw new LlmError('网关密钥换取失败。请重新登录一次。', 'auth')
    }
    const modelId = typeof options['model'] === 'string' ? options['model'] : ''
    if (modelId === '') throw new LlmError('这条请求没有指定模型', 'invalid')
    const messages = Array.isArray(options['messages']) ? options['messages'] as unknown[] : []
    const system = typeof options['system'] === 'string' ? options['system'] : ''
    const requested = options['reasoningEffort']
    const effort = typeof requested === 'string' && requested !== '' ? requested : MONKEYCODE_DEFAULT_EFFORT
    const signal = options['signal'] instanceof AbortSignal
      ? options['signal'] as AbortSignal
      : new AbortController().signal

    const queue: { type: 'text' | 'reasoning'; text: string }[] = []
    let done = false
    let failure: Error | undefined
    const turn = monkeycodeChat({
      site: this.options.site,
      apiKey: keys.apiKey,
      signingSecret: keys.signingSecret,
      model: modelId,
      messages,
      ...(system === '' ? {} : { system }),
      effort,
      signal,
      onDelta: delta => { queue.push(delta) },
    })
      .catch((error: unknown) => { failure = error instanceof Error ? error : new Error(String(error)) })
      .finally(() => { done = true })

    while (!done || queue.length > 0) {
      const next = queue.shift()
      if (next !== undefined) {
        yield next.type === 'reasoning'
          ? { type: 'reasoning-delta', index: 0, text: next.text }
          : { type: 'text-delta', index: 0, text: next.text }
        continue
      }
      if (done) break
      await Promise.race([turn, new Promise(resolve => setTimeout(resolve, 20))])
    }
    await turn
    if (failure !== undefined) throw failure
  }

  /**
   * The gateway key and its signing secret.
   *
   * The secret is not stored on disk — it is re-derived from the session cookie when this
   * process does not already hold it, because a secret on disk is one more thing to leak.
   */
  private async keysFor(
    credential: MonkeycodeCredential,
  ): Promise<{ apiKey: string; signingSecret: string } | undefined> {
    const cachedSecret = monkeycodeSecretFor(this.options.site.id)
    if (credential.apiKey !== undefined && credential.apiKey !== '' && cachedSecret !== undefined) {
      return { apiKey: credential.apiKey, signingSecret: cachedSecret }
    }
    const exchanged = await monkeycodeExchangeKey(this.options.site, credential.cookie)
    if (exchanged.apiKey === undefined || exchanged.signingSecret === undefined) return undefined
    rememberMonkeycodeSecret(this.options.site.id, exchanged.signingSecret)
    await saveMonkeycodeCredential({ ...credential, apiKey: exchanged.apiKey })
    return { apiKey: exchanged.apiKey, signingSecret: exchanged.signingSecret }
  }

  /** Everything the picker shows for one model. */
  private describe(model: MonkeycodeModel): LlmResolvedModelInfo {
    /**
     * Only a model the gateway genuinely gives a ladder gets one.
     *
     * `glm-5` says no on purpose: declaring efforts for it would make the host send a thinking
     * budget that the gateway drops, so the model would silently behave as if the choice had
     * been ignored.
     */
    const efforts = model.reasoning ? MONKEYCODE_EFFORTS : []
    return {
      provider: this.options.site.id,
      id: model.id,
      name: model.name,
      inputModalities: ['text'],
      defaultMaxTokens: model.maxOutputTokens,
      context: { contextWindow: model.contextWindow },
      ...(efforts.length === 0
        ? {}
        : {
          reasoning: {
            efforts: efforts.map(effort => ({
              id: ReasoningEffortId(effort),
              name: EFFORT_LABELS[effort] ?? effort,
            })),
            defaultEffort: ReasoningEffortId(MONKEYCODE_DEFAULT_EFFORT),
          },
        }),
    }
  }
}
