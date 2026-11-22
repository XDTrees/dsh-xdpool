/**
 * 亮色主题：护眼绿。
 *
 * WHY THIS IS A SEPARATE FILE
 *
 * `design-css.ts` 是设计稿的产物（`scripts/extract-design-css.mjs` 生成，头注释写着
 * 「改样式请改设计稿源文件」），而且 `tests/design-parity.test.ts` 直接对它的文本做断言。
 * 把浅色变量塞进去，下一次重新抽取设计稿就会把它们整段冲掉，测试也会跟着漂。
 * 所以浅色单独成一份，只在 `.app[data-theme="light"]` 下覆盖变量 —— 组件一行都不用改。
 *
 * WHY `.app[data-theme]` AND NOT `prefers-color-scheme`
 *
 * 宿主本身是暗色，插件的底色又是自己画的（`.app { background: var(--bg) }`）。
 * 跟着系统走的话，暗色宿主里会出现一块亮色面板；用户要的是「在这个插件里选」，
 * 所以主题是插件自己的设置，跟着 `.app` 走，绝不碰宿主文档的 `:root`。
 *
 * 取色来源（可复核）
 *
 * 2026-11-22 用户提供的 WorkBuddy 截图（1920×1040），逐区域统计最高频色：
 *   侧栏底 #F9FBF7 / 内容块 #F3F7EC / 分隔 #DDE7D3 / 主强调绿 #416D08 / 主文字 #2D3A25。
 * 下面每个值的取舍都贴着这五个样本，只做对比度校正（见各行的注释）。
 *
 * WHY THE CHANNEL COLOURS ARE RE-DECLARED
 *
 * `--c-<id>` 在暗色下按 `oklch(70–78% …)` 提亮过（深底上才不脏）。同一份值搬到白底上
 * 会发白、读数困难，所以浅色下把亮度降到 52%、色相与彩度原样保留 —— 品牌身份不变，
 * 只是换成白底该有的明度。
 *
 * @module dsh-xdpool/client/theme-css
 */

/**
 * 浅色变量表 + 三处字面色修正。
 *
 * 字面色只有这几处：滚动条滑块、开关滑块的投影、`vision` 徽标的文字色。
 * 其余 1000+ 处颜色都走变量，所以覆盖变量就够 —— 这一点是逐条数过的，不是猜的。
 */
