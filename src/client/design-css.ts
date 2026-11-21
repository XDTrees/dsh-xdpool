/**
 * 设计稿样式，原样接管。
 *
 * 来源：xdpool-design 的 tokens.css / app.css / channel-colors.css / build-a.mjs。
 * 改样式请改设计稿源文件，再跑 scripts/extract-design-css.mjs。
 */
export const DESIGN_TOKENS_CSS = `/* XD Pool 设计变量
   ============================================================
   方向：克制 · 精密 · 工具感
   坐标：Linear 的克制、Arc 的空间感、Apple 的精致度

   三条硬规则
   1. 不用纯黑纯白。底色是近黑的冷蓝（色相 250），文字是带底色的近白。
   2. 分层靠明度，不靠边框。四层表面亮度递增 4%，边界自然出现。
   3. 边框是 1px 半透明白，像一道极细的亮边，不是灰线。

   主色的克制
   冷青 oklch(72% 0.060 195)，饱和度只有常见「AI 绿」的四成。
   它只出现在四个地方：开关打开态、进度条、主按钮、在线状态点。
   其余全部是无彩色 —— 工具不该有品牌色铺满屏。
   ============================================================ */
:root {
  /* ---- 表面：四层，亮度递进 ---- */
  --bg: oklch(12.5% 0.008 175);          /* 页面底 */
  --surface: oklch(16.5% 0.009 175);     /* 卡片 */
  --surface-2: oklch(20% 0.010 175);     /* 卡片内嵌层 / 表头 */
  --surface-3: oklch(24% 0.011 175);     /* 控件底 / 进度槽 */

  /* ---- 文字：三档，全部带底色 ---- */
  --text: oklch(96% 0.003 175);          /* 主文字，不用纯白 */
  --muted: oklch(73% 0.008 175);         /* 次要 */
  --faint: oklch(63% 0.008 175);         /* 标签、单位、弱提示 */

  /* ---- 分隔线：半透明，永远不实色 ---- */
  --line: oklch(100% 0 0 / 0.06);
  --line-2: oklch(100% 0 0 / 0.11);
  --line-3: oklch(100% 0 0 / 0.18);      /* 只在必须被看见处 */

  /* ---- 主色：冷青，低饱和 ---- */
  --accent: oklch(74% 0.085 165);
  --accent-strong: oklch(80% 0.090 165);  /* hover */
  --accent-dim: oklch(74% 0.085 165 / 0.13);
  --accent-line: oklch(74% 0.085 165 / 0.40);
  --accent-ink: oklch(14% 0.018 165);     /* 主色上的字：深墨 */

  /* ---- 状态色：同样低饱和 ---- */
  --ok: oklch(70% 0.070 160);
  --warn: oklch(76% 0.080 82);
  --danger: oklch(64% 0.110 25);
  --info: oklch(70% 0.055 245);

  /* ---- 字体 ---- */
  --sans: "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  /* 标题用同一套，但字重更重、字距更紧 —— 截图里那个标题的分量感就在这 */
  /* 标题用衬线：中文思源宋体，西文 Tiempos 那一路。
     这是 Claude 的做法 —— 正文黑体保证易读，标题衬线给出分量和出版感。 */
  --sans-head: "Source Han Serif SC", "Noto Serif SC", "Songti SC", "SimSun", Georgia, "Times New Roman", serif;
  --mono: "JetBrains Mono", "SF Mono", "Cascadia Code", ui-monospace, Menlo, monospace;

  /* ---- 字号：五档，克制 ---- */
  --fs-xs: 12px;    /* 标签、单位、辅助 */
  --fs-sm: 13px;    /* 正文、按钮、行 */
  /* 标题 */
  --fs-md: 15px;
  --fs-lg: 18px;
  --fs-xl: 22px;    /* 汇总数字 */

  /* ---- 间距：4 的倍数 ---- */
  --s1: 4px;
  --s2: 8px;
  --s3: 12px;
  --s4: 16px;
  --s5: 24px;
  --s6: 32px;
  --s7: 48px;

  /* ---- 圆角：三档 ---- */
  --r-sm: 6px;
  --r-md: 9px;
  --r-lg: 12px;
  --r-pill: 999px;

  /* ---- 阴影：带冷调，不用纯黑 ---- */
  --sh-sm: 0 1px 2px oklch(8% 0.01 250 / 0.28);
  --sh-md: 0 4px 14px oklch(8% 0.01 250 / 0.32), 0 1px 3px oklch(8% 0.01 250 / 0.24);
  --sh-lg: 0 18px 44px oklch(8% 0.01 250 / 0.46), 0 2px 8px oklch(8% 0.01 250 / 0.28);

  /* ---- 尺寸 · 动效 ---- */
  --rail-w: 200px;
  --list-w: 264px;
  --ease: cubic-bezier(.2, .8, .2, 1);
  --t-fast: 140ms;
  --t-base: 200ms;
  --t-slow: 260ms;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  font-size: var(--fs-sm);
  line-height: 1.65;         /* 放宽，密集信息需要呼吸 */
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

button, input, select { font-family: inherit; }
button { cursor: pointer; }

/* 数字等宽：刷新时不左右跳 */
.num { font-variant-numeric: tabular-nums; }

/* 焦点环：只给键盘用户 */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* 滚动条：细、半透明、悬停变亮 */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: oklch(100% 0 0 / 0.08);
  border-radius: var(--r-pill);
  border: 3px solid transparent;
  background-clip: content-box;
  transition: background var(--t-fast) var(--ease);
}
::-webkit-scrollbar-thumb:hover { background: oklch(100% 0 0 / 0.16); background-clip: content-box; }

@media (prefers-reduced-motion: reduce) {
  * { transition-duration: 1ms !important; animation-duration: 1ms !important; }
}

/* 渠道品牌色：取自项目 channel-roster.ts 的 accent
   深色背景下提亮到 72% 左右，否则原色显得脏
   每个渠道两档：--c-<id> 主色，--c-<id>-soft 10% 透明版（做柱子和进度条底） */
:root{
  --c-codearts: oklch(70% 0.145 28);
  --c-buddy: oklch(78% 0.145 258);
  --c-workbuddy: oklch(70% 0.145 258);
  --c-lobsterai: oklch(78% 0.145 45);
  --c-qoder: oklch(74% 0.145 279);
  --c-qodercn: oklch(78% 0.145 284);
  --c-trae: oklch(78% 0.121 179);
  --c-cline: oklch(72% 0.145 278);
  --c-loomy: oklch(76% 0.145 264);
  --c-raccoon: oklch(78% 0.103 195);
  --c-minimax: oklch(78% 0.145 358);
  --c-zcode: oklch(76% 0.145 265);
  --c-gemini: oklch(78% 0.145 260);
  --c-autoclaw: oklch(78% 0.145 260);
  --c-autoclaw-cn: oklch(78% 0.132 255);
  --c-baizhi: oklch(78% 0.145 261);
  --c-monkeycode: oklch(78% 0.145 286);
  --c-monkeycode-intl: oklch(78% 0.145 291);
  --c-accio: oklch(78% 0.145 45);
  --c-astudio: oklch(76% 0.145 261);
  --c-marvis: oklch(68% 0.145 261);
  --c-doubao: oklch(68% 0.138 264);
}
`

