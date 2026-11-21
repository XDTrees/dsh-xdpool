/**
 * The design tokens: colour, type, radius, shadow — one vocabulary.
 *
 * WHY THE PALETTE IS INTERPOLATED HERE AND NOT IN THE CSS
 *
 * These values must be flattened before the string is used. `styles.ts` embeds this text inside
 * its own template literal, and a nested `${...}` inside a value that is itself interpolated is
 * NOT expanded a second time — the build emits the literal characters. That is what left
 * `--xd-surface: var(--dsw-alias-bg-layer-1, ${PALETTE_LIGHT.surface})` in the bundle: an invalid
 * CSS value, so the variable resolved to nothing and every surface that used it went transparent.
 *
 * So each token is a plain string constant here, and the CSS is assembled from them.
 *
 * THERE IS NO THEME SWITCH, ON PURPOSE
 *
 * A plugin that paints its own light/dark control inside an application that already has one gives
 * the reader a second place to look, and the two disagree the moment either changes. Every token
 * asks the host's alias variable first; the literal palette is only the fallback, and
 * `prefers-color-scheme` supplies a dark one behind that.
 *
 * @module dsh-xdpool/client/tokens
 */

/** The radii, as one scale: R - p for anything nested inside a box of radius R. */
export const RADII = {
  card: 14,
  cardDark: 12,
  panel: 10,
  chip: 8,
  pill: 999,
} as const

/**
 * The light palette.
 *
 * Values are written out rather than referenced, because anything reaching the stylesheet has to
 * be a finished string — see the note at the top.
 */
const LIGHT = {
  ground: '#F6F5F3',
  surface: '#FFFFFF',
  surfaceAlt: '#EEECEA',
  text: '#1A1A1D',
  textMuted: '#5F5C58',
  divider: '#E0DDD9',
  primary: '#0F8B4C',
  onPrimary: '#FFFFFF',
  accent: '#A8871B',
  danger: '#C0442F',
} as const

/**
 * 深色调色板。
 *
 * 底色是中性炭黑，不是绿黑。
 *
 * 之前把底也染成绿调（#0B0F0E 带青色），整屏看起来像蒙了一层绿滤镜 ——
 * 绿是「状态」的颜色（已连接、免费、开关打开），底色染绿之后每个状态
 * 都淹在背景里，反而不显眼。
 *
 * 现在底色回到中性炭黑并带一点暖（#0E0E11 偏红半档），主色提到一个
 * 明确的绿。这样绿只出现在该绿的地方，对比也拉开。
 *
 * 金色作为第二强调色（#C9A227 那一族）：它标「订阅 / VIP」，和绿分工明确。
 */
const DARK = {
  ground: '#0E0E11',
  surface: '#16161A',
  surfaceAlt: '#1D1D22',
  text: '#F0EFEC',
  textMuted: '#A6A29C',
  divider: '#2A2A30',
  primary: '#34C77B',
  onPrimary: '#04150C',
  accent: '#C9A227',
  danger: '#E06A55',
} as const

/** The type stacks. Chinese-first, with the host's UI font last. */
const SANS = '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", system-ui, sans-serif'
const SERIF = '"Songti SC", "Noto Serif SC", "Source Han Serif SC", serif'
const MONO = '"JetBrains Mono", "SF Mono", "Cascadia Code", ui-monospace, monospace'

/** The keys every scheme supplies. */
interface Palette {
  ground: string
  surface: string
  surfaceAlt: string
  text: string
  textMuted: string
  divider: string
  primary: string
  onPrimary: string
  accent: string
  danger: string
}

/**
 * One scheme's declarations, as joined text.
 *
 * Written with `+` rather than a template literal on purpose: this function is kept as a function
 * in the bundle, and a template literal inside it survives as literal `${...}` characters — which
 * CSS reads as a broken value, not as a substitution. String concatenation cannot be mistaken for
 * a placeholder by anything downstream.
 */
