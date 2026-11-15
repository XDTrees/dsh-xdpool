/**
 * Doubao's credit tasks: what is waiting, and claiming it.
 *
 * WHAT WAS MEASURED
 *
 * `POST /alice/ug/campaign/v3/detail/` with `{campaign_group_code:"pc_incentive_task_mvp_v3"}`
 * returns the account's tasks and milestones. Each claimable entry carries a NUMERIC `task_id`
 * and a `campaign_item_code`, and
 *
 *   POST /alice/ug/campaign/item/reward/claim/
 *   { task_id: <the numeric id>, campaign_group_code, campaign_item_code }
 *
 * answers success. Two ways to get it wrong, both measured: sending the `campaign_code` as
 * `task_id` answers `710010202`, and sending `task_id` as a string answers the same.
 *
 * THE DAILY SIGN-IN
 *
 * `/alice/ug/campaign/landing/checkin` is the endpoint the client's own check-in button calls,
 * and it is used as-is. What it answers is the account's business: one account was observed to
 * be refused with `710010702 系统错误` while the same call is the documented path for every
 * other, which reads as a flagged account rather than a broken endpoint — so the result is
 * passed through and the caller reports it.
 *
 * @module dsh-xdpool/doubao-campaign
 */
import { cookieHeader, sessionUsable, type DoubaoSession } from './doubao-auth.ts'

/** The campaign this account's tasks belong to. */
const CAMPAIGN_GROUP = 'pc_incentive_task_mvp_v3'

const DETAIL_ENDPOINT = 'https://www.doubao.com/alice/ug/campaign/v3/detail/'
const CLAIM_ENDPOINT = 'https://www.doubao.com/alice/ug/campaign/item/reward/claim/'
const CHECKIN_ENDPOINT = 'https://www.doubao.com/alice/ug/campaign/landing/checkin'

/** One task as the card shows it. */
export interface DoubaoTask {
  /**
   * The campaign item code — what the claim call sends as `campaign_item_code`.
   *
   * Measured: the detail document identifies a task by `campaign_code` (a slug like
   * `daily_signin`), and `task_status` is a NUMBER where 0 means "not started" and 1 or 3 mean
   * "done". Assuming `task_id`/`status` produced nothing at all, because neither field exists.
   */
  itemCode: string
  title: string
  /** Whether the reward can be collected now. */
  claimable: boolean
  /** Whether it has already been collected. */
  claimed: boolean
  /** The raw status the server reported, kept for the card's own wording. */
  status: number
  /** A short progress line, when the campaign reports one. */
  progress?: string
}

/** What one detail read produced. */
export interface DoubaoCampaign {
  tasks: readonly DoubaoTask[]
  /** How many are ready to claim — the number the card prints. */
  claimableCount: number
  /** Points already collected, when the campaign reports a total. */
  earned?: number
  /** Set when the read failed; the card shows it instead of an empty list. */
  error?: string
}

/**
 * The query parameters these endpoints require.
 *
 * Measured: the same body without them is answered `{code:1, msg:"invalid param"}` with HTTP
 * 200 — a refusal that reads as a malformed request and is actually a missing client
 * identity. The campaign endpoints are served by a different backend from the chat one and
 * check this envelope more strictly.
 */
const CLIENT_PARAMS = {
  aid: '497858',
  real_aid: '497858',
  device_platform: 'web',
  doubao_device_platform: 'web',
  language: 'zh',
  region: 'CN',
  sys_region: 'CN',
  pkg_type: 'release_version',
  pc_version: '2.1.7',
  client_platform: 'pc_client',
  runtime: 'web',
  runtime_version: '3.5.4',
  samantha_web: '1',
  'use-olympus-account': '1',
} as const

/** The endpoint with the client envelope attached. */
function buildUrl(endpoint: string): string {
  const params = new URLSearchParams({ ...CLIENT_PARAMS, web_tab_id: crypto.randomUUID() })
  return `${endpoint}?${params.toString()}`
}

/** The headers every campaign call needs. */
function headers(session: DoubaoSession): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: '*/*',
    'user-agent': session.userAgent,
    // The scheme referer, not https: this is the same check as the chat endpoint.
    Referer: 'chrome://doubao-chat/',
    'agw-js-conv': 'str',
    cookie: cookieHeader(session),
  }
}

/** Pull a numeric field that may arrive as a number or a numeric string. */
function numberOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/** A text field that may arrive under any of several names. */
function textOf(record: Record<string, unknown>, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = record[name]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

/**
 * Walk the detail document for task rows.
 *
 * The envelope is nested and has been rearranged between builds, so the walk looks for the
 * FIELDS a task needs (a numeric id plus a campaign item code) rather than a fixed path. That
 * is what keeps it working when the server adds a wrapper level.
 */
export function tasksFrom(raw: unknown): DoubaoTask[] {
  const out: DoubaoTask[] = []
  const seen = new Set<string>()
  const walk = (node: unknown, depth: number): void => {
    if (depth > 10 || node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry, depth + 1)
      return
    }
    const record = node as Record<string, unknown>
    /**
     * A task is identified by its campaign code — a SLUG, not a number.
     *
     * The claim call takes that slug, together with the campaign group. `task_id` does not
     * appear anywhere in this document; assuming it did meant every row was skipped and the
     * card reported "no tasks" against an account that had eight.
     */
    const itemCode = textOf(record, ['campaign_code', 'campaign_item_code', 'campaignItemCode', 'item_code'])
    const title = textOf(record, ['title', 'name', 'task_name'])
    /**
     * A node that is not a task is not a dead end.
     *
     * Returning here would abandon the whole subtree — and the tasks live under `data.tasks`,
     * so the very first wrapper node has neither field and every row below it was skipped.
     * `walk(child)` continues instead, which is what lets the envelope be rearranged.
     */
    if (itemCode === undefined || title === undefined || seen.has(itemCode)) {
      for (const value of Object.values(record)) walk(value, depth + 1)
      return
    }
    seen.add(itemCode)
    const status = numberOf(record['task_status'] ?? record['status'] ?? record['state']) ?? 0
    /**
     * What the statuses mean, measured on a live account:
     *   0 — not started (the guidance card)
     *   1 — completed, reward may be collectable
     *   3 — a choice step that is itself a task
     *
     * "Completed" is not "collected": the claim call is what moves the points, so the card
     * offers the button for a completed task and stops offering it once the server's own
     * totals show the reward landed.
     */
    const claimed = record['claimed'] === true || record['is_claimed'] === true
    const claimable = (status === 1 || status === 3) && !claimed
    out.push({
      itemCode,
      title,
      claimable,
      claimed,
      status,
      ...(typeof record['subtitle'] === 'string' && record['subtitle'] !== ''
        ? { progress: record['subtitle'] }
        : {}),
    })
  }
  walk(raw, 0)
  return out
}


