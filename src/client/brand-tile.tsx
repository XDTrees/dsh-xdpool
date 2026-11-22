/**
 * The 40px brand tile shared by the login channels and the account-pool cards.
 *
 * The user asked for the account pool to look like the sign-in page, which
 * means the two need the SAME tile, not two tiles that were measured by eye and
 * happen to be 40px. So the tile lives here, once, and both pages render it.
 *
 * Four decisions worth stating, because each of them is a way this could have
 * looked wrong:
 *
 * 1. A channel with real artwork shows it (`icon`); a channel without one wears
 *    its OWN INITIALS on the gradient (`initials`). The fallback is not a
 *    degraded mode — five of the thirteen channels have no logo in any build we
 *    carry — so the tile has to be good in both shapes rather than treating one
 *    as the real thing. The initials are the point of decision 5 below.
 * 2. The glyph is a CSS `mask`, not a `background-image`. The tile's gradient
 *    is repainted on hover (the tile lifts and rotates). With a background
 *    image the browser repaints the glyph along with the gradient, which shows
 *    up as a flicker on a 16-40px target. A mask is a separate layer and does
 *    not.
 * 3. The gradient is built from `color-mix` on the accent, not from two stored
 *    stops. Each channel supplies exactly one colour — its own brand — and
 *    inventing a second stop per channel would be a guess dressed as a fact.
 * 4. There is no alt text: the tile is `aria-hidden` and decorative. The
 *    channel's real name is right next to it in the same row, so a tile that
 *    announced itself would make a screen reader say every channel name twice.
 * 5. The no-artwork fallback is INITIALS, not a generic glyph. This is the fix
 *    for the user reporting that LobsterAI, TRAE, Loomy, MiniMax Code and Gemini
 *    Code Assist "have no icon set": they were all wearing the same `login` key
 *    shape, so five different vendors were visually identical and read as
 *    broken. The reference build solves it the same way — its logo tile falls
 *    back to `channel.name.slice(0, 2).toUpperCase()`. Letters come from the
 *    vendor's own name, so a reader can tell the five apart at a glance without
 *    anyone sourcing artwork we do not have, and nothing in the tile claims to
 *    be a logo it is not. The `login`/`chat`/`globe` glyphs stay for the two
 *    lanes that are not vendors at all — a pool card is a lane, not a company.
 */
import type { ReactElement } from 'react'

/** Which of the three shapes a tile wears. */
export type BrandTileGlyph = 'login' | 'chat' | 'globe'

/**
 * The glyph shapes a tile can wear, as SVG `mask-image` payloads.
 *
 * Written with single-quoted attributes and percent-encoded `#` because the
 * payload lands inside a CSS `url("…")`: a double quote in the SVG closes the
 * url() early, and a raw `#` starts a colour.
 */
export const BRAND_TILE_GLYPHS: Readonly<Record<BrandTileGlyph, string>> = Object.freeze({
  /** A key: for a sign-in channel. */
  login: "url('data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='8.2' cy='8.2' r='3.6' fill='none' stroke='white' stroke-width='1.8'/><path d='M10.9 10.9 19 19M16.2 16.2l2.1-2.1M18.4 18.4l1.9-1.9' stroke='white' stroke-width='1.8' stroke-linecap='round'/></svg>')",
  /** Two stacked bubbles: for a lane that serves a conversation. */
  chat: "url('data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M3.6 5.6h10.2A3.8 3.8 0 0 1 17.6 9.4v.6h.6a3.6 3.6 0 0 1 3.6 3.6a3.6 3.6 0 0 1-3.6 3.6H12l-4 3a.6.6 0 0 1-1-.46V17H7.4a3.8 3.8 0 0 1-3.8-3.8z' fill='none' stroke='white' stroke-width='1.7' stroke-linejoin='round'/></svg>')",
  /** A globe: for the international lane. */
  globe: "url('data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='8.2' fill='none' stroke='white' stroke-width='1.7'/><path d='M3.8 12h16.4' stroke='white' stroke-width='1.7'/><path d='M12 3.8c2.2 2.3 3.3 5.1 3.3 8.2s-1.1 5.9-3.3 8.2c-2.2-2.3-3.3-5.1-3.3-8.2S9.8 6.1 12 3.8z' fill='none' stroke='white' stroke-width='1.7'/></svg>')",
})

