/**
 * AStudio (科大讯飞 Astron Studio) — the web account surface.
 *
 * TWO CREDENTIALS, TWO AUDIENCES
 *
 * The model gateway takes a bearer JWT (measured at three years). The points, membership and
 * daily-reward endpoints take the WEB session cookies instead — `ssoSessionId` is the one the
 * server actually reads. They are not interchangeable, and a claim made with the bearer is
 * refused as an unauthenticated request.
 *
 * THE DAILY REWARD, AND WHY THE FIELD NAME MATTERS
 *
 * `client-popups/pending` lists claimable popups. The record names its kind in
 * **`componentType`**; reading `type` instead finds nothing at all, so the card reported
 * 「今天已领取」 while the balance never moved. `type` is still accepted as a fallback for an
 * older payload shape.
 *
 * @module dsh-xdpool/astudio-account
 */

import { explainFailure } from './credential-errors.ts'
import {
  ASTUDIO_CLIENT_TYPE,
  ASTUDIO_DAILY_REWARD_COMPONENT,
  ASTUDIO_POINTS_BALANCE_PATH,
  ASTUDIO_POINTS_DETAILS_PATH,
  ASTUDIO_POPUPS_COMPLETE_PATH,
  ASTUDIO_POPUPS_PENDING_PATH,
  ASTUDIO_STUDIO_VERSION,
  ASTUDIO_WEB,
} from './astudio-models.ts'

/** One stored AStudio account. */
export interface AstudioAccount {
  /** The vendor's uid; the account-slot key. */
  accountId: string
  /** The model gateway bearer. */
  bearer: string
  /** The web session cookies, joined into a `Cookie` header. Empty when signed in by key only. */
  cookie: string
  nickname?: string
  /** Epoch ms, when the bearer is known to expire. Bearer JWTs last years. */
  expiresAt?: number
}

/** A points bucket as the card shows it. */
export interface AstudioBalance {
  /** Membership tier as the vendor names it. */
  tier?: string
  /** The general points pool. */
  total: number
  /** Points expiring soonest and when, when the vendor reports it. */
  expiringAt?: string
  expiringPoints?: number
  /** The separate Spark pool, which only `spark-*` models spend. */
  sparkTotal?: number
  sparkExpiringAt?: string
  /** Why the read failed, when it did. */
  error?: string
}

/** What a check-in attempt produced. */
export interface AstudioCheckin {
  outcome: 'claimed' | 'done' | 'inactive' | 'failed'
  /** Points credited this call, when the vendor said. */
  credit?: number
  message?: string
}

/** The headers the web surface expects. */
function webHeaders(account: Pick<AstudioAccount, 'cookie'>): Record<string, string> {
  return {
    Accept: 'application/json',
    Cookie: account.cookie,
    // Both are checked; either missing is answered `11001001`, which reads like an auth
    // failure and is actually a missing identity.
    clientType: ASTUDIO_CLIENT_TYPE,
    studioVersion: ASTUDIO_STUDIO_VERSION,
  }
}

/** Pull a number out of whatever shape the vendor used. */
function pointsOf(payload: unknown): number {
  if (typeof payload === 'number') return Number.isFinite(payload) && payload >= 0 ? Math.floor(payload) : 0
  if (typeof payload === 'string') {
    const text = payload.trim()
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        return pointsOf(JSON.parse(text) as unknown)
      } catch {
        // Not JSON after all; fall through to the integer read.
      }
    }
    const parsed = Number.parseInt(text, 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  }
  if (payload !== null && typeof payload === 'object') {
    for (const key of ['points', 'credit', 'rewardPoints', 'reward_points', 'totalBalance']) {
      const value = (payload as Record<string, unknown>)[key]
      if (value !== undefined) return pointsOf(value)
    }
  }
  return 0
}

/** Read the envelope code, which arrives as a number or a numeric string. */
function codeOf(body: unknown): number | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const raw = (body as Record<string, unknown>)['code']
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** The message in an envelope. */
function messageOf(body: unknown): string {
  if (body === null || typeof body !== 'object') return ''
  const record = body as Record<string, unknown>
  const message = record['message'] ?? record['desc'] ?? record['msg']
  return typeof message === 'string' ? message : ''
}

/**
 * Whether the session is gone for good.
 *
 * `80000` is the terminal code, and the vendor also sends a sentence with it. Both are checked
 * because the sentence appears with other codes too.
 */
function sessionDead(code: number | undefined, message: string): boolean {
  return code === 80000 || message.includes('登录异常，请重新登录')
}

