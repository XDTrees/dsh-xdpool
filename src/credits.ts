/**
 * Estimated credit spend, per channel and per model.
 *
 * THE FORMULA IS NOT `tokens × multiplier`
 *
 * This module was wrong once, in a way worth recording. The model picker shows a figure
 * like `x0.11`, and the obvious reading — "0.11 credits per million tokens" — is wrong.
 * The multiplier is a DISPLAY figure; the actual billing is three separate coefficients
 * per model, in credits per million tokens:
 *
 *   积分 = 未命中缓存的输入 × 输入系数
 *        + 缓存命中       × 缓存系数
 *        + 输出（含思考） × 输出系数
 *
 * With the real coefficients for DeepSeek-V4.1-Flash (14.29 / 0.29 / 57.1), a day of
 * 3.5M input + 197M cache reads + 0.29M output costs about 74 credits. The old
 * `total × 0.11` formula reported 0.4 — off by two orders of magnitude, and in the
 * direction that makes a user think they have far more headroom than they do.
 *
 * Cached input is by far the dominant term in agentic use: 197M cache reads against 3.5M
 * fresh input is normal, and at 0.29 credits/M those 197M still cost 57 credits. A
 * formula that ignores the cache field is not merely imprecise, it misses most of the
 * bill.
 *
 * WHERE THE COEFFICIENTS COME FROM
 *
 * Measured publicly by third parties against the live gateway (13 models, 555 charges,
 * every one reconciled). They are a snapshot: WorkBuddy adjusts them, and the same source
 * recorded GLM-5.3-Flash rising ~30% between two measurement rounds. So they are declared
 * HERE, dated, and a model absent from this table is reported as unpriced rather than
 * billed at a guessed rate.
 *
 * @module dsh-xdpool/credits
 */

/**
 * Three billing coefficients for one model, in credits per MILLION tokens.
 *
 * All three are needed: a model can be cheap on input and expensive on output by 4×
 * (DeepSeek-V4.1-Flash: 14.29 in, 57.1 out), so a single number cannot describe it.
 */
export interface CreditRates {
  /** Fresh (uncached) input tokens. */
  input: number
  /** Cache READ tokens — the cheapest tier, and the largest term in practice. */
  cache: number
  /** Output tokens, reasoning included. */
  output: number
}

/** When this table was measured, and therefore how stale it may be. */
export const RATES_MEASURED_AT = '2026-11-06'

/**
 * Coefficients by model id, as the billing gateway names them.
 *
 * Keys are lower-cased and matched case-insensitively, because the three sources that
 * name a model here (the pool catalog, the pack ledger, a channel listing) disagree on
 * casing: `deepseek-v4.1-flash` / `DeepSeek-V4.1-Flash`.
 *
 * The `(闲时)` suffix in the source table marks DeepSeek's off-peak price. It is used as
 * the plain rate: peak pricing is higher, so an estimate built on the off-peak figure
 * UNDERSTATES the bill, which is the safe direction for a "can I keep going" gauge.
 */
const RATE_TABLE: Readonly<Record<string, CreditRates>> = {
  'deepseek-v4.1-flash': { input: 14.29, cache: 0.29, output: 57.1 },
  'space-bunny': { input: 15.0, cache: 3.0, output: 60.0 },
  'minimax-m3.1-flash': { input: 28.57, cache: 2.86, output: 114.3 },
  'glm-5.3-flash': { input: 14.86, cache: 4.29, output: 52.0 },
  'mimo-v2.6-pro': { input: 85.71, cache: 0.71, output: 171.4 },
  'hy4-preview': { input: 142.86, cache: 5.71, output: 285.7 },
  'step-5-preview': { input: 120.0, cache: 12.0, output: 342.9 },
  'deepseek-v4-pro': { input: 257.14, cache: 8.57, output: 771.4 },
  'glm-5.3': { input: 160.0, cache: 40.0, output: 560.0 },
  'glm-5.2': { input: 160.0, cache: 40.0, output: 560.0 },
  'kimi-k2.8-preview': { input: 158.0, cache: 41.43, output: 655.7 },
  'kimi-k3.1-pro': { input: 315.71, cache: 31.71, output: 1651.4 },
  'kimi-k3-1': { input: 485.71, cache: 48.57, output: 2428.6 },
  // The pack and the pool spell this model both ways.
  'kimi-k3': { input: 485.71, cache: 48.57, output: 2428.6 },
}

/**
 * Tokens are frequently reported in a "total" form that already includes the cached
 * portion, while the pool's own ledger keeps them apart. Normalising here — rather than
 * at each call site — is what keeps one caller from double-counting.
 */
