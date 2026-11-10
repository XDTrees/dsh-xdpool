import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REGION_PALETTES, REGION_GLYPH_BY_REGION, regionCardStyle } from '../src/client/region-card.tsx'
import { BRAND_TILE_GLYPHS } from '../src/client/brand-tile.tsx'
import { CHANNEL_ICONS, channelIcon } from '../src/client/channel-icons.ts'

const ROOT = join(import.meta.dirname, '..')
const styles = readFileSync(join(ROOT, 'src', 'client', 'styles.ts'), 'utf8')
const card = readFileSync(join(ROOT, 'src', 'client', 'PoolCard.tsx'), 'utf8')
const regionCard = readFileSync(join(ROOT, 'src', 'client', 'region-card.tsx'), 'utf8')
const brandTile = readFileSync(join(ROOT, 'src', 'client', 'brand-tile.tsx'), 'utf8')
const channels = readFileSync(join(ROOT, 'src', 'client', 'ChannelsPage.tsx'), 'utf8')
const channelDescriptors = readFileSync(join(ROOT, 'src', 'channels.ts'), 'utf8')
const locales = readFileSync(join(ROOT, 'src', 'client', 'locales.ts'), 'utf8')

/**
 * The region-card block of the pool stylesheet.
 *
 * The whole file is one string of nine stylesheet exports, and three of them
 * contain a 760px media query of their own. `mediaRule` reads this slice so
 * "does the region card adapt at narrow widths?" cannot be answered by a rule
 * from a different page — which is the version of the bug the test exists to
 * prevent. Plain `rule` reads the whole sheet, because the shared tile and the
 * channel row it sits in are styled in `CHANNEL_CARD_CSS` by design.
 */
const REGION_CSS = slice(styles, '/* Region cards:', 'export const AGGREGATE_CARD_CSS')

/**
 * The body of one rule, or `''` when the rule does not exist.
 *
 * The selector is anchored to a rule boundary, which rules out a partial match
 * inside a longer selector (`.region[data-state="ok"] .region-state{` contains
 * `.region-state{`). The boundary is "preceded by whitespace, a brace, or a
 * comma" — a space counts, because `.region:hover .tile{` is itself a rule.
 */
function rule(selector: string): string {
  const start = boundaryIndexOf(styles, `${selector}{`)
  if (start === -1) return ''
  return styles.slice(start, styles.indexOf('}', start) + 1)
}

/**
 * Where `needle` begins a whole rule inside `haystack`, or -1.
 *
 * "Whole rule" means the selector is not the tail of a longer one. Indentation
 * is skipped — a rule inside a media query is indented — but a space WITHIN a
 * line is not skipped, because that is a descendant combinator:
 * `.region:hover .tile{` is one rule about the region, not a second rule about
 * the tile. What is left has to be a newline, a brace, a comma, or the
 * template literal's own backtick.
 */
function boundaryIndexOf(haystack: string, needle: string): number {
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    let back = at - 1
    while (back >= 0 && (haystack[back] === ' ' || haystack[back] === '\t')) back -= 1
    const before = back < 0 ? '' : (haystack[back] as string)
    if (before === '' || before === '\n' || before === '{' || before === '}' || before === ',' || before === '`') return at
  }
  return -1
}

/** Whether any rule defines this class, in any state. */
function hasRule(selector: string): boolean {
  return boundaryIndexOf(styles, `.${selector}{`) !== -1
}

/**
 * The border-radius a rule declares.
 *
 * "Same size" has to mean the same shell, not a similar one, and the radius is
 * one of the three numbers that carry it. Module level because both shells are
 * compared from two different describes: the pool lane against the login
 * channel, and the mirrored channel row against the pool lane.
 */
function radiusOf(selector: string): string {
  return (/\bradius:\s*([^;]+)/u.exec(rule(selector))?.[1] ?? '').trim()
}

/** The translucent layer fill a card shell uses, whitespace normalised. */
function fillOf(selector: string): string {
  return (/background:(color-mix\([^;]*\))/u.exec(rule(selector))?.[1] ?? '')
    .replace(/\s+/gu, '')
}

/**
 * The region-card class names a source file mentions in markup.
 *
 * Custom-property names are skipped. `regionCardStyle` writes keys like
 * `--dsm-xdpool-region-accent`, and a regex that only looks for
 * `dsm-xdpool-region-` matches the tail of those too — and there is
 * no rule to define a variable, so every one of them would read as missing.
 */
