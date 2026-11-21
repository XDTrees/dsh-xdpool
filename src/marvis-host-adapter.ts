/**
 * Marvis as a host adapter — the fifteenth login channel.
 *
 * Registered the same way every other channel is (`ctx.llm.registerAdapter`), because the model
 * PICKER reads that registry and nothing else. The wire is `marvis-upstream.ts`.
 *
 * WHAT IS DIFFERENT ABOUT THIS CHANNEL
 *
 *   - The account is an OAuth session (QQ or WeChat), not a cookie jar, and every request has to
 *     carry the device id it was authorised on.
 *   - `model` takes a slot name, and the reply reports the real model it routed to. The display
 *     name here is the REAL model, so a reader can tell what answered; the id stays the slot.
 *
 * @module dsh-xdpool/marvis-host-adapter
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
import type { MarvisAccount } from './marvis-protocol.ts'
import { MARVIS_MODELS, findMarvisModel } from './marvis-models.ts'
import { marvisChat, type MarvisDelta } from './marvis-upstream.ts'

/** The provider id the picker groups by. */
export const MARVIS_PROVIDER_ID = 'marvis'

/** The name the picker shows. */
export const MARVIS_PROVIDER_NAME = '腾讯 Marvis'

/** The output ceiling the slots declare. */
const MAX_OUTPUT_TOKENS = 32_000

/** The ladder's display names. */
const EFFORT_LABELS: Readonly<Record<string, string>> = {
  low: '低',
  mid: '中',
  high: '高',
  max: '最高',
}

export interface MarvisHostAdapterOptions {
  /** The stored account, read per call so a sign-in is visible without a restart. */
  account: () => Promise<MarvisAccount | undefined>
}

/**
 * The adapter.
 *
 * `listModels` answers EMPTY when no account is stored — the same gate every other channel has.
 * Without it a deleted account would leave its group in the picker forever, offering models that
 * cannot answer.
 */
export class MarvisHostAdapter extends LlmAdapter {
  private readonly options: MarvisHostAdapterOptions

  constructor(options: MarvisHostAdapterOptions) {
    super()
    this.options = options
  }

  override providerInfo(_provider: string): LlmProviderInfo {
    return { id: MARVIS_PROVIDER_ID, name: MARVIS_PROVIDER_NAME }
  }

  override async listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    const account = await this.options.account()
    if (account === undefined || account.accessToken === '') return []
    return MARVIS_MODELS.map(model => this.describe(model))
  }

  override async resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const known = findMarvisModel(model)
    // An unknown id is described from itself rather than refused: the upstream is the authority
    // on which slots exist, and a 400 from it names the real problem.
    return this.describe(known ?? { id: model, name: model, contextWindow: 128_000 })
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const resolved = await this.resolveModel(provider, model, signal)
    return {
      model: resolved,
      stream: (streamOptions: GenerateOptions) => this.stream(streamOptions),
    }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const account = await this.options.account()
    if (account === undefined || account.accessToken === '') {
      throw new LlmError('还没有登录态。请在 Marvis 卡片里用 QQ 或微信登录一次。', 'auth')
    }
    const modelId = typeof options['model'] === 'string' ? options['model'] : ''
    if (modelId === '') throw new LlmError('这条请求没有指定模型', 'invalid')

    const messages = Array.isArray(options['messages']) ? options['messages'] as unknown[] : []
    const system = typeof options['system'] === 'string' ? options['system'] : ''
    const requested = options['reasoningEffort']
    const effort = typeof requested === 'string' && ['low', 'high', 'max'].includes(requested)
      ? requested
      : undefined
    const signal = options['signal'] instanceof AbortSignal
      ? options['signal'] as AbortSignal
      : new AbortController().signal

    /** Chunks are queued and drained so a long answer arrives progressively. */
    const queue: MarvisDelta[] = []
    let done = false
    let failure: Error | undefined
    const turn = marvisChat({
      account,
      model: modelId,
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
          // `index` is required by StreamChunk; text lives in block 0, reasoning alongside it.
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

  /** Everything the picker shows for one model. */
  private describe(model: { id: string; name: string; contextWindow: number; efforts?: readonly string[]; vision?: boolean }): LlmResolvedModelInfo {
    const efforts = model.efforts ?? []
    return {
      provider: MARVIS_PROVIDER_ID,
      id: model.id,
      // The REAL model, not the slot: the service routes per account, and the slot name says
      // nothing about what actually answered.
      name: model.name,
      inputModalities: model.vision === true ? ['text', 'image'] : ['text'],
      defaultMaxTokens: MAX_OUTPUT_TOKENS,
      context: { contextWindow: model.contextWindow },
      ...(efforts.length === 0
        ? {}
        : {
          reasoning: {
            efforts: efforts.map(effort => ({
              id: ReasoningEffortId(effort),
              name: EFFORT_LABELS[effort] ?? effort,
            })),
            defaultEffort: ReasoningEffortId(efforts.includes('high') ? 'high' : efforts[0] ?? 'high'),
          },
        }),
    }
  }
}
