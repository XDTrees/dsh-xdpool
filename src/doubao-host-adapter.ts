/**
 * Doubao as a host adapter.
 *
 * WHY THIS IS NEEDED
 *
 * `channel-lane.ts` serves `<channel>:<model>` ids for a gateway route, but the model PICKER
 * reads the host's adapter registry — `ctx.llm.registerAdapter([id], adapter)`. Every channel in
 * the pack registers one; Doubao did not, so a signed-in account with ten models enabled showed
 * nothing in the picker at all. The lane made the models reachable over HTTP; this makes them
 * visible in the list.
 *
 * WHAT IT IMPLEMENTS
 *
 * The five methods `LlmAdapter` requires, in the shape the pack's own adapters use:
 * `providerInfo`, `listModels`, `resolveModel`, `prepareCall`, `stream`. The wire stays in
 * `doubao-upstream.ts` — the module ported from a working implementation — so nothing here
 * invents request details.
 *
 * WHAT IT REPORTS ABOUT A MODEL
 *
 * The picker shows what these fields say, so they carry the same facts the other channels do:
 * context window, output ceiling, whether the model reasons, and the multiplier as a tag. A
 * model with no published figure says nothing rather than inventing one.
 *
 * @module dsh-xdpool/doubao-host-adapter
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
import { sessionUsable, type DoubaoSession } from './doubao-auth.ts'
import { DOUBAO_MODELS, type DoubaoModelInfo } from './doubao-models.ts'
import { fetchLiveModels } from './doubao-catalog-live.ts'
import { chat, type DoubaoImage } from './doubao-upstream.ts'
import { DOUBAO_REASONING_LEVELS } from './doubao-catalog.ts'

/** The provider id the picker groups by. */
export const DOUBAO_PROVIDER_ID = 'doubao'

/** The name the picker shows for the group. */
export const DOUBAO_PROVIDER_NAME = '豆包'

/**
 * The context window this lane reports.
 *
 * Doubao does not publish a per-model window on the endpoints this lane calls, and the chat
 * itself accepts far more than the client advertises. 256k is what the reference implementation
 * settled on after measuring; reporting nothing would make the picker show "—" beside every
 * model, which reads as a broken channel.
 */
const CONTEXT_WINDOW = 256_000

/** The ladder's display names, in the vendor's own words for this language. */
const EFFORT_LABELS: Readonly<Record<string, string>> = {
  low: '低',
  mid: '中',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
  auto: '自动',
}

/**
 * What a model falls back to when the listing carried no ladder of its own.
 *
 * The five static rows have no `efforts`, and the picker has always shown
 * 低/中/高 for them — keeping that is what makes this change invisible to
 * anyone whose account does not publish ladders (issue #207).
 */
const FALLBACK_EFFORTS: readonly string[] = ['low', 'mid', 'high']

/**
 * Three levels that sit at the same POSITIONS on whatever ladder a model has.
 *
 * Not "filter by name": Qwen 4 Max publishes 低/高/极高 (three levels, no 最高 at
 * all), so a `['low','high','max']` filter left it with two — fewer than the
 * client itself offers. Taking the first, the middle and the last gives every
 * model three levels, and the top one is always the top one it really publishes.
 */
export function collapseLadder(efforts: readonly string[] | undefined): readonly string[] {
  const ladder = (efforts ?? []).filter(level => typeof level === 'string' && level !== '')
  if (ladder.length === 0) return FALLBACK_EFFORTS
  if (ladder.length <= 3) return ladder
  const middle = ladder[Math.floor((ladder.length - 1) / 2)] as string
  return [ladder[0] as string, middle, ladder[ladder.length - 1] as string]
}

/** The label for one level id, falling back to the id itself. */
function effortLabel(level: string): string {
  return EFFORT_LABELS[level] ?? level
}

/** The output ceiling the lane requests. */
const MAX_OUTPUT_TOKENS = 65_536

