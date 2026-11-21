/**
 * AutoClaw as a host adapter — one class, two sites.
 *
 * @module dsh-xdpool/autoclaw-host-adapter
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
  AUTOCLAW_CONTEXT_WINDOW,
  AUTOCLAW_EFFORTS,
  AUTOCLAW_MODELS,
  type AutoclawCredential,
  type AutoclawModel,
  type AutoclawSite,
} from './autoclaw-protocol.ts'
import { autoclawCatalog, autoclawChat } from './autoclaw-upstream.ts'

/** How long a catalogue read stays usable. */
const CATALOG_TTL_MS = 10 * 60_000

/** The output ceiling the vendor does not publish. */
const MAX_OUTPUT = 64_000

/** The ladder's display names. */
const EFFORT_LABELS: Readonly<Record<string, string>> = {
  low: '低',
  high: '高',
  max: '最高',
}

export interface AutoclawHostAdapterOptions {
  site: AutoclawSite
  credential: () => Promise<AutoclawCredential | undefined>
}

export class AutoclawHostAdapter extends LlmAdapter {
  private readonly options: AutoclawHostAdapterOptions
  private models: readonly AutoclawModel[] = AUTOCLAW_MODELS
  private modelsAt = 0
  /**
   * Which account the cached list was built for.
   *
   * The TTL alone is not enough: signing into a DIFFERENT account within ten minutes kept the
   * previous account's catalogue, so the card showed models the new account cannot use and none
   * of the ones it can.
   */
  private modelsFor: string | undefined
  private live = false

  constructor(options: AutoclawHostAdapterOptions) {
    super()
    this.options = options
  }

  override providerInfo(_provider: string): LlmProviderInfo {
    return { id: this.options.site.id, name: this.options.site.displayName }
  }

  override async listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    const credential = await this.options.credential()
    if (credential === undefined || credential.accessToken === '') return []
    await this.refresh(credential)
    return this.models.map(model => this.describe(model))
  }

  override async resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const known = this.models.find(row => row.id === model)
    return this.describe(known ?? { id: model, name: model, free: false })
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const resolved = await this.resolveModel(provider, model, signal)
    return { model: resolved, stream: (streamOptions: GenerateOptions) => this.stream(streamOptions) }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const credential = await this.options.credential()
    if (credential === undefined || credential.accessToken === '') {
      throw new LlmError('还没有登录态。请在 AutoClaw 卡片里粘贴凭据。', 'auth')
    }
    const modelId = typeof options['model'] === 'string' ? options['model'] : ''
    if (modelId === '') throw new LlmError('这条请求没有指定模型', 'invalid')
    const messages = Array.isArray(options['messages']) ? options['messages'] as unknown[] : []
    const system = typeof options['system'] === 'string' ? options['system'] : ''
    const requested = options['reasoningEffort']
    const effort = typeof requested === 'string' && requested !== '' ? requested : undefined
    const signal = options['signal'] instanceof AbortSignal
      ? options['signal'] as AbortSignal
      : new AbortController().signal

    const queue: { type: 'text' | 'reasoning'; text: string }[] = []
    let done = false
    let failure: Error | undefined
    const turn = autoclawChat({
      site: this.options.site,
      credential,
      model: modelId,
      messages,
      ...(system === '' ? {} : { system }),
      ...(effort === undefined ? {} : { effort }),
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

  /** Read the catalogue once per TTL, keeping the measured table if the call fails. */
  private async refresh(credential: AutoclawCredential): Promise<void> {
    const changed = this.modelsFor !== credential.accessToken
    if (!changed && this.live && Date.now() - this.modelsAt < CATALOG_TTL_MS) return
    const result = await autoclawCatalog(this.options.site, credential)
    if (result.error === undefined && result.models.length > 0) {
      this.models = result.models
      this.modelsFor = credential.accessToken
      this.modelsAt = Date.now()
      this.live = true
    }
  }

  /** Everything the picker shows for one model. */
  private describe(model: AutoclawModel): LlmResolvedModelInfo {
    return {
      provider: this.options.site.id,
      id: model.id,
      name: model.free ? `${model.name}（限免）` : model.name,
      inputModalities: ['text'],
      defaultMaxTokens: MAX_OUTPUT,
      context: { contextWindow: AUTOCLAW_CONTEXT_WINDOW },
      reasoning: {
        efforts: AUTOCLAW_EFFORTS.map(effort => ({
          id: ReasoningEffortId(effort),
          name: EFFORT_LABELS[effort] ?? effort,
        })),
        /**
         * `off` is expressed by Omitting the field, which is why there is no `none` rung — the
         * vendor's client does the same.
         */
        defaultEffort: ReasoningEffortId('high'),
      },
    }
  }
}