function cacheRateOf(model: string): CreditRates | undefined {
  const key = model.trim().toLowerCase()
  if (key === '') return undefined
  const direct = RATE_TABLE[key]
  if (direct !== undefined) return direct
  // A channel may decorate the id (`nvidia/…`, `cline-free/…`, a vendor prefix). Take the
  // trailing segment, which is the model proper.
  const tail = key.split('/').pop()
  if (tail !== undefined && tail !== key) {
    const byTail = RATE_TABLE[tail]
    if (byTail !== undefined) return byTail
  }
  // Some listings carry a variant suffix the table does not spell out.
  for (const candidate of Object.keys(RATE_TABLE)) {
    if (key.startsWith(candidate) || key.endsWith(candidate)) return RATE_TABLE[candidate]
  }
  return undefined
}

/** One model's contribution to a channel's spend. */
export interface CreditSpendRow {
  channel: string
  model: string
  requests: number
  /** Fresh input, excluding the cached portion. */
  inputTokens: number
  /** Cache reads, billed at the cache coefficient. */
  cacheTokens: number
  outputTokens: number
  /** The coefficients used, or undefined when the model is not in the table. */
  rates: CreditRates | undefined
  /** Estimated credits, or undefined when `rates` is unknown. */
  credits: number | undefined
}

/** A whole channel's total. */
export interface CreditChannelTotal {
  channel: string
  requests: number
  inputTokens: number
  cacheTokens: number
  outputTokens: number
  credits: number
  /** How many models on this channel had no published coefficients. */
  unpricedModels: number
}

/**
 * Credits for one row, using the three-coefficient formula.
 *
 * Each term is divided by a million because the coefficients are per-million-token; the
 * sum is rounded to four decimals so a long tail of small requests accumulates into
 * something comparable without claiming precision nobody has.
 */
export function creditsOf(
  inputTokens: number,
  cacheTokens: number,
  outputTokens: number,
  rates: CreditRates | undefined,
): number | undefined {
  if (rates === undefined) return undefined
  const fresh = Math.max(0, inputTokens)
  const cached = Math.max(0, cacheTokens)
  const out = Math.max(0, outputTokens)
  const total = (fresh * rates.input + cached * rates.cache + out * rates.output) / 1_000_000
  return Math.round(total * 10_000) / 10_000
}

/** Roll per-model rows up to one line per channel. */
export function totalsByChannel(rows: readonly CreditSpendRow[]): readonly CreditChannelTotal[] {
  const byChannel = new Map<string, CreditChannelTotal>()
  for (const row of rows) {
    const current = byChannel.get(row.channel) ?? {
      channel: row.channel,
      requests: 0,
      inputTokens: 0,
      cacheTokens: 0,
      outputTokens: 0,
      credits: 0,
      unpricedModels: 0,
    }
    current.requests += row.requests
    current.inputTokens += row.inputTokens
    current.cacheTokens += row.cacheTokens
    current.outputTokens += row.outputTokens
    if (row.credits === undefined) current.unpricedModels += 1
    else current.credits = Math.round((current.credits + row.credits) * 10_000) / 10_000
    byChannel.set(row.channel, current)
  }
  // Biggest spender first: the panel exists to answer "who is eating the quota".
  return [...byChannel.values()].sort((a, b) => b.credits - a.credits)
}

/**
 * The coefficients for a model, exported for the report.
 *
 * Returns undefined rather than zeros for an unknown model: "we do not know the price"
 * and "this was free" are different statements, and a zero would collapse them.
 */
export function ratesFor(model: string): CreditRates | undefined {
  return cacheRateOf(model)
}

/**
 * Read a display name's multiplier, kept for the picker's own labelling.
 *
 * This is the figure the UI shows (`Hy3 · x0.05`). It is NOT used for billing — see the
 * module note — but the panel still displays it because it is what the user sees in the
 * picker and hiding it would make the two disagree.
 */
export function rateFromModelName(name: string): number | undefined {
  if (typeof name !== 'string' || name === '') return undefined
  const [, ...tail] = name.split('·')
  const hasSeparator = tail.length > 0
  const region = (hasSeparator ? tail.join('·') : name).trim()
  if (/免费/u.test(region)) return 0
  const all = [...region.matchAll(/x\s*(\d+(?:\.\d+)?)/giu)]
  if (all.length > 0) {
    const last = all[all.length - 1]
    if (!hasSeparator && !/x\s*\d+(?:\.\d+)?\s*$/iu.test(region)) return undefined
    const digits = last?.[1]
    if (digits !== undefined) {
      const value = Number(digits)
      return Number.isFinite(value) ? value : undefined
    }
  }
  const suffixed = [...region.matchAll(/(\d+(?:\.\d+)?)\s*x/giu)]
  if (suffixed.length > 0) {
    if (!hasSeparator && !/\d+(?:\.\d+)?\s*x\s*$/iu.test(region)) return undefined
    const digits = suffixed[suffixed.length - 1]?.[1]
    if (digits !== undefined) {
      const value = Number(digits)
      return Number.isFinite(value) ? value : undefined
    }
  }
  return undefined
}
