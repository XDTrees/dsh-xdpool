/**
 * 百智云 as a host adapter.
 *
 * An Anthropic-shaped gateway with an API key. The daily credit needs a console session, which
 * the adapter does not use — it is here for the card's check-in button.
 *
 * @module dsh-xdpool/baizhi-host-adapter
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
  BAIZHI_MAX_CONTEXT,
  BAIZHI_MAX_OUTPUT,
  type BaizhiCredential,
  type BaizhiModel,
} from './baizhi-protocol.ts'
import { baizhiCatalog, baizhiChat } from './baizhi-upstream.ts'

/** The provider id the picker groups by. */
export const BAIZHI_PROVIDER_ID = 'baizhi'

/** The name the picker shows. */
export const BAIZHI_PROVIDER_NAME = '百智云'

/** How long a catalogue read stays usable. */
const CATALOG_TTL_MS = 10 * 60_000

/** The ladder offered for a model that reasons. */
const EFFORTS: readonly string[] = ['none', 'low', 'medium', 'high']

/** The ladder's display names. */
const EFFORT_LABELS: Readonly<Record<string, string>> = {
  none: '关闭',
  low: '低',
  medium: '中',
  high: '高',
}

export interface BaizhiHostAdapterOptions {
  credential: () => Promise<BaizhiCredential | undefined>
}

export class BaizhiHostAdapter extends LlmAdapter {
  private readonly options: BaizhiHostAdapterOptions
  private models: readonly BaizhiModel[] = []
  private modelsAt = 0
  /**
   * Which account the cached list was built for.
   *
   * The TTL alone is not enough: signing into a DIFFERENT account within ten minutes kept the
   * previous account's catalogue, so the card showed models the new account cannot use and none
   * of the ones it can.
   */
  private modelsFor: string | undefined

  constructor(options: BaizhiHostAdapterOptions) {
    super()
    this.options = options
  }

  override providerInfo(_provider: string): LlmProviderInfo {
    return { id: BAIZHI_PROVIDER_ID, name: BAIZHI_PROVIDER_NAME }
  }

  override async listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    const credential = await this.options.credential()
    if (credential === undefined || credential.apiKey === '') return []
    await this.refresh(credential)
    return this.models.map(model => this.describe(model))
  }

  override async resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const known = this.models.find(row => row.id === model)
    return this.describe(known ?? { id: model, name: model, reasoning: false })
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const resolved = await this.resolveModel(provider, model, signal)
    return { model: resolved, stream: (streamOptions: GenerateOptions) => this.stream(streamOptions) }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const credential = await this.options.credential()
    if (credential === undefined || credential.apiKey === '') {
      throw new LlmError('还没有 API Key。请在百智云卡片里粘贴一个。', 'auth')
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
    const turn = baizhiChat({
      apiKey: credential.apiKey,
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

  /** Read the catalogue once per TTL. */
  private async refresh(credential: BaizhiCredential): Promise<void> {
    const changed = this.modelsFor !== credential.apiKey
    if (!changed && this.models.length > 0 && Date.now() - this.modelsAt < CATALOG_TTL_MS) return
    const live = await baizhiCatalog(credential)
    if (live.models.length > 0) {
      this.models = live.models
      this.modelsFor = credential.apiKey
      this.modelsAt = Date.now()
    }
  }

  /** Everything the picker shows for one model. */
  private describe(model: BaizhiModel): LlmResolvedModelInfo {
    const efforts = model.reasoning ? EFFORTS : []
    return {
      provider: BAIZHI_PROVIDER_ID,
      id: model.id,
      name: model.name,
      /**
       * An unknown image capability is reported as text-only.
       *
       * The vendor leaves the flag off some rows, and "unknown" cannot be expressed here — but
       * claiming an image capability a model does not have fails at request time, which is
       * worse than not offering it.
       */
      inputModalities: model.vision === true ? ['text', 'image'] : ['text'],
      defaultMaxTokens: model.maxOutputTokens ?? BAIZHI_MAX_OUTPUT,
      context: { contextWindow: model.contextWindow ?? BAIZHI_MAX_CONTEXT },
      ...(efforts.length === 0
        ? {}
        : {
          reasoning: {
            efforts: efforts.map(effort => ({
              id: ReasoningEffortId(effort),
              name: EFFORT_LABELS[effort] ?? effort,
            })),
            defaultEffort: ReasoningEffortId('medium'),
          },
        }),
    }
  }
}