export const LIGHT_THEME_CSS = `
/* ============================================================
   亮色 · 护眼绿
   ------------------------------------------------------------
   底不用纯白 (1. 底色带一点绿，长时间看不刺眼)；
   面用纯白 (2. 卡片要比底更亮，层次才出得来)；
   主色是深橄榄绿 (3. 白底上对比 6.15:1，正文小字也够读)。
   ============================================================ */
.app[data-theme="light"] {
  /* 让浏览器把原生控件（滚动条、输入框、下拉）也按亮色画 */
  color-scheme: light;

  /* ---- 表面：底带绿，面纯白，控件层最深 ---- */
  --bg: #F7F9F3;
  --surface: #FFFFFF;
  --surface-2: #F3F7EC;
  --surface-3: #E9EFE0;

  /* ---- 文字：近黑的橄榄灰，不用纯黑（纯黑在绿底上发脏） ---- */
  --text: #26301C;     /* 白底 13.8:1 */
  --muted: #55614A;    /* 白底 6.6:1 */
  --faint: #66715C;    /* 白底 5.2:1；--surface-2 上 4.7:1，12px 也过 AA */

  /* ---- 分隔线：深色半透明，和暗色那套的「一道光」互为正片/负片 ---- */
  --line: rgba(38, 48, 28, .09);
  --line-2: rgba(38, 48, 28, .15);
  --line-3: rgba(38, 48, 28, .24);

  /* ---- 主色：截图里的 #416D08（选中态、按钮、开关打开态） ---- */
  --accent: #416D08;          /* 白底 6.15:1 */
  --accent-strong: #345A05;   /* hover 压深，白底 8.0:1 */
  --accent-dim: rgba(65, 109, 8, .10);
  --accent-line: rgba(65, 109, 8, .36);
  --accent-ink: #FFFFFF;      /* 主色块上的字：浅色主题里主色是深的，字要反过来 */

  /* ---- 状态色：暗色那套是给深底提亮的，白底上要压暗才读得清 ---- */
  --ok: #2E7D46;       /* 5.1:1 */
  --warn: #8A6410;     /* 5.4:1 */
  --danger: #B23A26;   /* 6.0:1 */
  --info: #2F6A9E;     /* 5.7:1 */

  /* ---- 阴影：绿调中性灰，不用纯黑（纯黑阴影在白底上是脏的） ---- */
  --sh-sm: 0 1px 2px rgba(45, 58, 37, .06);
  --sh-md: 0 6px 18px rgba(45, 58, 37, .10), 0 1px 3px rgba(45, 58, 37, .06);
  --sh-lg: 0 18px 44px rgba(45, 58, 37, .14), 0 2px 8px rgba(45, 58, 37, .08);

  /* ---- 渠道色：色相/彩度照抄暗色那份，只把亮度压到白底能读的 52% ---- */
  --c-codearts: oklch(52% 0.145 28);
  --c-buddy: oklch(52% 0.145 258);
  --c-workbuddy: oklch(52% 0.145 258);
  --c-lobsterai: oklch(52% 0.145 45);
  --c-qoder: oklch(52% 0.145 279);
  --c-qodercn: oklch(52% 0.145 284);
  --c-trae: oklch(52% 0.121 179);
  --c-cline: oklch(52% 0.145 278);
  --c-loomy: oklch(52% 0.145 264);
  --c-raccoon: oklch(52% 0.103 195);
  --c-minimax: oklch(52% 0.145 358);
  --c-zcode: oklch(52% 0.145 265);
  --c-gemini: oklch(52% 0.145 260);
  --c-autoclaw: oklch(52% 0.145 260);
  --c-autoclaw-cn: oklch(52% 0.132 255);
  --c-baizhi: oklch(52% 0.145 261);
  --c-monkeycode: oklch(52% 0.145 286);
  --c-monkeycode-intl: oklch(52% 0.145 291);
  --c-accio: oklch(52% 0.145 45);
  --c-astudio: oklch(52% 0.145 261);
  --c-marvis: oklch(52% 0.145 261);
  --c-doubao: oklch(52% 0.138 264);

  /* 下拉浮层的投影。组件里写的是 var(--xd-pop-shadow, 暗色的 rgba(0,0,0,.35))，
     同一档纯黑在浅底上比卡片自带的 --sh-* 重得多，会显脏，所以这里给柔化版。
     变量名带 xd- 前缀，避免和 design-css.ts 的命名空间撞车。 */
  --xd-pop-shadow: 0 8px 24px rgba(45, 58, 37, .16), 0 2px 6px rgba(45, 58, 37, .08);
}

/* 滚动条：暗色用白色半透明（深底上一道光），浅色必须换成深色半透明 */
.app[data-theme="light"] ::-webkit-scrollbar-thumb {
  background: rgba(38, 48, 28, .18);
  background-clip: content-box;
  border: 3px solid transparent;
}
.app[data-theme="light"] ::-webkit-scrollbar-thumb:hover {
  background: rgba(38, 48, 28, .30);
  background-clip: content-box;
}

/* 开关滑块：暗色那圈 40% 纯黑投影在白底上太硬 */
.app[data-theme="light"] .sw::after {
  box-shadow: 0 1px 2px rgba(38, 48, 28, .28), inset 0 1px 0 rgba(255, 255, 255, .9);
}

/* vision 徽标：原色是 oklch(76% .09 250)，白底上约 2.6:1，必须压暗 */
.app[data-theme="light"] .badge[data-kind="vision"] {
  border-color: rgba(42, 92, 138, .35);
  background: rgba(42, 92, 138, .10);
  color: #2A5C8A;
}

/* plan 徽标：文字走 --warn（已压暗），但边框/底色是字面值 oklch(76% .13 78 / .6 / .14)，
   白底上淡到几乎看不见，所以按同一色相重新给一档 */
.app[data-theme="light"] .badge[data-kind="plan"] {
  border-color: rgba(138, 100, 16, .40);
  background: rgba(138, 100, 16, .10);
}

/* free 徽标：边框原为 oklch(64% .14 155 / .55)，白底上偏荧光绿，压回主色相 */
.app[data-theme="light"] .badge[data-kind="free"] {
  border-color: rgba(65, 109, 8, .34);
}

/* 「已绑定」小标签：边框也是那个荧光绿的字面值，同样压回主色相 */
.app[data-theme="light"] .ch-state[data-bound="true"] {
  border-color: rgba(65, 109, 8, .34);
}

/* ---- 交互描边：暗色用 oklch(64% .14 155 / .45) 做 hover 高亮 ----
   该色合成到白底是 #A1D6BA、仅 1.64:1，既跑出色相又在浅底上几乎看不见，
   所以亮色改为主色相 70% 不透明度的橄榄绿（#67945B，3.52:1，达到 UI 边界 3:1） */
.app[data-theme="light"] .acct:hover,
.app[data-theme="light"] .card-ch:hover {
  border-color: rgba(65, 109, 8, .70);
}

/* 已选中的分段按钮 / 芯片：同样换成本主题的强调色描边 */
.app[data-theme="light"] .chip[aria-pressed="true"] {
  border-color: rgba(65, 109, 8, .70);
}

/* ---- 柱状图：入账柱原为 oklch(64% .14 155 / .55)（白底 1.83:1），hover 柱 oklch(72% .14 155)（2.34:1）
   两者在白底上都偏淡且偏薄荷绿，按主色相压暗，同时保留「hover 变亮」的原有关系 ---- */
.app[data-theme="light"] .col-bar[data-kind="in"] {
  background: oklch(56% .12 152);
}

.app[data-theme="light"] .col:hover .col-bar {
  background: oklch(64% .13 152);
}
`