function regionClassNames(source: string): string[] {
  return [...new Set(
    [...source.matchAll(/(?<![-\w])dsm-xdpool-region-[a-z0-9-]+/gu)]
      .map(match => match[0]),
  )]
}

/**
 * A rule inside one of the region sheet's media queries.
 *
 * `marker` is the query's own header, e.g. '@media (max-width:760px){'. The
 * slice ends at the next `@media`, `}` at column 0, or `export const` — the
 * block is full of one-line nested rules, so counting braces would stop inside.
 */
function mediaRule(marker: string, selector: string): string {
  const blockStart = REGION_CSS.indexOf(marker)
  if (blockStart === -1) return ''
  const rest = REGION_CSS.slice(blockStart + marker.length)
  const cuts = [rest.indexOf('@media'), rest.indexOf('\n}'), rest.indexOf('export const')]
    .filter(at => at !== -1)
  const block = rest.slice(0, Math.min(...cuts))
  const start = boundaryIndexOf(block, `${selector}{`)
  return start === -1 ? '' : block.slice(start, block.indexOf('}', start) + 1)
}

/** `text` between two markers, both of which must exist. */
function slice(text: string, from: string, to: string): string {
  const start = text.indexOf(from)
  const end = text.indexOf(to, start + from.length)
  if (start === -1 || end === -1) throw new Error(`slice(${from}) is out of range`)
  return text.slice(start, end)
}

describe('the region cards stack the way the login page stacks', () => {
  it('is one full-width lane per row, not two columns', () => {
    // The user asked for the pool to be arranged like the scan-login page, and
    // that page is a single column of full-width cards. Side by side, the
    // shorter lane read as a lane that was missing something.
    const grid = rule('.dsm-xdpool-region-grid')
    expect(grid).not.toBe('')
    expect(grid).toContain('flex-direction:column')
    // `minmax(0, …)` and its grid equivalent are both about refusing to let a
    // long endpoint URL widen the column past the dialog; in a column flex box
    // the equivalent guard is `min-width:0` on the container.
    expect(grid).toContain('min-width:0')
    expect(grid).not.toContain('repeat(2')
    expect(rule('.dsm-xdpool-channels')).toContain('flex-direction:column')
  })

  it('renders both lanes on every visit, not one tab at a time', () => {
    // The old page switched lanes with a tab, so an un-signed-in lane was a tab
    // the user had to go looking for. Both cards always present means an empty
    // lane is simply visible.
    expect(card).toContain("const REGION_CARDS = ['cn', 'global'] as const")
    expect(card).toContain('REGION_CARDS.map(region =>')
    expect(card).toMatch(/data-region=\{region\}/)
    // and no tab strip is left behind to imply one-at-a-time.
    expect(card).not.toContain('role="tablist"')
    expect(card).not.toContain('dsm-xdpool-tab-active')
  })
})

