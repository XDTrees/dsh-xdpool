/**
 * The Doubao account roster.
 *
 * WHY THIS EXISTS (#171)
 *
 * The lane used to hold ONE session: a single browser profile, a single `sessionid`, a single
 * `doubao-session.json`. A second sign-in overwrote the first, so the pool could only ever
 * serve one Doubao account and the first one looked "kicked out". Everything downstream — the
 * chat lane, the quota reader, the task automation, the host adapter — read that one holder.
 *
 * So the holder becomes a roster, and this module is the one place that answers:
 *
 *   - WHICH accounts exist (in memory, mirrored to `doubao-store.ts`);
 *   - WHICH browser slot each one owns, so a re-sign-in lands on its own profile;
 *   - WHICH one answers the next request, which is what makes a second account useful
 *     instead of decorative.
 *
 * SELECTION IS STICKY, WITH COOLDOWNS
 *
 * Round-robin on every request would split one conversation across two accounts: Doubao keeps
 * history server-side under a conversation id minted by the account that opened it, so the
 * next account cannot continue it. A sticky choice — the same account until it reports a
 * failure class that means "this account cannot answer right now" — keeps a thread coherent
 * while still letting a fatigued account be skipped.
 *
 * The cooldown is deliberately short and per-kind:
 *
 *   session_dead      the cookie is rejected. Sign-in only, so it is marked for the rest of
 *                     the process rather than for a few seconds.
 *   quota_exhausted   the 5-hour/weekly window is spent. Long enough that the next turn does
 *                     not re-discover it, short enough that a reset is picked up.
 *   rate_limited      risk control wants a slider cleared in the Doubao client. Neither a
 *                     retry nor another account helps with the slider, but the OTHER accounts
 *                     are unaffected, which is exactly why stepping aside is right.
 *   network/upstream  a fact about the network or the vendor, not the account: no cooldown,
 *                     or a second account would be blamed for a flaky link.
 *
 * @module dsh-xdpool/doubao-roster
 */
import type { DoubaoSession } from './doubao-auth.ts'
import { sessionUsable } from './doubao-auth.ts'
import type { DoubaoAccountEntry } from './doubao-store.ts'
import { accountIdOf } from './doubao-store.ts'
import type { DoubaoErrorKind } from './doubao-upstream.ts'

/** One account the lane can serve. */
export interface DoubaoAccount {
  /** Stable id: the vendor's `uid_tt` when the jar carries it. */
  id: string
  /** The sign-in slot that owns the browser profile this jar came from. */
  slot: number
  session: DoubaoSession
  /** The vendor's display name, once a read has succeeded. */
  name?: string
  /** Epoch ms this account was last written. */
  savedAtMs: number
  /** Switch a row off without deleting its session: the card's per-account toggle. */
  disabled?: boolean
}

/** How long an account steps aside after a failure of one kind. */
const COOLDOWN_MS: Readonly<Record<DoubaoErrorKind, number>> = {
  // A rejected cookie needs a new sign-in; there is nothing to wait for.
  session_dead: Number.POSITIVE_INFINITY,
  // The 5-hour window is the narrowest one; five minutes is the shortest wait that can
  // plausibly see a reset without re-asking on every single turn.
  quota_exhausted: 5 * 60 * 1000,
  // Clearing the slider happens in the Doubao client and takes a person a minute.
  rate_limited: 2 * 60 * 1000,
  // Not the account's fault: stepping aside would blame the wrong one.
  network: 0,
  upstream: 0,
  // The 「工作任务」 runtime is the desktop app's, not the account's.
  task_runtime_unavailable: 0,
}

/** One account's health, kept beside it rather than inside it. */
interface Health {
  /** Epoch ms before which this account is skipped, or Infinity. */
  until: number
  /** The class that caused the cooldown, for the card's own wording. */
  kind?: DoubaoErrorKind
  /** The message to show, when there is one worth showing. */
  message?: string
}

