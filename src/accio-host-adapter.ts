/**
 * Accio as a host adapter.
 *
 * The catalogue is read once and cached; it is cheap (a config read, not a call) but the list
 * changes rarely.
 *
 * The wire id is the `modelCode`. The catalogue's public id is a slug, so the adapter keeps the
 * pairing between them — a picker entry carries the slug, a request carries the code, and this
 * is the one place that knows both.
 *
 * @module dsh-xdpool/accio-host-adapter
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
import { type AccioCredential, type AccioModel } from './accio-protocol.ts'
import { accioCatalog, accioChat } from './accio-upstream.ts'

/** The provider id the picker groups by. */
export const ACCIO_PROVIDER_ID = 'accio'

/** The name the picker shows. */
export const ACCIO_PROVIDER_NAME = 'Accio 阿里'

/** How long a catalogue read stays usable. */
const CATALOG_TTL_MS = 10 * 60_000

/** The output ceiling when the catalogue does not publish one. */
const DEFAULT_MAX_OUTPUT = 32_000

/** The ladder's display names. */
const EFFORT_LABELS: Readonly<Record<string, string>> = {
  none: '关闭',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
}

export interface AccioHostAdapterOptions {
  credential: () => Promise<AccioCredential | undefined>
}

export class AccioHostAdapter extends LlmAdapter {
  private readonly options: AccioHostAdapterOptions
  private models: readonly AccioModel[] = []
  private modelsAt = 0
  /**
   * Which account the cached list was built for.
   *
   * The TTL alone is not enough: signing into a DIFFERENT account within ten minutes kept the
   * previous account's catalogue, so the card showed models the new account cannot use and none
   * of the ones it can.
   */
  private modelsFor: string | undefined

  constructor(options: AccioHostAdapterOptions) {
    super()
    this.options = options
  }

  override providerInfo(_provider: string): LlmProviderInfo {
    return { id: ACCIO_PROVIDER_ID, name: ACCIO_PROVIDER_NAME }
  }

  override async listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    const credential = await this.options.credential()
    if (credential === undefined || credential.accessToken === '') return []
    await this.refresh(credential)
    return this.models.map(model => this.describe(model))
  }

  override async resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const known = this.models.find(row => row.id === model)
    return this.describe(known ?? { id: model, name: model, contextWindow: 0, supportsImage: false })
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const resolved = await this.resolveModel(provider, model, signal)
    return { model: resolved, stream: (streamOptions: GenerateOptions) => this.stream(streamOptions) }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const credential = await this.options.credential()
    if (credential === undefined || credential.accessToken === '') {
      throw new LlmError('还没有登录态。请在 Accio 卡片里登录一次。', 'auth')
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
    const turn = accioChat({
      credential,
      /**
       * The catalogue's public id IS the `modelCode` in this build.
       *
       * The reference implementation had to map a slug back to the code; here the id carried
       * into the request is already what `normalizeAccioModel` returned, so no mapping is
       * needed — and inventing one would risk sending a slug the gateway answers with silence.
       */
      modelCode: modelId,
      messages,
      ...(system === '' ? {} : { system }),
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
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

  /** Read the catalogue, at most once per TTL. */
  private async refresh(credential: AccioCredential): Promise<void> {
    const changed = this.modelsFor !== credential.accessToken
    if (!changed && this.models.length > 0 && Date.now() - this.modelsAt < CATALOG_TTL_MS) return
    const live = await accioCatalog(credential)
    if (live.models.length > 0) {
      this.models = live.models
      this.modelsFor = credential.accessToken
      this.modelsAt = Date.now()
    }
  }

  /** Everything the picker shows for one model. */
  private describe(model: AccioModel): LlmResolvedModelInfo {
    const efforts = model.efforts ?? []
    /**
     * A model without a published window gets 0, which the host reads as "unknown" rather than
     * as a tiny limit — better to let the upstream refuse than to pre-emptively refuse for it.
     */
    const context = model.contextWindow > 0 ? model.contextWindow : 1_048_576
    return {
      provider: ACCIO_PROVIDER_ID,
      id: model.id,
      name: model.name,
      inputModalities: model.supportsImage ? ['text', 'image'] : ['text'],
      defaultMaxTokens: model.maxTokens ?? DEFAULT_MAX_OUTPUT,
      context: { contextWindow: context },
      ...(efforts.length === 0
        ? {}
        : {
          reasoning: {
            efforts: efforts.map(effort => ({
              id: ReasoningEffortId(effort),
              name: EFFORT_LABELS[effort] ?? effort,
            })),
            defaultEffort: ReasoningEffortId(
              model.defaultEffort ?? (efforts.includes('high') ? 'high' : efforts[0] ?? 'high'),
            ),
          },
        }),
    }
  }
}
