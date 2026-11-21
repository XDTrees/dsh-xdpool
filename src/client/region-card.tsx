/**
 * The per-region cards on the account pool page.
 *
 * Shape of one card, and why it is this shape:
 *
 * - A 40px brand tile in the corner, because the user asked for the login
 *   page's tile and the two pages must look like the same family. It is the
 *   SHARED `BrandTile` from `brand-tile.tsx`, not a second copy of one: two
 *   separately measured tiles stop matching the first time one of them moves a
 *   pixel.
 * - Title, endpoint subtitle, and a state pill. The pill carries `data-state`
 *   so the colour comes from CSS, not from a prop that has to be kept in sync
 *   with the copy.
 * - One line of prose, clamped to two lines. A card that grows with its text
 *   stops being a card.
 * - A compact statistic row (accounts / models / remaining credit) with the
 *   numbers highlighted and the labels quiet, which is the order the user
 *   reads them in.
 * - A row of three outline buttons and the `Accounts / Models` disclosure.
 *
 * The disclosures use `aria-expanded` + `hidden`, not `max-height: 0`.
 * `max-height: 0` clips the focus ring of anything inside the panel, which
 * makes the first Tab after expanding land nowhere visible.
 *
 * `aria-expanded` on this page is new. The host-compatibility suite used to
 * assert that this page carried NO expand affordance at all; that assertion was
 * about a whole-card collapse that no longer exists. Two explicit, labelled
 * disclosures inside a card are a different control and are allowed. The test
 * was narrowed to the old rule rather than the new one ignored.
 */
import type { ReactElement, ReactNode } from 'react'
import type { PoolRegion } from '../status-paths.ts'
import { BrandTile } from './brand-tile.tsx'
import type { BrandTileGlyph } from './brand-tile.tsx'
import { channelIcon } from './channel-icons.ts'

/** The two supplier lanes this card can describe. */
export type RegionCardRegion = PoolRegion

/**
 * Which login channel each lane IS.
 *
 * The pool serves the same two vendors the login page offers, so the lane's
 * mark is that vendor's own logo rather than a shape we drew. These are the two
 * ids in `POOL_OWNED_CHANNELS`; naming them here is what lets the card wear the
 * real artwork the user recognises from the WorkBuddy app.
 */
export const REGION_CHANNEL_BY_REGION: Readonly<Record<RegionCardRegion, string>> = Object.freeze({
  cn: 'buddy',
  global: 'workbuddy',
})

/**
 * Which glyph each lane wears when its logo is not in this build.
 *
 * The tile itself is shared with the login-channels page (`brand-tile.tsx`) so
 * the two pages cannot drift apart; only the shape differs per lane, because a
 * bubble says "this is a lane that answers" where a key would say "sign in
 * here", and the two cards are showing different things.
 */
export const REGION_GLYPH_BY_REGION: Readonly<Record<RegionCardRegion, BrandTileGlyph>> = Object.freeze({
  cn: 'chat',
  global: 'globe',
})

/**
 * The brand accent for each lane, injected as CSS variables on the card root.
 *
 * These three hex values per lane are the only hard-coded colours in the pool
 * stylesheet. They name an external brand, and the host alias palette has no
 * token for "what colour is the WorkBuddy app"; borrowing a host accent would
 * make the card change colour with the user's theme while claiming to be a
 * brand tile.
 */
export interface RegionCardPalette {
  /** Used for the state pill ring and the disclosure hover. */
  readonly accent: string
  /** Gradient stop 1. */
  readonly from: string
  /** Gradient stop 2. */
  readonly to: string
}

/** The two palettes, frozen so a caller cannot mutate a shared object. */
export const REGION_PALETTES: Readonly<Record<RegionCardRegion, RegionCardPalette>> = Object.freeze({
  cn: Object.freeze({ accent: '#6f5cf0', from: '#4f6ef7', to: '#8b5cf6' }),
  global: Object.freeze({ accent: '#10a5a0', from: '#0fb5a4', to: '#3fd6a8' }),
})

