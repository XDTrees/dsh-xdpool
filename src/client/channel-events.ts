/**
 * The browser event a sign-in fires so the rest of the page re-reads.
 *
 * WHY THIS EXISTS
 *
 * The channel list and the account pool are separate components with separate fetches. Signing in
 * refreshed only the list, so the card for the account that had just been added did not appear
 * until the page was reloaded — the credential was stored, the panel reported success, and the
 * pool still showed nothing. From the user's side that is indistinguishable from a failed
 * sign-in, and it is the reason two different screens disagreed about the same account.
 *
 * A DOM event rather than shared state: the two components do not share a parent that could hold
 * it, and the window is the one place both can reach.
 *
 * @module dsh-xdpool/client/channel-events
 */

/** Fired after a channel's credential has been stored. */
export const CHANNEL_ADOPTED_EVENT = 'dsh-xdpool:channel-adopted'

/** Tell the page that an account was just adopted. */
export function announceChannelAdopted(channel: string): void {
  try {
    // Read through a guarded global so this module can be type-checked and imported outside a
    // browser — the host half of the plugin shares this project.
    const scope = globalThis as { window?: { dispatchEvent?: (event: unknown) => void } }
    if (scope.window?.dispatchEvent === undefined) return
    const EventCtor = (globalThis as { CustomEvent?: new (name: string, init: unknown) => unknown }).CustomEvent
    if (EventCtor === undefined) return
    scope.window.dispatchEvent(new EventCtor(CHANNEL_ADOPTED_EVENT, { detail: { channel } }))
  } catch {
    // A non-browser context has nothing to notify.
  }
}
