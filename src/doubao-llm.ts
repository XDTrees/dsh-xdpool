/**
 * Doubao as a channel the XD Pool gateway can serve.
 *
 * HOW THIS FITS
 *
 * `channel-lane.ts` routes `<channel>:<model>` ids by asking a lane which channels it serves
 * and calling `llm.listModels` / `llm.stream` for those channels. Every other channel is a
 * provider the vendored pack registered with the host; Doubao is this plugin's own, so this
 * module supplies the llm face for it and nothing else changes: the models appear in the
 * picker, the card lists them, and a chain can name them.
 *
 * WHICH ACCOUNT ANSWERS (#171)
 *
 * The lane used to read one module-level session, so a second sign-in replaced the first and
 * the pool could only serve one account. It now takes the roster and asks it for `next()` —
 * the account that is not cooling down, sticky so one conversation stays on one account.
 * A failure that names an account problem (a rejected cookie, a spent window, a slider
 * challenge) is recorded against THAT account, so the next turn moves on instead of retrying
 * into the same wall.
 *
 * WHAT IT DELEGATES
 *
 * The wire is `doubao-upstream.ts`, ported wholesale from a working implementation rather
 * than re-derived. That matters: three request details decide whether a call succeeds —
 * the `SamanthaDoubao` User-Agent suffix, the `chrome://doubao-chat/` referer, and the real
 * `sec-ch-ua` brand — and getting any of them wrong answers `710022004 rate limited`, which
 * reads as throttling. Re-deriving those cost a day; this module does not touch them.
 *
 * @module dsh-xdpool/doubao-llm
 */
import { sessionUsable } from './doubao-auth.ts'
import {
  DOUBAO_REASONING_LEVELS,
  findDoubaoModel,
  type DoubaoModelInfo,
} from './doubao-catalog.ts'
import { fetchLiveModels } from './doubao-catalog-live.ts'
import type { DoubaoAccount, DoubaoRoster } from './doubao-roster.ts'
export { doubaoListing } from './doubao-models.ts'
import {
  chat,
  classifyDoubaoFailure,
  describeDoubaoFailure,
  type DoubaoErrorKind,
  type DoubaoImage,
  type DoubaoUpstreamError,
} from './doubao-upstream.ts'

/** The channel id Doubao answers to. */
export const DOUBAO_CHANNEL = 'doubao'

/** One listing row, in the shape the channel lane expects. */
export interface DoubaoLaneModel {
  id: string
  name: string
  description?: string
}

/** One text chunk, in the shape the lane's `toChannelEvent` switches on. */
interface ChannelChunk extends Record<string, unknown> {
  type: 'text-delta'
  text: string
}

/** One reasoning chunk, kept apart so a thinking panel can show it separately. */
interface ReasoningChunk extends Record<string, unknown> {
  type: 'reasoning-delta'
  text: string
}

/** The text of a host content value, which may be a string or a block list. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const out: string[] = []
  for (const block of content) {
    if (typeof block === 'string') { out.push(block); continue }
    if (typeof block !== 'object' || block === null) continue
    const record = block as Record<string, unknown>
    if (typeof record['text'] === 'string') out.push(record['text'])
  }
  return out.join('\n')
}

/**
 * Flatten the host's message list into the single prompt Doubao takes.
 *
 * Doubao keeps history server-side under a conversation id, so the exchange is expressed by
 * the CONVERSATION. What has to travel inline is the system instruction and whatever the
 * caller put in front of the last user turn. A single question stays a single question.
 */
export function promptFromMessages(messages: readonly unknown[]): string {
  const parts: string[] = []
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) continue
    const text = textOf((message as Record<string, unknown>)['content'])
    if (text !== '') parts.push(text)
  }
  return parts.join('\n\n')
}

/** What {@link createDoubaoLlm} needs. */
export interface DoubaoLlmOptions {
  /** The roster, asked per call so a sign-in is visible without a restart. */
  roster: () => DoubaoRoster
  /** Called once the upstream reports its own conversation id, so the next turn continues it. */
  onConversationId?: ((id: string) => void) | undefined
}

/** The two methods `channel-lane` calls. */
export interface DoubaoLlm {
  listModels: (provider: string) => Promise<readonly DoubaoLaneModel[]>
  stream: (options: Record<string, unknown>) => AsyncIterable<ChannelChunk | ReasoningChunk>
}

/** The sentence a caller sees when the roster has nothing to offer. */
const NO_ACCOUNT = '还没有浏览器登录态。请在豆包卡片里点「重新登录」扫码一次。'

/** Whether a failure class says something about the ACCOUNT rather than the network. */
function blamesAccount(kind: DoubaoErrorKind): boolean {
  return kind === 'session_dead' || kind === 'quota_exhausted' || kind === 'rate_limited'
}

/**
 * Pick the account for one turn, preferring an explicit request.
 *
 * The host's model id is `doubao:<model>`; an account may also be named in the stream options
 * as `doubaoAccount`, which is what lets the card's "use this one" button mean something.
 * Without a name the roster picks, which is the ordinary path.
 */
function pickAccount(roster: DoubaoRoster, requested: unknown): DoubaoAccount | undefined {
  if (typeof requested === 'string' && requested !== '') {
    const named = roster.get(requested)
    if (named !== undefined && named.disabled !== true && sessionUsable(named.session)) return named
  }
  return roster.next()
}

/**
 * The llm face for Doubao.
 *
 * `stream` yields text and reasoning as they arrive: `chat()` calls back per chunk, and the
 * chunks are queued and drained so a long answer appears progressively instead of landing
 * whole at the end.
 */