/** Props for one tile. */
export interface BrandTileProps {
  /**
   * The channel's own brand colour, as `#rrggbb`.
   *
   * Passed through rather than looked up by name so the tile cannot drift from
   * the channel list: `src/channels.ts` is the one place that decides what
   * colour a vendor is.
   */
  readonly accent: string
  /** The shape drawn on the gradient, when no artwork is available. */
  readonly glyph: BrandTileGlyph
  /**
   * Real artwork for this channel, as a `data:` URL, when this build has any.
   *
   * `undefined` is the ordinary path, not a failure: five of the thirteen
   * channels ship no logo, so the initials tile is what they are supposed to
   * look like rather than a placeholder standing in for something missing.
   */
  readonly icon?: string | undefined
  /**
   * Two letters drawn on the gradient when there is no artwork.
   *
   * Pass the vendor's own initials — `'LO'`, `'TR'`, `'GE'` — not a shape. The
   * tile prefers `initials` whenever it is present and ignores `glyph`, so a
   * caller cannot accidentally get "the key icon again" by forgetting to pass
   * one. Two characters is a hard maximum: at 40px the third letter stops being
   * legible and starts being texture.
   */
  readonly initials?: string | undefined
  /** Extra class names, so a caller can place the tile without a wrapper. */
  readonly className?: string | undefined
  /**
   * 边长（px），不传就是设计稿 .ch-logo 的默认尺寸。
   *
   * 聚合渠道的 .vd-head 是一行小字（13px 名称 + 类别胶囊），默认的 32px 方块
   * 会把卡片头撑高一倍；那里传 20。尺寸写在 inline style 上，不新增 CSS ——
   * 设计稿样式是提取生成的，插件这边不改它。
   */
  readonly size?: number | undefined
}

/**
 * At most two characters, upper-cased, punctuation dropped.
 *
 * A defensive clamp rather than a formatting nicety: the value is written as
 * text inside a fixed 40px tile, and a longer or lowercase string would either
 * overflow the tile or render at a size the caller did not measure.
 */
function tileInitials(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const letters = [...value]
    .filter(character => /[0-9A-Za-z一-鿿]/u.test(character))
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return letters === '' ? undefined : letters
}

/**
 * One 40px tile.
 *
 * The accent reaches CSS through a custom property rather than through an
 * inline `background`, because the gradient has to be composed with a neutral
 * underlay — see decision 3 in the module header.
 */
export function BrandTile({ accent, glyph, icon, initials, className, size }: BrandTileProps): ReactElement {
  const letters = icon === undefined ? tileInitials(initials) : undefined
  return (
    <span
      aria-hidden="true"
      className={`ch-logo${icon === undefined ? ' ch-logo-letters' : ' ch-logo-art'}${className === undefined ? '' : ` ${className}`}`}
      /*
        有图标时才挂 ch-logo-art —— 只挂字母版会把图标的位置留空。
        这个判断和上面那个是两件事：上面决定「字母还是图标」，这里决定「图标层要不要」。
      */
      data-logo={icon === undefined ? '' : ' ch-logo-art'}
      style={{
        '--ch-logo-accent': accent,
        '--ch-logo-glyph': letters === undefined ? BRAND_TILE_GLYPHS[glyph] : 'none',
        '--ch-logo-icon': icon === undefined ? 'none'
          /* css:--icon-xxx 是「用设计稿的 CSS 变量」，不是 data URI */
          : icon.startsWith('css:') ? `var(${icon.slice(4)})`
            : `url("${icon}")`,
        ...size === undefined ? {} : {
          width: `${String(size)}px`,
          height: `${String(size)}px`,
          flex: `0 0 ${String(size)}px`,
          borderRadius: size <= 24 ? '5px' : 'var(--r-md)',
          // 字母版在小方块里要跟着缩，否则两个字母会顶出边
          fontSize: `${String(Math.max(9, Math.round(size * 0.42)))}px`,
        },
      } as Record<string, string>}
    >
      {letters}
    </span>
  )
}