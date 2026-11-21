/**
 * AStudio as a host adapter.
 *
 * Registered through `ctx.llm.registerAdapter` like every other channel, because the picker
 * reads that registry and nothing else.
 *
 * Endpoints are resolved per call and cached briefly: the gateway's base URL travels with the
 * credentials and the `api_key` rotates, so a cached endpoint is a working one until it stops
 * being accepted — which is what the 401/404 retry below is for.
 *
 * @module dsh-xdpool/astudio-host-adapter
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
import { ASTUDIO_DEFAULT_MODEL, ASTUDIO_MODELS, findAstudioModel } from './astudio-models.ts'
import { astudioCatalog, astudioChat, astudioEndpoints, type AstudioEndpoint } from './astudio-upstream.ts'
import type { AstudioAccount } from './astudio-account.ts'

/** The provider id the picker groups by. */
export const ASTUDIO_PROVIDER_ID = 'astudio'

/** The name the picker shows. */
export const ASTUDIO_PROVIDER_NAME = 'AStudio 讯飞'

/** The output ceiling the catalogue does not always publish. */
const DEFAULT_MAX_OUTPUT = 32_000

/** How long a resolved endpoint table stays usable. */
const ENDPOINT_TTL_MS = 10 * 60_000

/** The ladder's display names. */
const EFFORT_LABELS: Readonly<Record<string, string>> = {
  none: '关闭',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
}

export interface AstudioHostAdapterOptions {
  /** The stored account, read per call so a sign-in is visible without a restart. */
  account: () => Promise<AstudioAccount | undefined>
}

export class AstudioHostAdapter extends LlmAdapter {
  private readonly options: AstudioHostAdapterOptions
  /** Cached endpoints, and whether the last catalogue read failed. */
  private endpoints: readonly AstudioEndpoint[] = []
  private endpointsAt = 0
  private catalogue: readonly { id: string; name: string; contextWindow: number; maxOutputTokens?: number; efforts?: readonly string[]; free?: boolean }[] = ASTUDIO_MODELS

  constructor(options: AstudioHostAdapterOptions) {
    super()
    this.options = options
  }

  override providerInfo(_provider: string): LlmProviderInfo {
    return { id: ASTUDIO_PROVIDER_ID, name: ASTUDIO_PROVIDER_NAME }
  }