export function createDoubaoLlm(options: DoubaoLlmOptions): DoubaoLlm {
  return {
    listModels: async (provider: string) => {
      if (provider !== DOUBAO_CHANNEL) return []
      /**
       * The account's own roster, with the measured six as the floor.
       *
       * `fetchLiveModels` asks the vendor what this session may use and merges the answer
       * behind the known-good entries; a failed read simply leaves the six in place. Using it
       * here means the picker shows what the account can actually call, including the
       * third-party models Doubao publishes per plan, instead of a fixed list that was short.
       *
       * The FIRST usable account answers: the catalogue is a property of the vendor account,
       * and a pool of three would otherwise list three different menus under one group.
       */
      const roster = options.roster()
      const account = roster.next()
      const live = await fetchLiveModels(account?.session)
      return live.map(model => ({
        id: model.id,
        name: model.name,
        ...(model.badge === undefined ? {} : { description: model.badge }),
      }))
    },

    stream: async function* (streamOptions: Record<string, unknown>): AsyncIterable<ChannelChunk | ReasoningChunk> {
      const roster = options.roster()
      /**
       * Retry across accounts, but ONLY for failures that blame the account.
       *
       * A roster exists so that one spent window does not stop the lane. A network failure is
       * a fact about the link, so trying a second account would spend its quota to fail the
       * same way; that distinction is what `blamesAccount` encodes. The bound is the roster's
       * size, so a pool of three costs at most three attempts and never loops.
       */
      const tried = new Set<string>()
      let account = pickAccount(roster, streamOptions['doubaoAccount'])
      if (account === undefined) throw new Error(NO_ACCOUNT)

      /**
       * Whether any text has reached the CALLER.
       *
       * Counted across attempts, not within one: once a delta has been yielded the answer is
       * already on screen, so switching accounts would restart it into a second thread and
       * leave the user with two half answers. That is the line between "step aside" and
       * "report it".
       */
      let emitted = false

      const modelId = typeof streamOptions['model'] === 'string' ? streamOptions['model'] : ''
      const model: DoubaoModelInfo | undefined = findDoubaoModel(modelId)
      if (model === undefined) {
        throw new Error(`豆包没有模型 ${modelId}：它可能已经下线`)
      }
      const messages = Array.isArray(streamOptions['messages'])
        ? streamOptions['messages'] as unknown[]
        : []
      const system = typeof streamOptions['system'] === 'string' ? streamOptions['system'] : ''
      const body = promptFromMessages(messages)
      const prompt = system === '' ? body : `${system}\n\n${body}`
      if (prompt === '') throw new Error('这条请求没有可发送的文字')

      /**
       * The reasoning level.
       *
       * The picker sends an opaque branded string; Doubao's levels are named. An unknown
       * value falls back to the middle level, which every model in the family accepts.
       */
      const requested = streamOptions['reasoningEffort']
      const levelName = DOUBAO_REASONING_LEVELS.some(entry => entry.id === requested)
        ? String(requested)
        : 'medium'
      const signal = streamOptions['signal'] instanceof AbortSignal
        ? streamOptions['signal'] as AbortSignal
        : new AbortController().signal

      for (;;) {
        tried.add(account.id)
        const textQueue: string[] = []
        const reasoningQueue: string[] = []
        let done = false
        let failure: Error | undefined
        let images: readonly DoubaoImage[] = []
        let conversationId: string | undefined

        const turn = chat(prompt, {
          modelKey: model.id,
          reasoningLevel: levelName,
          session: account.session,
          signal,
          callbacks: {
            onText: (chunk: string) => { if (chunk !== '') textQueue.push(chunk) },
            onThinking: (chunk: string) => { if (chunk !== '') reasoningQueue.push(chunk) },
          },
        } as never)
          .then(result => {
            if (typeof result.conversationId === 'string' && result.conversationId !== '') {
              conversationId = result.conversationId
            }
            if (Array.isArray(result.images)) images = result.images
          })
          .catch((error: unknown) => { failure = error instanceof Error ? error : new Error(String(error)) })
          .finally(() => { done = true })

        while (!done || textQueue.length > 0 || reasoningQueue.length > 0) {
          const reasoning = reasoningQueue.shift()
          if (reasoning !== undefined) {
            emitted = true
            yield { type: 'reasoning-delta', text: reasoning }
            continue
          }
          const text = textQueue.shift()
          if (text !== undefined) {
            emitted = true
            yield { type: 'text-delta', text }
            continue
          }
          if (done) break
          await Promise.race([turn, new Promise(resolve => setTimeout(resolve, 20))])
        }
        await turn

        if (failure !== undefined) {
          const kind = classifyDoubaoFailure(failure as DoubaoUpstreamError)
          if (blamesAccount(kind)) {
            roster.penalise(account.id, kind, describeDoubaoFailure(failure))
            const next = pickAccount(roster, undefined)
            /**
             * Step aside only if another account can answer AND nothing has been emitted.
             *
             * A half-streamed answer cannot be retried — the first account already opened a
             * server-side thread and the text is on screen — so the failure is reported
             * instead of silently restarting into a second account.
             */
            if (next !== undefined && !tried.has(next.id) && !emitted) {
              account = next
              continue
            }
          }
          throw failure
        }

        roster.clear(account.id)
        if (conversationId !== undefined) options.onConversationId?.(conversationId)
        // An image answer arrives as a URL list; it is appended as markdown so the client
        // renders it without knowing about Doubao's own image blocks.
        for (const image of images) {
          if (typeof image.url === 'string' && image.url !== '') {
            yield { type: 'text-delta', text: `\n\n![生成图](${image.url})\n` }
          }
        }
        return
      }
    },
  }
}
