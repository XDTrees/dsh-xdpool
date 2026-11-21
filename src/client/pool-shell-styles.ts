/**
 * Styles for the two-column account pool and the shell around every page.
 *
 * RADII FOLLOW ONE RULE: r = R - p
 *
 * A box sitting p inside a container of radius R gets R - p, so both corners share a centre
 * instead of one visibly cutting into the other. The scale is 12 (the frame) to 8 (a panel
 * inside it) to 6 (a chip), every value on the 4px grid, nothing below 4, and pills stay fully
 * round. The previous sheet carried nine hard-coded radii — 999, 13, 12, 10, 9, 8, 7, 6 — with
 * the same nesting drawn at two different values, which is what makes nested boxes look like two
 * people drew them.
 *
 * @module dsh-xdpool/client/pool-shell-styles
 */

/** The radii, as one vocabulary. */
export const SHELL_RADII = {
  frame: 12,
  panel: 8,
  chip: 6,
} as const

/** Continuous corners where the engine supports them; plain radii everywhere else. */
const CONTINUOUS =
  '@supports (corner-shape: superellipse(1.25)) {'
  + '  .dsm-xdpool-frame, .dsm-xdpool-frame *:not([data-pill="true"]) { corner-shape: superellipse(1.25); }'
  + '  .dsm-xdpool-frame [data-pill="true"] { corner-shape: round; }'
  + '}'

/** The shared vocabulary, as custom properties. */
const TOKENS = [
  `  --shell-radius:${String(SHELL_RADII.frame)}px;`,
  `  --panel-radius:${String(SHELL_RADII.panel)}px;`,
  `  --chip-radius:${String(SHELL_RADII.chip)}px;`,
].join('\n')

/**
 * The pool's two columns.
 *
 * WHY A FIXED FRAME
 *
 * The old layout was a single column of cards, so twenty channels meant a page you scrolled for a
 * minute and a summary that left the screen the moment you did. Here the rail and the summary stay
 * put and only the detail scrolls.
 */
/**
 * The motion vocabulary: one curve per role, one duration per size.
 *
 * The stylesheet had three `transition: ... ease` — the CSS default, which is not a choice and
 * reads as "nobody decided". These are the curves the tips call for, named by what they are FOR
 * rather than by how they look, so a new component picks a role instead of a bezier.
 */
export const MOTION_CSS = `
.dsm-xdpool-frame, .dsm-xdpool-shell {
  /* Lands right after a click: an icon, a label, a selected row. */
  --xd-ease-out: cubic-bezier(.22, 1, .36, 1);
  /* Anything that LEAVES, and only that. */
  --xd-ease-in: cubic-bezier(.42, 0, 1, 1);
  /* Something that stays and only changes place: a pane opening, a rail sliding. */
  --xd-ease-in-out: cubic-bezier(.42, 0, .58, 1);
  /* A small confirmation: a tick, a count, a switch settling. Never on a panel. */
  --xd-ease-overshoot: cubic-bezier(.34, 1.56, .64, 1);
  /* Things that run rather than move: spinners, the skeleton band. */
  --xd-linear: linear;

  --xd-dur-sm: 160ms;
  --xd-dur-md: 260ms;
  --xd-dur-lg: 380ms;
}

/* Reduced motion keeps every state and drops the movement. */
@media (prefers-reduced-motion: reduce) {
  .dsm-xdpool-frame, .dsm-xdpool-shell {
    --xd-dur-sm: 1ms;
    --xd-dur-md: 1ms;
    --xd-dur-lg: 1ms;
    --xd-ease-out: linear;
    --xd-ease-in: linear;
    --xd-ease-in-out: linear;
    --xd-ease-overshoot: linear;
  }
}
`