/**
 * Read the account's tasks.
 *
 * A failure is reported through `error`, not thrown: the card sits beside the quota panel and
 * must render whether or not the campaign is reachable.
 */
export async function fetchCampaign(session: DoubaoSession | undefined): Promise<DoubaoCampaign> {
  if (session === undefined || !sessionUsable(session)) {
    return { tasks: [], claimableCount: 0, error: '还没有登录态' }
  }
  try {
    const response = await fetch(buildUrl(DETAIL_ENDPOINT), {
      method: 'POST',
      headers: headers(session),
      body: JSON.stringify({ campaign_group_code: CAMPAIGN_GROUP }),
      // A hung upstream must not hang the card: without a deadline the request held the
      // route open and the button appeared dead.
      signal: AbortSignal.timeout(20_000),
    })
    const payload = await response.json() as Record<string, unknown>
    const code = numberOf(payload['code'] ?? payload['status_code'])
    const message = textOf(payload, ['msg', 'message']) ?? ''
    if (code !== undefined && code !== 0) {
      return { tasks: [], claimableCount: 0, error: message === '' ? `上游返回 ${String(code)}` : message }
    }
    const tasks = tasksFrom(payload)
    // The campaign reports the account's total in `data.progress.total_amount`, not as an
    // `earned` field of its own.
    const progress = (payload['data'] as Record<string, unknown> | undefined)?.['progress'] as
      | Record<string, unknown> | undefined
    const earned = numberOf(progress?.['total_amount'])
    return {
      tasks,
      claimableCount: tasks.filter(task => task.claimable).length,
      ...(earned === undefined ? {} : { earned }),
    }
  } catch (error: unknown) {
    return {
      tasks: [],
      claimableCount: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** What one claim attempt did. */
export interface DoubaoClaimResult {
  /** How many tasks were collected. */
  claimed: number
  /** How many were rejected, with the first reason. */
  failed: number
  reason?: string
}

/**
 * Collect every claimable task.
 *
 * `task_id` is sent as a NUMBER and paired with the item code: a string, or the campaign code
 * in its place, is answered `710010202`. That is the whole reason this loop is explicit rather
 * than a single "claim all" call — the endpoint takes one item at a time.
 */
export async function claimTasks(session: DoubaoSession | undefined): Promise<DoubaoClaimResult> {
  if (session === undefined || !sessionUsable(session)) return { claimed: 0, failed: 0, reason: '还没有登录态' }
  const campaign = await fetchCampaign(session)
  if (campaign.error !== undefined) return { claimed: 0, failed: 0, reason: campaign.error }
  const pending = campaign.tasks.filter(task => task.claimable)
  if (pending.length === 0) return { claimed: 0, failed: 0 }

  let claimed = 0
  let failed = 0
  let reason: string | undefined
  for (const task of pending) {
    try {
      const response = await fetch(buildUrl(CLAIM_ENDPOINT), {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: headers(session),
        body: JSON.stringify({
          campaign_group_code: CAMPAIGN_GROUP,
          campaign_item_code: task.itemCode,
        }),
      })
      const payload = await response.json() as Record<string, unknown>
      const code = numberOf(payload['code'] ?? payload['status_code'])
      if (code === undefined || code === 0) {
        claimed += 1
      } else {
        failed += 1
        reason ??= textOf(payload, ['msg', 'message']) ?? `上游返回 ${String(code)}`
      }
    } catch (error: unknown) {
      failed += 1
      reason ??= error instanceof Error ? error.message : String(error)
    }
  }
  return { claimed, failed, ...(reason === undefined ? {} : { reason }) }
}

export async function attemptCheckin(session: DoubaoSession | undefined): Promise<{ ok: boolean; message: string }> {
  if (session === undefined || !sessionUsable(session)) return { ok: false, message: '还没有登录态' }
  try {
    const response = await fetch(buildUrl(CHECKIN_ENDPOINT), {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: headers(session),
      body: JSON.stringify({ scene: CAMPAIGN_GROUP }),
    })
    const payload = await response.json() as Record<string, unknown>
    const code = numberOf(payload['code'] ?? payload['status_code'])
    if (code === undefined || code === 0) return { ok: true, message: '签到成功' }
    const message = textOf(payload, ['msg', 'message']) ?? ''
    // The server's own words. A refusal is reported as it comes: on some accounts this
    // endpoint answers 710010702, and the reason is the account rather than the call.
    return { ok: false, message: message === '' ? `上游返回 ${String(code)}` : message }
  } catch (error: unknown) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
