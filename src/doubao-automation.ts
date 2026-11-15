/**
 * Doubao's credit automation.
 *
 * WHAT "AUTOMATION" MEANS HERE
 *
 * WorkBuddy's automation claims a daily check-in. Doubao has no working check-in endpoint — it
 * answers `710010702 系统错误` for every account, including from Doubao's own client — but it
 * does have campaign tasks whose rewards are collectable, and `daily_signin` is one of them.
 * So the automation is: collect every claimable task, on a schedule, and record what it did.
 *
 * The distinction matters for what the card can promise. This cannot make a check-in succeed;
 * it can only collect what the server has already marked finished. When nothing is claimable it
 * says so rather than reporting a failure.
 *
 * @module dsh-xdpool/doubao-automation
 */
import { attemptCheckin, claimTasks, fetchCampaign } from './doubao-campaign.ts'
import type { DoubaoSession } from './doubao-auth.ts'

/** How often a pass runs while the switch is on. */
const INTERVAL_MS = 6 * 60 * 60 * 1000

/** What the card shows for the automation. */
export interface DoubaoAutomationState {
  enabled: boolean
  /** ISO timestamp of the last pass, or undefined when it has never run. */
  lastRunAt?: string
  /** What the last pass collected. */
  lastClaimed?: number
  /** Why the last pass collected nothing, when it did not. */
  lastNote?: string
  /** What the daily sign-in answered, so the card can show it separately from the tasks. */
  lastCheckin?: string
}

/** The holder: one per plugin instance, since one session means one account. */
export interface DoubaoAutomation {
  state: () => DoubaoAutomationState
  setEnabled: (enabled: boolean) => void
  /** Run one pass now, whatever the switch says. Used by the "run once" action. */
  runOnce: () => Promise<DoubaoAutomationState>
  stop: () => void
}

/**
 * The automation, wired to a session getter.
 *
 * `runOn()` is separate from the timer so the card's manual button and the scheduled pass do the
 * same thing — a second implementation for the button would be the one that drifts.
 */
export function createDoubaoAutomation(options: {
  session: () => DoubaoSession | undefined
  /** Called with a human sentence when a pass finishes, for the plugin log. */
  logger?: { info?: (...args: unknown[]) => void } | undefined
}): DoubaoAutomation {
  let enabled = false
  let state: DoubaoAutomationState = { enabled: false }
  let timer: ReturnType<typeof setInterval> | undefined

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }

  /**
   * One pass.
   *
   * "Nothing to collect" is recorded as a note rather than a failure: an account whose tasks are
   * all done has nothing wrong with it, and reporting that as an error every six hours is how a
   * working feature reads as broken.
   */
  const runPass = async (): Promise<DoubaoAutomationState> => {
    const session = options.session()
    if (session === undefined) {
      state = { ...state, enabled, lastNote: '还没有登录态' }
      return state
    }
    /**
     * The daily sign-in first, then the tasks.
     *
     * `daily_signin` appears in the campaign as a task, but the endpoint its own button calls
     * is a separate one — and claiming the task does not perform the sign-in that earns it. So
     * both are attempted, and a refused sign-in does not stop the task collection that follows.
     */
    const checkin = await attemptCheckin(session)
    const before = await fetchCampaign(session)
    if (before.error !== undefined) {
      state = { ...state, enabled, lastNote: before.error }
      return state
    }
    const checkinNote = checkin.ok ? '签到成功' : checkin.message
    if (before.claimableCount === 0) {
      state = {
        ...state,
        enabled,
        lastRunAt: new Date().toISOString(),
        lastClaimed: 0,
        lastNote: '今天没有可领取的积分',
        lastCheckin: checkinNote,
      }
      return state
    }
    const result = await claimTasks(session)
    state = {
      ...state,
      enabled,
      lastRunAt: new Date().toISOString(),
      lastClaimed: result.claimed,
      lastCheckin: checkinNote,
      ...(result.reason === undefined
        ? {}
        : { lastNote: result.reason }),
    }
    options.logger?.info?.(
      `[xdpool] doubao automation: claimed ${String(result.claimed)} task(s)`
        + (result.failed > 0 ? `, ${String(result.failed)} failed` : ''),
    )
    return state
  }

  const arm = (): void => {
    clearTimer()
    if (!enabled) return
    timer = setInterval(() => { void runPass() }, INTERVAL_MS)
    // Node keeps the process alive for an interval by default; the plugin must not be what
    // holds DSH open.
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      (timer as { unref: () => void }).unref()
    }
  }

  return {
    state: () => state,
    setEnabled: (next: boolean) => {
      enabled = next
      state = { ...state, enabled: next }
      arm()
      // Turning it on runs a pass immediately: a switch that does nothing until six hours have
      // passed is indistinguishable from one that did not work.
      if (next) void runPass()
    },
    runOnce: async () => await runPass(),
    stop: () => { clearTimer() },
  }
}