  override async listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    const account = await this.options.account()
    // No account means no group: the same gate every channel has, so a removed sign-in does
    // not leave a picker group offering models that cannot answer.
    if (account === undefined || account.bearer === '') return []
    await this.refreshCatalogue(account)
    return this.catalogue.map(model => this.describe(model))
  }

  override async resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const known = this.catalogue.find(row => row.id === model) ?? findAstudioModel(model)
    return this.describe(known ?? { id: model, name: model, contextWindow: 128_000 })
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const resolved = await this.resolveModel(provider, model, signal)
    return { model: resolved, stream: (streamOptions: GenerateOptions) => this.stream(streamOptions) }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const account = await this.options.account()
    if (account === undefined || account.bearer === '') {
      throw new LlmError('还没有登录态。请在 AStudio 卡片里登录一次。', 'auth')
    }
    const modelId = typeof options['model'] === 'string' ? options['model'] : ASTUDIO_DEFAULT_MODEL
    const messages = Array.isArray(options['messages']) ? options['messages'] as unknown[] : []
    const system = typeof options['system'] === 'string' ? options['system'] : ''
    const requested = options['reasoningEffort']
    const effort = typeof requested === 'string' && requested !== '' ? requested : undefined
    const signal = options['signal'] instanceof AbortSignal
      ? options['signal'] as AbortSignal
      : new AbortController().signal

    const endpoint = await this.endpointFor(account, modelId, signal)
    const queue: { type: 'text' | 'reasoning'; text: string }[] = []
    let done = false
    let failure: Error | undefined
    let retried = false

    const run = async (): Promise<void> => {
      try {
        await astudioChat({
          bearer: account.bearer,
          model: modelId,
          messages,
          ...(system === '' ? {} : { system }),
          ...(effort === undefined ? {} : { reasoningEffort: effort }),
          ...(endpoint === undefined ? {} : { endpoint }),
          signal,
          onDelta: delta => { queue.push(delta) },
        })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        /**
         * A 401 or 404 is a ROTATED KEY, not a dead account.
         *
         * The `api_key` is short-lived and the gateway's base URL moves with it; re-reading the
         * endpoint table and trying once more is what the vendor's own client does. Only a
         * second failure is reported.
         */
        const looksRotated = /\b401\b|\b404\b|api endpoint not found/iu.test(message)
        if (!retried && looksRotated) {
          retried = true
          const refreshed = await astudioEndpoints({ bearer: account.bearer }, signal)
          if (refreshed.length > 0) {
            this.endpoints = refreshed
            this.endpointsAt = Date.now()
            const next = refreshed.find(row => row.model === modelId)
            try {
              await astudioChat({
                bearer: account.bearer,
                model: modelId,
                messages,
                ...(system === '' ? {} : { system }),
                ...(effort === undefined ? {} : { reasoningEffort: effort }),
                ...(next === undefined ? {} : { endpoint: next }),
                signal,
                onDelta: delta => { queue.push(delta) },
              })
              return
            } catch (again: unknown) {
              failure = again instanceof Error ? again : new Error(String(again))
              return
            }
          }
        }
        failure = error instanceof Error ? error : new Error(message)
      }
    }

    const turn = run().finally(() => { done = true })

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

  /** The endpoint row for one model, re-reading the table when it is stale. */
  private async endpointFor(
    account: AstudioAccount,
    model: string,
    signal: AbortSignal,
  ): Promise<AstudioEndpoint | undefined> {
    const stale = Date.now() - this.endpointsAt > ENDPOINT_TTL_MS
    if (stale || this.endpoints.length === 0) {
      const fresh = await astudioEndpoints({ bearer: account.bearer }, signal)
      if (fresh.length > 0) {
        this.endpoints = fresh
        this.endpointsAt = Date.now()
      }
    }
    return this.endpoints.find(row => row.model === model)
  }

  /** Read the live catalogue, at most once per TTL. */
  private async refreshCatalogue(account: AstudioAccount): Promise<void> {
    const stale = Date.now() - this.endpointsAt > ENDPOINT_TTL_MS
    if (!stale && this.catalogue !== ASTUDIO_MODELS) return
    const live = await astudioCatalog({ bearer: account.bearer })
    if (live.models.length > 0) {
      this.catalogue = live.models
      this.endpoints = live.endpoints
      this.endpointsAt = Date.now()
    }
  }

  /** Everything the picker shows for one model. */
  private describe(model: {
    id: string
    name: string
    contextWindow: number
    maxOutputTokens?: number
    efforts?: readonly string[]
    free?: boolean
  }): LlmResolvedModelInfo {
    const efforts = model.efforts ?? []
    return {
      provider: ASTUDIO_PROVIDER_ID,
      id: model.id,
      // A launch promotion is worth saying out loud; it is the cheapest option on the card.
      name: model.free === true ? `${model.name}（限免）` : model.name,
      inputModalities: ['text'],
      defaultMaxTokens: model.maxOutputTokens ?? DEFAULT_MAX_OUTPUT,
      context: { contextWindow: model.contextWindow },
      ...(efforts.length === 0
        ? {}
        : {
          reasoning: {
            efforts: efforts.map(effort => ({
              id: ReasoningEffortId(effort === 'none' ? 'none' : effort),
              name: EFFORT_LABELS[effort] ?? effort,
            })),
            defaultEffort: ReasoningEffortId(efforts.includes('high') ? 'high' : efforts[0] ?? 'high'),
          },
        }),
    }
  }
}
