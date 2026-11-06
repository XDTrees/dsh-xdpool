/**
 * Bridge the user's pool-card model selection into the vendored pack (#121).
 *
 * Two switches existed and neither knew about the other:
 *
 *   - `modelSelectionCn` / `modelSelectionGlobal` — what the pool card writes
 *     (`PoolCard.tsx saveModels` → `settingsScope.set`), consumed by this
 *     plugin's own catalog for the gateway's `/v1/models` and its roster;
 *   - `disabledModels` — what the pack reads in every adapter's `listModels()`,
 *     which is what the HOST's model picker renders.
 *
 * For the eleven scan-login channels the second switch is populated at startup
 * (`selectionTouched` + the silence pass), so the two agree by accident. `buddy`
 * and `workbuddy` are EXEMPT from that pass — deliberately, because the card
 * owns their selection — and the exemption is where the two switches came apart:
 * `disabledModels['buddy']` never exists, `disabled.size === 0`, so every model
 * came back and the card's "1 of 16" had no effect on the picker.
 *
 * The issue's preferred fix (A) is applied: `listModels` now takes the UNION of
 * both switches. This module is the bridge that makes the pool's selection
 * readable from inside the pack. It is a module-level handoff rather than an
 * argument because the pack is a build artifact of another repository — it
 * cannot import from `src/`, and threading a value through ten adapter
 * constructors would be rejected by the next pack refresh.
 *
 * The value is written on every catalog change and on startup, so a save takes
 * effect on the picker's next read without a restart.
 *
 * @module dsh-xdpool/model-switch-bridge
 */
import type { WorkBuddyRegion } from './upstream.ts'

/**
 * The lane id the host's picker uses for each region.
 *
 * The same two ids `POOL_OWNED_PROVIDERS` exempts inside the pack, and the same
 * two `REGION_CHANNEL_BY_REGION` maps in the card. Kept here as a literal
 * because this module is imported by the host half only, which must not pull in
 * the browser bundle's constants.
 */
const LANE_BY_REGION: Readonly<Record<WorkBuddyRegion, string>> = {
  cn: 'buddy',
  global: 'workbuddy',
}

/** Which model ids each lane is allowed to show, or `undefined` for "all". */
export type LaneSelection = Readonly<Record<string, readonly string[] | undefined>>

/**
 * The process-wide selection, keyed by LANE id (`buddy` / `workbuddy`).
 *
 * `undefined` for a lane means "no restriction" and is the default: a fresh
 * install with nothing saved must not present an empty picker. An empty ARRAY
 * means the user disabled everything, which is a real state the picker has to
 * honour — the difference between the two is the whole reason this cannot be
 * `?? []`.
 */
let laneSelection: LaneSelection = {}

/** Read the current selection. Used by the pack through the global below. */
export function currentLaneSelection(): LaneSelection {
  return laneSelection
}

/**
 * Replace the selection and mirror it where the pack can see it.
 *
 * The mirror is `globalThis.__xdpoolLaneSelection`, which `pack.js` reads in its
 * `[xdpool-local] laneAllowedIds` helper. A global rather than a getter on the
 * account pool because the pack's adapters receive `accountPool` — this
 * plugin's own object — and nothing else that this module could hang a function
 * on without editing ten constructors.
 */
export function applyLaneSelection(next: LaneSelection): void {
  laneSelection = next
  ;(globalThis as { __xdpoolLaneSelection?: LaneSelection }).__xdpoolLaneSelection = next
}

/**
 * Derive the lane keyed selection from the two settings documents.
 *
 * Split out from the caller so the mapping is testable without a host: the one
 * thing worth asserting is that an ABSENT setting becomes `undefined` (no
 * restriction) while an explicitly EMPTY `enabledModelIds` stays an empty array
 * (nothing allowed).
 */
export function laneSelectionFrom(
  cn: readonly string[] | undefined,
  global: readonly string[] | undefined,
): LaneSelection {
  return {
    [LANE_BY_REGION.cn]: cn,
    [LANE_BY_REGION.global]: global,
  }
}

/** The lane id for a region, exported so callers need not repeat the map. */
export function laneForRegion(region: WorkBuddyRegion): string {
  return LANE_BY_REGION[region]
}
