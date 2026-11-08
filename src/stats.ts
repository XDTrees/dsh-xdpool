/**
 * Per-call usage accounting for the chat path.
 *
 * The gateway can answer `usage` when the request asks for it
 * (`stream_options.include_usage`), but the shim forwards the response body
 * verbatim and threw every number away. This module is where those numbers
 * stop being thrown away: a bounded ring of samples in, one aggregate
 * document out. Nothing here touches Node or HTTP, so the same code is
 * exercised by unit tests and by the browser half.
 *
 * Two counts are kept apart on purpose:
 *
 *   - a LOGICAL TURN is one user request, however many accounts it visited;
 *   - a PHYSICAL CALL is one upstream HTTP round trip.
 *
 * They answer different questions. "How many turns failed" must not inflate
 * because the pool rotated three accounts before succeeding, and "how much
 * did this model cost" must not be diluted by recording the turn once.
 * Collapsing them into a single `calls` number is exactly what makes a panel
 * disagree with the person reading it.
 *
 * Usage is a BONUS, never a guarantee: a gateway may ignore
 * `stream_options` entirely. A window with no reported usage reports zeroes
 * AND says so, so the panel can print "not reported" instead of a confident
 * "0 tokens".
 *
 * @module dsh-xdpool/stats
 */

/** Tokens one upstream call reported. Every field is a non-negative count. */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  /** A subset of `outputTokens` the model spent thinking. */
  reasoningTokens: number
  /** A subset of `inputTokens` served from the prompt cache. */
  cachedTokens: number
}

/** One upstream HTTP round trip, successful or not. */
export interface UsageCall {
  /**
   * Which CHANNEL served the call: `workbuddy`, `free`, or a provider id.
   *
   * Until this existed the ledger could only say `地区` (domestic /
   * international), which is a property of the WorkBuddy pool and of nothing
   * else. Every row therefore read `国内版` even when the call had gone to a
   * third-party vendor or to the keyless lane, and the only honest reading of the
   * table was "the other channels are not recorded at all" — which was true:
   * only the pool and the free lane ever called `record`.
   */
  channel: string
  /** Which WorkBuddy gateway served it: `cn` or `global`; empty for other lanes. */
  region: string
  /** The model id the request asked for. */
  model: string
  /**
   * The pool account that served this physical call, as its display label.
   *
   * Carried because "which account earned this turn" is a question the ledger
   * has to answer from the samples themselves: the call is filed from inside
   * the stream forwarder, long after the choice of account has scrolled out of
   * whatever picked it. Without it the per-account view could only be a guess
   * reconstructed from turn ordering, which is exactly the kind of plausible
   * fiction this module refuses to publish.
   */
  account?: string
  /**
   * Identifies one user request.
   *
   * Calls sharing a `turnId` are retries of the SAME logical turn - the pool
   * cooling an account and taking the next one. That is what lets the panel
   * separate "3 calls" from "1 turn that rotated".
   */
  turnId: string
  /** When the call finished, in epoch milliseconds. */
  at: number
  ok: boolean
  /** Request sent to first byte. Absent when the call failed before any byte. */
  ttftMs?: number
  /** First byte to `[DONE]`. Absent when the stream never completed. */
  decodeMs?: number
  usage?: TokenUsage
}

/** One row of the per-model aggregate. */
export interface UsageRow {
  /**
   * The channel this row is about: `workbuddy`, `free`, or a provider id.
   *
   * Part of the grouping key, not just a label. Two vendors can publish the same
   * model id, and the pool and the free lane can both serve `glm-5.3` — summing
   * them into one row would attribute a third-party vendor's tokens to WorkBuddy.
   */
  channel: string
  region: string
  model: string
  /** Physical upstream calls. */
  calls: number
  /** Logical turns that reached this model. */
  turns: number
  /** Calls that failed. */
  failed: number
  /** Turns where a failure was followed by a success on another account. */
  recovered: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  /** Output tokens per second while decoding, or `null` when unsound. */
  tps: number | null
  /** Mean time to first byte, or `null` when no call reported one. */
  avgTtftMs: number | null
  /** Most recent completion, for "last used". */
  lastUsedAt: number
}

/** One row of the per-account aggregate. */
export interface UsageAccountRow {
  /** Display label of the account, as the pool prints it. */
  account: string
  /**
   * The channel this account belongs to.
   *
   * Part of the grouping key: a provider's key and a pool account are different
   * things even when both are labelled, and `free` is not a WorkBuddy account at
   * all.
   */
  channel: string
  /** Region the account belongs to; an account serves one gateway. */
  region: string
  /** Physical calls this account served. */
  calls: number
  /** Logical turns this account saw through. */
  turns: number
  /** Calls this account refused. */
  failed: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  /** Most recent completion, for "last used". */
  lastUsedAt: number
  /** The two most-used models here, for a compact "what it usually runs" column. */
  topModels: readonly string[]
}

