/**
 * 百智云 (Baizhi) — Anthropic gateway, and a daily credit behind a proof-of-work challenge.
 *
 * THE DAILY CREDIT IS NOT A PLAIN POST
 *
 * Claiming it takes four steps: ask for a challenge, solve it LOCALLY (a proof-of-work), redeem
 * the solutions for a captcha token, then claim with that token. The work is real — matching a
 * hex prefix of `sha256(salt + n)` — and the prefix comparison is on HEX TEXT, not bytes; a byte
 * comparison is answered `invalid`.
 *
 * `claimed: false` DOES NOT MEAN FAILURE
 *
 * It means either "today's credit was already taken" or "the vendor did not grant one", and the
 * only way to tell them apart is to read the wallet again and look at
 * `daily_temporary_credit_claimed`. Reporting it as a failure painted the card red for a user
 * who had already been credited.
 *
 * @module dsh-xdpool/baizhi-protocol
 */
import { createHash } from 'node:crypto'

/** The Anthropic-shaped model gateway. */
export const BAIZHI_API_BASE = 'https://ai-models.app.baizhi.cloud/api/anthropic'

/** The platform that serves the wallet and the captcha. */
export const BAIZHI_PLATFORM = 'https://baizhi.cloud'

/** Where a console key is created. */
export const BAIZHI_KEYS_PAGE = 'https://ai-models.app.baizhi.cloud/console/keys'

/** The Anthropic version header. */
export const BAIZHI_ANTHROPIC_VERSION = '2023-06-01'

/** The largest context the gateway publishes. */
export const BAIZHI_MAX_CONTEXT = 1_048_576

/** The output ceiling measured as accepted. */
export const BAIZHI_MAX_OUTPUT = 100_000

/** One model. */
export interface BaizhiModel {
  id: string
  name: string
  /** Absent means unknown — inventing one would be a fabrication. */
  contextWindow?: number
  maxOutputTokens?: number
  /** Whether it reasons, so the card can offer a ladder. */
  reasoning: boolean
  /** Whether it accepts an image. Absent means unknown, which is not the same as "no". */
  vision?: boolean
}

/** One stored account. */
export interface BaizhiCredential {
  /** The console API key, which is what the gateway takes. */
  apiKey: string
  /** The console web session, which is what the daily credit needs. */
  sessionCookie?: string
  nickname?: string
}

/** The wallet as the card shows it. */
export interface BaizhiWallet {
  /** Credit left, in yuan. */
  balance?: number
  /** Whether today's temporary credit is in. */
  dailyClaimed?: boolean
  error?: string
}

/** Hash a string to a 32-bit seed. */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * The platform's xorshift32 variant: derive `length` hex characters from a seed.
 *
 * The three shifts are 13 left, 17 right, 5 left — the order matters, because a different mixer
 * produces a different salt and the redeem step rejects it.
 */
export function baizhiPrng(seed: string, length: number): string {
  let state = fnv1a32(seed)
  let out = ''
  while (out.length < length) {
    state = (state ^ ((state << 13) >>> 0)) >>> 0
    state = (state ^ (state >>> 17)) >>> 0
    state = (state ^ ((state << 5) >>> 0)) >>> 0
    out += state.toString(16).padStart(8, '0')
  }
  return out.slice(0, length)
}

/**
 * Find the smallest `n` whose `sha256(salt + n)` starts with `target`.
 *
 * The comparison is on the HEX string. A byte-wise compare is answered `invalid` by the redeem
 * endpoint, and the rejection says nothing about why.
 */
export function baizhiSolveOne(
  salt: string,
  target: string,
  budget: { remaining: number },
): number {
  for (let n = 0; ; n += 1) {
    budget.remaining -= 1
    if (budget.remaining < 0) {
      throw new Error('签到验证求解超出预算（上游可能调高了难度）—— 已中止，避免卡住宿主')
    }
    const digest = createHash('sha256').update(`${salt}${n}`, 'utf8').digest('hex')
    if (digest.startsWith(target)) return n
  }
}

