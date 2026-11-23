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
import { DOUBAO_REASONING_LEVELS } from './doubao-catalog.ts'
import { fetchLiveModels } from './doubao-catalog-live.ts'
import { chat, type DoubaoImage } from './doubao-upstream.ts'

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

/**
 * The ladder's display names, in the vendor's own words for this language.
 *
 * `medium` is kept as an alias of `mid` rather than removed: the two spellings were
 * in use at the same time (`doubao-menu.ts` said `medium`, `doubao-catalog.ts` said
 * `mid`), so a menu row produced by either build still gets a name here. That
 * module now says `mid`; this alias is what keeps an already-cached document from
 * rendering a raw id.
 */
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
 * Collapse a model's own ladder to three rungs: bottom, middle, top.
 *
 * WHY NOT A FIXED LIST OF NAMES
 *
 * The account publishes a DIFFERENT ladder per model, and the ladders differ in
 * LENGTH, not just in naming. Measured 2026-11-23 on one account:
 *
 *   person-qwen4-max        低 / 高 / 极高                 (3 rungs, no 最高 at all)
 *   person-deepseek-v4-1…   低 / 中 / 高 / 极高 / 最高      (5 rungs)
 *
 * Filtering by name (`['low','high','max']`) therefore cannot work: it erases
 * `xhigh` on the Qwen entry and leaves it with TWO rungs — fewer than the app
 * itself offers. Selecting by position gives every model the same three-rung
 * SHAPE while each one keeps its own names, and the top rung is always a level
 * that model really publishes.
 *
 * A ladder of three or fewer rungs is returned untouched: there is no middle to
 * collapse, and de-duplicating would silently drop a rung the account can use.
 */
function collapseLadder(efforts: readonly string[] | undefined): readonly string[] {
  if (efforts === undefined || efforts.length === 0) return []
  if (efforts.length <= 3) return efforts
  return [
    efforts[0]!,
    efforts[Math.floor((efforts.length - 1) / 2)]!,
    efforts[efforts.length - 1]!,
  ]
}

/**
 * The three rungs this lane falls back to when a model publishes no ladder of its own.
 *
 * Every entry in the static `DOUBAO_MODELS` table is in that position: those five rows carry
 * `reasoning: true` and no `efforts`. Reporting nothing for them would REMOVE the picker the
 * channel has always had — the rungs are unpinned from the account, not absent — so they keep
 * the list this adapter hardcoded before the ladder was wired through.
 */
const FALLBACK_EFFORTS: readonly string[] = ['low', 'mid', 'high']

/**
 * The reasoning block the picker renders, or nothing when the model cannot think.
 *
 * Order of preference: the model's own published ladder, narrowed to three rungs; then
 * {@link FALLBACK_EFFORTS} for a model that reasons but publishes no ladder; and no
 * `reasoning` key at all for a model whose `reasoning` is false (the no-CoT `0` route) or
 * which is absent from both lists (an unrecognised id).
 *
 * `defaultEffort` is always one of the offered ids by construction: `high` when the ladder
 * has it, otherwise the top rung.
 */
function reasoningOf(
  model: DoubaoModelInfo,
): Pick<LlmResolvedModelInfo, 'reasoning'> | Record<string, never> {
  if (model.reasoning === false) return {}
  const ladder = collapseLadder(model.efforts)
  const rungs = ladder.length > 0 ? ladder : FALLBACK_EFFORTS
  const fallback = rungs.includes('high') ? 'high' : rungs[rungs.length - 1]!
  return {
    reasoning: {
      efforts: rungs.map(id => ({
        id: ReasoningEffortId(id),
        name: EFFORT_LABELS[id] ?? id,
      })),
      defaultEffort: ReasoningEffortId(fallback),
    },
  }
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
     * Accept any level the catalog knows, not just the three this lane used to publish.
     *
     * This gate used to whitelist `low`/`mid`/`high` and fall back to `mid`, so a level
     * offered above `high` was silently rewritten before it reached the wire — the
     * picker could display 极高 or 最高 and the request still went out as 中. The two
     * sides have to agree or every rung past `high` is decorative.
     *
     * `DOUBAO_REASONING_LEVELS` is the authority here rather than a literal list: it is
     * the same table `findReasoningLevel` resolves against, so a level this gate lets
     * through is one the upstream can map to an ordinal.
     */
    const known = DOUBAO_REASONING_LEVELS.some(entry => entry.id === requested)
    const level = typeof requested === 'string' && known ? requested : 'high'
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
      ...reasoningOf(model),
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