/** One calendar day, local time. */
export interface UsageDay {
  day: string
  calls: number
  failedTurns: number
  inputTokens: number
  outputTokens: number
}

/** The document the usage panel renders. */
export interface UsageSummary {
  /** Samples still retained, so the panel can say "last N". */
  samples: number
  /** Logical turns in the retained window. */
  turns: number
  /** Turns where every call failed. */
  failedTurns: number
  /** Turns that failed and then succeeded on another account. */
  recoveredTurns: number
  /** Physical upstream calls; above `turns` when the pool rotated. */
  calls: number
  /**
   * False when no retained sample carried usage.
   *
   * The panel must distinguish "used no tokens" from "the gateway told us
   * nothing", and only this flag tells them apart.
   */
  usageReported: boolean
  /**
   * Retained calls, newest first.
   *
   * Published so the ledger's "recent detail" table can be rendered from the
   * same numbers the aggregates above are computed from. Two derivations of
   * one fact set are two chances to disagree; handing the panel the raw
   * samples removes the second derivation entirely.
   *
   * Newest first because that is the order a reader wants, and `record` only
   * ever appends - so reversing here costs one copy rather than a second
   * insertion order to keep in sync.
   */
  entries: readonly UsageCall[]
  rows: UsageRow[]
  accounts: UsageAccountRow[]
  days: UsageDay[]
}

/**
 * Retained calls. Bounded on purpose: a busy week is thousands of calls, and a
 * dashboard that grows without limit turns into a memory leak with a chart.
 */
export const USAGE_MAX_SAMPLES = 2000

/** Days kept in the daily series. A month of history nobody scrolls to is cost without insight. */
export const USAGE_DAY_LIMIT = 14

/**
 * Minimum total decoding time before a throughput figure is published.
 *
 * A one-token answer that arrives in 20ms would otherwise report a tps two
 * orders of magnitude above anything a real turn reaches, and the panel would
 * rank models by that artefact instead of by speed.
 */
const MIN_DECODE_MS = 120

/**
 * A reported token count, or null when the key is absent / not a finite
 * number.
 *
 * Zero is ACCEPTED: an empty turn really can cost nothing, and reporting that
 * as "the gateway said nothing" would make the panel lie in the other
 * direction.
 */
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

function zero(value: unknown): number {
  return count(value) ?? 0
}

function detailOf(value: unknown, key: string): number {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 0
  return zero((value as Record<string, unknown>)[key])
}

/**
 * Read a gateway `usage` object, accepting both spellings OpenAI-compatible
 * gateways use (`prompt_tokens` / `input_tokens`).
 *
 * Returns undefined when the document is not a usage report at all, so callers
 * can tell "the gateway sent zeroes" from "there was nothing here".
 */
export function parseUsage(value: unknown): TokenUsage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const obj = value as Record<string, unknown>
  const input = count(obj['prompt_tokens']) ?? count(obj['input_tokens'])
  const output = count(obj['completion_tokens']) ?? count(obj['output_tokens'])
  if (input === null && output === null) return undefined
  return {
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
    reasoningTokens: detailOf(obj['completion_tokens_details'], 'reasoning_tokens'),
    cachedTokens: detailOf(obj['prompt_tokens_details'], 'cached_tokens'),
  }
}

/**
 * True for the trailer frame a gateway sends to report usage.
 *
 * It is recognised by an EMPTY `choices` array beside a `usage` field. A frame
 * that also carries content is a normal chunk that happens to mention usage,
 * and dropping it would delete the user's answer - which is why the strip step
 * downstream is allowed to remove exactly these and nothing else.
 */
export function isUsageOnlyFrame(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false
  const obj = parsed as Record<string, unknown>
  if (obj['usage'] === undefined || obj['usage'] === null) return false
  const choices = obj['choices']
  return Array.isArray(choices) && choices.length === 0
}