/**
 * The multiplier, when the name carries one.
 *
 * Every vendor in this plugin writes the price into the model name; Doubao's own models are
 * included in the promotion programme, so the same shape appears (`… · x0.00`, `… · 免费`). The
 * split is done here rather than in the card so the PICKER sees it too.
 */
function rateOf(name: string): string | undefined {
  const match = /[·・]\s*(x\s*[\d.]+(?:\s*→\s*x?[\d.]+)?|免费|限时免费)/iu.exec(name)
  return match?.[1]?.trim()
}

/** The name without its trailing price. */
function bareName(name: string): string {
  return name.replace(/\s*[·・]\s*(?:x\s*[\d.]+(?:\s*→\s*x?[\d.]+)?|免费|限时免费|正式版.*)$/iu, '').trim()
}

/** The chat options the upstream takes. */
interface DoubaoChatOptions {
  modelKey: string
  reasoningLevel: string
  signal: AbortSignal
  callbacks: { onText: (chunk: string) => void; onThinking: (chunk: string) => void }
}

export interface DoubaoHostAdapterOptions {
  /** The stored session, read per call so a sign-in is visible without a restart. */
  session: () => DoubaoSession | undefined
  /**
   * The ids the user has switched OFF on the card, read per call so a toggle is
   * visible without a restart — issue #196.
   *
   * Storage is a DISABLED list rather than an enabled one, and that is the whole
   * reason this lane must not repeat the mistake the pool catalogue already paid
   * for (#122): a settings list nobody has written yet reads as `[]`, so an
   * enabled-allow-list would mean "serve nothing" on a fresh install — the
   * Doubao group would vanish from the picker until the card happened to be
   * opened once. A disabled-list reads the same `[]` as "nothing is switched
   * off", which is exactly true, and "all switched off" stays expressible by
   * listing every id.
   */
  disabled?: (() => readonly string[] | undefined) | undefined
  /**
   * The user pressed 「全关」 on the card — every model off, grouped.
   *
   * A separate flag because the disable-LIST cannot express it: "all models
   * switched off" has to be stored as every id, and the card does not always
   * know the whole roster (the listing can still be loading when the button is
   * pressed), so an all-off that stored `[]` was read back as "nothing
   * disabled" — the picker kept showing every model, which is the report this
   * flag exists for.
   */
  hideAll?: (() => boolean) | undefined
  /** Called when the upstream reports its conversation id. */
  onConversationId?: ((id: string) => void) | undefined
}

/**
 * Shrink a roster by the ids the user switched off — issue #196.
 *
 * Exported because it is the entire rule, and the rule is where this lane went
 * wrong: `listModels` published the whole live roster while the card showed
 * "4/16", so the picker offered twelve models the user had deliberately hidden.
 * A pure function keeps that rule testable without a session or a network read.
 *
 * `undefined` and `[]` both mean "nothing switched off". They are not
 * distinguished because the settings document cannot distinguish them (see the
 * note on `disabled` above), and an empty disable-list is the safe reading:
 * show everything, recoverable in one click.
 */
export function visibleDoubaoModels<T extends { id: string }>(
  models: readonly T[],
  disabled: readonly string[] | undefined,
): readonly T[] {
  if (disabled === undefined || disabled.length === 0) return models
  const hidden = new Set(disabled)
  return models.filter(model => !hidden.has(model.id))
}

/**
 * The adapter.
 *
 * `listModels` reads the account's live roster through `fetchLiveModels`, which merges the
 * measured six with whatever `brief_list` returns and whatever the desktop client's cache holds —
 * that is where the `person-*` models (DeepSeek, Kimi, GLM) come from.
 */
export class DoubaoHostAdapter extends LlmAdapter {
  private readonly options: DoubaoHostAdapterOptions
  /** The last roster read, so a picker redraw does not re-fetch. */
  private cached: { at: number; models: readonly DoubaoModelInfo[] } | undefined

  constructor(options: DoubaoHostAdapterOptions) {
    super()
    this.options = options
  }

  override providerInfo(_provider: string): LlmProviderInfo {
    return { id: DOUBAO_PROVIDER_ID, name: DOUBAO_PROVIDER_NAME }
  }