export const DESIGN_DETAIL_CSS = `/* XD Pool 公共骨架
   ============================================================
   三层布局：功能页 · 条目栏 · 内容

   分层的做法：四层表面亮度递进（12.5% → 16.5% → 20% → 24%），
   边界自然出现，不需要画粗边框。只有真正的分隔才用 1px 半透明白。
   ============================================================ */

.app {
  display: grid;
  grid-template-columns: var(--rail-w) var(--list-w) minmax(0, 1fr);
  height: 100vh;
  overflow: hidden;
}
/* 两栏：没有条目栏的页面 */
.app-wide { grid-template-columns: var(--rail-w) minmax(0, 1fr); }

/* ============================================================
   第一层：功能页
   ============================================================ */
.rail {
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border-right: 1px solid var(--line);
  padding: var(--s3) var(--s2);
  min-height: 0;
}

.rail-brand {
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: var(--s1) var(--s2) var(--s5);
}
.rail-logo {
  width: 26px;
  height: 26px;
  border-radius: var(--r-md);
  background-image: var(--avatar);
  background-size: cover;
  background-position: center;
  box-shadow: 0 0 0 1px var(--line-2);
}
.rail-name {
  font-family: var(--sans-head);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
}
.rail-ver {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 0;
  background: transparent;
  padding: 0;
  min-height: 24px;
  font-size: var(--fs-xs);
  color: var(--faint);
  font-variant-numeric: tabular-nums;
  text-decoration: none;
  transition: color var(--t-fast) var(--ease);
}
.rail-ver:hover { color: var(--accent); }
.rail-ver svg { width: 10px; height: 10px; opacity: 0.65; }
.rail-ver:hover svg { opacity: 1; }

/* 功能页行：选中只有一道竖条 + 背景微亮 */
.rail-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--s2);
  width: 100%;
  padding: 7px var(--s2);
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--muted);
  font-size: var(--fs-sm);
  text-align: left;
  text-decoration: none;
  transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
}
.rail-item:hover { background: var(--surface); color: var(--text); }
.rail-item[aria-current="page"] {
  background: var(--surface);
  color: var(--text);
  font-weight: 500;
}
/* 选中标记：左侧 2px 竖条 */
.rail-item[aria-current="page"]::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 16px;
  border-radius: var(--r-pill);
  background: var(--accent);
}
.rail-item svg {
  flex: 0 0 15px;
  width: 15px;
  height: 15px;
  opacity: 0.7;
}
.rail-item[aria-current="page"] svg { opacity: 1; color: var(--accent); }
.rail-item .badge {
  margin-left: auto;
  font-size: var(--fs-xs);
  padding: 0 5px;
  border-radius: var(--r-pill);
  background: var(--accent-dim);
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.rail-foot {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-top: var(--s4);
}
.rail-foot .rail-item { font-size: var(--fs-xs); padding: 6px var(--s2); }

/* ============================================================
   第二层：条目栏
   ============================================================ */
.list {
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-right: 1px solid var(--line);
  min-height: 0;
  overflow: hidden;
}

.list-head {
  padding: var(--s4) var(--s3) var(--s3);
  display: flex;
  flex-direction: column;
  gap: var(--s2);
}
.list-title {
  font-family: var(--sans-head);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--text);
}

.list-scroll {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 var(--s2) var(--s4);
}
.list-scroll.app ::-webkit-scrollbar { width: 8px; }

/* 分组标题：小、淡、带点 */
.list-group {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  font-weight: 500;
  letter-spacing: 0.03em;
  color: var(--faint);
  padding: var(--s4) var(--s2) var(--s1);
}
.list-group::before {
  content: '';
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--accent);
  flex: 0 0 auto;
}
.list-group[data-empty="true"]::before { background: var(--line-3); }
.list-group .list-group-n {
  margin-left: auto;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.list-group[data-empty="true"] {
  border-top: 1px solid var(--line);
  margin-top: var(--s3);
  padding-top: var(--s4);
}

/* 条目行 */
.ch {
  display: flex;
  align-items: center;
  gap: var(--s2);
  width: 100%;
  padding: 6px var(--s2);
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--muted);
  font-size: var(--fs-sm);
  text-align: left;
  text-decoration: none;
  min-height: 32px;
  min-width: 0;
  transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
}
.ch:hover { background: var(--surface-2); color: var(--text); }
.ch[aria-current="true"] {
  background: var(--surface-2);
  color: var(--text);
  font-weight: 500;
}
.ch[aria-current="true"] .ch-n { color: var(--accent); }

.ch-mark {
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
  border-radius: var(--r-sm);
  background-color: var(--surface-3);
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
}
.ch-name {
  flex: 1 1 auto;
  min-width: 0;
  /* 名字长了省略，悬停有完整名（列表要一行一个才扫得快） */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ch-n {
  font-size: var(--fs-xs);
  color: var(--faint);
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}
.ch-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--warn);
  flex: 0 0 auto;
}
/* 未登录：图标去色，名字更淡 */
.ch[data-bound="false"] .ch-mark { opacity: 0.4; filter: grayscale(1); }
.ch[data-bound="false"] .ch-name { color: var(--faint); }

/* ============================================================
   内容区
   ============================================================ */
.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}
.main.app ::-webkit-scrollbar { width: 10px; }

.mhead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--s4);
  padding: var(--s5) var(--s6) var(--s4);
  margin-bottom: var(--s4);
  position: sticky;
  top: 0;
  background: var(--bg);
  z-index: 5;
  flex-wrap: wrap;
}
.mhead-title {
  display: flex;
  align-items: baseline;
  gap: var(--s2);
  flex-wrap: wrap;
  min-width: 0;
}
.mhead-name {
  font-family: var(--sans-head);
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
  color: var(--text);
}
.mhead-org { font-size: var(--fs-xs); color: var(--faint); }
.mhead-actions { display: flex; gap: var(--s2); flex-wrap: wrap; }

.mbody {
  padding: 0 var(--s6) var(--s7);
  display: flex;
  flex-direction: column;
  gap: var(--s5);
}

/* ============================================================
   控件
   ============================================================ */

/* 按钮：三种 —— 默认（描边）、主（实心）、危险 */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 12px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line-2);
  background: transparent;
  color: var(--text);
  font-size: var(--fs-xs);
  white-space: nowrap;
  text-decoration: none;
  transition: background var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease);
}
.btn:hover { background: var(--surface); border-color: var(--line-3); }
.btn:disabled { opacity: 0.4; cursor: default; }

.btn-primary {
  background: var(--accent);
  border-color: transparent;
  color: var(--accent-ink);
  font-weight: 600;
}
.btn-primary:hover { background: var(--accent-strong); border-color: transparent; }

.btn-danger { color: var(--danger); border-color: color-mix(in oklch, var(--danger) 32%, transparent); }
.btn-danger:hover {
  background: color-mix(in oklch, var(--danger) 10%, transparent);
  border-color: color-mix(in oklch, var(--danger) 50%, transparent);
}

/* 小按钮 */
.tiny, a.tiny {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
  padding: 0 9px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line-2);
  background: transparent;
  color: var(--muted);
  font-size: var(--fs-xs);
  white-space: nowrap;
  text-decoration: none;
  transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease);
}
.tiny:hover { background: var(--surface-2); color: var(--text); border-color: var(--line-3); }
.tiny-primary {
  border-color: transparent;
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 600;
}
.tiny-primary:hover { background: var(--accent-strong); color: var(--accent-ink); }

/* 状态标签：描边胶囊，不做实色 */
.pill {
  font-size: var(--fs-xs);
  line-height: 16px;
  padding: 0 7px;
  border-radius: var(--r-pill);
  border: 1px solid var(--line-2);
  color: var(--faint);
  white-space: nowrap;
}
.pill[data-tone="ok"] {
  border-color: var(--accent-line);
  background: var(--accent-dim);
  color: var(--accent);
}
.pill[data-tone="warn"] {
  border-color: color-mix(in oklch, var(--warn) 32%, transparent);
  background: color-mix(in oklch, var(--warn) 10%, transparent);
  color: var(--warn);
}
.pill[data-tone="err"] {
  border-color: color-mix(in oklch, var(--danger) 32%, transparent);
  background: color-mix(in oklch, var(--danger) 10%, transparent);
  color: var(--danger);
}

/* 开关：药丸形，滑块带内阴影 */
.sw {
  flex: 0 0 auto;
  width: 40px;
  height: 24px;
  border: 0;
  background: transparent;
  position: relative;
  padding: 0;
  display: grid;
  place-items: center;
}
.sw::before {
  content: '';
  width: 26px;
  height: 15px;
  border-radius: var(--r-pill);
  background: var(--surface-3);
  box-shadow: inset 0 0 0 1px var(--line);
  transition: background var(--t-base) var(--ease);
}
.sw::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 8px;
  width: 12px;
  height: 12px;
  margin-top: -6px;
  border-radius: 50%;
  background: var(--faint);
  box-shadow: 0 1px 2px oklch(0% 0 0 / 0.4), inset 0 1px 0 oklch(100% 0 0 / 0.14);
  transition: transform var(--t-base) var(--ease), background var(--t-base) var(--ease);
}
.sw[aria-checked="true"]::before {
  background: var(--accent);
  box-shadow: none;
}
.sw[aria-checked="true"]::after {
  transform: translateX(12px);
  background: oklch(98% 0 0);
}
.sw:disabled { opacity: 0.4; cursor: default; }

/* 分段控件 */
.seg {
  display: inline-flex;
  background: var(--surface-2);
  border-radius: var(--r-sm);
  padding: 2px;
  gap: 1px;
}
.seg button {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: var(--fs-xs);
  padding: 0 10px;
  min-height: 24px;
  border-radius: 5px;
  transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
}
.seg button:hover { color: var(--text); }
.seg button[aria-pressed="true"] {
  background: var(--surface-3);
  color: var(--text);
  font-weight: 500;
}

/* 搜索框 */
.search {
  padding: 4px 10px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line-2);
  background: var(--surface);
  color: var(--text);
  font-size: var(--fs-xs);
  width: 150px;
  transition: border-color var(--t-fast) var(--ease);
}
.search::placeholder { color: var(--faint); }
.search:focus { outline: none; border-color: var(--accent-line); }

/* 区块 */
.sec { display: flex; flex-direction: column; gap: var(--s3); }
.sec-head {
  display: flex;
  align-items: center;
  gap: var(--s2);
  flex-wrap: wrap;
}
.sec-title {
  font-family: var(--sans-head);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
}
.sec-n {
  font-size: var(--fs-xs);
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}
.sec-actions {
  margin-left: auto;
  display: flex;
  gap: var(--s2);
  align-items: center;
  flex-wrap: wrap;
}

.note {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--muted);
  line-height: 1.7;
  max-width: 62ch;
}
.hint {
  display: flex;
  align-items: flex-start;
  gap: var(--s2);
  padding: var(--s2) var(--s3);
  border-radius: var(--r-sm);
  background: var(--surface);
  font-size: var(--fs-xs);
  color: var(--muted);
  line-height: 1.6;
}
.hint b { color: var(--accent); font-weight: 600; flex: 0 0 auto; }

.card {
  padding: var(--s4);
  border-radius: var(--r-md);
  border: 1px solid var(--line);
  background: var(--surface);
}

/* ============================================================
   数字格
   ============================================================ */
.kpi, .sum-cell {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: var(--s3) var(--s4);
  border-radius: var(--r-md);
  background: var(--surface);
}
.kpi-k, .sum-k {
  font-size: var(--fs-xs);
  color: var(--faint);
  white-space: nowrap;
}
.kpi-v, .sum-v {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.kpi-u, .sum-u {
  font-size: var(--fs-xs);
  font-weight: 400;
  color: var(--faint);
  margin-left: 2px;
}
.kpi-sub, .sum-sub {
  font-size: var(--fs-xs);
  color: var(--faint);
  line-height: 1.5;
}
.kpi-sub[data-tone="ok"], .sum-sub[data-tone="ok"] { color: var(--accent); }
.kpi-sub[data-tone="warn"], .sum-sub[data-tone="warn"] { color: var(--warn); }
.kpi-sub[data-tone="err"], .sum-sub[data-tone="err"] { color: var(--danger); }

/* ============================================================
   浮层小窗
   ============================================================ */
.pop {
  position: absolute;
  z-index: 60;
  width: min(320px, calc(100% - 32px));
  display: flex;
  flex-direction: column;
  gap: var(--s2);
  padding: var(--s4);
  border-radius: var(--r-lg);
  border: 1px solid var(--line-2);
  background: var(--surface-2);
  box-shadow: var(--sh-lg);
  animation: pop-in var(--t-base) var(--ease) both;
}
@keyframes pop-in {
  from { opacity: 0; transform: translateY(-4px) scale(0.985); }
  to { opacity: 1; transform: none; }
}
.pop-head { display: flex; align-items: center; gap: 6px; }
.pop-name {
  flex: 1 1 auto;
  font-size: var(--fs-md);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pop-close {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--faint);
  font-size: 15px;
  line-height: 1;
  transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
}
.pop-close:hover { background: var(--surface-3); color: var(--text); }

/* 键值对 */
.facts { display: flex; flex-direction: column; gap: 5px; margin: 0; }
.fact { display: flex; align-items: baseline; gap: var(--s2); font-size: var(--fs-xs); }
.fact dt { flex: 0 0 auto; color: var(--faint); min-width: 60px; }
.fact dd {
  flex: 1 1 auto;
  margin: 0;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ============================================================
   窄窗口：功能页收成一条 60px 的图标条
   ------------------------------------------------------------
   头像要占满这条带的宽度并居中 —— 缩窄后还留在左上角会显得空。
   版本号保留在头像下面，因为它是「检查更新」的入口，不能丢。
   ============================================================ */
@media (max-width: 1180px) {
  .app { grid-template-columns: 60px 224px minmax(0, 1fr); }

  .rail { padding: 0; align-items: center; }

  /* 品牌区：头像独占顶部，横向撑满 */
  .rail-brand {
    flex-direction: column;
    align-items: center;
    width: 100%;
    gap: 4px;
    padding: var(--s3) 0 var(--s4);
  }
  .rail-logo {
    width: 34px;
    height: 34px;
    border-radius: var(--r-md);
  }
  .rail-name { display: none; }
  /* 版本号仍在（检查更新的入口），保持 12px 和 24 的点击区 */
  .rail-ver {
    font-size: var(--fs-xs);
    min-height: 24px;
    gap: 2px;
    justify-content: center;
    color: var(--muted);
  }
  .rail-ver svg { width: 9px; height: 9px; }

  /* 图标行：居中，正方形 */
  .rail-item {
    justify-content: center;
    padding: 0;
    width: 40px;
    height: 36px;
    margin: 0 auto;
    border-radius: var(--r-sm);
  }
  .rail-item span, .rail-group, .list-sum, .rail-item .badge { display: none; }
  .rail-item svg { width: 17px; height: 17px; }
  /* 选中态的竖条贴到最左 */
  .rail-item[aria-current="page"]::before { left: -10px; }

  .mhead, .mbody { padding-left: var(--s4); padding-right: var(--s4); }
}


/* ============================================================
   标题统一用衬线
   ------------------------------------------------------------
   各页内联样式里可能写了别的大小，这里统一覆盖。
   只覆盖字体族和字距，字号字重留给各页自己定。
   ============================================================ */
.mhead-name,
.list-title,
.sec-title,
.trend-title,
.rank-title,
.rail-name,
.group-title,
.pop-name,
.banner-t,
.kpi-v,
.sum-v {
  font-family: var(--sans-head);
  letter-spacing: 0;
}

/* 数字不要衬线 —— 衬线的数字在小尺寸下会糊 */
.kpi-v, .sum-v, .num, .rank-v, .rank-pct, .col-bar {
  font-family: var(--sans);
}


/* 图表轴：标签永远不压字，容器放不下就横滑 */
.axis{overflow-x:auto;scrollbar-width:none}
.axis.app ::-webkit-scrollbar{display:none}
.axis>span{flex:0 0 auto;white-space:nowrap}

/* ============================================================
   侧栏头部三个数字：账号总数 / 已连 / 积分
   ------------------------------------------------------------
   之前是上下三行（19 账号 / 12 已连 / 共 47.4 万 积分），
   中间空一大截，也分不清哪个是总量。改成三个并排小格，一格一个数。
   ============================================================ */
.list-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  border-radius: var(--r-sm);
  background: var(--line);
  overflow: hidden;
}
.ls {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px var(--s2);
  background: var(--surface);
  min-width: 0;
}
.ls-v {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ls-u {
  font-size: var(--fs-xs);
  font-weight: 400;
  color: var(--faint);
  margin-left: 1px;
}
.ls-k {
  font-size: var(--fs-xs);
  color: var(--faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}


.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s2)}
.kpi{padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;gap:2px}
.kpi-k{font-size:var(--fs-xs);color:var(--faint)}
.kpi-v{font-size:var(--fs-xl);font-weight:600;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
.kpi-u{font-size:var(--fs-xs);font-weight:400;color:var(--faint);margin-left:3px}
.kpi-sub{font-size:var(--fs-xs);color:var(--faint)}

.table{border:1px solid var(--line);border-radius:var(--r-lg);background:var(--surface);overflow:hidden}
.tr{display:grid;gap:var(--s3);align-items:center;padding:var(--s2) var(--s3);min-height:38px;border-bottom:1px solid var(--line);transition:background var(--t-base) var(--ease)}
.tr:last-child{border-bottom:0}
.tr:not(.tr-head):hover{background:var(--surface-2)}
.tr-head{min-height:32px;background:var(--surface-2);font-size:var(--fs-xs);color:var(--faint);font-weight:600}
.td{font-size:var(--fs-sm);font-variant-numeric:tabular-nums;min-width:0}
.td-name{display:flex;align-items:center;gap:var(--s2);min-width:0}
.td-mono{font-family:var(--mono);font-size:var(--fs-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-ch{display:flex;align-items:center;gap:6px;font-size:var(--fs-xs);color:var(--muted);flex:0 0 auto}
.td-ch .m{width:16px;height:16px;border-radius:4px;background-color:var(--surface-3);background-size:contain;background-repeat:no-repeat;background-position:center}
.td-num{text-align:right;color:var(--text)}
.td-dim{text-align:right;color:var(--faint);font-size:var(--fs-xs)}

.bars{display:flex;flex-direction:column;gap:var(--s2)}
.bar{display:grid;grid-template-columns:110px minmax(0,1fr) 68px;gap:var(--s3);align-items:center}
.bar-k{font-size:var(--fs-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-track{height:8px;border-radius:var(--r-pill);background:var(--surface-3);overflow:hidden}
.bar-fill{height:100%;border-radius:var(--r-pill);background:var(--accent)}
.bar-v{font-size:var(--fs-sm);text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}

.accts{
  display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));
  gap:var(--s2);
  /* 每行按内容高度走，展开的卡片只把自己撑高，不拉别人 */
  align-items:start;
  grid-auto-rows:min-content;
}
/* 账号卡：一个总数 + 折起来的明细 */
.acct-total{display:flex;align-items:baseline;gap:4px}
.acct-total-v{font-size:22px;font-weight:700;letter-spacing:-0.03em;font-variant-numeric:tabular-nums;line-height:1.2}
.acct-total-u{font-size:var(--fs-xs);color:var(--faint)}
.acct-detail{position:relative}
/* details 折叠时内容必须真正消失：没有 display:none 的自定义样式会让 dl 仍占位 */
.acct-detail:not([open])>.facts{display:none}
.acct-detail>.facts{
  display:flex;flex-direction:column;gap:4px;margin:0;
  padding:var(--s2);border-radius:var(--r-md);
  background:var(--surface-2);
}
.acct-detail>.facts .fact{display:flex;align-items:baseline;gap:var(--s2);font-size:var(--fs-xs)}
.acct-detail>.facts .fact dt{flex:0 0 auto;color:var(--faint);min-width:56px}
.acct-detail>.facts .fact dd{flex:1 1 auto;margin:0;color:var(--text);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.acct-detail>summary{
  display:inline-flex;align-items:center;gap:4px;
  min-height:24px;padding:0 9px;border-radius:var(--r-sm);
  border:1px solid var(--line-2);background:transparent;
  color:var(--muted);font-size:var(--fs-xs);cursor:pointer;
  list-style:none;
  transition:background var(--t-base) var(--ease),color var(--t-base) var(--ease);
}
.acct-detail>summary::-webkit-details-marker{display:none}
.acct-detail>summary::after{content:'▾';font-size:9px;opacity:.7}
.acct-detail[open]>summary::after{content:'▴'}
.acct-detail>summary:hover{background:var(--surface-2);color:var(--text)}
.acct-detail[open]>summary{margin-bottom:var(--s2)}



.acct{
  padding:var(--s3);border-radius:var(--r-lg);
  border:1px solid var(--line);background:var(--surface);
  display:flex;flex-direction:column;gap:var(--s2);
  position:relative;align-self:start;
  transition:border-color var(--t-base) var(--ease),background var(--t-base) var(--ease);
}
.acct:hover{border-color:oklch(64% .14 155 / .45);background:var(--surface-2)}
.acct-head{display:flex;align-items:center;gap:6px;min-width:0}
.acct-dot{width:6px;height:6px;border-radius:50%;background:var(--accent);flex:0 0 auto}
.acct-name{font-size:var(--fs-md);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:0}
.acct-row{display:flex;align-items:baseline;gap:var(--s2);font-size:var(--fs-sm)}
.acct-k{color:var(--faint);flex:0 0 auto;font-size:var(--fs-xs)}
.acct-v{color:var(--text);font-variant-numeric:tabular-nums}
.acct-soon{color:var(--warn);font-size:var(--fs-xs)}
.acct-bar{height:3px;border-radius:var(--r-pill);background:var(--surface-3);overflow:hidden}
.acct-bar span{display:block;height:100%;border-radius:var(--r-pill);background:var(--accent)}
.acct-more{display:flex;align-items:center;gap:6px;padding-top:var(--s1)}
.tiny{padding:2px 9px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:transparent;color:var(--muted);font-size:var(--fs-xs);line-height:17px;white-space:nowrap;transition:background var(--t-base) var(--ease),color var(--t-base) var(--ease)}
.tiny:hover{background:var(--surface-2);color:var(--text)}
.tiny-primary{border-color:transparent;background:var(--accent);color:var(--accent-ink);font-weight:600}

.models{
  border:1px solid var(--line);
  border-radius:var(--r-md);
  overflow:hidden;
  background:var(--surface);
  min-width:0;
}
.model{
  display:grid;grid-template-columns:auto minmax(0,1fr) auto;
  grid-template-areas:"sw main side";
  align-items:center;gap:0 var(--s3);
  padding:var(--s2) var(--s3);
  border-bottom:1px solid var(--line);
  transition:background var(--t-base) var(--ease);
}
.model:last-child{border-bottom:0}
.model:hover{background:var(--surface-2)}
.model>.sw{grid-area:sw}
.model-main{grid-area:main;display:flex;flex-direction:column;gap:3px;min-width:0}
.model-top{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
.model-name{font-size:var(--fs-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.model[data-off="true"] .model-name{color:var(--faint)}
.model-sub{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.model-side{grid-area:side;display:flex;align-items:center;gap:var(--s2);flex:0 0 auto}

.badge{font-size:12px;line-height:15px;padding:0 5px;border-radius:var(--r-pill);border:1px solid var(--line-2);color:var(--muted);white-space:nowrap;flex:0 0 auto}
.badge[data-kind="free"]{border-color:oklch(64% .14 155/.55);background:var(--accent-dim);color:var(--accent);font-weight:600}
.badge[data-kind="plan"]{border-color:oklch(76% .13 78/.6);background:oklch(76% .13 78/.14);color:var(--warn);font-weight:600}
.badge[data-kind="vision"]{border-color:oklch(70% .1 250/.5);background:oklch(70% .1 250/.12);color:oklch(76% .09 250)}

.model-mult{font-size:var(--fs-xs);color:var(--muted);font-variant-numeric:tabular-nums;flex:0 0 auto}
.model-mult[data-free="true"]{color:var(--accent);font-weight:600}

.ctx-select{
  appearance:none;border:1px solid var(--line-2);
  background-color:var(--surface);color:var(--text);
  font-family:inherit;font-size:var(--fs-xs);
  padding:0 20px 0 7px;min-height:24px;height:24px;border-radius:var(--r-sm);
  cursor:pointer;font-variant-numeric:tabular-nums;
  background-image:linear-gradient(45deg,transparent 50%,var(--faint) 50%),linear-gradient(135deg,var(--faint) 50%,transparent 50%);
  background-position:calc(100% - 11px) 10px,calc(100% - 7px) 10px;
  background-size:4px 4px,4px 4px;background-repeat:no-repeat;
}
.ctx-select:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:transparent}

/* token 型渠道的用量条（Marvis 这类每天给固定 token 的） */
.quota{display:flex;flex-direction:column;gap:3px;width:100%}
.quota-bar{height:4px;border-radius:var(--r-pill);background:var(--surface-3);overflow:hidden}
.quota-bar span{display:block;height:100%;border-radius:var(--r-pill);background:var(--accent)}
.quota-text{
  display:flex;align-items:baseline;gap:5px;
  font-size:var(--fs-xs);color:var(--muted);font-variant-numeric:tabular-nums;
}
.quota-used{color:var(--faint)}
.quota-reset{margin-left:auto;color:var(--faint)}

/* 登录方式标签（Marvis 令牌 / 微信扫码这类） */
.login-kind{
  font-size:12px;line-height:15px;padding:0 5px;border-radius:var(--r-pill);
  border:1px solid var(--line-2);color:var(--faint);white-space:nowrap;
}
.model[data-off="true"] .ctx-select{opacity:.45;pointer-events:none}

.policies{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--s2)}
.policy{padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;gap:var(--s2)}
.policy-k{font-size:var(--fs-xs);color:var(--faint)}
.policy-v{font-size:var(--fs-md);color:var(--text);display:flex;align-items:center;gap:var(--s2)}
.policy-hint{font-size:var(--fs-xs);color:var(--faint);line-height:1.5}
.stack{display:flex;flex-direction:column;gap:var(--s2)}
.row{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.field{display:flex;flex-direction:column;gap:4px}
.field label{font-size:var(--fs-xs);color:var(--faint)}
.input{padding:6px 10px;border-radius:var(--r-md);border:1px solid var(--line-2);background:var(--surface);color:var(--text);font-size:var(--fs-md);font-family:inherit;min-width:0}
.input:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:transparent}


.groups{display:flex;flex-direction:column;gap:var(--s5)}

.group-head{
  display:flex;align-items:center;gap:var(--s2);
  padding-bottom:var(--s2);margin-bottom:var(--s3);
  border-bottom:1px solid var(--line);
}
.group-dot{width:6px;height:6px;border-radius:50%;background:var(--accent);flex:0 0 auto}
.group-dot[data-empty="true"]{background:var(--faint)}
.group-title{font-size:var(--fs-lg);font-weight:600;white-space:nowrap}
.group-n{
  font-size:var(--fs-xs);color:var(--faint);
  background:var(--surface-2);padding:1px 8px;border-radius:var(--r-pill);
  font-variant-numeric:tabular-nums;
}
.group-hint{margin-left:auto;font-size:var(--fs-xs);color:var(--faint)}

.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:var(--s2)}
.card-ch{
  display:flex;flex-direction:column;gap:var(--s2);
  padding:var(--s3);border-radius:var(--r-lg);
  border:1px solid var(--line);background:var(--surface);
  transition:border-color var(--t-base) var(--ease),background var(--t-base) var(--ease);
}
.card-ch:hover{border-color:oklch(64% .14 155 / .45);background:var(--surface-2)}
.ch-head{display:flex;align-items:center;gap:var(--s2);min-width:0}
.ch-logo{
  flex:0 0 32px;width:32px;height:32px;border-radius:var(--r-md);
  background-color:var(--surface-3);
  background-size:contain;background-repeat:no-repeat;background-position:center;
}
.card-ch[data-bound="false"] .ch-logo{opacity:.45;filter:grayscale(1)}
.ch-titles{display:flex;flex-direction:column;gap:0;min-width:0;flex:1 1 auto}
.ch-title{font-size:var(--fs-md);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ch-org{font-size:var(--fs-xs);color:var(--faint)}
.ch-state{
  flex:0 0 auto;font-size:var(--fs-xs);padding:1px 7px;border-radius:var(--r-pill);
  border:1px solid var(--line-2);color:var(--faint);
}
.ch-state[data-bound="true"]{
  border-color:oklch(64% .14 155 / .5);background:var(--accent-dim);
  color:var(--accent);font-weight:600;
}
.ch-note{margin:0;font-size:var(--fs-xs);color:var(--muted);line-height:1.6;min-height:32px}
.ch-foot{display:flex;align-items:center;gap:var(--s2);margin-top:auto}
.ch-count{font-size:var(--fs-xs);color:var(--faint);font-variant-numeric:tabular-nums;margin-right:auto}
.card-ch[data-bound="false"] .ch-title{color:var(--muted)}

/* 备注：每家一句说明，来源是渠道清单里的 note 字段 */


.lane{
  display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap;
  padding:var(--s2) var(--s3);
  border-radius:var(--r-md);
  background:var(--surface);
  border:1px solid var(--line);
}
.lane-t{font-size:var(--fs-sm);font-weight:500;white-space:nowrap}
.lane-d{font-size:var(--fs-xs);color:var(--faint);flex:1 1 auto;min-width:0}

.tabs{
  display:flex;gap:2px;
  background:var(--surface);
  border-radius:var(--r-sm);
  padding:3px;
  overflow-x:auto;scrollbar-width:none;
}
.tabs::-webkit-scrollbar{display:none}
.tab{
  flex:0 0 auto;border:0;background:transparent;
  color:var(--muted);font-size:var(--fs-xs);
  padding:0 11px;min-height:26px;border-radius:4px;
  white-space:nowrap;
  transition:background var(--t-fast) var(--ease),color var(--t-fast) var(--ease);
}
.tab:hover{color:var(--text)}
.tab[aria-pressed="true"]{background:var(--surface-3);color:var(--text);font-weight:500}
.tab .n{font-variant-numeric:tabular-nums;color:var(--faint);margin-left:4px}
.tab[aria-pressed="true"] .n{color:var(--accent)}

.vendors{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(330px,1fr));
  gap:var(--s3);align-items:start;
}
.vd{
  display:flex;flex-direction:column;gap:var(--s2);
  padding:var(--s3);border-radius:var(--r-md);
  overflow:hidden;
  border:1px solid var(--line);background:var(--surface);
  min-width:0;
  transition:border-color var(--t-fast) var(--ease);
}
.vd:hover{border-color:var(--line-2)}
.vd[data-on="true"]{border-color:color-mix(in oklch, var(--accent) 28%, transparent)}

.vd-head{display:flex;align-items:center;gap:var(--s2);min-width:0;flex-wrap:wrap}
.vd-name{
  flex:1 1 auto;min-width:0;font-size:var(--fs-sm);font-weight:500;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.vd-cat{
  flex:0 0 auto;font-size:var(--fs-xs);line-height:16px;
  padding:0 7px;border-radius:var(--r-pill);
  border:1px solid var(--line-2);color:var(--faint);white-space:nowrap;
}
.vd-cat[data-cat="free"]{border-color:var(--accent-line);background:var(--accent-dim);color:var(--accent)}
.vd-cat[data-cat="free-tier"]{
  border-color:color-mix(in oklch, var(--info) 34%, transparent);
  background:color-mix(in oklch, var(--info) 11%, transparent);color:var(--info);
}
.vd-cat[data-cat="oauth"]{
  border-color:color-mix(in oklch, var(--warn) 32%, transparent);
  background:color-mix(in oklch, var(--warn) 10%, transparent);color:var(--warn);
}

.vd-models-line{
  margin:0;
  font-size:var(--fs-xs);color:var(--faint);
  line-height:1.5;
  /* 允许两行，超出就省略 —— 不硬切一眼 */
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
  overflow:hidden;word-break:break-word;
}

.vd-key-row{display:flex;gap:5px;align-items:center}
.vd-input{
  flex:1 1 auto;min-width:0;
  padding:4px 9px;min-height:26px;
  border-radius:var(--r-sm);border:1px solid var(--line-2);
  background:var(--bg);color:var(--text);
  font-size:var(--fs-xs);font-family:var(--mono);
  transition:border-color var(--t-fast) var(--ease);
}
.vd-input::placeholder{color:var(--faint);font-family:var(--sans)}
.vd-input:focus{outline:none;border-color:var(--accent-line)}
.vd-input[data-set="true"]{border-color:var(--accent-line);background:var(--accent-dim);color:var(--accent)}

.vd-keys{display:flex;flex-wrap:wrap;gap:4px}
.vd-key-tag{
  display:inline-flex;align-items:center;gap:2px;
  font-size:var(--fs-xs);font-family:var(--mono);
  padding:0 2px 0 6px;border-radius:var(--r-sm);
  background:var(--surface-2);color:var(--muted);
}
.vd-key-tag button{
  border:0;background:transparent;color:var(--faint);
  width:24px;height:24px;display:grid;place-items:center;
  border-radius:4px;font-size:13px;line-height:1;padding:0;
}
.vd-key-tag button:hover{
  background:color-mix(in oklch, var(--danger) 14%, transparent);
  color:var(--danger);
}

.vd-foot{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap;margin-top:auto;padding-top:var(--s2)}
.vd-state{display:flex;align-items:center;gap:5px;font-size:var(--fs-xs);color:var(--faint)}
.vd-state[data-on="true"]{color:var(--accent)}
.vd-state::before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor;flex:0 0 auto}
.vd-n{font-size:var(--fs-xs);color:var(--faint);font-variant-numeric:tabular-nums}
.vd-actions{margin-left:auto;display:flex;gap:5px;align-items:center}

@media (max-width:1180px){ .vendors{grid-template-columns:minmax(0,1fr)} }


/* 弹层：贴着页面居中，模拟真实弹窗 */
.pick-wrap{
  position:relative;
  display:grid;place-items:center;
  min-height:640px;
  padding:var(--s5);
  border:1px dashed var(--line-2);
  border-radius:var(--r-lg);
  background:var(--surface);
}
.pick-note{
  position:absolute;left:var(--s4);top:var(--s3);
  font-size:var(--fs-xs);color:var(--faint);
}
.pick{
  position:relative;
  width:min(520px,100%);
  /* 必须有确定高度，否则 flex 列表压不住内容 */
  height:560px;
  display:flex;flex-direction:column;
  border-radius:var(--r-lg);
  border:1px solid var(--line-2);
  background:var(--surface-2);
  box-shadow:var(--sh-lg);
  overflow:hidden;
  animation:pk-in var(--t-base) var(--ease) both;
}
@keyframes pk-in{from{opacity:0;transform:translateY(-6px) scale(.99)}to{opacity:1;transform:none}}

.pick-head{
  flex:0 0 auto;
  display:flex;align-items:center;gap:var(--s2);
  padding:var(--s3) var(--s4);
  border-bottom:1px solid var(--line);
}
.pick-title{
  font-family:var(--sans-head);
  font-size:15px;font-weight:600;
  flex:1 1 auto;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.pick-close{
  flex:0 0 auto;width:24px;height:24px;
  border:0;border-radius:var(--r-sm);
  background:transparent;color:var(--faint);
  font-size:15px;line-height:1;display:grid;place-items:center;
  transition:background var(--t-fast) var(--ease),color var(--t-fast) var(--ease);
}
.pick-close:hover{background:var(--surface-3);color:var(--text)}

.pick-tools{
  flex:0 0 auto;
  display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap;
  padding:var(--s2) var(--s4);
  border-bottom:1px solid var(--line);
  background:var(--surface);
}
.pick-sum{
  font-size:var(--fs-xs);color:var(--faint);
  font-variant-numeric:tabular-nums;
  flex:0 0 auto;
}
.pick-sum b{color:var(--accent);font-weight:600}
.pick-tools .search{margin-left:auto}

/* 模型列表 */
.pick-list{
  /* flex-basis 0 才会给 foot 留出位置；auto 会按内容撑，压到 foot 上 */
  flex:1 1 0;min-height:0;
  overflow-y:auto;
  /* 底部留够：滚到底时最后一行不能被 foot 压住 */
  padding:var(--s1) var(--s2) var(--s3);
}
.mp-row{
  display:flex;align-items:flex-start;gap:var(--s2);
  padding:7px var(--s2);
  border-radius:var(--r-sm);
  cursor:pointer;
  transition:background var(--t-fast) var(--ease);
}
.mp-row:hover{background:var(--surface-3)}
.mp-row input{
  flex:0 0 auto;
  /* 视觉 14，点击区 24（用 padding 撑，不影响对齐） */
  width:24px;height:24px;
  margin:-4px -5px -4px -5px;
  accent-color:var(--accent);
  cursor:pointer;
}
.mp-main{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1 1 auto}
.mp-name{
  font-size:var(--fs-sm);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.mp-id{
  font-size:var(--fs-xs);color:var(--faint);
  font-family:var(--mono);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.mp-tags{display:flex;gap:3px;flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end}
.mp-tag{
  font-size:var(--fs-xs);line-height:15px;
  padding:0 5px;border-radius:var(--r-pill);
  border:1px solid var(--line-2);color:var(--faint);
  white-space:nowrap;
}
.mp-tag[data-k="vis"]{
  border-color:color-mix(in oklch, var(--info) 34%, transparent);
  background:color-mix(in oklch, var(--info) 10%, transparent);color:var(--info);
}
.mp-tag[data-k="rz"]{
  border-color:color-mix(in oklch, var(--warn) 30%, transparent);
  background:color-mix(in oklch, var(--warn) 9%, transparent);color:var(--warn);
}

.pick-foot{
  flex:0 0 auto;
  position:relative;z-index:2;
  display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap;
  padding:var(--s3) var(--s4);
  border-top:1px solid var(--line);
  background:var(--surface);
}
.pick-hint{font-size:var(--fs-xs);color:var(--faint);flex:1 1 120px;min-width:0}
.pick-actions{display:flex;gap:var(--s2);margin-left:auto}
.pick-hint{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}


/* ---- 汇总条 ---- */
.summary{
  display:grid;grid-template-columns:repeat(6,minmax(0,1fr));
  gap:1px;border:1px solid var(--line);border-radius:var(--r-lg);
  background:var(--line);overflow:hidden;
}
.sum-cell{
  display:flex;flex-direction:column;gap:3px;
  padding:var(--s3);background:var(--surface);
}
.sum-k{font-size:var(--fs-xs);color:var(--faint);white-space:nowrap}
.sum-v{
  font-size:var(--fs-xl);font-weight:600;letter-spacing:-0.02em;
  font-variant-numeric:tabular-nums;line-height:1.25;
}
.sum-u{font-size:var(--fs-xs);font-weight:400;color:var(--faint);margin-left:2px}
.sum-sub{font-size:var(--fs-xs);color:var(--faint);line-height:1.55}

/* 1280 这类宽度下六列放不下副标题，退成三列 */
@media (max-width:1380px){
  .summary{grid-template-columns:repeat(3,minmax(0,1fr))}
}
/* 900-1100：两列副标题放不下，退成单列才不至于折行 */
@media (max-width:1100px){
  .summary{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:980px){
  .summary{grid-template-columns:minmax(0,1fr)}
  .sum-cell{padding:var(--s2) var(--s3)}
}
/* 轴标签宁可横滑，也不要把字挤断 */

.axis::-webkit-scrollbar{display:none}

@media (max-width:900px){
  .summary{grid-template-columns:repeat(2,minmax(0,1fr))}
}
.sum-sub[data-tone="ok"]{color:var(--accent)}
.sum-sub[data-tone="warn"]{color:var(--warn)}
.sum-sub[data-tone="err"]{color:var(--danger)}

/* ---- 趋势 ---- */
.trend{
  border:1px solid var(--line);border-radius:var(--r-lg);
  background:var(--surface);padding:var(--s3);
  display:flex;flex-direction:column;gap:var(--s3);
}
.trend-head{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.trend-title{font-size:var(--fs-md);font-weight:600}
.trend-actions{margin-left:auto;display:flex;gap:var(--s2)}
.chart{
  display:flex;align-items:flex-end;gap:4px;
  height:130px;padding-top:var(--s2);
  border-bottom:1px solid var(--line);
}
.col{
  display:flex;flex-direction:column;justify-content:flex-end;gap:2px;
  flex:1 1 0;min-width:0;height:100%;
}
.col-bar{border-radius:2px 2px 0 0;background:var(--accent);min-height:2px;flex:0 0 auto;transition:background var(--t-base) var(--ease)}
.col-bar[data-kind="in"]{background:oklch(64% .14 155/.55)}
.col-bar[data-kind="out"]{background:var(--accent)}
.col:hover .col-bar{background:oklch(72% .14 155)}
.axis{
  display:flex;gap:4px;
  font-size:var(--fs-xs);color:var(--faint);
  overflow-x:auto;scrollbar-width:none;
}
.axis::-webkit-scrollbar{display:none}
.axis span{white-space:nowrap}
.axis span{flex:0 0 auto;text-align:center;white-space:nowrap;min-width:40px}

/* ---- 榜单 ---- */
.ranks{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:var(--s3)}
.rank{
  border:1px solid var(--line);border-radius:var(--r-lg);
  background:var(--surface);overflow:hidden;
  display:flex;flex-direction:column;
}
.rank-head{
  display:flex;align-items:center;gap:var(--s2);
  padding:var(--s2) var(--s3);
  border-bottom:1px solid var(--line);
  background:var(--surface-2);
}
.rank-title{font-size:var(--fs-md);font-weight:600}
.rank-n{font-size:var(--fs-xs);color:var(--faint);margin-left:auto;font-variant-numeric:tabular-nums}
.rank-row{
  display:grid;grid-template-columns:20px minmax(0,1fr) 72px 64px;
  gap:var(--s2);align-items:center;
  padding:var(--s2) var(--s3);min-height:40px;
  border-bottom:1px solid var(--line);
  transition:background var(--t-base) var(--ease);
}
.rank-row:last-child{border-bottom:0}
.rank-row:hover{background:var(--surface-2)}
.rank-icon{width:20px;height:20px;border-radius:var(--r-sm);background-color:var(--surface-3);background-size:contain;background-repeat:no-repeat;background-position:center}
.rank-body{display:flex;flex-direction:column;gap:3px;min-width:0}
.rank-name{font-size:var(--fs-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rank-bar{height:3px;border-radius:var(--r-pill);background:var(--surface-3);overflow:hidden}
.rank-bar span{display:block;height:100%;border-radius:var(--r-pill);background:var(--accent)}
.rank-v{font-size:var(--fs-sm);text-align:right;font-variant-numeric:tabular-nums}
.rank-pct{font-size:var(--fs-xs);text-align:right;color:var(--faint);font-variant-numeric:tabular-nums}

/* ---- 明细表 ---- */
.table{
  border:1px solid var(--line);
  border-radius:var(--r-md);
  background:var(--surface);
  overflow:hidden;
}
/* 明细表五列加起来有最小宽度，窄了让整个表横滑，别把字挤没 */
.table-scroll{overflow-x:auto;scrollbar-width:none}
.table-scroll::-webkit-scrollbar{display:none}
.tr{display:grid;gap:var(--s3);align-items:center;padding:var(--s2) var(--s3);min-height:40px;border-bottom:1px solid var(--line);min-width:520px;transition:background var(--t-base) var(--ease)}
.tr:last-child{border-bottom:0}
.tr:not(.tr-head):hover{background:var(--surface-2)}
.tr-head{min-height:32px;background:var(--surface-2);font-size:var(--fs-xs);color:var(--faint);font-weight:600}
.td{font-size:var(--fs-sm);min-width:0}
.td-mono{font-family:var(--mono);font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-num{text-align:right;font-variant-numeric:tabular-nums}
.td-dim{text-align:right;color:var(--faint);font-size:var(--fs-xs);font-variant-numeric:tabular-nums}
.td-ch{display:flex;align-items:center;gap:6px;font-size:var(--fs-xs);color:var(--muted);flex:0 0 auto}
.td-ch .m{width:16px;height:16px;border-radius:4px;background-color:var(--surface-3);background-size:contain;background-repeat:no-repeat;background-position:center}

/* ---- 筛选条 ---- */
.filters{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.chip{
  font-size:var(--fs-xs);padding:0 9px;min-height:24px;
  display:inline-flex;align-items:center;
  border-radius:var(--r-pill);border:1px solid var(--line-2);
  background:transparent;color:var(--muted);
  transition:background var(--t-base) var(--ease),color var(--t-base) var(--ease);
}
.chip:hover{background:var(--surface-2);color:var(--text)}
.chip[aria-pressed="true"]{background:var(--accent-dim);border-color:oklch(64% .14 155/.5);color:var(--accent);font-weight:600}


.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s2)}
.kpi{padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;gap:2px}
.kpi-k{font-size:var(--fs-xs);color:var(--faint)}
.kpi-v{font-size:var(--fs-xl);font-weight:600;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
.kpi-u{font-size:var(--fs-xs);font-weight:400;color:var(--faint);margin-left:3px}
.kpi-sub{font-size:var(--fs-xs);color:var(--faint)}

.table{border:1px solid var(--line);border-radius:var(--r-lg);background:var(--surface);overflow:hidden}
.tr{display:grid;gap:var(--s3);align-items:center;padding:var(--s2) var(--s3);min-height:40px;border-bottom:1px solid var(--line);transition:background var(--t-base) var(--ease)}
.tr:last-child{border-bottom:0}
.tr:not(.tr-head):hover{background:var(--surface-2)}
.tr-head{min-height:32px;background:var(--surface-2);font-size:var(--fs-xs);color:var(--faint);font-weight:600}
.td{font-size:var(--fs-sm);min-width:0}
.td-mono{font-family:var(--mono);font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-num{text-align:right;font-variant-numeric:tabular-nums}
.td-dim{text-align:right;color:var(--faint);font-size:var(--fs-xs);font-variant-numeric:tabular-nums}

.row{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.stack{display:flex;flex-direction:column;gap:var(--s2)}
.field{display:flex;flex-direction:column;gap:4px;min-width:0}
.field label{font-size:var(--fs-xs);color:var(--faint)}
.input,.select{padding:6px 10px;border-radius:var(--r-md);border:1px solid var(--line-2);background:var(--surface);color:var(--text);font-size:var(--fs-md);font-family:inherit;min-width:0;width:100%}
.input:focus,.select:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:transparent}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:var(--s3)}

.kv{display:grid;grid-template-columns:104px minmax(0,1fr);gap:var(--s2) var(--s3);font-size:var(--fs-sm)}
.kv dt{color:var(--faint);font-size:var(--fs-xs)}
.kv dd{margin:0;color:var(--text);font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis}
.mono{font-family:var(--mono);font-size:var(--fs-xs)}

.banner{display:flex;align-items:flex-start;gap:var(--s3);padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface)}
.banner-icon{flex:0 0 32px;width:32px;height:32px;border-radius:var(--r-md);background:var(--surface-3);display:grid;place-items:center;color:var(--accent)}
.banner-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.banner-t{font-size:var(--fs-md);font-weight:600}
.banner-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}

.steps{display:flex;flex-direction:column;gap:var(--s3)}
.step{display:flex;gap:var(--s3);align-items:flex-start}
.step-n{flex:0 0 22px;width:22px;height:22px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:grid;place-items:center;font-size:var(--fs-xs);font-weight:700}
.step-b{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 auto}
.step-t{font-size:var(--fs-md);font-weight:500}
.step-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}


.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s2)}
.kpi{padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;gap:2px}
.kpi-k{font-size:var(--fs-xs);color:var(--faint)}
.kpi-v{font-size:var(--fs-xl);font-weight:600;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
.kpi-u{font-size:var(--fs-xs);font-weight:400;color:var(--faint);margin-left:3px}
.kpi-sub{font-size:var(--fs-xs);color:var(--faint)}

.table{border:1px solid var(--line);border-radius:var(--r-lg);background:var(--surface);overflow:hidden}
.tr{display:grid;gap:var(--s3);align-items:center;padding:var(--s2) var(--s3);min-height:40px;border-bottom:1px solid var(--line);transition:background var(--t-base) var(--ease)}
.tr:last-child{border-bottom:0}
.tr:not(.tr-head):hover{background:var(--surface-2)}
.tr-head{min-height:32px;background:var(--surface-2);font-size:var(--fs-xs);color:var(--faint);font-weight:600}
.td{font-size:var(--fs-sm);min-width:0}
.td-mono{font-family:var(--mono);font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-num{text-align:right;font-variant-numeric:tabular-nums}
.td-dim{text-align:right;color:var(--faint);font-size:var(--fs-xs)}

.row{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.stack{display:flex;flex-direction:column;gap:var(--s2)}
.field{display:flex;flex-direction:column;gap:4px;min-width:0}
.field label{font-size:var(--fs-xs);color:var(--faint)}
.input,.select{padding:6px 10px;border-radius:var(--r-md);border:1px solid var(--line-2);background:var(--surface);color:var(--text);font-size:var(--fs-md);font-family:inherit;min-width:0;width:100%}
.input:focus,.select:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:transparent}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:var(--s3)}

.kv{display:grid;grid-template-columns:120px minmax(0,1fr);gap:var(--s2) var(--s3);font-size:var(--fs-sm);margin:0}
.kv dt{color:var(--faint);font-size:var(--fs-xs)}
.kv dd{margin:0;color:var(--text);font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis}
.mono{font-family:var(--mono);font-size:var(--fs-xs)}

.banner{display:flex;align-items:flex-start;gap:var(--s3);padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface)}
.banner-icon{flex:0 0 32px;width:32px;height:32px;border-radius:var(--r-md);background:var(--surface-3);display:grid;place-items:center;color:var(--accent)}
.banner-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.banner-t{font-size:var(--fs-md);font-weight:600}
.banner-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}

.steps{display:flex;flex-direction:column;gap:var(--s3)}
.step{display:flex;gap:var(--s3);align-items:flex-start}
.step-n{flex:0 0 22px;width:22px;height:22px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:grid;place-items:center;font-size:var(--fs-xs);font-weight:700}
.step-b{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 auto}
.step-t{font-size:var(--fs-md);font-weight:500}
.step-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}

.code{
  padding:var(--s3);border-radius:var(--r-md);
  background:var(--bg);border:1px solid var(--line);
  font-family:var(--mono);font-size:var(--fs-xs);line-height:1.7;
  color:var(--muted);overflow-x:auto;white-space:pre;
}
.code b{color:var(--accent);font-weight:600}


.pop-wrap{
  position:relative;min-height:420px;
  display:grid;place-items:center;
  border:1px dashed var(--line-2);border-radius:var(--r-lg);
  background:var(--surface-2);
  padding:var(--s6);
}
.pop-note{
  position:absolute;left:var(--s4);top:var(--s3);
  font-size:var(--fs-xs);color:var(--faint);
}
.pop{
  position:relative;width:min(340px,100%);
  display:flex;flex-direction:column;gap:var(--s3);
  padding:var(--s4);border-radius:var(--r-lg);
  border:1px solid var(--line-2);background:var(--surface);
  box-shadow:var(--sh-lg);
  animation:pop-in 140ms var(--ease) both;
}
@keyframes pop-in{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
.pop-head{display:flex;align-items:center;gap:var(--s2)}
.pop-name{flex:1 1 auto;font-size:var(--fs-lg);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pop-close{flex:0 0 auto;width:26px;height:26px;border:0;border-radius:var(--r-sm);background:transparent;color:var(--faint);font-size:16px;line-height:1;transition:background var(--t-base) var(--ease)}
.pop-close:hover{background:var(--surface-2);color:var(--text)}
.facts{display:flex;flex-direction:column;gap:6px;margin:0}
.fact{display:flex;align-items:baseline;gap:var(--s2);font-size:var(--fs-sm)}
.fact dt{flex:0 0 auto;color:var(--faint);font-size:var(--fs-xs);min-width:64px}
.fact dd{flex:1 1 auto;margin:0;color:var(--text);font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pop-actions{display:flex;gap:var(--s2);padding-top:var(--s1);border-top:1px solid var(--line)}

.qr{
  width:180px;height:180px;border-radius:var(--r-md);
  background:#fff;display:grid;place-items:center;
  margin:0 auto;
  color:#111;font-size:var(--fs-xs);text-align:center;line-height:1.6;
}
.qr-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--s3)}
.qr-item{display:flex;flex-direction:column;align-items:center;gap:var(--s2);min-width:0}
.qr-label{font-size:var(--fs-sm);font-weight:600}
.qr-step{font-size:var(--fs-xs);color:var(--muted);text-align:center;line-height:1.5}

.steps{display:flex;flex-direction:column;gap:var(--s3)}
.step{display:flex;gap:var(--s3);align-items:flex-start}
.step-n{flex:0 0 22px;width:22px;height:22px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:grid;place-items:center;font-size:var(--fs-xs);font-weight:700}
.step-n[data-done="true"]{background:var(--accent);color:var(--accent-ink)}
.step-n[data-wait="true"]{background:var(--surface-3);color:var(--muted)}
.step-b{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 auto}
.step-t{font-size:var(--fs-md);font-weight:500}
.step-t[data-wait="true"]{color:var(--faint)}
.step-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}

.spinner{
  width:14px;height:14px;border-radius:50%;
  border:2px solid var(--line-2);border-top-color:var(--accent);
  animation:spin .9s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg)}}

.banner{display:flex;align-items:flex-start;gap:var(--s3);padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface)}
.banner-icon{flex:0 0 32px;width:32px;height:32px;border-radius:var(--r-md);background:var(--accent-dim);display:grid;place-items:center;color:var(--accent)}
.banner-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.banner-t{font-size:var(--fs-md);font-weight:600}
.banner-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}
.row{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.stack{display:flex;flex-direction:column;gap:var(--s2)}


.kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s2)}
.kpi{padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;gap:2px}
.kpi-k{font-size:var(--fs-xs);color:var(--faint)}
.kpi-v{font-size:var(--fs-xl);font-weight:600;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
.kpi-u{font-size:var(--fs-xs);font-weight:400;color:var(--faint);margin-left:3px}
.kpi-sub{font-size:var(--fs-xs);color:var(--faint)}

.accts{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:var(--s2)}
.acct{padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;gap:var(--s3);transition:border-color var(--t-base) var(--ease),background var(--t-base) var(--ease)}
.acct:hover{border-color:oklch(64% .14 155 / .45);background:var(--surface-2)}
.acct-head{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
.acct-dot{width:6px;height:6px;border-radius:50%;background:var(--accent);flex:0 0 auto}
.acct-name{font-size:var(--fs-md);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 auto}
.acct-more{display:flex;align-items:center;gap:6px;margin-top:auto}

/* token 用量：比积分条更显眼，因为每天归零 */
.quota{display:flex;flex-direction:column;gap:5px}
.quota-bar{height:5px;border-radius:var(--r-pill);background:var(--surface-3);overflow:hidden}
.quota-bar span{display:block;height:100%;border-radius:var(--r-pill);background:var(--accent);transition:width var(--t-base) var(--ease)}
.quota-bar[data-low="true"] span{background:var(--warn)}
.quota-text{display:flex;align-items:baseline;gap:5px;font-size:var(--fs-sm);font-variant-numeric:tabular-nums}
.quota-used{color:var(--text);font-weight:500}
.quota-total{color:var(--faint);font-size:var(--fs-xs)}
.quota-reset{margin-left:auto;font-size:var(--fs-xs);color:var(--faint)}

/* 登录方式标签 */
.login-kind{font-size:12px;line-height:15px;padding:0 5px;border-radius:var(--r-pill);border:1px solid var(--line-2);color:var(--faint);white-space:nowrap}

.row{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.banner{display:flex;align-items:flex-start;gap:var(--s3);padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface)}
.banner-icon{flex:0 0 32px;width:32px;height:32px;border-radius:var(--r-md);background:var(--accent-dim);display:grid;place-items:center;color:var(--accent)}
.banner-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.banner-t{font-size:var(--fs-md);font-weight:600}
.banner-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}



.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s2)}
.kpi{padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;gap:2px}
.kpi-k{font-size:var(--fs-xs);color:var(--faint)}
.kpi-v{font-size:var(--fs-xl);font-weight:600;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
.kpi-u{font-size:var(--fs-xs);font-weight:400;color:var(--faint);margin-left:3px}
.kpi-sub{font-size:var(--fs-xs);color:var(--faint)}

.table{border:1px solid var(--line);border-radius:var(--r-lg);background:var(--surface);overflow:hidden}
.tr{display:grid;gap:var(--s3);align-items:center;padding:var(--s2) var(--s3);min-height:38px;border-bottom:1px solid var(--line);transition:background var(--t-base) var(--ease)}
.tr:last-child{border-bottom:0}
.tr:not(.tr-head):hover{background:var(--surface-2)}
.tr-head{min-height:32px;background:var(--surface-2);font-size:var(--fs-xs);color:var(--faint);font-weight:600}
.td{font-size:var(--fs-sm);font-variant-numeric:tabular-nums;min-width:0}
.td-name{display:flex;align-items:center;gap:var(--s2);min-width:0}
.td-mono{font-family:var(--mono);font-size:var(--fs-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-ch{display:flex;align-items:center;gap:6px;font-size:var(--fs-xs);color:var(--muted);flex:0 0 auto}
.td-ch .m{width:16px;height:16px;border-radius:4px;background-color:var(--surface-3);background-size:contain;background-repeat:no-repeat;background-position:center}
.td-num{text-align:right;color:var(--text)}
.td-dim{text-align:right;color:var(--faint);font-size:var(--fs-xs)}

.bars{display:flex;flex-direction:column;gap:var(--s2)}
.bar{display:grid;grid-template-columns:110px minmax(0,1fr) 68px;gap:var(--s3);align-items:center}
.bar-k{font-size:var(--fs-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-track{height:8px;border-radius:var(--r-pill);background:var(--surface-3);overflow:hidden}
.bar-fill{height:100%;border-radius:var(--r-pill);background:var(--accent)}
.bar-v{font-size:var(--fs-sm);text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}

.accts{
  display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));
  gap:var(--s2);
  /* 每行按内容高度走，展开的卡片只把自己撑高，不拉别人 */
  align-items:start;
  grid-auto-rows:min-content;
}
/* 账号卡：一个总数 + 折起来的明细 */
.acct-total{display:flex;align-items:baseline;gap:4px}
.acct-total-v{font-size:22px;font-weight:700;letter-spacing:-0.03em;font-variant-numeric:tabular-nums;line-height:1.2}
.acct-total-u{font-size:var(--fs-xs);color:var(--faint)}
.acct-detail{position:relative}
/* details 折叠时内容必须真正消失：没有 display:none 的自定义样式会让 dl 仍占位 */
.acct-detail:not([open])>.facts{display:none}
.acct-detail>.facts{
  display:flex;flex-direction:column;gap:4px;margin:0;
  padding:var(--s2);border-radius:var(--r-md);
  background:var(--surface-2);
}
.acct-detail>.facts .fact{display:flex;align-items:baseline;gap:var(--s2);font-size:var(--fs-xs)}
.acct-detail>.facts .fact dt{flex:0 0 auto;color:var(--faint);min-width:56px}
.acct-detail>.facts .fact dd{flex:1 1 auto;margin:0;color:var(--text);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.acct-detail>summary{
  display:inline-flex;align-items:center;gap:4px;
  min-height:24px;padding:0 9px;border-radius:var(--r-sm);
  border:1px solid var(--line-2);background:transparent;
  color:var(--muted);font-size:var(--fs-xs);cursor:pointer;
  list-style:none;
  transition:background var(--t-base) var(--ease),color var(--t-base) var(--ease);
}
.acct-detail>summary::-webkit-details-marker{display:none}
.acct-detail>summary::after{content:'▾';font-size:9px;opacity:.7}
.acct-detail[open]>summary::after{content:'▴'}
.acct-detail>summary:hover{background:var(--surface-2);color:var(--text)}
.acct-detail[open]>summary{margin-bottom:var(--s2)}



.acct{
  padding:var(--s3);border-radius:var(--r-lg);
  border:1px solid var(--line);background:var(--surface);
  display:flex;flex-direction:column;gap:var(--s2);
  position:relative;align-self:start;
  transition:border-color var(--t-base) var(--ease),background var(--t-base) var(--ease);
}
.acct:hover{border-color:oklch(64% .14 155 / .45);background:var(--surface-2)}
.acct-head{display:flex;align-items:center;gap:6px;min-width:0}
.acct-dot{width:6px;height:6px;border-radius:50%;background:var(--accent);flex:0 0 auto}
.acct-name{font-size:var(--fs-md);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:0}
.acct-row{display:flex;align-items:baseline;gap:var(--s2);font-size:var(--fs-sm)}
.acct-k{color:var(--faint);flex:0 0 auto;font-size:var(--fs-xs)}
.acct-v{color:var(--text);font-variant-numeric:tabular-nums}
.acct-soon{color:var(--warn);font-size:var(--fs-xs)}
.acct-bar{height:3px;border-radius:var(--r-pill);background:var(--surface-3);overflow:hidden}
.acct-bar span{display:block;height:100%;border-radius:var(--r-pill);background:var(--accent)}
.acct-more{display:flex;align-items:center;gap:6px;padding-top:var(--s1)}
.tiny{padding:2px 9px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:transparent;color:var(--muted);font-size:var(--fs-xs);line-height:17px;white-space:nowrap;transition:background var(--t-base) var(--ease),color var(--t-base) var(--ease)}
.tiny:hover{background:var(--surface-2);color:var(--text)}
.tiny-primary{border-color:transparent;background:var(--accent);color:var(--accent-ink);font-weight:600}

.models{
  border:1px solid var(--line);
  border-radius:var(--r-md);
  overflow:hidden;
  background:var(--surface);
  min-width:0;
}
.model{
  display:grid;grid-template-columns:auto minmax(0,1fr) auto;
  grid-template-areas:"sw main side";
  align-items:center;gap:0 var(--s3);
  padding:var(--s2) var(--s3);
  border-bottom:1px solid var(--line);
  transition:background var(--t-base) var(--ease);
}
.model:last-child{border-bottom:0}
.model:hover{background:var(--surface-2)}
.model>.sw{grid-area:sw}
.model-main{grid-area:main;display:flex;flex-direction:column;gap:3px;min-width:0}
.model-top{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
.model-name{font-size:var(--fs-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.model[data-off="true"] .model-name{color:var(--faint)}
.model-sub{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.model-side{grid-area:side;display:flex;align-items:center;gap:var(--s2);flex:0 0 auto}

.badge{font-size:12px;line-height:15px;padding:0 5px;border-radius:var(--r-pill);border:1px solid var(--line-2);color:var(--muted);white-space:nowrap;flex:0 0 auto}
.badge[data-kind="free"]{border-color:oklch(64% .14 155/.55);background:var(--accent-dim);color:var(--accent);font-weight:600}
.badge[data-kind="plan"]{border-color:oklch(76% .13 78/.6);background:oklch(76% .13 78/.14);color:var(--warn);font-weight:600}
.badge[data-kind="vision"]{border-color:oklch(70% .1 250/.5);background:oklch(70% .1 250/.12);color:oklch(76% .09 250)}

.model-mult{font-size:var(--fs-xs);color:var(--muted);font-variant-numeric:tabular-nums;flex:0 0 auto}
.model-mult[data-free="true"]{color:var(--accent);font-weight:600}

.ctx-select{
  appearance:none;border:1px solid var(--line-2);
  background-color:var(--surface);color:var(--text);
  font-family:inherit;font-size:var(--fs-xs);
  padding:0 20px 0 7px;min-height:24px;height:24px;border-radius:var(--r-sm);
  cursor:pointer;font-variant-numeric:tabular-nums;
  background-image:linear-gradient(45deg,transparent 50%,var(--faint) 50%),linear-gradient(135deg,var(--faint) 50%,transparent 50%);
  background-position:calc(100% - 11px) 10px,calc(100% - 7px) 10px;
  background-size:4px 4px,4px 4px;background-repeat:no-repeat;
}
.ctx-select:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:transparent}

/* token 型渠道的用量条（Marvis 这类每天给固定 token 的） */
.quota{display:flex;flex-direction:column;gap:3px;width:100%}
.quota-bar{height:4px;border-radius:var(--r-pill);background:var(--surface-3);overflow:hidden}
.quota-bar span{display:block;height:100%;border-radius:var(--r-pill);background:var(--accent)}
.quota-text{
  display:flex;align-items:baseline;gap:5px;
  font-size:var(--fs-xs);color:var(--muted);font-variant-numeric:tabular-nums;
}
.quota-used{color:var(--faint)}
.quota-reset{margin-left:auto;color:var(--faint)}

/* 登录方式标签（Marvis 令牌 / 微信扫码这类） */
.login-kind{
  font-size:12px;line-height:15px;padding:0 5px;border-radius:var(--r-pill);
  border:1px solid var(--line-2);color:var(--faint);white-space:nowrap;
}
.model[data-off="true"] .ctx-select{opacity:.45;pointer-events:none}

.policies{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--s2)}
.policy{padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;gap:var(--s2)}
.policy-k{font-size:var(--fs-xs);color:var(--faint)}
.policy-v{font-size:var(--fs-md);color:var(--text);display:flex;align-items:center;gap:var(--s2)}
.policy-hint{font-size:var(--fs-xs);color:var(--faint);line-height:1.5}
.stack{display:flex;flex-direction:column;gap:var(--s2)}
.row{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.field{display:flex;flex-direction:column;gap:4px}
.field label{font-size:var(--fs-xs);color:var(--faint)}
.input{padding:6px 10px;border-radius:var(--r-md);border:1px solid var(--line-2);background:var(--surface);color:var(--text);font-size:var(--fs-md);font-family:inherit;min-width:0}
.input:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:transparent}




.groups{display:flex;flex-direction:column;gap:var(--s5)}

.group-head{
  display:flex;align-items:center;gap:var(--s2);
  padding-bottom:var(--s2);margin-bottom:var(--s3);
  border-bottom:1px solid var(--line);
}
.group-dot{width:6px;height:6px;border-radius:50%;background:var(--accent);flex:0 0 auto}
.group-dot[data-empty="true"]{background:var(--faint)}
.group-title{font-size:var(--fs-lg);font-weight:600;white-space:nowrap}
.group-n{
  font-size:var(--fs-xs);color:var(--faint);
  background:var(--surface-2);padding:1px 8px;border-radius:var(--r-pill);
  font-variant-numeric:tabular-nums;
}
.group-hint{margin-left:auto;font-size:var(--fs-xs);color:var(--faint)}

.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:var(--s2)}
.card-ch{
  display:flex;flex-direction:column;gap:var(--s2);
  padding:var(--s3);border-radius:var(--r-lg);
  border:1px solid var(--line);background:var(--surface);
  transition:border-color var(--t-base) var(--ease),background var(--t-base) var(--ease);
}
.card-ch:hover{border-color:oklch(64% .14 155 / .45);background:var(--surface-2)}
.ch-head{display:flex;align-items:center;gap:var(--s2);min-width:0}
.ch-logo{
  flex:0 0 32px;width:32px;height:32px;border-radius:var(--r-md);
  background-color:var(--surface-3);
  background-size:contain;background-repeat:no-repeat;background-position:center;
}
.card-ch[data-bound="false"] .ch-logo{opacity:.45;filter:grayscale(1)}
.ch-titles{display:flex;flex-direction:column;gap:0;min-width:0;flex:1 1 auto}
.ch-title{font-size:var(--fs-md);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ch-org{font-size:var(--fs-xs);color:var(--faint)}
.ch-state{
  flex:0 0 auto;font-size:var(--fs-xs);padding:1px 7px;border-radius:var(--r-pill);
  border:1px solid var(--line-2);color:var(--faint);
}
.ch-state[data-bound="true"]{
  border-color:oklch(64% .14 155 / .5);background:var(--accent-dim);
  color:var(--accent);font-weight:600;
}
.ch-note{margin:0;font-size:var(--fs-xs);color:var(--muted);line-height:1.6;min-height:32px}
.ch-foot{display:flex;align-items:center;gap:var(--s2);margin-top:auto}
.ch-count{font-size:var(--fs-xs);color:var(--faint);font-variant-numeric:tabular-nums;margin-right:auto}
.card-ch[data-bound="false"] .ch-title{color:var(--muted)}

/* 备注：每家一句说明，来源是渠道清单里的 note 字段 */




.lane{
  display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap;
  padding:var(--s2) var(--s3);
  border-radius:var(--r-md);
  background:var(--surface);
  border:1px solid var(--line);
}
.lane-t{font-size:var(--fs-sm);font-weight:500;white-space:nowrap}
.lane-d{font-size:var(--fs-xs);color:var(--faint);flex:1 1 auto;min-width:0}

.tabs{
  display:flex;gap:2px;
  background:var(--surface);
  border-radius:var(--r-sm);
  padding:3px;
  overflow-x:auto;scrollbar-width:none;
}
.tabs::-webkit-scrollbar{display:none}
.tab{
  flex:0 0 auto;border:0;background:transparent;
  color:var(--muted);font-size:var(--fs-xs);
  padding:0 11px;min-height:26px;border-radius:4px;
  white-space:nowrap;
  transition:background var(--t-fast) var(--ease),color var(--t-fast) var(--ease);
}
.tab:hover{color:var(--text)}
.tab[aria-pressed="true"]{background:var(--surface-3);color:var(--text);font-weight:500}
.tab .n{font-variant-numeric:tabular-nums;color:var(--faint);margin-left:4px}
.tab[aria-pressed="true"] .n{color:var(--accent)}

.vendors{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(330px,1fr));
  gap:var(--s3);align-items:start;
}
.vd{
  display:flex;flex-direction:column;gap:var(--s2);
  padding:var(--s3);border-radius:var(--r-md);
  overflow:hidden;
  border:1px solid var(--line);background:var(--surface);
  min-width:0;
  transition:border-color var(--t-fast) var(--ease);
}
.vd:hover{border-color:var(--line-2)}
.vd[data-on="true"]{border-color:color-mix(in oklch, var(--accent) 28%, transparent)}

.vd-head{display:flex;align-items:center;gap:var(--s2);min-width:0;flex-wrap:wrap}
.vd-name{
  flex:1 1 auto;min-width:0;font-size:var(--fs-sm);font-weight:500;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.vd-cat{
  flex:0 0 auto;font-size:var(--fs-xs);line-height:16px;
  padding:0 7px;border-radius:var(--r-pill);
  border:1px solid var(--line-2);color:var(--faint);white-space:nowrap;
}
.vd-cat[data-cat="free"]{border-color:var(--accent-line);background:var(--accent-dim);color:var(--accent)}
.vd-cat[data-cat="free-tier"]{
  border-color:color-mix(in oklch, var(--info) 34%, transparent);
  background:color-mix(in oklch, var(--info) 11%, transparent);color:var(--info);
}
.vd-cat[data-cat="oauth"]{
  border-color:color-mix(in oklch, var(--warn) 32%, transparent);
  background:color-mix(in oklch, var(--warn) 10%, transparent);color:var(--warn);
}

.vd-models-line{
  margin:0;
  font-size:var(--fs-xs);color:var(--faint);
  line-height:1.5;
  /* 允许两行，超出就省略 —— 不硬切一眼 */
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
  overflow:hidden;word-break:break-word;
}

.vd-key-row{display:flex;gap:5px;align-items:center}
.vd-input{
  flex:1 1 auto;min-width:0;
  padding:4px 9px;min-height:26px;
  border-radius:var(--r-sm);border:1px solid var(--line-2);
  background:var(--bg);color:var(--text);
  font-size:var(--fs-xs);font-family:var(--mono);
  transition:border-color var(--t-fast) var(--ease);
}
.vd-input::placeholder{color:var(--faint);font-family:var(--sans)}
.vd-input:focus{outline:none;border-color:var(--accent-line)}
.vd-input[data-set="true"]{border-color:var(--accent-line);background:var(--accent-dim);color:var(--accent)}

.vd-keys{display:flex;flex-wrap:wrap;gap:4px}
.vd-key-tag{
  display:inline-flex;align-items:center;gap:2px;
  font-size:var(--fs-xs);font-family:var(--mono);
  padding:0 2px 0 6px;border-radius:var(--r-sm);
  background:var(--surface-2);color:var(--muted);
}
.vd-key-tag button{
  border:0;background:transparent;color:var(--faint);
  width:24px;height:24px;display:grid;place-items:center;
  border-radius:4px;font-size:13px;line-height:1;padding:0;
}
.vd-key-tag button:hover{
  background:color-mix(in oklch, var(--danger) 14%, transparent);
  color:var(--danger);
}

.vd-foot{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap;margin-top:auto;padding-top:var(--s2)}
.vd-state{display:flex;align-items:center;gap:5px;font-size:var(--fs-xs);color:var(--faint)}
.vd-state[data-on="true"]{color:var(--accent)}
.vd-state::before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor;flex:0 0 auto}
.vd-n{font-size:var(--fs-xs);color:var(--faint);font-variant-numeric:tabular-nums}
.vd-actions{margin-left:auto;display:flex;gap:5px;align-items:center}

@media (max-width:1180px){ .vendors{grid-template-columns:minmax(0,1fr)} }




/* ---- 汇总条 ---- */
.summary{
  display:grid;grid-template-columns:repeat(6,minmax(0,1fr));
  gap:1px;border:1px solid var(--line);border-radius:var(--r-lg);
  background:var(--line);overflow:hidden;
}
.sum-cell{
  display:flex;flex-direction:column;gap:3px;
  padding:var(--s3);background:var(--surface);
}
.sum-k{font-size:var(--fs-xs);color:var(--faint);white-space:nowrap}
.sum-v{
  font-size:var(--fs-xl);font-weight:600;letter-spacing:-0.02em;
  font-variant-numeric:tabular-nums;line-height:1.25;
}
.sum-u{font-size:var(--fs-xs);font-weight:400;color:var(--faint);margin-left:2px}
.sum-sub{font-size:var(--fs-xs);color:var(--faint);line-height:1.55}

/* 1280 这类宽度下六列放不下副标题，退成三列 */
@media (max-width:1380px){
  .summary{grid-template-columns:repeat(3,minmax(0,1fr))}
}
/* 900-1100：两列副标题放不下，退成单列才不至于折行 */
@media (max-width:1100px){
  .summary{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:980px){
  .summary{grid-template-columns:minmax(0,1fr)}
  .sum-cell{padding:var(--s2) var(--s3)}
}
/* 轴标签宁可横滑，也不要把字挤断 */

.axis::-webkit-scrollbar{display:none}

@media (max-width:900px){
  .summary{grid-template-columns:repeat(2,minmax(0,1fr))}
}
.sum-sub[data-tone="ok"]{color:var(--accent)}
.sum-sub[data-tone="warn"]{color:var(--warn)}
.sum-sub[data-tone="err"]{color:var(--danger)}

/* ---- 趋势 ---- */
.trend{
  border:1px solid var(--line);border-radius:var(--r-lg);
  background:var(--surface);padding:var(--s3);
  display:flex;flex-direction:column;gap:var(--s3);
}
.trend-head{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.trend-title{font-size:var(--fs-md);font-weight:600}
.trend-actions{margin-left:auto;display:flex;gap:var(--s2)}
.chart{
  display:flex;align-items:flex-end;gap:4px;
  height:130px;padding-top:var(--s2);
  border-bottom:1px solid var(--line);
}
.col{
  display:flex;flex-direction:column;justify-content:flex-end;gap:2px;
  flex:1 1 0;min-width:0;height:100%;
}
.col-bar{border-radius:2px 2px 0 0;background:var(--accent);min-height:2px;flex:0 0 auto;transition:background var(--t-base) var(--ease)}
.col-bar[data-kind="in"]{background:oklch(64% .14 155/.55)}
.col-bar[data-kind="out"]{background:var(--accent)}
.col:hover .col-bar{background:oklch(72% .14 155)}
.axis{
  display:flex;gap:4px;
  font-size:var(--fs-xs);color:var(--faint);
  overflow-x:auto;scrollbar-width:none;
}
.axis::-webkit-scrollbar{display:none}
.axis span{white-space:nowrap}
.axis span{flex:0 0 auto;text-align:center;white-space:nowrap;min-width:40px}

/* ---- 榜单 ---- */
.ranks{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:var(--s3)}
.rank{
  border:1px solid var(--line);border-radius:var(--r-lg);
  background:var(--surface);overflow:hidden;
  display:flex;flex-direction:column;
}
.rank-head{
  display:flex;align-items:center;gap:var(--s2);
  padding:var(--s2) var(--s3);
  border-bottom:1px solid var(--line);
  background:var(--surface-2);
}
.rank-title{font-size:var(--fs-md);font-weight:600}
.rank-n{font-size:var(--fs-xs);color:var(--faint);margin-left:auto;font-variant-numeric:tabular-nums}
.rank-row{
  display:grid;grid-template-columns:20px minmax(0,1fr) 72px 64px;
  gap:var(--s2);align-items:center;
  padding:var(--s2) var(--s3);min-height:40px;
  border-bottom:1px solid var(--line);
  transition:background var(--t-base) var(--ease);
}
.rank-row:last-child{border-bottom:0}
.rank-row:hover{background:var(--surface-2)}
.rank-icon{width:20px;height:20px;border-radius:var(--r-sm);background-color:var(--surface-3);background-size:contain;background-repeat:no-repeat;background-position:center}
.rank-body{display:flex;flex-direction:column;gap:3px;min-width:0}
.rank-name{font-size:var(--fs-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rank-bar{height:3px;border-radius:var(--r-pill);background:var(--surface-3);overflow:hidden}
.rank-bar span{display:block;height:100%;border-radius:var(--r-pill);background:var(--accent)}
.rank-v{font-size:var(--fs-sm);text-align:right;font-variant-numeric:tabular-nums}
.rank-pct{font-size:var(--fs-xs);text-align:right;color:var(--faint);font-variant-numeric:tabular-nums}

/* ---- 明细表 ---- */
.table{
  border:1px solid var(--line);
  border-radius:var(--r-md);
  background:var(--surface);
  overflow:hidden;
}
/* 明细表五列加起来有最小宽度，窄了让整个表横滑，别把字挤没 */
.table-scroll{overflow-x:auto;scrollbar-width:none}
.table-scroll::-webkit-scrollbar{display:none}
.tr{display:grid;gap:var(--s3);align-items:center;padding:var(--s2) var(--s3);min-height:40px;border-bottom:1px solid var(--line);min-width:520px;transition:background var(--t-base) var(--ease)}
.tr:last-child{border-bottom:0}
.tr:not(.tr-head):hover{background:var(--surface-2)}
.tr-head{min-height:32px;background:var(--surface-2);font-size:var(--fs-xs);color:var(--faint);font-weight:600}
.td{font-size:var(--fs-sm);min-width:0}
.td-mono{font-family:var(--mono);font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-num{text-align:right;font-variant-numeric:tabular-nums}
.td-dim{text-align:right;color:var(--faint);font-size:var(--fs-xs);font-variant-numeric:tabular-nums}
.td-ch{display:flex;align-items:center;gap:6px;font-size:var(--fs-xs);color:var(--muted);flex:0 0 auto}
.td-ch .m{width:16px;height:16px;border-radius:4px;background-color:var(--surface-3);background-size:contain;background-repeat:no-repeat;background-position:center}

/* ---- 筛选条 ---- */
.filters{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.chip{
  font-size:var(--fs-xs);padding:0 9px;min-height:24px;
  display:inline-flex;align-items:center;
  border-radius:var(--r-pill);border:1px solid var(--line-2);
  background:transparent;color:var(--muted);
  transition:background var(--t-base) var(--ease),color var(--t-base) var(--ease);
}
.chip:hover{background:var(--surface-2);color:var(--text)}
.chip[aria-pressed="true"]{background:var(--accent-dim);border-color:oklch(64% .14 155/.5);color:var(--accent);font-weight:600}




.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s2)}
.kpi{padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;gap:2px}
.kpi-k{font-size:var(--fs-xs);color:var(--faint)}
.kpi-v{font-size:var(--fs-xl);font-weight:600;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
.kpi-u{font-size:var(--fs-xs);font-weight:400;color:var(--faint);margin-left:3px}
.kpi-sub{font-size:var(--fs-xs);color:var(--faint)}

.table{border:1px solid var(--line);border-radius:var(--r-lg);background:var(--surface);overflow:hidden}
.tr{display:grid;gap:var(--s3);align-items:center;padding:var(--s2) var(--s3);min-height:40px;border-bottom:1px solid var(--line);transition:background var(--t-base) var(--ease)}
.tr:last-child{border-bottom:0}
.tr:not(.tr-head):hover{background:var(--surface-2)}
.tr-head{min-height:32px;background:var(--surface-2);font-size:var(--fs-xs);color:var(--faint);font-weight:600}
.td{font-size:var(--fs-sm);min-width:0}
.td-mono{font-family:var(--mono);font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-num{text-align:right;font-variant-numeric:tabular-nums}
.td-dim{text-align:right;color:var(--faint);font-size:var(--fs-xs);font-variant-numeric:tabular-nums}

.row{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.stack{display:flex;flex-direction:column;gap:var(--s2)}
.field{display:flex;flex-direction:column;gap:4px;min-width:0}
.field label{font-size:var(--fs-xs);color:var(--faint)}
.input,.select{padding:6px 10px;border-radius:var(--r-md);border:1px solid var(--line-2);background:var(--surface);color:var(--text);font-size:var(--fs-md);font-family:inherit;min-width:0;width:100%}
.input:focus,.select:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:transparent}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:var(--s3)}

.kv{display:grid;grid-template-columns:104px minmax(0,1fr);gap:var(--s2) var(--s3);font-size:var(--fs-sm)}
.kv dt{color:var(--faint);font-size:var(--fs-xs)}
.kv dd{margin:0;color:var(--text);font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis}
.mono{font-family:var(--mono);font-size:var(--fs-xs)}

.banner{display:flex;align-items:flex-start;gap:var(--s3);padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface)}
.banner-icon{flex:0 0 32px;width:32px;height:32px;border-radius:var(--r-md);background:var(--surface-3);display:grid;place-items:center;color:var(--accent)}
.banner-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.banner-t{font-size:var(--fs-md);font-weight:600}
.banner-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}

.steps{display:flex;flex-direction:column;gap:var(--s3)}
.step{display:flex;gap:var(--s3);align-items:flex-start}
.step-n{flex:0 0 22px;width:22px;height:22px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:grid;place-items:center;font-size:var(--fs-xs);font-weight:700}
.step-b{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 auto}
.step-t{font-size:var(--fs-md);font-weight:500}
.step-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}




.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s2)}
.kpi{padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;gap:2px}
.kpi-k{font-size:var(--fs-xs);color:var(--faint)}
.kpi-v{font-size:var(--fs-xl);font-weight:600;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
.kpi-u{font-size:var(--fs-xs);font-weight:400;color:var(--faint);margin-left:3px}
.kpi-sub{font-size:var(--fs-xs);color:var(--faint)}

.table{border:1px solid var(--line);border-radius:var(--r-lg);background:var(--surface);overflow:hidden}
.tr{display:grid;gap:var(--s3);align-items:center;padding:var(--s2) var(--s3);min-height:40px;border-bottom:1px solid var(--line);transition:background var(--t-base) var(--ease)}
.tr:last-child{border-bottom:0}
.tr:not(.tr-head):hover{background:var(--surface-2)}
.tr-head{min-height:32px;background:var(--surface-2);font-size:var(--fs-xs);color:var(--faint);font-weight:600}
.td{font-size:var(--fs-sm);min-width:0}
.td-mono{font-family:var(--mono);font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-num{text-align:right;font-variant-numeric:tabular-nums}
.td-dim{text-align:right;color:var(--faint);font-size:var(--fs-xs)}

.row{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.stack{display:flex;flex-direction:column;gap:var(--s2)}
.field{display:flex;flex-direction:column;gap:4px;min-width:0}
.field label{font-size:var(--fs-xs);color:var(--faint)}
.input,.select{padding:6px 10px;border-radius:var(--r-md);border:1px solid var(--line-2);background:var(--surface);color:var(--text);font-size:var(--fs-md);font-family:inherit;min-width:0;width:100%}
.input:focus,.select:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:transparent}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:var(--s3)}

.kv{display:grid;grid-template-columns:120px minmax(0,1fr);gap:var(--s2) var(--s3);font-size:var(--fs-sm);margin:0}
.kv dt{color:var(--faint);font-size:var(--fs-xs)}
.kv dd{margin:0;color:var(--text);font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis}
.mono{font-family:var(--mono);font-size:var(--fs-xs)}

.banner{display:flex;align-items:flex-start;gap:var(--s3);padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface)}
.banner-icon{flex:0 0 32px;width:32px;height:32px;border-radius:var(--r-md);background:var(--surface-3);display:grid;place-items:center;color:var(--accent)}
.banner-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.banner-t{font-size:var(--fs-md);font-weight:600}
.banner-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}

.steps{display:flex;flex-direction:column;gap:var(--s3)}
.step{display:flex;gap:var(--s3);align-items:flex-start}
.step-n{flex:0 0 22px;width:22px;height:22px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:grid;place-items:center;font-size:var(--fs-xs);font-weight:700}
.step-b{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 auto}
.step-t{font-size:var(--fs-md);font-weight:500}
.step-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}

.code{
  padding:var(--s3);border-radius:var(--r-md);
  background:var(--bg);border:1px solid var(--line);
  font-family:var(--mono);font-size:var(--fs-xs);line-height:1.7;
  color:var(--muted);overflow-x:auto;white-space:pre;
}
.code b{color:var(--accent);font-weight:600}




.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s2)}
.kpi{padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;gap:2px}
.kpi-k{font-size:var(--fs-xs);color:var(--faint)}
.kpi-v{font-size:var(--fs-xl);font-weight:600;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
.kpi-u{font-size:var(--fs-xs);font-weight:400;color:var(--faint);margin-left:3px}
.kpi-sub{font-size:var(--fs-xs);color:var(--faint)}

.table{border:1px solid var(--line);border-radius:var(--r-lg);background:var(--surface);overflow:hidden}
.tr{display:grid;gap:var(--s3);align-items:center;padding:var(--s2) var(--s3);min-height:40px;border-bottom:1px solid var(--line);transition:background var(--t-base) var(--ease)}
.tr:last-child{border-bottom:0}
.tr:not(.tr-head):hover{background:var(--surface-2)}
.tr-head{min-height:32px;background:var(--surface-2);font-size:var(--fs-xs);color:var(--faint);font-weight:600}
.td{font-size:var(--fs-sm);min-width:0}
.td-mono{font-family:var(--mono);font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-num{text-align:right;font-variant-numeric:tabular-nums}
.td-dim{text-align:right;color:var(--faint);font-size:var(--fs-xs)}

.row{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.stack{display:flex;flex-direction:column;gap:var(--s2)}
.field{display:flex;flex-direction:column;gap:4px;min-width:0}
.field label{font-size:var(--fs-xs);color:var(--faint)}
.input,.select{padding:6px 10px;border-radius:var(--r-md);border:1px solid var(--line-2);background:var(--surface);color:var(--text);font-size:var(--fs-md);font-family:inherit;min-width:0;width:100%}
.input:focus,.select:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:transparent}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:var(--s3)}

.kv{display:grid;grid-template-columns:120px minmax(0,1fr);gap:var(--s2) var(--s3);font-size:var(--fs-sm);margin:0}
.kv dt{color:var(--faint);font-size:var(--fs-xs)}
.kv dd{margin:0;color:var(--text);font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis}
.mono{font-family:var(--mono);font-size:var(--fs-xs)}

.banner{display:flex;align-items:flex-start;gap:var(--s3);padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface)}
.banner-icon{flex:0 0 32px;width:32px;height:32px;border-radius:var(--r-md);background:var(--surface-3);display:grid;place-items:center;color:var(--accent)}
.banner-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.banner-t{font-size:var(--fs-md);font-weight:600}
.banner-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}

.steps{display:flex;flex-direction:column;gap:var(--s3)}
.step{display:flex;gap:var(--s3);align-items:flex-start}
.step-n{flex:0 0 22px;width:22px;height:22px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:grid;place-items:center;font-size:var(--fs-xs);font-weight:700}
.step-b{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 auto}
.step-t{font-size:var(--fs-md);font-weight:500}
.step-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}

.code{
  padding:var(--s3);border-radius:var(--r-md);
  background:var(--bg);border:1px solid var(--line);
  font-family:var(--mono);font-size:var(--fs-xs);line-height:1.7;
  color:var(--muted);overflow-x:auto;white-space:pre;
}
.code b{color:var(--accent);font-weight:600}




.pop-wrap{
  position:relative;min-height:420px;
  display:grid;place-items:center;
  border:1px dashed var(--line-2);border-radius:var(--r-lg);
  background:var(--surface-2);
  padding:var(--s6);
}
.pop-note{
  position:absolute;left:var(--s4);top:var(--s3);
  font-size:var(--fs-xs);color:var(--faint);
}
.pop{
  position:relative;width:min(340px,100%);
  display:flex;flex-direction:column;gap:var(--s3);
  padding:var(--s4);border-radius:var(--r-lg);
  border:1px solid var(--line-2);background:var(--surface);
  box-shadow:var(--sh-lg);
  animation:pop-in 140ms var(--ease) both;
}
@keyframes pop-in{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
.pop-head{display:flex;align-items:center;gap:var(--s2)}
.pop-name{flex:1 1 auto;font-size:var(--fs-lg);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pop-close{flex:0 0 auto;width:26px;height:26px;border:0;border-radius:var(--r-sm);background:transparent;color:var(--faint);font-size:16px;line-height:1;transition:background var(--t-base) var(--ease)}
.pop-close:hover{background:var(--surface-2);color:var(--text)}
.facts{display:flex;flex-direction:column;gap:6px;margin:0}
.fact{display:flex;align-items:baseline;gap:var(--s2);font-size:var(--fs-sm)}
.fact dt{flex:0 0 auto;color:var(--faint);font-size:var(--fs-xs);min-width:64px}
.fact dd{flex:1 1 auto;margin:0;color:var(--text);font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pop-actions{display:flex;gap:var(--s2);padding-top:var(--s1);border-top:1px solid var(--line)}

.qr{
  width:180px;height:180px;border-radius:var(--r-md);
  background:#fff;display:grid;place-items:center;
  margin:0 auto;
  color:#111;font-size:var(--fs-xs);text-align:center;line-height:1.6;
}
.qr-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--s3)}
.qr-item{display:flex;flex-direction:column;align-items:center;gap:var(--s2);min-width:0}
.qr-label{font-size:var(--fs-sm);font-weight:600}
.qr-step{font-size:var(--fs-xs);color:var(--muted);text-align:center;line-height:1.5}

.steps{display:flex;flex-direction:column;gap:var(--s3)}
.step{display:flex;gap:var(--s3);align-items:flex-start}
.step-n{flex:0 0 22px;width:22px;height:22px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:grid;place-items:center;font-size:var(--fs-xs);font-weight:700}
.step-n[data-done="true"]{background:var(--accent);color:var(--accent-ink)}
.step-n[data-wait="true"]{background:var(--surface-3);color:var(--muted)}
.step-b{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 auto}
.step-t{font-size:var(--fs-md);font-weight:500}
.step-t[data-wait="true"]{color:var(--faint)}
.step-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}

.spinner{
  width:14px;height:14px;border-radius:50%;
  border:2px solid var(--line-2);border-top-color:var(--accent);
  animation:spin .9s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg)}}

.banner{display:flex;align-items:flex-start;gap:var(--s3);padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface)}
.banner-icon{flex:0 0 32px;width:32px;height:32px;border-radius:var(--r-md);background:var(--accent-dim);display:grid;place-items:center;color:var(--accent)}
.banner-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.banner-t{font-size:var(--fs-md);font-weight:600}
.banner-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}
.row{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.stack{display:flex;flex-direction:column;gap:var(--s2)}




.pop-wrap{
  position:relative;min-height:420px;
  display:grid;place-items:center;
  border:1px dashed var(--line-2);border-radius:var(--r-lg);
  background:var(--surface-2);
  padding:var(--s6);
}
.pop-note{
  position:absolute;left:var(--s4);top:var(--s3);
  font-size:var(--fs-xs);color:var(--faint);
}
.pop{
  position:relative;width:min(340px,100%);
  display:flex;flex-direction:column;gap:var(--s3);
  padding:var(--s4);border-radius:var(--r-lg);
  border:1px solid var(--line-2);background:var(--surface);
  box-shadow:var(--sh-lg);
  animation:pop-in 140ms var(--ease) both;
}
@keyframes pop-in{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
.pop-head{display:flex;align-items:center;gap:var(--s2)}
.pop-name{flex:1 1 auto;font-size:var(--fs-lg);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pop-close{flex:0 0 auto;width:26px;height:26px;border:0;border-radius:var(--r-sm);background:transparent;color:var(--faint);font-size:16px;line-height:1;transition:background var(--t-base) var(--ease)}
.pop-close:hover{background:var(--surface-2);color:var(--text)}
.facts{display:flex;flex-direction:column;gap:6px;margin:0}
.fact{display:flex;align-items:baseline;gap:var(--s2);font-size:var(--fs-sm)}
.fact dt{flex:0 0 auto;color:var(--faint);font-size:var(--fs-xs);min-width:64px}
.fact dd{flex:1 1 auto;margin:0;color:var(--text);font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pop-actions{display:flex;gap:var(--s2);padding-top:var(--s1);border-top:1px solid var(--line)}

.qr{
  width:180px;height:180px;border-radius:var(--r-md);
  background:#fff;display:grid;place-items:center;
  margin:0 auto;
  color:#111;font-size:var(--fs-xs);text-align:center;line-height:1.6;
}
.qr-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--s3)}
.qr-item{display:flex;flex-direction:column;align-items:center;gap:var(--s2);min-width:0}
.qr-label{font-size:var(--fs-sm);font-weight:600}
.qr-step{font-size:var(--fs-xs);color:var(--muted);text-align:center;line-height:1.5}

.steps{display:flex;flex-direction:column;gap:var(--s3)}
.step{display:flex;gap:var(--s3);align-items:flex-start}
.step-n{flex:0 0 22px;width:22px;height:22px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:grid;place-items:center;font-size:var(--fs-xs);font-weight:700}
.step-n[data-done="true"]{background:var(--accent);color:var(--accent-ink)}
.step-n[data-wait="true"]{background:var(--surface-3);color:var(--muted)}
.step-b{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 auto}
.step-t{font-size:var(--fs-md);font-weight:500}
.step-t[data-wait="true"]{color:var(--faint)}
.step-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}

.spinner{
  width:14px;height:14px;border-radius:50%;
  border:2px solid var(--line-2);border-top-color:var(--accent);
  animation:spin .9s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg)}}

.banner{display:flex;align-items:flex-start;gap:var(--s3);padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface)}
.banner-icon{flex:0 0 32px;width:32px;height:32px;border-radius:var(--r-md);background:var(--accent-dim);display:grid;place-items:center;color:var(--accent)}
.banner-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.banner-t{font-size:var(--fs-md);font-weight:600}
.banner-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}
.row{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.stack{display:flex;flex-direction:column;gap:var(--s2)}




.pop-wrap{
  position:relative;min-height:420px;
  display:grid;place-items:center;
  border:1px dashed var(--line-2);border-radius:var(--r-lg);
  background:var(--surface-2);
  padding:var(--s6);
}
.pop-note{
  position:absolute;left:var(--s4);top:var(--s3);
  font-size:var(--fs-xs);color:var(--faint);
}
.pop{
  position:relative;width:min(340px,100%);
  display:flex;flex-direction:column;gap:var(--s3);
  padding:var(--s4);border-radius:var(--r-lg);
  border:1px solid var(--line-2);background:var(--surface);
  box-shadow:var(--sh-lg);
  animation:pop-in 140ms var(--ease) both;
}
@keyframes pop-in{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
.pop-head{display:flex;align-items:center;gap:var(--s2)}
.pop-name{flex:1 1 auto;font-size:var(--fs-lg);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pop-close{flex:0 0 auto;width:26px;height:26px;border:0;border-radius:var(--r-sm);background:transparent;color:var(--faint);font-size:16px;line-height:1;transition:background var(--t-base) var(--ease)}
.pop-close:hover{background:var(--surface-2);color:var(--text)}
.facts{display:flex;flex-direction:column;gap:6px;margin:0}
.fact{display:flex;align-items:baseline;gap:var(--s2);font-size:var(--fs-sm)}
.fact dt{flex:0 0 auto;color:var(--faint);font-size:var(--fs-xs);min-width:64px}
.fact dd{flex:1 1 auto;margin:0;color:var(--text);font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pop-actions{display:flex;gap:var(--s2);padding-top:var(--s1);border-top:1px solid var(--line)}

.qr{
  width:180px;height:180px;border-radius:var(--r-md);
  background:#fff;display:grid;place-items:center;
  margin:0 auto;
  color:#111;font-size:var(--fs-xs);text-align:center;line-height:1.6;
}
.qr-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--s3)}
.qr-item{display:flex;flex-direction:column;align-items:center;gap:var(--s2);min-width:0}
.qr-label{font-size:var(--fs-sm);font-weight:600}
.qr-step{font-size:var(--fs-xs);color:var(--muted);text-align:center;line-height:1.5}

.steps{display:flex;flex-direction:column;gap:var(--s3)}
.step{display:flex;gap:var(--s3);align-items:flex-start}
.step-n{flex:0 0 22px;width:22px;height:22px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:grid;place-items:center;font-size:var(--fs-xs);font-weight:700}
.step-n[data-done="true"]{background:var(--accent);color:var(--accent-ink)}
.step-n[data-wait="true"]{background:var(--surface-3);color:var(--muted)}
.step-b{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 auto}
.step-t{font-size:var(--fs-md);font-weight:500}
.step-t[data-wait="true"]{color:var(--faint)}
.step-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}

.spinner{
  width:14px;height:14px;border-radius:50%;
  border:2px solid var(--line-2);border-top-color:var(--accent);
  animation:spin .9s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg)}}

.banner{display:flex;align-items:flex-start;gap:var(--s3);padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface)}
.banner-icon{flex:0 0 32px;width:32px;height:32px;border-radius:var(--r-md);background:var(--accent-dim);display:grid;place-items:center;color:var(--accent)}
.banner-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.banner-t{font-size:var(--fs-md);font-weight:600}
.banner-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}
.row{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.stack{display:flex;flex-direction:column;gap:var(--s2)}




.pop-wrap{
  position:relative;min-height:420px;
  display:grid;place-items:center;
  border:1px dashed var(--line-2);border-radius:var(--r-lg);
  background:var(--surface-2);
  padding:var(--s6);
}
.pop-note{
  position:absolute;left:var(--s4);top:var(--s3);
  font-size:var(--fs-xs);color:var(--faint);
}
.pop{
  position:relative;width:min(340px,100%);
  display:flex;flex-direction:column;gap:var(--s3);
  padding:var(--s4);border-radius:var(--r-lg);
  border:1px solid var(--line-2);background:var(--surface);
  box-shadow:var(--sh-lg);
  animation:pop-in 140ms var(--ease) both;
}
@keyframes pop-in{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
.pop-head{display:flex;align-items:center;gap:var(--s2)}
.pop-name{flex:1 1 auto;font-size:var(--fs-lg);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pop-close{flex:0 0 auto;width:26px;height:26px;border:0;border-radius:var(--r-sm);background:transparent;color:var(--faint);font-size:16px;line-height:1;transition:background var(--t-base) var(--ease)}
.pop-close:hover{background:var(--surface-2);color:var(--text)}
.facts{display:flex;flex-direction:column;gap:6px;margin:0}
.fact{display:flex;align-items:baseline;gap:var(--s2);font-size:var(--fs-sm)}
.fact dt{flex:0 0 auto;color:var(--faint);font-size:var(--fs-xs);min-width:64px}
.fact dd{flex:1 1 auto;margin:0;color:var(--text);font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pop-actions{display:flex;gap:var(--s2);padding-top:var(--s1);border-top:1px solid var(--line)}

.qr{
  width:180px;height:180px;border-radius:var(--r-md);
  background:#fff;display:grid;place-items:center;
  margin:0 auto;
  color:#111;font-size:var(--fs-xs);text-align:center;line-height:1.6;
}
.qr-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--s3)}
.qr-item{display:flex;flex-direction:column;align-items:center;gap:var(--s2);min-width:0}
.qr-label{font-size:var(--fs-sm);font-weight:600}
.qr-step{font-size:var(--fs-xs);color:var(--muted);text-align:center;line-height:1.5}

.steps{display:flex;flex-direction:column;gap:var(--s3)}
.step{display:flex;gap:var(--s3);align-items:flex-start}
.step-n{flex:0 0 22px;width:22px;height:22px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:grid;place-items:center;font-size:var(--fs-xs);font-weight:700}
.step-n[data-done="true"]{background:var(--accent);color:var(--accent-ink)}
.step-n[data-wait="true"]{background:var(--surface-3);color:var(--muted)}
.step-b{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 auto}
.step-t{font-size:var(--fs-md);font-weight:500}
.step-t[data-wait="true"]{color:var(--faint)}
.step-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}

.spinner{
  width:14px;height:14px;border-radius:50%;
  border:2px solid var(--line-2);border-top-color:var(--accent);
  animation:spin .9s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg)}}

.banner{display:flex;align-items:flex-start;gap:var(--s3);padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface)}
.banner-icon{flex:0 0 32px;width:32px;height:32px;border-radius:var(--r-md);background:var(--accent-dim);display:grid;place-items:center;color:var(--accent)}
.banner-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.banner-t{font-size:var(--fs-md);font-weight:600}
.banner-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}
.row{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.stack{display:flex;flex-direction:column;gap:var(--s2)}




.pop-wrap{
  position:relative;min-height:420px;
  display:grid;place-items:center;
  border:1px dashed var(--line-2);border-radius:var(--r-lg);
  background:var(--surface-2);
  padding:var(--s6);
}
.pop-note{
  position:absolute;left:var(--s4);top:var(--s3);
  font-size:var(--fs-xs);color:var(--faint);
}
.pop{
  position:relative;width:min(340px,100%);
  display:flex;flex-direction:column;gap:var(--s3);
  padding:var(--s4);border-radius:var(--r-lg);
  border:1px solid var(--line-2);background:var(--surface);
  box-shadow:var(--sh-lg);
  animation:pop-in 140ms var(--ease) both;
}
@keyframes pop-in{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
.pop-head{display:flex;align-items:center;gap:var(--s2)}
.pop-name{flex:1 1 auto;font-size:var(--fs-lg);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pop-close{flex:0 0 auto;width:26px;height:26px;border:0;border-radius:var(--r-sm);background:transparent;color:var(--faint);font-size:16px;line-height:1;transition:background var(--t-base) var(--ease)}
.pop-close:hover{background:var(--surface-2);color:var(--text)}
.facts{display:flex;flex-direction:column;gap:6px;margin:0}
.fact{display:flex;align-items:baseline;gap:var(--s2);font-size:var(--fs-sm)}
.fact dt{flex:0 0 auto;color:var(--faint);font-size:var(--fs-xs);min-width:64px}
.fact dd{flex:1 1 auto;margin:0;color:var(--text);font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pop-actions{display:flex;gap:var(--s2);padding-top:var(--s1);border-top:1px solid var(--line)}

.qr{
  width:180px;height:180px;border-radius:var(--r-md);
  background:#fff;display:grid;place-items:center;
  margin:0 auto;
  color:#111;font-size:var(--fs-xs);text-align:center;line-height:1.6;
}
.qr-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--s3)}
.qr-item{display:flex;flex-direction:column;align-items:center;gap:var(--s2);min-width:0}
.qr-label{font-size:var(--fs-sm);font-weight:600}
.qr-step{font-size:var(--fs-xs);color:var(--muted);text-align:center;line-height:1.5}

.steps{display:flex;flex-direction:column;gap:var(--s3)}
.step{display:flex;gap:var(--s3);align-items:flex-start}
.step-n{flex:0 0 22px;width:22px;height:22px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:grid;place-items:center;font-size:var(--fs-xs);font-weight:700}
.step-n[data-done="true"]{background:var(--accent);color:var(--accent-ink)}
.step-n[data-wait="true"]{background:var(--surface-3);color:var(--muted)}
.step-b{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 auto}
.step-t{font-size:var(--fs-md);font-weight:500}
.step-t[data-wait="true"]{color:var(--faint)}
.step-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}

.spinner{
  width:14px;height:14px;border-radius:50%;
  border:2px solid var(--line-2);border-top-color:var(--accent);
  animation:spin .9s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg)}}

.banner{display:flex;align-items:flex-start;gap:var(--s3);padding:var(--s3);border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface)}
.banner-icon{flex:0 0 32px;width:32px;height:32px;border-radius:var(--r-md);background:var(--accent-dim);display:grid;place-items:center;color:var(--accent)}
.banner-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.banner-t{font-size:var(--fs-md);font-weight:600}
.banner-d{font-size:var(--fs-xs);color:var(--muted);line-height:1.6}
.row{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.stack{display:flex;flex-direction:column;gap:var(--s2)}



/* ============================================================
   唯一的一条 bridge：把设计稿 body 上的排版落到 .app
   ------------------------------------------------------------
   设计稿在 body 上定字号、字体、颜色；插件跑在宿主的对话框里，不能改 body。
   所以把同样的声明放在 .app 上。

   除此之外不再有第二条针对 dsm-xdpool-* 的规则 —— 前面几轮那些
   「.dsm-xdpool-frame { grid-template-columns: ... }」和设计稿的 .app
   抢同一个属性，谁赢取决于加载顺序，改一次生效一次不生效一次，
   排查了很久才发现是规则在互相盖。一套类名配一份 CSS，不留 bridge。
   ============================================================ */

.app {
  font-family: var(--sans);
  font-size: var(--fs-sm);
  line-height: 1.65;
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}

/* ============================================================
   插件独有：没有图标的渠道用自己的首字母
   ------------------------------------------------------------
   设计稿的 .ch-logo 用 background-image 放厂商图标。但二十二家里有五家
   在任何构建里都没有图标（CodeArts / LobsterAI / Loom / 豆包 …），
   设计稿没画这种情况 —— 那五格会是一片空白。

   所以这一条是插件自己加的：有图标时用图标，没有就用首字母，
   尺寸和圆角与图标版一致，看起来是同一个控件而不是缺图。
   ============================================================ */

/* 字母版：把首字母居中画在同一个方块里，底色用渠道自己的 accent */
.ch-logo-letters{
  display:grid;place-items:center;
  font-size:var(--fs-xs);font-weight:800;letter-spacing:-.02em;
  line-height:1;color:#fff;text-transform:uppercase;
  background-color:var(--ch-logo-accent, var(--surface-3));
}
.ch-logo-letters::after{content:none}
/* 设计稿的 .ch-logo 用伪元素叠图形；字母版要把它关掉。 */
.ch-logo::after{content:none}
/* 有图标的渠道：图标铺满，覆盖字母版留下的底色。 */
/*
  有图标的渠道：插件把图放在 --ch-logo-icon 里（data URI），
  设计稿靠 background-image 上色 —— 这一条把它接起来。

  之前这里只写了 size/repeat/position，没有 background-image，
  于是所有有图标的渠道都画成一块空底色。
*/
.ch-logo-art{background-image:var(--ch-logo-icon, none);background-color:var(--ch-logo-accent, var(--surface-3));background-size:contain;background-repeat:no-repeat;background-position:center}

/* ============================================================
   插件独有：加载骨架与折叠箭头
   ------------------------------------------------------------
   设计稿是静态稿，没有画「数据还在路上」的样子。插件要真加载，
   所以这两条自己补：骨架用一条低对比的横线占位，箭头是个小三角。
   ============================================================ */

.skel-line{height:10px;border-radius:4px;background:var(--surface-3);opacity:.5;animation:xd-pulse 1.4s ease-in-out infinite}
.skel-line:nth-child(2n){width:72%}
@keyframes xd-pulse{0%,100%{opacity:.35}50%{opacity:.6}}


/* 插件用 span/b 写字实行，设计稿用 dt/dd —— 给前者补上同样的排布 */
.fact > .td-name{flex:0 0 auto;min-width:60px;color:var(--faint)}
.fact > .td-num{flex:1 1 auto;min-width:0;color:var(--text);font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fact > .td-num[data-tone="quiet"]{color:var(--faint)}

.strip-caret{width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--faint);transition:transform var(--t-base) var(--ease)}
.strip-caret[data-open="true"]{transform:rotate(180deg)}
`