/** Local calendar day of an instant, as `YYYY-MM-DD`. */
export function usageDayKey(at: number): string {
  const d = new Date(at)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/**
 * Timing and usage captured while one stream is forwarded.
 *
 * Kept free of Node stream types so it can be unit tested with plain numbers;
 * the shim owns the Transform that feeds it chunks.
 */
export class StreamTracker {
  /** Milliseconds from request start to the first byte, once seen. */
  ttftMs: number | undefined
  /** Milliseconds from first byte to the end of the stream, once finished. */
  decodeMs: number | undefined
  /** Usage seen in any frame, if the gateway sent any. */
  usage: TokenUsage | undefined

  private firstAt: number | undefined
  private readonly startedAt: number

  constructor(startedAt: number = Date.now()) {
    this.startedAt = startedAt
  }

  /** Record the first byte. Repeated calls keep the earliest. */
  markFirstByte(at: number = Date.now()): void {
    if (this.firstAt !== undefined) return
    this.firstAt = at
    const ttft = at - this.startedAt
    if (ttft >= 0) this.ttftMs = ttft
  }

  /** Record stream completion. Repeated calls keep the earliest. */
  finish(at: number = Date.now()): void {
    if (this.decodeMs !== undefined) return
    if (this.firstAt === undefined) return
    const decode = at - this.firstAt
    if (decode >= 0) this.decodeMs = decode
  }

  /** Fold a parsed frame's usage in; later frames overwrite, as the gateway intends. */
  observe(parsed: unknown): void {
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
    const usage = parseUsage((parsed as Record<string, unknown>)['usage'])
    if (usage !== undefined) this.usage = usage
  }
}

interface TurnBucket {
  calls: number
  succeeded: number
  failed: number
}

/**
 * A bounded window of recent calls, summarised on demand.
 *
 * In-memory by design: this is a live panel, and persisting every prompt's
 * token counts would turn a convenience into a record of what the user asked.
 * A restart therefore starts the chart again, which the panel states rather
 * than hides.
 */
export class UsageRecorder {
  private samples: UsageCall[] = []
  private readonly limit: number

  constructor(limit: number = USAGE_MAX_SAMPLES) {
    this.limit = limit > 0 ? limit : 1
  }

  /** Retain one call, dropping the oldest once the window is full. */
  record(call: UsageCall): void {
    this.samples.push(call)
    while (this.samples.length > this.limit) this.samples.shift()
  }

  /** Samples currently retained. */
  size(): number {
    return this.samples.length
  }

  /** Forget every retained call. */
  reset(): void {
    this.samples = []
  }

  /**
   * Refill today's samples from the pack's own ledger.
   *
   * WHY THIS EXISTS
   *
   * `samples` is process memory, so every restart emptied the usage panel and the pool
   * card — "网关尚未上报 token 数" after a restart was not the gateway declining to
   * answer, it was this recorder having forgotten. The pack, meanwhile, persists a 90-day
   * day-aggregated ledger on disk, so the same period was already recorded and simply not
   * read.
   *
   * Called ONCE at startup, before the first request. It REPLACES rather than appends:
   * whatever is in memory at that moment is either empty (a fresh process) or belongs to
   * the same ledger entries, and adding both would double every figure.
   *
   * The rows are synthesised at DAY granularity — one `UsageCall` per (channel, model) with
   * the day's totals — because that is the resolution the ledger keeps. Per-call timestamps
   * are not recoverable, so the panel's "recent calls" list stays empty after a restart
   * while its totals are right; inventing timestamps to fill the list would be worse than
   * an empty list.
   */
  backfill(calls: readonly UsageCall[]): void {
    this.samples = []
    for (const call of calls) this.record(call)
  }

  /** Aggregate the retained window. */
  summary(): UsageSummary {
    interface Acc {
      row: UsageRow
      turnIds: Set<string>
      decodeMs: number
      ttftTotal: number
      ttftCount: number
    }
    const rows = new Map<string, Acc>()
    const turns = new Map<string, TurnBucket>()
    let calls = 0
    let usageReported = false

    for (const call of this.samples) {
      calls += 1
      if (call.usage !== undefined) usageReported = true

      const bucket = turns.get(call.turnId) ?? { calls: 0, succeeded: 0, failed: 0 }
      bucket.calls += 1
      if (call.ok) bucket.succeeded += 1
      else bucket.failed += 1
      turns.set(call.turnId, bucket)

      // The channel is part of the grouping key, not a label added afterwards:
      // two vendors can publish the same model id, and the pool and the free lane
      // can both serve `glm-5.3`. Summing them would credit a third-party vendor's
      // tokens to WorkBuddy and make the per-model share column nonsense.
      const key = `${call.channel}\u0000${call.region}\u0000${call.model}`
      let acc = rows.get(key)
      if (acc === undefined) {
        acc = {
          row: {
            channel: call.channel,
            region: call.region,
            model: call.model,
            calls: 0,
            turns: 0,
            failed: 0,
            recovered: 0,
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            cachedTokens: 0,
            tps: null,
            avgTtftMs: null,
            lastUsedAt: 0,
          },
          turnIds: new Set<string>(),
          decodeMs: 0,
          ttftTotal: 0,
          ttftCount: 0,
        }
        rows.set(key, acc)
      }
      acc.row.calls += 1
      acc.turnIds.add(call.turnId)
      if (!call.ok) acc.row.failed += 1
      if (call.at > acc.row.lastUsedAt) acc.row.lastUsedAt = call.at
      if (call.ttftMs !== undefined) {
        acc.ttftTotal += call.ttftMs
        acc.ttftCount += 1
      }
      if (call.decodeMs !== undefined) acc.decodeMs += call.decodeMs
      if (call.usage !== undefined) {
        acc.row.inputTokens += call.usage.inputTokens
        acc.row.outputTokens += call.usage.outputTokens
        acc.row.reasoningTokens += call.usage.reasoningTokens
        acc.row.cachedTokens += call.usage.cachedTokens
      }
    }

    const failedTurnIds = new Set<string>()
    let recoveredTurns = 0
    for (const [turnId, bucket] of turns) {
      if (bucket.failed > 0 && bucket.succeeded === 0) failedTurnIds.add(turnId)
      else if (bucket.failed > 0) recoveredTurns += 1
    }

    const out: UsageRow[] = []
    for (const acc of rows.values()) {
      let recovered = 0
      for (const turnId of acc.turnIds) {
        const bucket = turns.get(turnId)
        if (bucket !== undefined && bucket.failed > 0 && bucket.succeeded > 0) recovered += 1
      }
      out.push({
        ...acc.row,
        turns: acc.turnIds.size,
        recovered,
        tps: acc.decodeMs >= MIN_DECODE_MS ? Math.round(acc.row.outputTokens / (acc.decodeMs / 1000)) : null,
        avgTtftMs: acc.ttftCount > 0 ? Math.round(acc.ttftTotal / acc.ttftCount) : null,
      })
    }
    out.sort((a, b) => (b.calls - a.calls) || (b.lastUsedAt - a.lastUsedAt) || a.model.localeCompare(b.model))

    return {
      samples: this.samples.length,
      turns: turns.size,
      failedTurns: failedTurnIds.size,
      recoveredTurns,
      calls,
      usageReported,
      entries: this.samples.slice().reverse(),
      rows: out,
      accounts: this.accountRows(),
      days: this.days(failedTurnIds),
    }
  }

  /**
   * One row per account, busiest first.
   *
   * Samples that never named an account are grouped under an empty label
   * rather than dropped: `account` is optional on `UsageCall`, so a caller that
   * files a sample without one - a failure raised before any account was ever
   * picked, say - would otherwise vanish from this view, and the account table
   * would add up to less than the call total with nothing on screen to explain
   * the gap. Every shim record site names its account; this branch exists so
   * that a future one cannot quietly break the totals.
   *
   * `topModels` keeps the two most-used ids rather than every one: this column
   * answers "what does this account usually run", and a list of nine ids is not
   * an answer to that question, it is just the other table again.
   */
  private accountRows(): UsageAccountRow[] {
    interface Acc {
      row: UsageAccountRow
      turnIds: Set<string>
      modelCalls: Map<string, number>
    }
    const buckets = new Map<string, Acc>()
    for (const call of this.samples) {
      const label = call.account ?? ''
      // Channel in the key too: a provider's key and a pool account can share a
      // label, and `free` is not a WorkBuddy account at all. Grouping by region
      // alone merged them into one row that belonged to neither.
      const key = `${call.channel}\u0000${call.region}\u0000${label}`
      let acc = buckets.get(key)
      if (acc === undefined) {
        acc = {
          row: {
            account: label,
            channel: call.channel,
            region: call.region,
            calls: 0,
            turns: 0,
            failed: 0,
            inputTokens: 0,
            outputTokens: 0,
            cachedTokens: 0,
            lastUsedAt: 0,
            topModels: [],
          },
          turnIds: new Set<string>(),
          modelCalls: new Map<string, number>(),
        }
        buckets.set(key, acc)
      }
      acc.row.calls += 1
      acc.turnIds.add(call.turnId)
      if (!call.ok) acc.row.failed += 1
      if (call.at > acc.row.lastUsedAt) acc.row.lastUsedAt = call.at
      acc.modelCalls.set(call.model, (acc.modelCalls.get(call.model) ?? 0) + 1)
      if (call.usage !== undefined) {
        acc.row.inputTokens += call.usage.inputTokens
        acc.row.outputTokens += call.usage.outputTokens
        acc.row.cachedTokens += call.usage.cachedTokens
      }
    }

    const out: UsageAccountRow[] = []
    for (const acc of buckets.values()) {
      const topModels = [...acc.modelCalls.entries()]
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
        .slice(0, 2)
        .map(([model]) => model)
      out.push({ ...acc.row, turns: acc.turnIds.size, topModels })
    }
    out.sort((a, b) => (b.calls - a.calls) || (b.lastUsedAt - a.lastUsedAt) || a.account.localeCompare(b.account))
    return out
  }

  /**
   * The daily series, oldest first, limited to the most recent days.
   *
   * Sorted by key rather than insertion order because a retained window can
   * straddle a month boundary, and a chart whose axis jumps backwards reads as
   * corrupted data rather than as history.
   *
   * `failedTurns` is counted by DISTINCT turn id, not by summing per-call
   * failures: a turn that rotated three accounts and failed on all three is
   * still one failed turn, and the whole reason this module keeps turns and
   * calls apart is so that number stays honest in every place it appears.
   */
  private days(failedTurnIds: ReadonlySet<string>): UsageDay[] {
    interface DayAcc {
      day: string
      calls: number
      inputTokens: number
      outputTokens: number
      failedTurnIds: Set<string>
    }
    const buckets = new Map<string, DayAcc>()
    for (const call of this.samples) {
      const key = usageDayKey(call.at)
      let acc = buckets.get(key)
      if (acc === undefined) {
        acc = { day: key, calls: 0, inputTokens: 0, outputTokens: 0, failedTurnIds: new Set<string>() }
        buckets.set(key, acc)
      }
      acc.calls += 1
      acc.inputTokens += call.usage?.inputTokens ?? 0
      acc.outputTokens += call.usage?.outputTokens ?? 0
      if (failedTurnIds.has(call.turnId)) acc.failedTurnIds.add(call.turnId)
    }
    return [...buckets.values()]
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-USAGE_DAY_LIMIT)
      .map(acc => ({
        day: acc.day,
        calls: acc.calls,
        failedTurns: acc.failedTurnIds.size,
        inputTokens: acc.inputTokens,
        outputTokens: acc.outputTokens,
      }))
  }
}