/** Read the points balance. */
export async function astudioBalance(
  account: AstudioAccount,
  signal?: AbortSignal,
): Promise<AstudioBalance> {
  if (account.cookie === '') {
    // A key-only sign-in has no web session: the model works, the points cannot be read.
    return { total: 0, error: '只填了模型密钥，读不到积分（需要浏览器登录一次）' }
  }
  try {
    const response = await fetch(`${ASTUDIO_WEB}${ASTUDIO_POINTS_BALANCE_PATH}`, {
      headers: webHeaders(account),
      signal: signal ?? AbortSignal.timeout(15_000),
    })
    if (!response.ok) return { total: 0, error: explainFailure({ status: response.status, channel: 'AStudio' }) }
    const body = await response.json() as Record<string, unknown>
    const code = codeOf(body)
    if (sessionDead(code, messageOf(body))) {
      return { total: 0, error: 'AStudio 登录会话已失效，请重新登录' }
    }
    if (code !== undefined && code !== 0) {
      return { total: 0, error: messageOf(body) || `code=${String(code)}` }
    }
    const data = (body['data'] ?? {}) as Record<string, unknown>
    /**
     * `totalBalance` is the vendor's own total, not a sum of the packages.
     *
     * Adding the packages up drifts: expired ones stay in the list for a while, and a
     * promotional grant can be counted twice.
     */
    const total = (() => {
      const authoritative = pointsOf(data['totalBalance'])
      if (authoritative > 0) return authoritative
      const packages = data['packages'] ?? data['pointsPackages']
      if (Array.isArray(packages)) {
        return packages.reduce<number>((sum, item) => sum + pointsOf(item), 0)
      }
      return pointsOf(data)
    })()
    const spark = data['sparkPoints'] ?? data['sparkBalance']
    const out: AstudioBalance = { total }
    const tier = data['membershipName'] ?? data['membership'] ?? data['vipName']
    if (typeof tier === 'string' && tier !== '') out.tier = tier
    const expireAt = data['nextExpireTime'] ?? data['pointsNextExpireTime']
    if (typeof expireAt === 'string' && expireAt !== '') out.expiringAt = expireAt
    const expirePoints = pointsOf(data['nextExpirePoints'] ?? data['pointsNextExpirePoints'])
    if (expirePoints > 0) out.expiringPoints = expirePoints
    if (spark !== undefined) {
      const sparkTotal = pointsOf(spark)
      if (sparkTotal > 0) {
        out.sparkTotal = sparkTotal
        const sparkAt = data['sparkNextExpireTime'] ?? data['sparkRunsOutAt']
        if (typeof sparkAt === 'string' && sparkAt !== '') out.sparkExpiringAt = sparkAt
      }
    }
    return out
  } catch (error: unknown) {
    return { total: 0, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The daily check-in.
 *
 * Read first, claim second: a day already credited needs no write, and the proof that a claim
 * worked is a GRANT line in `points/details` — not a balance difference, and not what the popup
 * says about itself.
 */
export async function astudioCheckin(
  account: AstudioAccount,
  signal?: AbortSignal,
): Promise<AstudioCheckin> {
  if (account.cookie === '') {
    return { outcome: 'inactive', message: '只填了模型密钥，无法签到（需要浏览器登录一次）' }
  }
  const headers = webHeaders(account)

  // 1. Has today already been credited? Read the day's movements.
  const alreadyCredited = await astudioCreditedToday(account, signal)
  if (alreadyCredited === true) {
    return { outcome: 'done', message: '今天的每日登录积分已到账' }
  }

  // 2. Ask which popups can be claimed.
  let pending: Record<string, unknown>
  try {
    const response = await fetch(`${ASTUDIO_WEB}${ASTUDIO_POPUPS_PENDING_PATH}`, {
      headers,
      signal: signal ?? AbortSignal.timeout(15_000),
    })
    if (!response.ok) return { outcome: 'failed', message: `查询失败（HTTP ${String(response.status)}）` }
    pending = await response.json() as Record<string, unknown>
  } catch (error: unknown) {
    return { outcome: 'failed', message: `查询失败：${error instanceof Error ? error.message : String(error)}` }
  }
  const pendingCode = codeOf(pending)
  if (sessionDead(pendingCode, messageOf(pending))) {
    return { outcome: 'failed', message: 'AStudio 登录会话已失效，请重新登录' }
  }
  if (pendingCode !== undefined && pendingCode !== 0) {
    return { outcome: 'failed', message: messageOf(pending) || `code=${String(pendingCode)}` }
  }

  const rows = Array.isArray(pending['data']) ? pending['data'] as unknown[] : []
  const claimable: { popupId: number; instanceKey: string; payload: unknown }[] = []
  const seen = new Set<number>()
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    // `componentType` is the real field; `type` is the older shape.
    const kind = String(record['componentType'] ?? record['type'] ?? '')
    if (kind !== ASTUDIO_DAILY_REWARD_COMPONENT && kind !== 'NEW_USER_DIALOG') continue
    const popupId = typeof record['popupId'] === 'number'
      ? record['popupId']
      : Number.parseInt(String(record['popupId'] ?? ''), 10)
    if (!Number.isFinite(popupId) || seen.has(popupId)) continue
    seen.add(popupId)
    claimable.push({
      popupId,
      instanceKey: typeof record['instanceKey'] === 'string' ? record['instanceKey'] : '',
      payload: record['payload'] ?? record['content'],
    })
  }
  // Nothing pending is the "already claimed" state: the vendor answers `code 0` with an empty
  // list once the day's reward is taken.
  if (claimable.length === 0) return { outcome: 'done', message: '今天已领取' }

  let credited = 0
  for (const popup of claimable) {
    let complete: Record<string, unknown>
    try {
      const response = await fetch(`${ASTUDIO_WEB}${ASTUDIO_POPUPS_COMPLETE_PATH}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ popupId: popup.popupId, instanceKey: popup.instanceKey }),
        signal: signal ?? AbortSignal.timeout(15_000),
      })
      if (!response.ok) return { outcome: 'failed', message: `领取失败（HTTP ${String(response.status)}）` }
      complete = await response.json() as Record<string, unknown>
    } catch (error: unknown) {
      return { outcome: 'failed', message: `领取失败：${error instanceof Error ? error.message : String(error)}` }
    }
    const completeCode = codeOf(complete)
    if (sessionDead(completeCode, messageOf(complete))) {
      return { outcome: 'failed', message: 'AStudio 登录会话已失效，请重新登录' }
    }
    if (completeCode !== undefined && completeCode !== 0) {
      return { outcome: 'failed', message: messageOf(complete) || `code=${String(completeCode)}` }
    }
    const fromResponse = pointsOf(complete['data'])
    credited += fromResponse > 0 ? fromResponse : pointsOf(popup.payload)
  }

  /**
   * The claim is judged by the LEDGER, not by the response.
   *
   * A 200 with a plausible body has been observed while the balance did not move, so the
   * movement list decides. It can lag a couple of seconds, hence the short second read.
   */
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await astudioCreditedToday(account, signal) === true) {
      return {
        outcome: 'claimed',
        ...(credited > 0 ? { credit: credited } : {}),
        ...(claimable.length > 1 ? { message: `已领取 ${String(claimable.length)} 项福利` } : {}),
      }
    }
    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 1500))
  }
  return { outcome: 'failed', message: '领取请求成功，但积分流水里还没出现入账，请稍后再看' }
}

/**
 * Whether today already has a 「每日登录赠送」 credit.
 *
 * The window is Beijing time, matching the vendor's own day boundary.
 */
async function astudioCreditedToday(
  account: AstudioAccount,
  signal?: AbortSignal,
): Promise<boolean | undefined> {
  try {
    const query = new URLSearchParams({ direction: 'CREDIT', pageNo: '1', pageSize: '20' })
    const response = await fetch(`${ASTUDIO_WEB}${ASTUDIO_POINTS_DETAILS_PATH}?${query.toString()}`, {
      headers: webHeaders(account),
      signal: signal ?? AbortSignal.timeout(15_000),
    })
    if (!response.ok) return undefined
    const body = await response.json() as Record<string, unknown>
    const data = body['data']
    const rows = Array.isArray(data)
      ? data
      : Array.isArray((data as Record<string, unknown> | undefined)?.['records'])
        ? ((data as Record<string, unknown>)['records'] as unknown[])
        : []
    const today = beijingDay()
    for (const row of rows) {
      if (row === null || typeof row !== 'object') continue
      const record = row as Record<string, unknown>
      const reason = String(record['reason'] ?? record['description'] ?? record['remark'] ?? '')
      if (!reason.includes('每日登录')) continue
      const at = record['createTime'] ?? record['createdAt'] ?? record['time']
      if (typeof at === 'string' && at.slice(0, 10) >= today) return true
      if (typeof at === 'number') {
        const day = new Date(at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
        if (day >= today) return true
      }
      // A row without a usable timestamp still counts: it came back from a one-page read of
      // today's credits.
      if (at === undefined) return true
    }
    return false
  } catch {
    return undefined
  }
}

/** Today's date in Beijing, as `YYYY-MM-DD`. */
function beijingDay(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

/**
 * Exchange the web session for a model bearer.
 *
 * This is what the desktop app calls on launch. The old bearer keeps working after a re-mint,
 * which is why a failure here leaves the stored one in place.
 */
export async function astudioMintBearer(
  account: { cookie: string; accountId?: string },
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    const response = await fetch(`${ASTUDIO_WEB}/auth/bearer-token`, {
      method: 'POST',
      headers: { ...webHeaders(account), 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: account.accountId ?? '' }),
      signal: signal ?? AbortSignal.timeout(20_000),
    })
    if (!response.ok) return undefined
    const body = await response.json() as Record<string, unknown>
    const data = body['data']
    if (typeof data === 'string' && data !== '') return data
    if (data !== null && typeof data === 'object') {
      const token = (data as Record<string, unknown>)['token'] ?? (data as Record<string, unknown>)['bearerToken']
      if (typeof token === 'string' && token !== '') return token
    }
    return undefined
  } catch {
    return undefined
  }
}