/**
 * The card's three colour variables, ready to spread into a `style` prop.
 *
 * React's CSSProperties type has no index signature for custom properties, so
 * the caller has to cast; doing the cast once here keeps it out of the markup.
 *
 * `from` / `to` are kept as separate stops rather than folded into one
 * `color-mix`: these two lanes ARE the pool's own suppliers, so their gradient
 * is a named brand decision, unlike the thirteen third-party channels, which
 * each supply exactly one colour and get their second stop derived.
 */
export function regionCardStyle(
  region: RegionCardRegion,
): Record<string, string> {
  const palette = REGION_PALETTES[region]
  return {
    '--dsm-xdpool-region-accent': palette.accent,
    '--dsm-xdpool-region-icon-from': palette.from,
    '--dsm-xdpool-region-icon-to': palette.to,
  }
}

/** The lane's tile: the vendor's own logo when this build carries it. */
export function RegionCardTile({ region }: { region: RegionCardRegion }): ReactElement {
  const icon = channelIcon(REGION_CHANNEL_BY_REGION[region])
  return (
    <BrandTile
      accent={REGION_PALETTES[region].accent}
      glyph={REGION_GLYPH_BY_REGION[region]}
      {...icon === undefined ? {} : { icon }}
    />
  )
}

/**
 * Which of the three states the lane is in.
 *
 * `ok` means at least one account can serve a request. `cooling` means every
 * account is rate-limited. `error` means the status document could not be read
 * at all — which is NOT the same as "no accounts", and the two must never
 * share a pill.
 */
export type RegionCardState = 'ok' | 'cooling' | 'error'

/** One statistic: a number to read first, a label to read second. */
export interface RegionCardStat {
  /** Already formatted for display. Undefined renders as an em dash. */
  readonly value: string | undefined
  /** Short noun, e.g. "accounts" or "remaining credit". */
  readonly label: string
}

/** What a disclosure shows when it is open. */
export interface RegionCardPaneProps {
  /** `id` used by the trigger's `aria-controls`. */
  readonly id: string
  /** Hidden while the disclosure is closed. */
  readonly open: boolean
  /** The pane body. */
  readonly children: React.ReactNode
}

/**
 * One labelled disclosure.
 *
 * Rendered as a plain `div` with `role="group"` rather than a fieldset,
 * because the body is not a form control and a fieldset would imply a legend
 * the user is supposed to fill in.
 */
export function RegionCardPane({ id, open, children }: RegionCardPaneProps): ReactElement {
  return (
    <div className="card" id={id} role="group" hidden={!open}>
      {children}
    </div>
  )
}

/** Props for the disclosure trigger, so the two triggers cannot drift apart. */
export interface RegionCardTriggerProps {
  /** `id` of the pane this trigger controls. */
  readonly controls: string
  /** Whether the pane is currently open. */
  readonly open: boolean
  /** `aria-label`; the visible text is the glyph plus this. */
  readonly label: string
  /** Glyph drawn at the left of the trigger. */
  readonly glyph: ReactNode
  /** Shown after the glyph, e.g. "Accounts". */
  readonly text: string
  /**
   * Extra count badge, e.g. the account total.
   *
   * `| undefined` is explicit because the project compiles with
   * `exactOptionalPropertyTypes`: an optional prop does not accept an explicit
   * `undefined` unless the type says so, and the caller naturally has
   * `count: someMaybeString` rather than a spread of a conditional object.
   */
  readonly count?: string | undefined
  /** Click handler. */
  readonly onToggle: () => void
}

/**
 * The `Accounts / Models` half of the segmented control.
 *
 * A button, not a `<summary>`: the card has no card-level `open` state left
 * to summarise, and `<summary>` inside a non-details element is invalid.
 */
export function RegionCardTrigger({
  controls,
  open,
  label,
  glyph,
  text,
  count,
  onToggle,
}: RegionCardTriggerProps): ReactElement {
  return (
    <button
      type="button"
      className="dsm-xdpool-region-seg-btn"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      onClick={onToggle}
    >
      <span className="dsm-xdpool-region-seg-glyph" aria-hidden="true">{glyph}</span>
      <span className="dsm-xdpool-region-seg-text">{text}</span>
      {count === undefined
        ? null
        : <span className="dsm-xdpool-region-seg-count">{count}</span>}
    </button>
  )
}