/** A parsed challenge. */
export interface BaizhiChallenge {
  token: string
  /** How many solutions to produce. */
  count: number
  /** Salt length, in hex characters. */
  saltLength: number
  /** Target width, in hex characters. */
  targetLength: number
}

/**
 * Read a challenge envelope.
 *
 * The bounds are defensive: a `c` of a billion would hang the process, so an out-of-range value
 * is refused rather than attempted.
 */
export function readBaizhiChallenge(data: unknown): BaizhiChallenge | { error: string } {
  if (data === null || typeof data !== 'object') return { error: '签到验证题报文不是对象（上游形态可能已变）' }
  const record = data as Record<string, unknown>
  const token = typeof record['token'] === 'string' ? record['token'].trim() : ''
  if (token === '') return { error: '签到验证题报文里没有 token（上游形态可能已变）' }
  const raw = record['challenge']
  if (raw === null || typeof raw !== 'object') {
    return { error: '签到验证题报文里没有 challenge（上游形态可能已变）' }
  }
  const nums = raw as Record<string, unknown>
  const count = Number(nums['c'])
  const saltLength = Number(nums['s'])
  const targetLength = Number(nums['d'])
  if (!Number.isFinite(count) || !Number.isFinite(saltLength) || !Number.isFinite(targetLength)) {
    return { error: '签到验证题的 c/s/d 字段缺失（上游形态可能已变）' }
  }
  if (count < 1 || count > 500) return { error: `签到验证题数量异常（c=${String(count)}）` }
  if (saltLength < 1 || saltLength > 256) return { error: `签到验证题盐长度异常（s=${String(saltLength)}）` }
  if (targetLength < 1 || targetLength > 16) return { error: `签到验证题目标长度异常（d=${String(targetLength)}）` }
  return { token, count, saltLength, targetLength }
}

/**
 * Solve every sub-challenge.
 *
 * TWO DETAILS THAT DECIDE WHETHER THE REDEEM IS ACCEPTED
 *
 *   - The ordinal is ONE-based. Off by one and every solution is wrong, so the claim fails with
 *     no hint about why.
 *   - The target seed is `${token}${ordinal}d` — a trailing `d` distinguishes it from the salt
 *     seed. Using the same seed for both produces a target no solution can ever match.
 */
export function baizhiSolve(
  challenge: BaizhiChallenge,
  budget = { remaining: 5_000_000 },
): number[] {
  const solutions: number[] = []
  for (let index = 0; index < challenge.count; index += 1) {
    const ordinal = index + 1
    const salt = baizhiPrng(`${challenge.token}${String(ordinal)}`, challenge.saltLength)
    const target = baizhiPrng(`${challenge.token}${String(ordinal)}d`, challenge.targetLength)
    solutions.push(baizhiSolveOne(salt, target, budget))
  }
  return solutions
}

/** One row of the live catalogue. */
export function normalizeBaizhiModel(raw: unknown): BaizhiModel | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const id = typeof record['id'] === 'string' ? record['id'] : ''
  if (id === '') return undefined
  const name = typeof record['display_name'] === 'string' && record['display_name'] !== ''
    ? record['display_name']
    : typeof record['name'] === 'string' && record['name'] !== '' ? record['name'] : id
  const context = Number(record['context_window'] ?? record['max_input_tokens'])
  const output = Number(record['max_tokens'] ?? record['max_output_tokens'])
  return {
    id,
    name,
    /**
     * An absent window stays absent.
     *
     * The vendor does not publish one for every model, and filling in a number would make the
     * host compact against a limit nobody promised.
     */
    ...Number.isFinite(context) && context > 0 ? { contextWindow: context } : {},
    ...Number.isFinite(output) && output > 0 ? { maxOutputTokens: Math.floor(output) } : {},
    reasoning: record['thinking'] === true || record['supports_thinking'] === true,
    // Unknown is not "no": leaving it out lets the host treat the model as unstated.
    ...record['vision'] === true || record['supports_image'] === true ? { vision: true } : {},
  }
}