/** What a caller may ask the roster for. */
export interface DoubaoRoster {
  /** Every account, in the order it was written. */
  list: () => readonly DoubaoAccount[]
  /** The accounts a request may use: enabled, with a usable jar. */
  usable: () => readonly DoubaoAccount[]
  /** One account by id, enabled or not. */
  get: (id: string) => DoubaoAccount | undefined
  /** The account the next request should use, or undefined when none can answer. */
  next: () => DoubaoAccount | undefined
  /** File a freshly harvested jar. Replaces the account it belongs to; never adds a duplicate. */
  adopt: (input: { session: DoubaoSession; slot: number; name?: string }) => DoubaoAccount
  /** Replace the whole list, which is what a startup restore and a delete both do. */
  replace: (entries: readonly DoubaoAccountEntry[]) => void
  /** Drop one account. Returns whether it was there. */
  remove: (id: string) => boolean
  /** Turn one account off or on. Returns whether it was there. */
  setDisabled: (id: string, disabled: boolean) => boolean
  /** Record a name read, so the card can label the row without a second round trip. */
  setName: (id: string, name: string) => void
  /** Record a failure class against the account that produced it. */
  penalise: (id: string, kind: DoubaoErrorKind, message?: string) => void
  /** Clear an account's health, which a successful turn and a fresh sign-in both do. */
  clear: (id: string) => void
  /** The health of one account, for the card. */
  healthOf: (id: string) => { coolingDown: boolean; until?: number; kind?: DoubaoErrorKind; message?: string }
  /** The slot a NEW sign-in should use: the lowest one no account claims. */
  freeSlot: () => number
  /** The account whose browser slot this is, if any. */
  bySlot: (slot: number) => DoubaoAccount | undefined
  /** Called after every mutation, so the caller can persist. */
  onChange: (listener: (list: readonly DoubaoAccount[]) => void) => () => void
}

/** Whether a stored entry describes an account the lane may serve. */
function entryUsable(entry: DoubaoAccountEntry): boolean {
  return sessionUsable(entry.session)
}

