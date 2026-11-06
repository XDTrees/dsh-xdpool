/**
 * The `sidebarRow` switch, read and written from one place.
 *
 * Two independent owners need this flag: the page card draws the checkbox, and
 * `apply()` decides whether to register the sidebar row before that card has ever
 * mounted. Both therefore have to read the same source of truth — the settings
 * mirror the host exposes — instead of one asking the server and the other
 * guessing.
 *
 * The scope is typed structurally here rather than imported from `PoolCard.tsx`:
 * this module is pulled into both tsconfigs (the server one has no JSX setting),
 * and the only thing it needs from that component is `getSnapshot().value`.
 *
 * The default is ON, and the read is fail-open on purpose: "the mirror has no
 * opinion yet" and "the user turned it off" must not be the same answer, or a
 * host that has not populated the mirror would silently hide a feature nobody
 * switched off. That is also why only the literal `false` disables the row.
 */

/** Settings field the switch writes (declared in the plugin Config schema). */
export const SIDEBAR_ROW_FIELD = 'sidebarRow'

/** The slice of the settings scope this module reads. */
interface SidebarRowScope {
  getSnapshot(): { value?: unknown }
}

/**
 * Whether the sidebar entry should exist.
 *
 * Never throws: a locked-down host makes `getSnapshot()` unusable, and the
 * documented degradation there is the settings page, not a missing entry.
 */
export function readSidebarRow(scope: SidebarRowScope | undefined): boolean {
  if (scope === undefined) return true
  try {
    const value = scope.getSnapshot().value
    if (value === null || typeof value !== 'object') return true
    return (value as Record<string, unknown>)[SIDEBAR_ROW_FIELD] !== false
  } catch {
    return true
  }
}