function declarations(palette: Palette, radius: number, shadow: string, shadowSmall: string): string {
  const parts = [
    '--xd-ground: var(--dsw-alias-bg-layer-0, ' + palette.ground + ');',
    '--xd-surface: var(--dsw-alias-bg-layer-1, ' + palette.surface + ');',
    '--xd-surface-2: var(--dsw-alias-bg-layer-2, ' + palette.surfaceAlt + ');',
    '--xd-text: var(--dsw-alias-label-primary, ' + palette.text + ');',
    '--xd-muted: var(--dsw-alias-label-secondary, ' + palette.textMuted + ');',
    '--xd-faint: var(--dsw-alias-label-tertiary, ' + palette.textMuted + ');',
    '--xd-divider: var(--dsw-alias-border-l1, ' + palette.divider + ');',
    /*
      主色用我们自己的绿，不再问宿主的品牌色。

      之前写成 `var(--dsw-alias-brand-primary, 绿)` —— 宿主只要定义了品牌色
      （默认是蓝），我们的绿就永远用不上，整站的按钮、开关、选中态全是蓝的。
      设计稿定的是绿，所以这里必须直给。
    */
    '--xd-primary: ' + palette.primary + ';',
    '--xd-on-primary: ' + palette.onPrimary + ';',
    '--xd-accent: ' + palette.accent + ';',
    '--xd-danger: ' + palette.danger + ';',
    '--xd-radius-card: ' + String(radius) + 'px;',
    '--xd-radius-panel: ' + String(RADII.panel) + 'px;',
    '--xd-radius-chip: ' + String(RADII.chip) + 'px;',
    '--xd-radius-pill: ' + String(RADII.pill) + 'px;',
    '--xd-shadow: ' + shadow + ';',
    '--xd-shadow-sm: ' + shadowSmall + ';',
    '--xd-font: ' + SANS + ';',
    /*
      标题字体：衬线，直给。

      之前这里写的是 SANS，只有在 prefers-color-scheme:dark 的兜底块里才被
      替换成 SERIF —— 浅色模式下标题就成了黑体。设计稿的分区标题一律衬线
      （.sec-title / .kpi-v / .group-title 都走 --sans-head），
      这是它「有分量」的来源，不能只在深色下成立。
    */
    '--xd-font-head: ' + SERIF + ';',
    '--xd-font-mono: ' + MONO + ';',
    // ---- 发丝线：用半透明白而不是实色，深色下才有「一道光」的感觉 ----
    '--xd-line: ' + 'color-mix(in oklch, currentColor 7%, transparent)' + ';',
    '--xd-line-2: ' + 'color-mix(in oklch, currentColor 12%, transparent)' + ';',
    // ---- 主色分档 ----
    '--xd-primary-dim: ' + 'color-mix(in oklch, var(--xd-primary) 13%, transparent)' + ';',
    '--xd-primary-line: ' + 'color-mix(in oklch, var(--xd-primary) 38%, transparent)' + ';',
    /*
      字号阶梯：五档，和设计稿的 --fs-xs..xl 一一对应。

      之前全仓 200 多处 font-size 是写死的数字（110 处 11px、19 处 11.5px、
      14 处 10px…），既不合规也没法统一调。收到这五档之后，改一处就全站一致。
    */
    '--xd-fs-xs: 12px;',
    '--xd-fs-sm: 13px;',
    '--xd-fs-md: 15px;',
    '--xd-fs-lg: 18px;',
    '--xd-fs-xl: 22px;',
    /*
      间距：4 的倍数，七档。

      设计稿的 --s1..s7。写作 --xd-s1 而不是 --xd-space-1，是为了和设计稿
      源码对得上 —— 看设计稿写 s4，在这里找 s4 就行。
    */
    '--xd-s1: 4px;',
    '--xd-s2: 8px;',
    '--xd-s3: 12px;',
    '--xd-s4: 16px;',
    '--xd-s5: 24px;',
    '--xd-s6: 32px;',
    '--xd-s7: 48px;',
    // ---- 状态色 ----
    '--xd-ok: ' + 'var(--xd-primary)' + ';',
    '--xd-warn: ' + '#C9A227' + ';',
    '--xd-info: ' + '#5B8FB9' + ';',
  ]
  return parts.join(String.fromCharCode(10) + "  ")
}

/**
 * The stylesheet, assembled by concatenation.
 *
 * No template literal: a `${` inside one would survive into the bundle when this text is itself
 * interpolated somewhere else, and CSS has no idea what to do with it.
 */
export const TOKENS_CSS = [
  ':root{',
  '  ' + declarations(LIGHT, RADII.card, '0 6px 18px rgba(47, 125, 79, .10)', '0 2px 8px rgba(47, 125, 79, .07)'),
  '  font-family: var(--xd-font);',
  '  color: var(--xd-text);',
  '}',
  '',
  '/*',
  '  The dark fallback, for a host that supplies no aliases of its own. It sits inside each',
  "  var() fallback, so a themed application keeps its own scheme rather than being overridden.",
  '*/',
  '@media (prefers-color-scheme: dark) {',
  '  :root{',
  '  ' + declarations(DARK, RADII.cardDark, '0 12px 40px rgba(0, 0, 0, .45)', '0 4px 16px rgba(0, 0, 0, .32)').replace(/--xd-font-head: [^;]+;/, `--xd-font-head: ${SERIF};`),
  '  }',
  '',
  '  /* A serif headline is lighter and more open; that is what makes it read as composed. */',
  '  .dsm-xdpool-detailtitle h2 {',
  '    font-family: var(--xd-font-head);',
  '    font-weight: 500;',
  '    letter-spacing: .02em;',
  '  }',
  '}',
].join('\n')