/** Build the roster over whatever the caller restores at startup. */
export function createDoubaoRoster(): DoubaoRoster {
  let accounts: DoubaoAccount[] = []
  let cursor = 0
  const health = new Map<string, Health>()
  const listeners = new Set<(list: readonly DoubaoAccount[]) => void>()

  const publish = (): void => {
    for (const listener of listeners) {
      try {
        listener(accounts)
      } catch {
        // A listener that throws must not take the lane down: the roster is the source of
        // truth and the persistence half is a side effect.
      }
    }
  }

  const snapshot = (): readonly DoubaoAccount[] => accounts
  const usable = (): readonly DoubaoAccount[] =>
    accounts.filter(account => account.disabled !== true && sessionUsable(account.session))

  const get = (id: string): DoubaoAccount | undefined => accounts.find(account => account.id === id)

  /**
   * The account to answer with.
   *
   * Sticky: the account that answered last is tried first, so one conversation stays on one
   * account. Only when it is cooling down does the cursor move, and it moves to the next
   * account that is NOT cooling down — the point of a second account is that the first one's
   * exhaustion does not stop the lane.
   */
  const next = (): DoubaoAccount | undefined => {
    const pool = usable()
    if (pool.length === 0) return undefined
    const now = Date.now()
    const healthy = pool.filter(account => (health.get(account.id)?.until ?? 0) <= now)
    if (healthy.length === 0) {
      // Everything is cooling down. Answer with the soonest-to-recover rather than nothing:
      // the request may still succeed (a cooldown is a guess, not a fact), and refusing here
      // would report "no account" for a pool that exists.
      const soonest = [...pool].sort(
        (a, b) => (health.get(a.id)?.until ?? 0) - (health.get(b.id)?.until ?? 0),
      )[0]
      return soonest
    }
    const sticky = healthy.find(account => account.id === accounts[cursor]?.id)
    if (sticky !== undefined) return sticky
    const chosen = healthy[0]
    if (chosen === undefined) return undefined
    cursor = accounts.indexOf(chosen)
    return chosen
  }

  const adopt = (input: { session: DoubaoSession; slot: number; name?: string }): DoubaoAccount => {
    const id = accountIdOf(input.session, input.slot)
    const entry: DoubaoAccount = {
      id,
      slot: input.slot,
      session: input.session,
      savedAtMs: Date.now(),
      ...(input.name === undefined || input.name === '' ? {} : { name: input.name }),
    }
    const index = accounts.findIndex(account => account.id === id)
    if (index >= 0) {
      /**
       * The same person signing in again UPDATES their row.
       *
       * Their name is carried over unless a new one was read, because the account-info call is
       * a separate request and a re-sign-in that failed to answer it must not blank a label
       * the card was already showing.
       */
      const previous = accounts[index]
      const merged: DoubaoAccount = {
        ...entry,
        ...(previous?.name === undefined || entry.name !== undefined ? {} : { name: previous.name }),
        ...(previous?.disabled === undefined ? {} : { disabled: previous.disabled }),
      }
      accounts = accounts.map((account, at) => (at === index ? merged : account))
      health.delete(id)
      publish()
      return merged
    }
    accounts = [...accounts, entry]
    // A new account is the one the user just asked for, so the next turn goes there.
    cursor = accounts.length - 1
    publish()
    return entry
  }

  const replace = (entries: readonly DoubaoAccountEntry[]): void => {
    accounts = entries.filter(entryUsable).map(entry => ({
      id: entry.id,
      slot: entry.slot,
      session: entry.session,
      savedAtMs: entry.savedAtMs,
      ...(entry.name === undefined || entry.name === '' ? {} : { name: entry.name }),
      ...(entry.disabled === true ? { disabled: true } : {}),
    }))
    cursor = 0
    publish()
  }

  const remove = (id: string): boolean => {
    const before = accounts.length
    accounts = accounts.filter(account => account.id !== id)
    health.delete(id)
    if (accounts.length === before) return false
    if (cursor >= accounts.length) cursor = 0
    publish()
    return true
  }

  const setDisabled = (id: string, disabled: boolean): boolean => {
    const index = accounts.findIndex(account => account.id === id)
    if (index < 0) return false
    accounts = accounts.map((account, at) => (at === index ? { ...account, disabled } : account))
    publish()
    return true
  }

  const setName = (id: string, name: string): void => {
    if (name === '') return
    const index = accounts.findIndex(account => account.id === id)
    if (index < 0) return
    if (accounts[index]?.name === name) return
    accounts = accounts.map((account, at) => (at === index ? { ...account, name } : account))
    publish()
  }

  const penalise = (id: string, kind: DoubaoErrorKind, message?: string): void => {
    const wait = COOLDOWN_MS[kind] ?? 0
    if (wait <= 0 && message === undefined) {
      health.delete(id)
      return
    }
    health.set(id, {
      until: wait <= 0 ? 0 : Date.now() + wait,
      kind,
      ...(message === undefined || message === '' ? {} : { message }),
    })
  }

  const clear = (id: string): void => {
    health.delete(id)
  }

  const healthOf = (id: string): { coolingDown: boolean; until?: number; kind?: DoubaoErrorKind; message?: string } => {
    const record = health.get(id)
    if (record === undefined) return { coolingDown: false }
    const coolingDown = record.until > Date.now()
    return {
      coolingDown,
      ...(record.until === undefined || record.until <= 0 ? {} : { until: record.until }),
      ...(record.kind === undefined ? {} : { kind: record.kind }),
      ...(record.message === undefined ? {} : { message: record.message }),
    }
  }

  const freeSlot = (): number => {
    const used = new Set(accounts.map(account => account.slot))
    let slot = 0
    while (used.has(slot)) slot += 1
    return slot
  }

  const bySlot = (slot: number): DoubaoAccount | undefined =>
    accounts.find(account => account.slot === slot)

  const onChange = (listener: (list: readonly DoubaoAccount[]) => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  return {
    list: snapshot,
    usable,
    get,
    next,
    adopt,
    replace,
    remove,
    setDisabled,
    setName,
    penalise,
    clear,
    healthOf,
    freeSlot,
    bySlot,
    onChange,
  }
}

/** The entries to persist for a roster snapshot. */
export function entriesOf(accounts: readonly DoubaoAccount[]): DoubaoAccountEntry[] {
  return accounts.map(account => ({
    id: account.id,
    slot: account.slot,
    session: account.session,
    savedAtMs: account.savedAtMs,
    ...(account.name === undefined ? {} : { name: account.name }),
    ...(account.disabled === true ? { disabled: true } : {}),
  }))
}