export const POOL_SHELL_CSS = `
/*
  账号池的两栏：条目栏 264px + 详情吃掉剩余。

  设计稿的三层是「功能页 / 条目栏 / 内容」。功能页由 .shellnav 画（外层），
  这个元素只负责后两层，所以是 264 + 1fr 的两列。

  之前是 232px，且带 12px 的 padding 和 gap —— 条目栏因此比设计稿窄 32px，
  两侧各让出 12px 之后内容也跟着缩。设计稿里这一层是贴边的：
  条目栏自己的底色和右侧发丝线就是边界，不需要再镶一圈。
*/
.dsm-xdpool-shell{
${TOKENS}
  display:grid;
  grid-template-columns:264px minmax(0,1fr);
  grid-template-rows:minmax(0,1fr);
  gap:0;
  padding:0;
  border-radius:0;
  min-height:0;
  min-width:0;
  height:100%;
  box-sizing:border-box;
  overflow:hidden;
}
.dsm-xdpool-shell>*{min-width:0}
.dsm-xdpool-shellhead{grid-column:1/-1;min-width:0}

/* ---- summary ------------------------------------------------------------- */
.dsm-xdpool-summary{display:grid;grid-template-columns:1.1fr 1.2fr .9fr;gap:var(--xd-s2);min-width:0}
.dsm-xdpool-summary-cell{
  display:flex;flex-direction:column;gap:3px;padding:10px 12px;
  border-radius:var(--xd-radius-panel);border:1px solid var(--xd-divider);
  background:var(--xd-surface);min-width:0;
}
.dsm-xdpool-summary-label{
  font-size:var(--xd-fs-xs);line-height:16px;color:var(--xd-faint);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.dsm-xdpool-summary-value{
  display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;
  font-size:17px;font-weight:600;line-height:24px;
  color:var(--xd-text);
  font-variant-numeric:tabular-nums;min-width:0;
}
.dsm-xdpool-summary-value-note{font-size:var(--xd-fs-xs);font-weight:500;line-height:20px;color:var(--xd-muted)}
.dsm-xdpool-summary-figure{display:inline-flex;align-items:baseline;gap:3px}
.dsm-xdpool-summary-unit{font-size:var(--xd-fs-xs);font-weight:400;color:var(--xd-faint)}

/* ---- rail ---------------------------------------------------------------- */
/*
  Its own scroll area with min-height:0, which is what lets it shrink inside the grid instead of
  stretching the page: without it a long rail makes the frame taller than the viewport and the two
  columns stop being independent.
*/
/* ============================================================
   侧栏顶部的三个数字
   ------------------------------------------------------------
   照设计稿的 .list-stats：三格并排，格与格之间靠背景色透出 1px 缝，
   不画边框。数字 15px 加粗，标签 12px 淡色在下面。
   ============================================================ */

.dsm-xdpool-rail::-webkit-scrollbar{width:6px}
.dsm-xdpool-rail::-webkit-scrollbar-thumb{background:#ffffff1f;border-radius:999px}
/* 前面一个 4px 点：已登录是主色，未登录是灰的（设计稿 .list-group::before） */
.dsm-xdpool-railsection::before{
  content:'';flex:0 0 auto;
  width:4px;height:4px;border-radius:50%;
  background:var(--xd-primary);
}
.dsm-xdpool-railsection[data-empty="true"]::before{background:var(--xd-line-3)}
/* 未登录那组上方加一道线，和上面隔开 */
.dsm-xdpool-railsection[data-empty="true"]{
  border-top:1px solid var(--xd-line);
  margin-top:12px;padding-top:16px;
}
/*
  The travelling indicator.

  Rule 1g: one indicator moves from the old row to the new one, its leading edge leaving first —
  which is what the ease-in-out curve does. Positions are whole rows (32px), so the bar lands
  exactly on a row rather than between two.
*/
.dsm-xdpool-railind{
  position:absolute;
  left:6px;
  top:6px;
  width:3px;
  height:22px;
  margin-top:5px;
  border-radius:var(--xd-radius-pill);
  background:var(--xd-primary);
  transition:transform var(--xd-dur-md) var(--xd-ease-in-out);
  pointer-events:none;
}
/* 条目栏本身：设计稿 .list —— 自己滚自己的，右侧一条发丝线 */
.dsm-xdpool-rail{
  display:flex;
  flex-direction:column;
  background:var(--xd-surface);
  border-right:1px solid var(--xd-line);
  min-height:0;
  min-width:0;
  overflow:hidden;
  padding:0;
}
/* 三格汇总：设计稿 .list-stats —— 三列，靠 1px 缝分层 */
.dsm-xdpool-railhead{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:1px;
  border-radius:6px;
  background:var(--xd-line);
  overflow:hidden;
  margin:16px 12px 4px;
  flex:0 0 auto;
}
.dsm-xdpool-railstat{
  display:flex;
  flex-direction:column;
  gap:1px;
  padding:6px 8px;
  background:var(--xd-surface);
  min-width:0;
}
.dsm-xdpool-railstatvalue{
  font-size:var(--xd-fs-md);
  font-weight:600;
  letter-spacing:-0.02em;
  line-height:1.25;
  color:var(--xd-text);
  font-variant-numeric:tabular-nums;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.dsm-xdpool-railstatunit{font-size:var(--xd-fs-xs);font-weight:400;color:var(--xd-faint);margin-left:1px}
.dsm-xdpool-railstatlabel{
  font-size:var(--xd-fs-xs);
  line-height:1.4;
  color:var(--xd-faint);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.dsm-xdpool-railscroll{
  flex:1 1 auto;
  min-height:0;
  min-width:0;
  overflow-y:auto;
  overflow-x:hidden;
  padding:0 8px 16px;
}
.dsm-xdpool-railsection{
  display:flex;
  align-items:center;
  gap:6px;
  font-size:var(--xd-fs-xs);
  font-weight:500;
  letter-spacing:0.03em;
  line-height:16px;
  color:var(--xd-faint);
  padding:var(--xd-s4) 8px 4px;
}
.dsm-xdpool-railsection::before{
  content:'';
  width:4px;
  height:4px;
  border-radius:50%;
  background:var(--xd-primary);
  flex:0 0 auto;
}
.dsm-xdpool-railsection[data-empty="true"]::before{background:var(--xd-line-3)}
.dsm-xdpool-railsection[data-empty="true"]{
  border-top:1px solid var(--xd-line);
  margin-top:12px;
  padding-top:16px;
}
.dsm-xdpool-railrow{
  display:flex;
  align-items:center;
  gap:var(--xd-s2);
  width:100%;
  min-height:32px;
  padding:6px 8px;
  border:0;
  border-radius:6px;
  background:transparent;
  color:var(--xd-muted);
  font:inherit;
  font-size:var(--xd-fs-sm);
  line-height:19px;
  text-align:left;
  cursor:pointer;
  min-width:0;
  transition:background var(--xd-dur-sm) var(--xd-ease-out),color var(--xd-dur-sm) var(--xd-ease-out);
}
.dsm-xdpool-railmark{
  flex:0 0 20px;
  width:20px;
  height:20px;
  border-radius:6px;
  background-color:var(--xd-surface-3);
  display:grid;
  place-items:center;
  overflow:hidden;
  font-size:9px;
  font-weight:700;
}
.dsm-xdpool-railname{
  flex:1 1 auto;
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.dsm-xdpool-railcount{
  flex:0 0 auto;
  font-size:var(--xd-fs-xs);
  line-height:16px;
  color:var(--xd-faint);
  font-variant-numeric:tabular-nums;
}

.dsm-xdpool-railrow:hover{background:#ffffff0d;color:var(--xd-text)}
.dsm-xdpool-railrow[data-active="true"]{background:var(--xd-surface-2);color:var(--xd-text);font-weight:600}
/* Unbound channels read as secondary: they are doors, not holdings. */
.dsm-xdpool-railrow[data-state="idle"] .dsm-xdpool-railmark{opacity:.4;filter:grayscale(1)}
.dsm-xdpool-railrow[data-state="idle"] .dsm-xdpool-railname{color:var(--xd-faint)}
.dsm-xdpool-railmark img{display:block;width:20px;height:20px;border-radius:6px;object-fit:cover}
.dsm-xdpool-raildot{flex:0 0 auto;width:6px;height:6px;border-radius:999px}
.dsm-xdpool-raildot[data-tone="expiring"]{background:var(--xd-accent)}
.dsm-xdpool-raildot[data-tone="error"]{background:var(--xd-danger)}

/* ---- detail -------------------------------------------------------------- */
/*
  Embedded: the detail column only, with the rail supplied by the parent.

  One rail for every channel means the second component must stop drawing its own — otherwise the
  same list appears twice, which is exactly what "these look like two different plugins" came from.
*/
.dsm-xdpool-embedded{
  display:block;
  padding:0;
  min-height:0;
}
.dsm-xdpool-embedded>.dsm-xdpool-detail{border:0;border-radius:0;background:transparent}

/* One lane in the detail column, taking the whole width. */
.dsm-xdpool-region-single{grid-template-columns:minmax(0,1fr)!important;gap:0!important}
.dsm-xdpool-region-single>.dsm-xdpool-region{border-left:0;border-right:0;border-radius:0}
.dsm-xdpool-detail{
  display:flex;flex-direction:column;
  min-height:0;
  /* 少了这两行，grid 会按内容把详情撑得比格子宽，右边那一列就跑到屏幕外。 */
  min-width:0;
  width:100%;
  border-radius:var(--xd-radius-panel);border:1px solid var(--xd-divider);
  background:var(--xd-surface);overflow:hidden;
}
/*
  The header stays put while the body scrolls: the detail can be long (accounts, models,
  automation), and a header that scrolls away takes the channel's name and its actions with it.
*/
.dsm-xdpool-detailhead{
  display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;
  padding:10px 12px;border-bottom:1px solid var(--xd-divider);
  background:var(--xd-surface);position:sticky;top:0;z-index:1;
}
.dsm-xdpool-detailtitle{display:flex;align-items:baseline;gap:var(--xd-s2);flex-wrap:wrap;min-width:0}
.dsm-xdpool-detailmark{
  display:inline-flex;align-items:center;justify-content:center;flex:0 0 22px;
  width:22px;height:22px;border-radius:6px;background:#ffffff0f;
  font-size:9px;font-weight:700;overflow:hidden;
}
.dsm-xdpool-detailmark img{display:block;width:22px;height:22px;border-radius:6px;object-fit:cover}
.dsm-xdpool-detailstate{
  flex:0 0 auto;font-size:var(--xd-fs-xs);line-height:16px;padding:1px 7px;border-radius:999px;
  border:1px solid var(--xd-divider);
  color:var(--xd-faint);
}
.dsm-xdpool-detailstate[data-on="true"]{
  border-color:color-mix(in srgb,var(--xd-primary) 45%,transparent);
  color:var(--xd-primary);
  background:color-mix(in srgb,var(--xd-primary) 10%,transparent);
}
.dsm-xdpool-detailtitle h2{
  margin:0;font-size:14px;font-weight:600;line-height:20px;
  color:var(--xd-text);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dsm-xdpool-detailsub{
  font-size:var(--xd-fs-xs);line-height:16px;color:var(--xd-faint);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dsm-xdpool-detailactions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:0 1 auto}
.dsm-xdpool-detail{
  animation:dsm-xdpool-detail-in-down var(--xd-dur-md) var(--xd-ease-out) both;
}
/* A row in the lower half brings its panel up from below. */
.dsm-xdpool-detail[data-enter="up"]{
  animation-name:dsm-xdpool-detail-in-up;
}
/*
  The panel arrives from the side that was picked.

  Rule 1g: new content enters from the side of the tab that was chosen. A row near the top of the
  rail brings its panel down from above; one near the bottom brings it up from below. A single
  direction — every panel rising — makes the rail feel like a list of buttons rather than a place
  you are moving through.

  The distance is 6px: enough to read as direction, not enough to draw attention to the frame
  instead of the channel that was just picked.
*/
@keyframes dsm-xdpool-detail-in-down{
  from{opacity:0;transform:translateY(-6px)}
  to{opacity:1;transform:none}
}
@keyframes dsm-xdpool-detail-in-up{
  from{opacity:0;transform:translateY(6px)}
  to{opacity:1;transform:none}
}
.dsm-xdpool-detailbody{
  flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;
  padding:var(--xd-s3);display:flex;flex-direction:column;gap:var(--xd-s3);
}
.dsm-xdpool-detailbody::-webkit-scrollbar{width:8px}
.dsm-xdpool-detailbody::-webkit-scrollbar-thumb{background:#ffffff1f;border-radius:999px}
.dsm-xdpool-detailempty{
  display:flex;align-items:center;justify-content:center;min-height:160px;padding:24px;
  font-size:var(--xd-fs-xs);line-height:18px;color:var(--xd-faint);text-align:center;
}

/* ---- skeleton: real sizes, one band across the whole list ----------------- */
.dsm-xdpool-skel{display:flex;flex-direction:column;gap:var(--xd-s2);width:100%}
.dsm-xdpool-skelrow{
  animation:dsm-xdpool-skel-in var(--xd-dur-sm) var(--xd-ease-out) both;
}
@keyframes dsm-xdpool-skel-in{from{opacity:0}to{opacity:1}}
.dsm-xdpool-skelrow{
  display:flex;align-items:flex-start;gap:10px;padding:var(--xd-s2);
  border-radius:var(--xd-radius-panel);background:#ffffff08;position:relative;overflow:hidden;
}
.dsm-xdpool-skelmark{flex:0 0 24px;width:24px;height:24px;border-radius:999px;background:#ffffff14}
.dsm-xdpool-skelcopy{display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-width:0}
.dsm-xdpool-skelline{height:12px;border-radius:6px;background:#ffffff14}
.dsm-xdpool-skelline-short{height:10px;border-radius:5px;background:#ffffff0f}
.dsm-xdpool-skelrow::after{
  content:"";position:absolute;inset:0;width:320px;
  background:linear-gradient(90deg,transparent,#ffffff14,transparent);
  animation:dsm-xdpool-skelband 1.2s linear infinite;
}
@keyframes dsm-xdpool-skelband{from{transform:translateX(-320px)}to{transform:translateX(100%)}}

/* ---- a spinner that fits inside a button without moving its label --------- */
.dsm-xdpool-spin{
  display:inline-block;width:12px;height:12px;border-radius:999px;
  border:1.5px solid currentColor;border-top-color:transparent;
  animation:dsm-xdpool-spin .9s linear infinite;vertical-align:-1px;
}
@keyframes dsm-xdpool-spin{to{transform:rotate(360deg)}}

/* ---- a failure that stays where it happened ------------------------------ */
.dsm-xdpool-inlineerror{
  display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0;padding:var(--xd-s2) 10px;
  border-radius:var(--xd-radius-chip);
  border:1px solid color-mix(in srgb,var(--xd-danger) 40%,transparent);
  background:color-mix(in srgb,var(--xd-danger) 8%,transparent);
  font-size:var(--xd-fs-xs);line-height:18px;color:var(--xd-danger);
}
.dsm-xdpool-inlineerror-text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.dsm-xdpool-inlineerror-retry{
  flex:0 0 auto;border:1px solid currentColor;background:transparent;color:inherit;
  font:inherit;font-size:var(--xd-fs-xs);padding:2px 8px;border-radius:999px;cursor:pointer;
}

/* ---- narrow: the rail becomes a strip above the detail ------------------- */
/*
  A 232px rail on a 360px screen leaves 128px for the detail, which truncates every model name and
  wraps every button onto two lines. Turning it into a scrolling strip gives the content the full
  width and keeps the channels reachable.
*/
/*
  窄容器：条目栏收窄，但仍然是两栏。

  设计稿在 1280 宽下是 264 + 1fr。容器窄的时候把条目栏压到 200px 就够了 ——
  直接降成单列会让条目栏变成一整块横条顶在上面，账号池那一屏最要紧的
  「左边选渠道、右边看详情」的关系就断了。
*/
@container xdpool (max-width:820px){
  .dsm-xdpool-shell{
    grid-template-columns:200px minmax(0,1fr);
    grid-template-rows:minmax(0,1fr);
    gap:0;padding:0;
  }
  .dsm-xdpool-summary{grid-template-columns:1fr 1fr}
  .dsm-xdpool-summary-cell-wide{grid-column:1/-1}
  /*
    条目栏保持竖列。

    这里原本把它改成横向滚动条（flex-direction:row + 每行 max-width:150px）——
    结果一屏里九个渠道挤成一条，名字被截成「WorkBuddy 国…」，
    而下面还留着它们的详情。竖列在 200px 里读得下，别的地方也别改。
  */
  .dsm-xdpool-detailbody{padding:0 16px 32px}
  .dsm-xdpool-pagehead{padding:var(--xd-s4) 16px 12px}
}

/*
  手机宽度：条目栏改成顶部横滑条，内容占满整行。

  560px 以下，200px 的竖列 + 内容只剩 200 出头 —— 模型名和按钮都会被切掉。
  设计稿在这一档的解法是把条目栏横过来：一行一个渠道，左右滑，
  内容是完整宽度。竖列在 >=560 时读得下，再窄就必须换。

  只在这一档做，不影响平板和设置面板的窄容器。
*/
@container xdpool (max-width:560px){
  .dsm-xdpool-shell{
    grid-template-columns:minmax(0,1fr);
    grid-template-rows:auto minmax(0,1fr);
    gap:0;padding:0;
  }
  .dsm-xdpool-rail{
    flex-direction:row;
    align-items:center;
    gap:6px;
    padding:var(--xd-s2);
    border-right:0;
    border-bottom:1px solid var(--xd-line);
    overflow-x:auto;
    overflow-y:hidden;
    scrollbar-width:none;
  }
  .dsm-xdpool-rail::-webkit-scrollbar{display:none}
  /* 三格汇总在横条里也横过来 */
  .dsm-xdpool-railhead{
    display:flex;
    gap:var(--xd-s2);
    margin:0;
    padding:0;
    background:transparent;
    flex:0 0 auto;
  }
  .dsm-xdpool-railstat{
    padding:2px 6px;
    border-radius:6px;
    background:var(--xd-surface-2);
  }
  .dsm-xdpool-railstatvalue{font-size:var(--xd-fs-sm)}
  .dsm-xdpool-railstatlabel{font-size:var(--xd-fs-xs)}
  .dsm-xdpool-railscroll{
    display:flex;
    flex-direction:row;
    align-items:center;
    gap:6px;
    padding:0;
    overflow:visible;
    flex:0 0 auto;
  }
  .dsm-xdpool-railsection{display:none}
  .dsm-xdpool-railrow{
    flex:0 0 auto;
    width:auto;
    min-width:0;
    max-width:160px;
    min-height:32px;
    padding:0 10px;
  }
  .dsm-xdpool-railname{max-width:100px}
  .dsm-xdpool-detail{min-height:0;overflow-y:auto}
}
@container xdpool (max-width:460px){
  .dsm-xdpool-summary{grid-template-columns:1fr}
  .dsm-xdpool-summary-cell-wide{grid-column:auto}
  .dsm-xdpool-summary-value{font-size:var(--xd-fs-md);line-height:22px}
  .dsm-xdpool-detailhead{padding:var(--xd-s2) 10px}
  .dsm-xdpool-detailbody{padding:var(--xd-s2);gap:10px}
}

/* ---- reduced motion: keep every state, drop the movement ---------------- */
@media (prefers-reduced-motion:reduce){
  .dsm-xdpool-railrow{transition:none}
  .dsm-xdpool-skelrow::after{animation:none;background:none}
  .dsm-xdpool-spin{animation-duration:2.4s}
}

${CONTINUOUS}
`