/**
 * What one SSE frame says, when it says something at all.
 *
 * Two questions are answered together because both need the parse: is this the
 * gateway's usage TRAILER (a frame the host never asked for, so the shim drops
 * it), and what did the frame contain (so the tracker can read usage out of it
 * either way).
 *
 * Keeping them in one return value is what stops the two decisions from
 * drifting apart. An earlier shape returned the payload only for trailer
 * frames, so a gateway reporting usage on its LAST CONTENT CHUNK instead of a
 * separate trailer would be counted as having reported nothing at all - and the
 * panel, whose entire job is to tell "used no tokens" from "told us nothing",
 * would have printed the wrong one with a straight face.
 *
 * Parsed as TEXT rather than bytes on purpose. The caller slices the stream
 * on the blank line, and both `\n` (0x0A) and `\r` (0x0D) are single-byte
 * ASCII while UTF-8 continuation bytes live in 0x80-0xBF, so a frame boundary
 * can never fall inside a character. The host still receives the ORIGINAL
 * bytes; only this inspection decodes.
 */
export interface InspectedFrame {
  /** The frame's payload exactly as the gateway sent it. */
  parsed: unknown
  /** True when the frame carries usage and nothing else. */
  usageOnly: boolean
}

/**
 * Inspect one SSE frame's content, without its trailing separator.
 *
 * Returns undefined when no `data:` line parsed, which covers the `[DONE]`
 * sentinel, keep-alive comments and truncated JSON alike - a frame the forwarder
 * has no opinion about must come back untouched rather than guessed at.
 */
export function inspectSseFrame(frame: string): InspectedFrame | undefined {
  for (const line of frame.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (payload === '' || payload === '[DONE]') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue
    const usage = (parsed as Record<string, unknown>)['usage']
    if (usage === undefined || usage === null) continue
    return { parsed, usageOnly: isUsageOnlyFrame(parsed) }
  }
  return undefined
}

/**
 * True when an SSE frame carries ONLY a usage report.
 *
 * A convenience over {@link inspectSseFrame} for callers that need the yes/no
 * answer and nothing else; the shim wants the payload itself so it can hand the
 * same object to `StreamTracker.observe` instead of parsing the frame a second
 * time.
 */
export function frameReportsOnlyUsage(frame: string): boolean {
  return inspectSseFrame(frame)?.usageOnly === true
}