  override async listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    /**
     * 「全关」 is an explicit state, not a very long disable-list — see the
     * `hideAll` option. Answered before the session read so it holds even when
     * the listing itself cannot be fetched.
     */
    if (this.options.hideAll?.() === true) {
      this.cached = undefined
      return []
    }
    const session = this.options.session()
    /**
     * No session, no models — issue #169.
     *
     * Every other channel passes through the pack's `providerCatalogVisible`, which answers
     * "no catalogue" when nothing is signed in, so an empty group is filtered out of the picker.
     * This adapter had no such gate: `fetchLiveModels` falls back to six baseline rows when the
     * session is missing, so deleting the Doubao account left its group standing in the picker
     * forever — offering models that cannot answer.
     *
     * The fallback itself is right for the CARD (a signed-in account whose menu read failed
     * should still see its models); it is wrong for the PICKER, which has no account at all.
     */
    if (session === undefined || !sessionUsable(session)) {
      this.cached = undefined
      return []
    }
    const models = await fetchLiveModels(session)
    /**
     * `cached` keeps the FULL roster on purpose — issue #196.
     *
     * An unchecked model must stay resolvable: a chain, a routing rule or an
     * agent's pinned default may still name it, and the tick list governs what
     * the picker OFFERS, never what the lane can serve. Filtering the cache
     * would turn "hidden" into "broken" the next time one of those names it.
     */
    this.cached = { at: Date.now(), models }
    const shown = visibleDoubaoModels(models, this.options.disabled?.())
    return shown.map(model => this.describe(model))
  }

  override async resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const known = this.cached?.models.find(entry => entry.id === model)
      ?? DOUBAO_MODELS.find(entry => entry.id === model)
    if (known === undefined) {
      // Not necessarily fatal: an id this build does not know may still be valid upstream, so
      // it is described from its own name rather than refused.
      return this.describe({ id: model, name: model, reasoning: true })
    }
    return this.describe(known)
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const resolved = await this.resolveModel(provider, model, signal)
    return {
      model: resolved,
      stream: (streamOptions: GenerateOptions) => this.stream(streamOptions),
    }
  }

  /**
   * One turn.
   *
   * Text and reasoning are queued separately and drained as they arrive, so a long answer
   * appears progressively instead of landing whole. An image answer is appended as markdown —
   * the client renders it without knowing about Doubao's own image blocks.
   */
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const session = this.options.session()
    if (session === undefined || !sessionUsable(session)) {
      throw new LlmError('还没有浏览器登录态。请在豆包卡片里点「重新登录」扫码一次。', 'auth')
    }
    const modelId = typeof options['model'] === 'string' ? options['model'] : ''
    if (modelId === '') throw new LlmError('这条请求没有指定模型', 'invalid')

    const messages = Array.isArray(options['messages']) ? options['messages'] as unknown[] : []
    const system = typeof options['system'] === 'string' ? options['system'] : ''
    const body = promptOf(messages)
    const prompt = system === '' ? body : `${system}\n\n${body}`
    if (prompt === '') throw new LlmError('这条请求没有可发送的文字', 'invalid')

    const requested = options['reasoningEffort']
    /**
     * Accept every level the vendor publishes — issue #207.
     *
     * The whitelist used to be the literal `['low','mid','high']`, so a picker
     * showing 极高/最高 still had them silently downgraded to 中 on the way out:
     * the display and the wire disagreed. `DOUBAO_REASONING_LEVELS` is the same
     * table the picker's labels come from, so the two cannot drift.
     */
    const level = typeof requested === 'string' && DOUBAO_REASONING_LEVELS.some(entry => entry.id === requested)
      ? requested
      : 'mid'
    const signal = options['signal'] instanceof AbortSignal
      ? options['signal'] as AbortSignal
      : new AbortController().signal

    const textQueue: string[] = []
    const reasoningQueue: string[] = []
    let done = false
    let failure: Error | undefined
    let images: readonly DoubaoImage[] = []

    const turn = chat(prompt, {
      modelKey: modelId,
      reasoningLevel: level,
      signal,
      callbacks: {
        onText: (chunk: string) => { if (chunk !== '') textQueue.push(chunk) },
        onThinking: (chunk: string) => { if (chunk !== '') reasoningQueue.push(chunk) },
      },
    } as unknown as Parameters<typeof chat>[1])
      .then(result => {
        if (typeof result.conversationId === 'string' && result.conversationId !== '') {
          this.options.onConversationId?.(result.conversationId)
        }
        if (Array.isArray(result.images)) images = result.images
      })
      .catch((error: unknown) => { failure = error instanceof Error ? error : new Error(String(error)) })
      .finally(() => { done = true })

    while (!done || textQueue.length > 0 || reasoningQueue.length > 0) {
      const thinking = reasoningQueue.shift()
      if (thinking !== undefined) {
        // `index` is required by StreamChunk: text lives in block 0, reasoning alongside it.
        yield { type: 'reasoning-delta', index: 0, text: thinking }
        continue
      }
      const text = textQueue.shift()
      if (text !== undefined) {
        yield { type: 'text-delta', index: 0, text }
        continue
      }
      if (done) break
      await Promise.race([turn, new Promise(resolve => setTimeout(resolve, 20))])
    }
    await turn
    if (failure !== undefined) throw failure
    for (const image of images) {
      if (typeof image.url === 'string' && image.url !== '') {
        yield { type: 'text-delta', index: 0, text: `\n\n![生成图](${image.url})\n` }
      }
    }
  }

  /** Everything the picker shows for one model. */
  private describe(model: DoubaoModelInfo): LlmResolvedModelInfo {
    const rate = rateOf(model.name)
    const free = rate !== undefined && (/免费/u.test(rate) || /^x\s*0*\.?0+$/iu.test(rate))
    return {
      provider: DOUBAO_PROVIDER_ID,
      id: model.id,
      name: bareName(model.name),
      // Doubao's chat accepts images; the task models do too. Declaring it keeps the composer
      // from refusing an attachment the model could have read.
      inputModalities: ['text', 'image'],
      defaultMaxTokens: MAX_OUTPUT_TOKENS,
      context: { contextWindow: model.contextWindow ?? CONTEXT_WINDOW },
      /**
       * The ladder each model actually publishes — issue #207.
       *
       * This used to be a hard-coded 低/中/高 for every row, so Kimi's 最高 and
       * Qwen's 极高 were unreachable from the picker even though the client's own
       * menu had been parsed into `efforts` all along. `collapseLadder` keeps
       * three levels for the picker but takes them from the model's real list.
       *
       * `reasoning: false` (豆包快速) carries no ladder at all: offering a
       * thinking control for a model that does not think is worse than offering
       * none.
       */
      ...(model.reasoning === false
        ? {}
        : ((): LlmResolvedModelInfo['reasoning'] => {
            const levels = collapseLadder(model.efforts)
            const middle = levels[Math.floor((levels.length - 1) / 2)] as string
            return {
              efforts: levels.map(level => ({ id: ReasoningEffortId(level), name: effortLabel(level) })),
              defaultEffort: ReasoningEffortId(middle),
            }
          })()),
      ...(rate === undefined
        ? {}
        : { tags: [{ text: rate, tone: free ? 'free' as const : 'price' as const }] }),
    }
  }
}

/** The readable text of the host's message list. */
function promptOf(messages: readonly unknown[]): string {
  const parts: string[] = []
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) continue
    const content = (message as Record<string, unknown>)['content']
    if (typeof content === 'string') {
      if (content !== '') parts.push(content)
      continue
    }
    if (!Array.isArray(content)) continue
    const texts: string[] = []
    for (const block of content) {
      if (typeof block === 'string') { texts.push(block); continue }
      if (typeof block !== 'object' || block === null) continue
      const text = (block as Record<string, unknown>)['text']
      if (typeof text === 'string') texts.push(text)
    }
    if (texts.length > 0) parts.push(texts.join('\n'))
  }
  return parts.join('\n\n')
}