describe('each card carries a brand tile', () => {
  it('is the shared 40px tile, not a second implementation of one', () => {
    // The user asked for the pool to look like the sign-in page. Two tiles
    // measured by eye stop matching the first time one of them moves a pixel,
    // so both pages must render the SAME component and the same class.
    const tile = rule('.dsm-xdpool-tile')
    expect(tile).not.toBe('')
    expect(tile).toContain('width:40px')
    expect(tile).toContain('height:40px')
    expect(tile).toContain('border-radius:13px')
    expect(tile).toContain('linear-gradient(145deg')
    // The glyph is a mask, not a background-image: hovering the tile repaints
    // the gradient, and a background-image would repaint the glyph with it.
    const glyph = rule('.dsm-xdpool-tile::after')
    expect(glyph).not.toBe('')
    expect(glyph).toContain('mask:var(--dsm-xdpool-tile-glyph')
    expect(glyph).not.toContain('background-image')

    expect(brandTile).toContain('className={`dsm-xdpool-tile')
    expect(brandTile).toContain('--dsm-xdpool-tile-accent')
    expect(brandTile).toContain('--dsm-xdpool-tile-glyph')
    // Decorative: the channel name sits next to it, so announcing it would say
    // every name twice.
    expect(brandTile).toContain('aria-hidden="true"')

    expect(channels).toContain('<BrandTile')
    expect(channels).toContain("from './brand-tile.tsx'")
    expect(regionCard).toContain("from './brand-tile.tsx'")
    expect(card).toContain('<RegionCardTile region={region} />')
  })

  it('wears the vendor\u2019s own logo when this build carries one', () => {
    // The user asked for the login page's icons, and those icons are the real
    // brand marks the OFM build embeds. Eight of the thirteen channels have
    // one; the other five keep the gradient-and-glyph fallback, which is why
    // the tile has to be good in both shapes.
    const art = rule('.dsm-xdpool-tile-art')
    expect(art, 'the artwork variant must exist').not.toBe('')
    expect(art).toContain('var(--dsm-xdpool-tile-icon')
    expect(art).toContain('background-size:contain')
    // The gradient and the mask are both switched off rather than layered
    // under an opaque PNG.
    expect(rule('.dsm-xdpool-tile-art::after')).toContain('content:none')
    expect(brandTile).toContain('--dsm-xdpool-tile-icon')
    expect(brandTile).toContain('dsm-xdpool-tile-art')

    // Both pages ask the same map, so a channel cannot have a logo on one page
    // and a fallback glyph on the other.
    expect(channels).toContain('channelIcon(channel.id)')
    expect(regionCard).toContain('channelIcon(REGION_CHANNEL_BY_REGION[region])')

    // Every payload is a real PNG data URL, and a missing key is the ordinary
    // fallback path rather than an error.
    expect(Object.keys(CHANNEL_ICONS).length).toBeGreaterThanOrEqual(8)
    for (const [id, uri] of Object.entries(CHANNEL_ICONS)) {
      expect(uri, `${id} must be a PNG data URL`).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/u)
    }
    expect(channelIcon('definitely-not-a-channel')).toBeUndefined()
    expect(channelIcon('buddy')).toBe(CHANNEL_ICONS.buddy)
  })

  it('paints every gradient fallback from the channel list, not from a lookup', () => {
    // The tile has to take the accent from `src/channels.ts`, which is the one
    // place that decides a vendor's colour. A hex typed into the tile component
    // would be a second, competing answer to "what colour is this vendor".
    expect(brandTile).not.toMatch(/#[0-9a-f]{6}/u)
    expect(channels).toContain('accent={channel.accent}')
    expect(regionCard).toContain('accent={REGION_PALETTES[region].accent}')
    // All three glyphs are real payloads, and none of them can close the url()
    // early or start a colour.
    for (const name of ['login', 'chat', 'globe'] as const) {
      const payload = BRAND_TILE_GLYPHS[name]
      expect(payload, `${name} must have a payload`).toContain("url('data:image/svg+xml;utf8,")
      expect(payload.slice(0, 80), `${name} must not use raw #`).not.toMatch(/#/)
      expect(payload).not.toContain('"')
    }
  })

  it('gives each lane its own colour and its own shape', () => {
    expect(REGION_PALETTES.cn.accent).not.toBe(REGION_PALETTES.global.accent)
    expect(REGION_GLYPH_BY_REGION.cn).not.toBe(REGION_GLYPH_BY_REGION.global)
    // A lane's colour reaches the DOM as a custom property, not as a class per
    // lane, so adding a lane is a data change and not a stylesheet change.
    expect(regionCardStyle('cn')).toEqual({
      '--dsm-xdpool-region-accent': REGION_PALETTES.cn.accent,
      '--dsm-xdpool-region-icon-from': REGION_PALETTES.cn.from,
      '--dsm-xdpool-region-icon-to': REGION_PALETTES.cn.to,
    })
    // The two stops are named, not derived: these lanes ARE the pool's own
    // suppliers, so their gradient is a brand decision.
    expect(REGION_PALETTES.cn.from).not.toBe(REGION_PALETTES.cn.to)
    // Every accent is a six-digit hex, because it goes straight into color-mix.
    for (const region of ['cn', 'global'] as const) {
      expect(REGION_PALETTES[region].accent).toMatch(/^#[0-9a-f]{6}$/u)
    }
  })
})

describe('the state pill is a colour plus a word, never a colour alone', () => {
  it('has three states with three distinct colours', () => {
    const base = rule('.dsm-xdpool-region-state')
    expect(base).not.toBe('')
    // A 6px dot carries the colour as well, so the pill still reads for
    // someone who cannot separate the tint from the surface.
    expect(rule('.dsm-xdpool-region-state::before')).toContain('border-radius:50%')
    const ok = rule('.dsm-xdpool-region[data-state="ok"] .dsm-xdpool-region-state')
    const cooling = rule('.dsm-xdpool-region[data-state="cooling"] .dsm-xdpool-region-state')
    const error = rule('.dsm-xdpool-region[data-state="error"] .dsm-xdpool-region-state')
    expect(ok).toContain('state-success-primary')
    expect(error).toContain('state-error-primary')
    // Cooling is not a failure and must not be painted like one.
    expect(cooling).not.toContain('state-error-primary')
    expect(cooling).not.toContain('state-success-primary')
    expect(card).toContain("cardState: error !== undefined")
  })

  it('is the reference build\u2019s badge, not a coloured halo', () => {
    // The user asked for the account-pool lane to be the same size and shape as
    // the login-channel cards. The badge is the loudest thing on both, so it has
    // to be the same component: a 999px pill, 6px/14px padding, a translucent
    // layer-1 fill and an inset top highlight, all lifted from `.ofm_poolbadge`.
    const base = rule('.dsm-xdpool-region-state')
    expect(base).toContain('padding:6px 14px')
    expect(base).toContain('border-radius:999px')
    expect(base).toContain('font-weight:650')
    expect(base).toContain('bg-layer-1')
    expect(base).toContain('inset 0 1px 0')
    // A `box-shadow` ring reads as a notification. Each state must tint the
    // badge's OWN fill instead, which is why no state may carry a ring.
    for (const state of ['ok', 'cooling', 'error']) {
      const tone = rule(`.dsm-xdpool-region[data-state="${state}"] .dsm-xdpool-region-state`)
      expect(tone, `data-state="${state}" must exist`).not.toBe('')
      expect(tone, `data-state="${state}" must not ring`).not.toContain('box-shadow')
      expect(tone, `data-state="${state}" must tint its own fill`).toContain('background:color-mix')
    }
  })
})

describe('the account-pool card is the same size as a login-channel card', () => {
  it('shares the channel card\u2019s radius, padding and fill', () => {
    // "Same size" has to mean the same shell, not a similar one. Three numbers
    // carry it: the radius, the padding, and the layer-3 translucent fill. If
    // one drifts the pool card stops reading as the same object as a channel.
    const region = rule('.dsm-xdpool-region')
    const channel = rule('.dsm-xdpool-channel')
    expect(region).not.toBe('')
    expect(channel).not.toBe('')
    expect(radiusOf('.dsm-xdpool-region'), 'the two cards must share a radius')
      .toBe(radiusOf('.dsm-xdpool-channel'))
    expect(fillOf('.dsm-xdpool-region'), 'the two cards must share a fill')
      .toBe(fillOf('.dsm-xdpool-channel'))
    expect(region).toContain('padding:12px 13px 12px 15px')
    // And the card gap matches too: five, not ten, because the channel card is
    // the denser of the two and the pool lane follows it.
    expect(region).toContain('gap:5px')
  })

  it('wears an accent hairline on top, so the two pages share a family', () => {
    const hair = rule('.dsm-xdpool-region::before')
    expect(hair).not.toBe('')
    expect(hair).toContain('--dsm-xdpool-region-accent')
    // Error has to break the lane\u2019s own colour, because a red-hairlined card
    // beside a purple one is the only place the failure is visible once the
    // card scrolls below the fold.
    expect(rule('.dsm-xdpool-region[data-state="error"]::before'))
      .toContain('state-error-primary')
  })

  it('lays the three figures out in one quiet line, as the reference build does', () => {
    // This used to be three recessed tiles, one per figure. The user asked for
    // the account-pool card to match the reference build's channel card, and
    // there the figures are `.ofm_chanmeta`: one wrapped flex line of
    // "label number" pairs. Three boxes for three numbers made the card taller
    // than the thing it described, and gave a 7.1K balance more visual weight
    // than the sentence explaining what the balance buys.
    const stats = rule('.dsm-xdpool-region-stats')
    expect(stats).not.toBe('')
    expect(stats).toContain('flex-wrap:wrap')
    // Baseline, not stretch: the labels and the numbers sit on one text line.
    expect(stats).toContain('align-items:baseline')
    // The whole row is a quiet third-level label colour; the numbers override
    // it individually, which is what keeps the digits the readable part.
    expect(stats).toContain('font-size:11.5px')
    expect(stats).toContain('label-tertiary')
    // No more recessed tile: no radius, no padding, no background, no column.
    expect(stats).not.toContain('border-radius')
    expect(stats).not.toContain('align-items:stretch')
    const stat = rule('.dsm-xdpool-region-stat')
    expect(stat).not.toBe('')
    expect(stat).toContain('display:inline-flex')
    expect(stat).toContain('align-items:baseline')
    expect(stat).not.toContain('border-radius')
    expect(stat).not.toContain('flex-direction:column')
    // The figure is the loud part, so it takes the secondary label colour and
    // the tabular figures; the label beside it stays inherited.
    const num = rule('.dsm-xdpool-region-num')
    expect(num).toContain('font-weight:650')
    expect(num).toContain('tabular-nums')
    expect(num).toContain('label-secondary')
    expect(num).toContain('text-overflow:ellipsis')
  })
})

describe('the statistics row reads numbers first and labels second', () => {
  it('marks the credit figure as the one that may be unknown', () => {
    // Three states, never two: no reading at all, a reported zero, and a
    // balance. A confident zero about a gateway that never answered is the one
    // number a statistics row must not invent.
    expect(card).toContain('creditLeftOf')
    expect(card).toContain('data-tone="quiet"')
    expect(rule('.dsm-xdpool-region-num[data-tone="quiet"]')).not.toBe('')
    expect(card).toContain("{creditLeft ?? '–'}")
  })

  it('puts the model count in enabled/total form', () => {
    expect(card).toContain('${card.modelState.enabled}/${models.length}')
    expect(card).toContain("t?.('row.regionStatModels')")
  })

  it('writes the label before its number, the way the reference build does', () => {
    // "账号 4/4", not "4/4 账号". The user\'s own screenshot of the card they
    // asked for reads label-first, and the reference build\'s `.ofm_chanmeta`
    // builds each pair as the label followed by a <b>. Getting this backwards
    // produces a row that reads as three fractions and no nouns.
    const stat = card.slice(card.indexOf('dsm-xdpool-region-stats'))
    const label = stat.indexOf('region-label')
    const num = stat.indexOf('region-num')
    expect(label).toBeGreaterThan(-1)
    expect(num).toBeGreaterThan(label)
  })
})

describe('the buttons are adapted for a 510px column', () => {
  it('lets the button group wrap instead of overflowing', () => {
    expect(rule('.dsm-xdpool-region-actions')).toContain('flex-wrap:wrap')
    expect(rule('.dsm-xdpool-region-btns')).toContain('flex-wrap:wrap')
    // At the narrowest width each group takes its own full line and the
    // segments split it evenly, so neither can push the other out of the card.
    expect(mediaRule('@media (max-width:760px)', '.dsm-xdpool-region-btns')).toContain('flex:1 1 100%')
    expect(mediaRule('@media (max-width:760px)', '.dsm-xdpool-region-seg')).toContain('width:100%')
    expect(mediaRule('@media (max-width:760px)', '.dsm-xdpool-region-seg-btn')).toContain('flex:1 1 0')
  })

  it('neutralises the hover lift on a disabled control', () => {
    // The shared `.dsm-btn:disabled` rule is only `opacity:.4`, so a disabled
    // button would still lift on hover — a control that moves under the cursor
    // while refusing to do anything.
    for (const selector of [
      '.dsm-xdpool-region-seg-btn:disabled',
      '.dsm-xdpool-region-tool:disabled',
    ]) {
      const disabled = rule(selector)
      expect(disabled, `${selector} must exist`).not.toBe('')
      expect(disabled).toContain('transform:none')
      expect(disabled).toContain('filter:saturate(.35)')
      const disabledHover = rule(`${selector}:hover`)
      expect(disabledHover, `${selector}:hover must exist`).not.toBe('')
      expect(disabledHover).toContain('transform:none')
    }
  })

  it('keeps a busy button the width it had', () => {
    // Swapping the label for a spinner-sized box reflows the row and shoves
    // the segmented control sideways in the middle of a click.
    const busy = rule('.dsm-xdpool-region-btn[aria-busy="true"]')
    expect(busy).not.toBe('')
    expect(busy).toContain('cursor:progress')
    expect(busy).toContain('pointer-events:none')
    expect(busy).not.toMatch(/\bwidth\s*:/)
    expect(rule('.dsm-xdpool-region-btn[aria-busy="true"]::before')).toContain('position:absolute')
    // And the card must actually set it, with the region that owns the work so
    // a click on the domestic card cannot spin the international one.
    expect(card).toContain('aria-busy={busyRegion === region}')
    expect(card).toContain('aria-busy={cooldownBusyRegion === region}')
    expect(card).toContain('aria-busy={catalogBusyRegion === region}')
  })

  it('keeps the focus ring inside the segmented control gutter', () => {
    // The segments sit in a 3px inset groove; an outline at the default 2px
    // offset would cross the card border and read as belonging to the card.
    expect(rule('.dsm-xdpool-region-seg-btn:focus-visible')).toContain('outline-offset:-2px')
  })

  it('truncates the three places a long string would otherwise push the card', () => {
    // Each of these sits directly inside a flex row, so the element itself
    // does not need `min-width:0` — the BOX has to be allowed to shrink, and
    // that is the parent's job. `text-overflow` on a child of a box that
    // refuses to shrink does nothing.
    for (const [selector, container] of [
      ['.dsm-xdpool-region-title', '.dsm-xdpool-region-titles'],
      ['.dsm-xdpool-region-sub', '.dsm-xdpool-region-titles'],
      ['.dsm-xdpool-channel-name', '.dsm-xdpool-channel-head'],
    ] as const) {
      const body = rule(selector)
      expect(body, `${selector} must exist`).not.toBe('')
      expect(body, `${selector} must truncate`).toContain('text-overflow:ellipsis')
      expect(body, `${selector} needs overflow:hidden to honour the ellipsis`).toContain('overflow:hidden')
      expect(body, `${selector} must not wrap onto a second line`).toContain('white-space:nowrap')
      expect(rule(container), `${container} must be allowed to shrink`).toContain('min-width:0')
    }
  })
})

describe('the disclosures open in place', () => {
  it('hides a closed pane with hidden, never with max-height', () => {
    // `max-height:0` clips the focus ring of anything inside, so the first Tab
    // after expanding lands nowhere visible.
    expect(rule('.dsm-xdpool-region-pane[hidden]')).toContain('display:none')
    expect(rule('.dsm-xdpool-region-pane')).not.toContain('max-height')
    expect(regionCard).toContain('hidden={!open}')
  })

  it('opens a disclosure without changing the expanded control shape', () => {
    expect(rule('.dsm-xdpool-region-seg-btn[aria-expanded="true"]')).not.toBe('')
    expect(rule('.dsm-xdpool-region-tool[aria-expanded="true"]')).not.toBe('')
    expect(regionCard).toContain('aria-expanded={open}')
    expect(regionCard).toContain('aria-controls={controls}')
    // Four panes per lane, all closed on arrival: a card that opens with a
    // 200-row account list is a wall of text where a summary was asked for.
    expect(card).toContain('const [openedPanes, setOpenedPanes] = useState<Record<string, boolean>>({})')
    for (const suffix of ['accounts', 'models', 'dist', 'auto']) {
      expect(card).toContain(`const ${suffix}PaneId`)
      expect(card).toContain(`id={${suffix}PaneId} open={${suffix}Open}`)
    }
  })

  it('keeps the two tool buttons on the domestic lane only', () => {
    // The schedule is one shared setting on one shared scheduler, so only the CN
    // card edits it — a second switch on the international card would drive the
    // same numbers. (This is a UI decision: `report` and `streak` DO run against
    // that gateway — see JOB_REGION_SCOPE in src/scheduler.ts.)
    expect(card).toContain('dsm-xdpool-region-cntools')
    expect(card).toMatch(/region === 'cn' \? here\?\.automation : undefined/)
    // And the card it reads from must be this lane's status, not the focused one.
    expect(card).toContain('const here = card.status')
    expect(card).not.toContain('automation: status?.automation')
  })
})

describe('the shared page classes survive a 510px column', () => {
  it('overrides the figures line inside a region card without reviving a grid', () => {
    // `-stats` is shared with the aggregate and relay pages, so whatever it is,
    // it has to be safe in a ~510px lane column. The lane card only needs its
    // gap tightened; anything more would be a second competing layout.
    const scoped = rule('.dsm-xdpool-region .dsm-xdpool-stats')
    expect(scoped).not.toBe('')
    expect(scoped, 'a column count here would resurrect the squeezed grid').not.toContain('grid-template-columns')
    const global = rule('.dsm-xdpool-stats')
    expect(global, 'the figures line must wrap rather than declare columns')
      .not.toContain('grid-template-columns')
    expect(global).toContain('flex-wrap:wrap')
  })
})

describe('one account is one flat row, not a card with two boxed halves', () => {
  it('lays the identity, the chips and the decisions on one wrapping line', () => {
    // The account card used to be a left column holding a single token-expiry
    // line beside a two-column credit grid, inside a card the lane's own width
    // had already forced down to one column. So the grid never did anything, and
    // the row read as a tall box that was mostly padding.
    const head = rule('.dsm-xdpool-account-head')
    expect(head).not.toBe('')
    expect(head).toContain('flex-wrap:wrap')
    expect(head, 'no divider: the head and the figures are one card now').not.toContain('border-bottom')
    // The name is the only thing allowed to shrink; it has to be able to.
    expect(rule('.dsm-xdpool-account-label')).toContain('min-width:0')
  })

  it('reads the balance as one figure in a row, not as a headline', () => {
    const total = rule('.dsm-xdpool-total-value')
    expect(total).not.toBe('')
    // The emphasis is colour and weight. At 28px the number outweighed the
    // account name it belongs to, which is how a routine balance became the
    // loudest thing on the row.
    const size = Number(total.match(/font-size:(\d+(?:\.\d+)?)px/)?.[1])
    expect(size, 'the balance must not out-shout the account name').toBeLessThanOrEqual(18)
    expect(total).toContain('font-weight:700')
  })

  it('marks the serving account on its own row instead of above the list', () => {
    // "In use now" is a fact about one row. As a green strip above the list it
    // read as a summary of every account, and the eye had to hunt for the row it
    // belonged to — the name had to be repeated in the strip to be useful at all.
    expect(card).toContain('serving={card.activeAccount?.id === account.id}')
    expect(card).toContain("data-serving={serving === true ? 'true' : undefined}")
    expect(rule('.dsm-xdpool-account[data-serving="true"]'), 'the row needs its own live state')
      .not.toBe('')
    // The strip needed the account's name, because the row it pointed at was
    // somewhere else in the list. On the row itself that name is already there.
    expect(card).not.toContain('dsm-xdpool-current-name')
    expect(card).not.toContain('row.currentAccountDisabled')
    expect(styles).not.toContain('dsm-xdpool-current-name')
  })

  it('prints the package breakdown as chips on the figures line', () => {
    // As its own column it needed a heading to say what it was. As chips the
    // name says it, and the amounts stay comparable between accounts.
    const list = rule('.dsm-xdpool-packages')
    expect(list).toContain('flex-wrap:wrap')
    const item = rule('.dsm-xdpool-packages li')
    expect(item, 'a two-row grid per package is the old table again')
      .not.toContain('grid-template-columns')
    expect(card).toContain('dsm-xdpool-panel-packages dsm-xdpool-packages')
  })

  it('gives up the total panel its banner chrome', () => {
    // A 3px green cap across the top and a tinted, centred box were built for a
    // full-width banner. On a figure inside a row they made the balance look like
    // a section of its own, which is the second half of the same problem.
    expect(styles, 'the banner cap must go with the banner')
      .not.toContain('dsm-xdpool-panel-total::before')
    expect(card).toContain('dsm-xdpool-panel-total')
  })

  it('keeps the check-in action on one line with its streak', () => {
    const checkin = rule('.dsm-xdpool-checkin')
    expect(checkin).not.toBe('')
    expect(checkin, 'a centred column under a divider is a dialog, and this is not')
      .not.toContain('align-items:center;gap:7px;width:100%;margin-top')
    expect(rule('.dsm-xdpool-checkin-btn'), 'a full-width button stretched the row')
      .not.toContain('width:100%')
  })
})

describe('every class the region card renders is styled', () => {
  it('closes over the class names PoolCard uses', () => {
    // `card-shell.test.ts` does this for the shell. The pool card's own
    // stylesheet had no equivalent, so the region cards were free to grow class
    // names that no rule ever defined — silently unstyled, which is exactly
    // what a missing rule looks like in a screenshot.
    const missing = regionClassNames(card).filter(name => hasRule(name) === false)
    expect(missing, `no CSS rule for: ${missing.join(', ')}`).toEqual([])
    expect(regionClassNames(card).length, 'the region card must use real class names')
      .toBeGreaterThan(15)
  })

  it('closes over the classes the shared tile and the panes use', () => {
    const missing = regionClassNames(regionCard).filter(name => hasRule(name) === false)
    expect(missing, `no CSS rule for: ${missing.join(', ')}`).toEqual([])
  })
})

describe('the card names the vendor instead of our own plumbing', () => {
  it('prints no loopback address and no port anywhere on the card', () => {
    // The user quoted two sentences off their own screenshot and said these
    // must not be displayed: the "running healthy — requests auto-rotate
    // across accounts" line and the "provider is listening on the loopback
    // address · http://127.0.0.1:6192" line. Both were about where this
    // plugin serves the lane from, which is a fact about us and not about the
    // vendor the user came to check.
    //
    // This is asserted at the source level rather than on rendered output: the
    // port used to reach the card came from `status.shim.baseUrl`, and it would
    // come back the moment somebody re-added it for a debug affordance.
    expect(card).not.toContain('shim.baseUrl')
    expect(card).not.toContain('row.shimRunning')
    expect(card).not.toContain('row.shimStopped')
    expect(card).not.toContain('row.regionEndpointPending')
    // And the copy itself is gone from both language tables, not merely unused.
    for (const key of ['row.shimRunning', 'row.shimStopped', 'row.regionEndpointPending']) {
      expect(locales, `${key} must not be defined any more`).not.toContain(`'${key}'`)
    }
  })

  it('takes its name, its host and its free-line note from the channel roster', () => {
    // Both pool lanes ARE two of the thirteen scan-login channels, so the pool
    // page reads the roster the login page reads and looks the lane up by its
    // channel id. The card used to say "CN" / "Global" — our word for the lane —
    // which put the same vendor under two names on two pages of one dialog.
    expect(card).toContain('REGION_CHANNEL_BY_REGION[region]')
    expect(card).toContain('{card.brandName}')
    expect(card).toContain('{card.brandSub}')
    expect(card).toContain('{card.brandNote}')
    // The subtitle is "vendor · host" when the vendor publishes a host, and
    // just the vendor when it does not — never a fabricated domain.
    expect(card).toContain('`${found.org} · ${found.domain}`')
    expect(card).toContain('found.domain === undefined ? found.org')
  })

  it('keeps the state pill to a word, with no sentence in it', () => {
    // "Running healthy — requests auto-rotate across accounts" was the pill's
    // text. A pill is a badge: the explanation belongs in the note line under
    // it, which is where the vendor's free-line description now lives.
    expect(locales).toContain("'row.ok': '已接入'")
    expect(locales).toContain("'row.ok': 'Running'")
    expect(locales).not.toContain('运行健康')
    expect(locales).not.toContain('auto-rotate')
  })
})

describe('the scan-login roster is read for branding only, never mirrored', () => {
  it('renders no channel rows in the pool', () => {
    // The user asked for the mirrored list to go: "在扫码登录页登录过什么，这里就
    // 同步显示什么，数量口径一致。这个不需要". They were right — the mirror
    // could only ever print thirteen vendors, and the count it printed came from
    // the same document the login page already shows. A list of rows that all say
    // "not connected" is a worse answer than no list.
    //
    // Asserted at the source level: the section is asserted absent here so that
    // re-adding it means editing this sentence, which is the point.
    for (const gone of [
      'dsm-xdpool-poolchans',
      'dsm-xdpool-poolchan',
      'PoolChannelRow',
      'row.poolChan',
    ]) {
      expect(card, `${gone} must not come back to the pool page`).not.toContain(gone)
      expect(styles, `${gone} must not come back to the stylesheet`).not.toContain(gone)
      expect(locales, `${gone} must not come back to either language table`).not.toContain(gone)
    }
  })

  it('still asks the roster, because the lane takes its name from it', () => {
    // Removing the mirror must not remove the branding: the lane's title is the
    // vendor's own name and its subtitle is the vendor's own host, both of which
    // live on the login page's roster. So one GET stays, and it stays a GET of a
    // local document — no pack call, because the only thing it now needs is
    // static text.
    expect(card).toContain('POOL_CHANNELS_PATH')
    expect(card).toContain('REGION_CHANNEL_BY_REGION[region]')
    // And the count RPC went with the rows: nothing asks the pack for figures now,
    // so the method is off this origin's allowlist.
    expect(card).not.toContain('provider.status')
    expect(card).not.toContain('providerStatusesFrom')
  })

  it('keeps only the domain the pack publishes, and never invents the rest', () => {
    // Only the pack's `buddy` and `workbuddy` adapters publish an `apiDomain`.
    // The other eleven carry a portal or API base instead, which is where the
    // user finishes a sign-in rather than where requests go — so a subtitle
    // printing it as the vendor's host would be the one line on the card
    // nobody could verify.
    expect(channelDescriptors).toContain('domain?: string')
    const withDomain = [...channelDescriptors.matchAll(/domain: '([^']+)'/gu)].map(m => m[1])
    expect(withDomain.sort()).toEqual(['copilot.tencent.com', 'www.workbuddy.ai'])
    expect(card).toContain('found.domain === undefined ? found.org')
  })
})