/**
 * The frame around every page: rail on the left, one panel on the right, dock on a narrow screen.
 *
 * min-height:0 on each scroll child is the load-bearing part: without it a long rail stretches the
 * grid, the panel stops being the only thing that scrolls, and the fixed frame goes back to being
 * a very tall page.
 */
export const SHELL_FRAME_CSS = `
.dsm-xdpool-frame{
  /* The palette and type come from tokens.ts; this only wires them in. */
  /*
    这是所有 @container xdpool 查询的锚点。

    之前整个插件里没有任何元素声明 container-type —— 那些容器查询
    从来没有生效过，窄屏一直用桌面布局（264 + 内容），于是内容被挤到
    屏幕外。声明在这一层，因为它是「三栏/两栏」真正的容器。
  */
  container-type:inline-size;
  container-name:xdpool;
  --rail-width:200px;
  --dock-height:52px;
  display:grid;
  grid-template-columns:var(--rail-width) minmax(0,1fr);
  /* 贴边：不留外 padding，靠底色和发丝线分层（Arc 的做法） */
  gap:0;height:100%;min-height:0;box-sizing:border-box;
  /* The popover anchors to the panel, not to the window: inside a settings dialog a
     viewport-fixed element lands outside the dialog entirely. */
  position:relative;
}
.dsm-xdpool-frame>*{min-width:0}

.dsm-xdpool-shellnav{
  display:flex;flex-direction:column;gap:var(--xd-s2);min-height:0;
  overflow-y:auto;overscroll-behavior:contain;padding:var(--xd-s3) 8px;
  /* 不再是一张卡片：和主区分靠底色 + 一道发丝线 */
  border:0;border-right:1px solid var(--xd-line);
  border-radius:0;
  background:var(--xd-ground);
}
.dsm-xdpool-shellbrand{display:flex;align-items:center;gap:var(--xd-s2);padding:2px 4px 6px;min-width:0}
.dsm-xdpool-shellavatar{width:26px;height:26px;border-radius:8px;object-fit:cover;flex:0 0 auto}
.dsm-xdpool-shellbrandcopy{display:flex;flex-direction:column;gap:1px;min-width:0}
.dsm-xdpool-shellbrandtitle{
  font-family:var(--xd-font-head);
  font-size:var(--xd-fs-md);font-weight:600;line-height:20px;letter-spacing:0;
  color:var(--xd-text);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
/* The version is an identity, not a destination — it stays out of the tab list. */
.dsm-xdpool-shellversion{
  display:inline-flex;align-items:center;gap:3px;
  font-size:var(--xd-fs-xs);line-height:16px;color:var(--xd-faint);
  font-variant-numeric:tabular-nums;
  text-decoration:none;cursor:pointer;
  transition:color var(--xd-dur-sm) var(--xd-ease-out);
}
.dsm-xdpool-shellversion:hover{color:var(--xd-primary)}
.dsm-xdpool-shellnavlist{display:flex;flex-direction:column;gap:2px;min-height:0}
.dsm-xdpool-shellnavrow{
  position:relative;
  display:flex;align-items:center;gap:var(--xd-s2);width:100%;padding:7px 9px;
  border:0;border-radius:6px;background:transparent;
  color:var(--xd-muted);
  font:inherit;font-size:var(--xd-fs-sm);line-height:19px;text-align:left;cursor:pointer;
  transition:background var(--xd-dur-sm) var(--xd-ease-out),color var(--xd-dur-sm) var(--xd-ease-out);min-width:0;
}
.dsm-xdpool-shellnavrow:hover{background:var(--xd-surface);color:var(--xd-text)}
.dsm-xdpool-shellnavrow[data-active="true"]{background:var(--xd-surface);color:var(--xd-text);font-weight:600}
/* 选中标记：左侧一道 2px 竖条（Linear 的做法，比整块高亮克制） */
.dsm-xdpool-shellnavrow[data-active="true"]::before{
  content:'';position:absolute;left:-8px;top:50%;transform:translateY(-50%);
  width:2px;height:16px;border-radius:2px;background:var(--xd-primary);
}
.dsm-xdpool-shellnavglyph{flex:0 0 auto;font-size:var(--xd-fs-xs);line-height:1;opacity:.8}
.dsm-xdpool-shellnavlabel{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-xdpool-shellnavnum{
  flex:0 0 auto;font-size:var(--xd-fs-xs);line-height:16px;
  color:var(--xd-faint);font-variant-numeric:tabular-nums;
}
.dsm-xdpool-shelllinks{margin-top:auto;display:flex;flex-direction:column;gap:var(--xd-s1)}
/*
  The foot-of-rail buttons: repo, group, sidebar toggle.

  One look for all three, and one press state. The hover lift is on the star's own glyph rather
  than the row, because a row that moves under the pointer makes the neighbouring row harder to
  hit — and the star is the only one of the three whose whole job is "go somewhere".
*/
.dsm-xdpool-star{
  display:flex;align-items:center;gap:var(--xd-s2);
  width:100%;padding:7px 9px;border:0;border-radius:6px;
  background:transparent;color:var(--xd-muted);
  font:inherit;font-size:var(--xd-fs-sm);line-height:19px;text-align:left;
  text-decoration:none;cursor:pointer;
  transition:background var(--xd-dur-sm) var(--xd-ease-out),color var(--xd-dur-sm) var(--xd-ease-out);
  min-width:0;
}
.dsm-xdpool-star:hover{background:var(--xd-surface-2);color:var(--xd-text)}
.dsm-xdpool-star:active{transform:scale(.985)}
.dsm-xdpool-star svg,.dsm-xdpool-star span:first-child{
  flex:0 0 auto;
  transition:transform var(--xd-dur-md) var(--xd-ease-overshoot);
}
/* The star turns a little on hover: a small reply, not a performance. */
.dsm-xdpool-star:hover svg,
.dsm-xdpool-star:hover span:first-child{transform:rotate(-12deg) scale(1.12)}
.dsm-xdpool-star>span:last-child{
  flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
/* The sidebar toggle shows its state in the glyph and in the tint. */
.dsm-xdpool-usageline{font-variant-numeric:tabular-nums}
.dsm-xdpool-usageline>span:last-child{font-size:var(--xd-fs-xs)}
.dsm-xdpool-sidebar-toggle-on{color:var(--xd-primary)}
.dsm-xdpool-sidebar-toggle-on:hover{color:var(--xd-primary)}

.dsm-xdpool-shellmain{display:flex;flex-direction:column;gap:10px;min-height:0;min-width:0}
.dsm-xdpool-shellhero{flex:0 0 auto;min-width:0}
/*
  Extra panels below the page body — the usage table, which used to sit on top.

  Its own scroll area with a height cap: a long log should not push the account list up, but it
  must stay reachable, so it gets a band of its own rather than a place in the flow.
*/
.dsm-xdpool-shellfoot{
  flex:0 0 auto;
  max-height:34vh;
  overflow-y:auto;
  overscroll-behavior:contain;
  min-width:0;
}
.dsm-xdpool-shellfoot::-webkit-scrollbar{width:8px}
.dsm-xdpool-shellfoot::-webkit-scrollbar-thumb{background:#ffffff1f;border-radius:999px}
/* The panel is the only scroll area on the page. */

/* ============================================================
   各页正文：设计稿 .mbody
   ------------------------------------------------------------
   padding 0 32 48、gap 24。左右 32 是设计稿给的呼吸，
   底部 48 保证滚到底时最后一块不和窗口边缘黏在一起。
   ============================================================ */
.dsm-xdpool-body > .dsm-xdpool-shellpanel{
  padding:0 32px 48px;
  gap:var(--xd-s5);
}

/* 页头：设计稿 .mhead —— padding 24 32 16，下留 16 */
.dsm-xdpool-pagehead{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:var(--xd-s4);
  padding:var(--xd-s5) var(--xd-s6) var(--xd-s4);
  margin-bottom:16px;
  position:sticky;
  top:0;
  background:var(--xd-ground);
  z-index:5;
  flex-wrap:wrap;
}
.dsm-xdpool-pagetitles{
  display:flex;
  align-items:baseline;
  gap:var(--xd-s2);
  flex-wrap:wrap;
  min-width:0;
}
/* 页标题：设计稿 .mhead-name —— 衬线 20px/600，字距 -0.01em */
.dsm-xdpool-pagetitle{
  margin:0;
  font-family:var(--xd-font-head);
  font-size:20px;
  font-weight:600;
  letter-spacing:-0.01em;
  line-height:1.3;
  color:var(--xd-text);
}
/* 组织名：设计稿 .mhead-org —— 12px 淡色，跟在标题同一基线 */
.dsm-xdpool-pageorg{
  font-size:var(--xd-fs-xs);
  line-height:1.3;
  color:var(--xd-faint);
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.dsm-xdpool-pills{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap}
.dsm-xdpool-pageactions{display:flex;gap:var(--xd-s2);flex-wrap:wrap}

.dsm-xdpool-shellpanel{
  flex:1 1 auto;min-height:0;min-width:0;
  overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;
}
.dsm-xdpool-shellpanel::-webkit-scrollbar{width:8px}
.dsm-xdpool-shellpanel::-webkit-scrollbar-thumb{background:#ffffff1f;border-radius:999px}

/* ---- dock: narrow screens only ------------------------------------------ */
.dsm-xdpool-dock{display:none}

@media (max-width:720px){
  .dsm-xdpool-frame{
    grid-template-columns:minmax(0,1fr);
    grid-template-rows:minmax(0,1fr);
    padding:10px 10px calc(var(--dock-height) + 12px);gap:0;
  }
  /*
    窄屏：导航行搬进底部 dock，但品牌区留着。

    头像和版本号不能一起藏掉 —— 它们不是装饰：头像回首页，版本号是检查更新的入口。
    整条 nav 一旦设为 display:none，第三层布局里那两个功能就没有第二个地方可去。
    所以这里只藏导航列表，把 nav 自己改成一条窄顶栏。
  */
  .dsm-xdpool-shellnav{
    display:flex;flex-direction:row;align-items:center;
    gap:var(--xd-s2);padding:0 0 8px;
    border-right:0;border-bottom:1px solid var(--xd-line);
    overflow:visible;
  }
  .dsm-xdpool-shellnavlist{display:none}
  .dsm-xdpool-shellbrand{padding:0;gap:var(--xd-s2)}
  .dsm-xdpool-shellbrandtitle{font-size:14px}
  /* 底部的 Star / 交流群 / 侧栏入口：窄屏移到品牌行右侧，仍然点得到 */
  .dsm-xdpool-shelllinks{
    margin-top:0;margin-left:auto;flex-direction:row;align-items:center;gap:6px;
  }
  .dsm-xdpool-shelllinks .dsm-xdpool-star{
    padding:5px 9px;font-size:var(--xd-fs-xs);
  }
  .dsm-xdpool-shelllinks .dsm-xdpool-star span{display:none}
  .dsm-xdpool-shellpanel{padding-bottom:4px}
  .dsm-xdpool-dock{
    display:flex;position:fixed;left:8px;right:8px;bottom:8px;
    height:var(--dock-height);align-items:center;justify-content:space-around;gap:2px;
    padding:0 6px;border-radius:12px;
    border:1px solid var(--xd-divider);
    background:color-mix(in srgb,var(--xd-surface) 88%,transparent);
    backdrop-filter:blur(12px);box-shadow:0 6px 24px #00000059;z-index:20;
  }
  .dsm-xdpool-dockbtn{
    display:flex;align-items:center;justify-content:center;
    flex:1 1 0;min-width:0;height:40px;border:0;border-radius:8px;
    background:transparent;color:var(--xd-faint);
    font:inherit;cursor:pointer;transition:background var(--xd-dur-sm) var(--xd-ease-out),color var(--xd-dur-sm) var(--xd-ease-out);
  }
  .dsm-xdpool-dockbtn[data-active="true"]{
    background:var(--xd-surface-2);color:var(--xd-text);
  }
  /*
    收窄侧栏时头像要占满顶部这一条件，在 dock 上体现为：图标一行，下面跟版本号。

    版本号保留字号 12 —— 它是「检查更新」的入口，缩到 8px 既不合规也点不准。
  */
  .dsm-xdpool-dockver{
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:0;flex:0 0 auto;padding:0 8px;min-height:32px;
    border:0;border-radius:8px;background:transparent;
    cursor:pointer;font:inherit;
    transition:background var(--xd-dur-sm) var(--xd-ease-out);
  }
  .dsm-xdpool-dockver:hover{background:var(--xd-surface-2)}
  /* 12px：它既是文字也是按钮，缩到 8px 既不合规也点不准 */
  .dsm-xdpool-dockvernum{
    font-size:var(--xd-fs-xs);line-height:16px;font-weight:500;
    color:var(--xd-muted);
    font-variant-numeric:tabular-nums;
    white-space:nowrap;
  }
  .dsm-xdpool-dockglyph{font-size:var(--xd-fs-sm);font-weight:600;line-height:1}
}

@media (prefers-reduced-motion:reduce){
  .dsm-xdpool-shellnavrow,.dsm-xdpool-dockbtn{transition:none}
}

${CONTINUOUS}
`


/** The shell styles, under the name the tests and older imports use. */
export const SHELL_CSS = SHELL_FRAME_CSS


/** The colour, type and radius tokens the frame and the cards share. */
export { TOKENS_CSS } from './tokens.ts'
