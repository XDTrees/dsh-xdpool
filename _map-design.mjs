/**
 * 把设计稿的精确尺寸映射到插件的类名上。
 *
 * 只做一件事：覆盖「几何」（尺寸、间距、圆角、字号、布局），
 * 不动颜色 —— 颜色由 tokens.ts 管，设计稿要的是绿色主色 + 中性炭底，
 * 那边的值已经按这个要求写好了。
 *
 * 每条映射都注明设计稿里的来源类名，方便反查。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = 'D:/dsh-home/_xdpool-src/src/client'

/** 设计稿类名 → 插件类名 + 要照抄的声明。 */
const MAP = [
  // ============ 第一层：功能页 ============
  {
    from: '.rail-brand + .rail-name + .rail-ver',
    to: '.dsm-xdpool-shellbrand, .dsm-xdpool-shellbrandtitle, .dsm-xdpool-shellversion',
    css: `
/* 品牌区：设计稿 .rail-brand —— padding 4 8 24，logo 26px */
.dsm-xdpool-shellbrand{
  display:flex;align-items:center;gap:8px;
  padding:4px 8px 24px;min-width:0;
}
.dsm-xdpool-shellavatar{
  width:26px;height:26px;border-radius:9px;
  object-fit:cover;flex:0 0 auto;
  box-shadow:0 0 0 1px var(--xd-line-2);
}
.dsm-xdpool-shellbrandcopy{display:flex;flex-direction:column;gap:0;min-width:0}
/* 名称：设计稿 .rail-name —— 衬线 15px/600 */
.dsm-xdpool-shellbrandtitle{
  font-family:var(--xd-font-head);
  font-size:15px;font-weight:600;line-height:20px;letter-spacing:0;
  color:var(--xd-text);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
/* 版本：设计稿 .rail-ver —— 12px，min-height 24，hover 转主色 */
.dsm-xdpool-shellversion{
  display:inline-flex;align-items:center;gap:3px;
  border:0;background:transparent;padding:0;min-height:24px;
  font-size:12px;line-height:16px;color:var(--xd-faint);
  font-variant-numeric:tabular-nums;text-decoration:none;cursor:pointer;
  transition:color 140ms var(--xd-ease-out);
}
.dsm-xdpool-shellversion:hover{color:var(--xd-primary)}
.dsm-xdpool-shellversion svg{width:10px;height:10px;opacity:.65}
.dsm-xdpool-shellversion:hover svg{opacity:1}
`,
  },

  // ============ 功能页行 ============
  {
    from: '.rail-item',
    to: '.dsm-xdpool-shellnavrow',
    css: `
/* 行：设计稿 .rail-item —— padding 7 8，圆角 6，13px */
.dsm-xdpool-shellnavrow{
  position:relative;
  display:flex;align-items:center;gap:8px;width:100%;
  padding:7px 8px;border:0;border-radius:6px;background:transparent;
  color:var(--xd-muted);
  font:inherit;font-size:13px;line-height:19px;text-align:left;
  cursor:pointer;min-width:0;
  transition:background 140ms var(--xd-ease-out),color 140ms var(--xd-ease-out);
}
.dsm-xdpool-shellnavrow:hover{background:var(--xd-surface);color:var(--xd-text)}
.dsm-xdpool-shellnavrow[data-active="true"]{
  background:var(--xd-surface);color:var(--xd-text);font-weight:500;
}
/* 选中竖条：设计稿 left:-8px，2px 宽 16px 高 */
.dsm-xdpool-shellnavrow[data-active="true"]::before{
  content:'';position:absolute;left:-8px;top:50%;transform:translateY(-50%);
  width:2px;height:16px;border-radius:999px;background:var(--xd-primary);
}
.dsm-xdpool-shellnavglyph{flex:0 0 auto;width:15px;font-size:11px;line-height:1;opacity:.7}
.dsm-xdpool-shellnavrow[data-active="true"] .dsm-xdpool-shellnavglyph{opacity:1;color:var(--xd-primary)}
.dsm-xdpool-shellnavlabel{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 计数：设计稿 .rail-item .badge —— 药丸，主色淡底 */
.dsm-xdpool-shellnavnum{
  flex:0 0 auto;font-size:12px;line-height:15px;
  padding:0 5px;border-radius:999px;
  background:var(--xd-primary-dim);color:var(--xd-primary);
  font-variant-numeric:tabular-nums;
}
`,
  },

  // ============ 第二层：条目栏 ============
  {
    from: '.list / .list-head / .list-title / .list-group / .ch',
    to: '.dsm-xdpool-rail 一族',
    css: `
/* 条目栏：设计稿 .list —— surface 底，右侧发丝线 */
.dsm-xdpool-rail{
  display:flex;flex-direction:column;
  background:var(--xd-surface);
  border-right:1px solid var(--xd-line);
  min-height:0;overflow:hidden;
  padding:0;
}
/* 头部：设计稿 .list-head —— padding 16 12 12，gap 8 */
.dsm-xdpool-railhead{
  display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
  gap:1px;border-radius:6px;background:var(--xd-line);
  overflow:hidden;margin:16px 12px 8px;
  flex:0 0 auto;
}
.dsm-xdpool-railstat{
  display:flex;flex-direction:column;gap:1px;
  padding:6px 8px;background:var(--xd-surface);min-width:0;
}
.dsm-xdpool-railstatvalue{
  font-size:15px;font-weight:600;letter-spacing:-0.02em;
  line-height:1.25;color:var(--xd-text);
  font-variant-numeric:tabular-nums;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dsm-xdpool-railstatunit{font-size:12px;font-weight:400;color:var(--xd-faint);margin-left:1px}
.dsm-xdpool-railstatlabel{
  font-size:12px;color:var(--xd-faint);line-height:1.4;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
/* 滚动区：设计稿 .list-scroll */
.dsm-xdpool-railscroll{
  flex:1 1 auto;min-height:0;min-width:0;
  overflow-y:auto;overflow-x:hidden;
  padding:0 8px 16px;
}
/* 分组标题：设计稿 .list-group —— 12px，前面一个 4px 点 */
.dsm-xdpool-railsection{
  display:flex;align-items:center;gap:6px;
  font-size:12px;font-weight:500;letter-spacing:.03em;
  color:var(--xd-faint);
  padding:16px 8px 4px;
}
.dsm-xdpool-railsection::before{
  content:'';width:4px;height:4px;border-radius:50%;
  background:var(--xd-primary);flex:0 0 auto;
}
.dsm-xdpool-railrow{
  position:relative;
  display:flex;align-items:center;gap:8px;width:100%;
  padding:6px 8px;border:0;border-radius:6px;background:transparent;
  color:var(--xd-muted);font:inherit;font-size:13px;line-height:19px;
  text-align:left;cursor:pointer;min-height:32px;min-width:0;
  transition:background 140ms var(--xd-ease-out),color 140ms var(--xd-ease-out);
}
.dsm-xdpool-railrow:hover{background:var(--xd-surface-2);color:var(--xd-text)}
.dsm-xdpool-railrow[data-active="true"]{
  background:var(--xd-surface-2);color:var(--xd-text);font-weight:500;
}
.dsm-xdpool-railrow[data-active="true"] .dsm-xdpool-railcount{color:var(--xd-primary)}
.dsm-xdpool-railmark{
  flex:0 0 20px;width:20px;height:20px;border-radius:6px;
  background-color:var(--xd-surface-3);
  display:grid;place-items:center;overflow:hidden;
}
.dsm-xdpool-railmark img{width:20px;height:20px;object-fit:contain}
.dsm-xdpool-railname{
  flex:1 1 auto;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dsm-xdpool-railcount{
  flex:0 0 auto;font-size:12px;color:var(--xd-faint);
  font-variant-numeric:tabular-nums;
}
/* 未登录：图标去色，名字更淡（设计稿 .ch[data-bound=false]） */
.dsm-xdpool-railrow[data-state="idle"] .dsm-xdpool-railmark{opacity:.4;filter:grayscale(1)}
.dsm-xdpool-railrow[data-state="idle"] .dsm-xdpool-railname{color:var(--xd-faint)}
`,
  },

  // ============ 内容区 ============
  {
    from: '.mhead / .mhead-name / .mbody',
    to: '.dsm-xdpool-pagehead 一族',
    css: `
/* 页头：设计稿 .mhead —— padding 24 32 16，下留 16 */
.dsm-xdpool-pagehead{
  display:flex;align-items:flex-start;justify-content:space-between;
  gap:16px;padding:24px 32px 16px;margin-bottom:16px;
  position:sticky;top:0;background:var(--xd-ground);z-index:5;
  flex-wrap:wrap;
}
.dsm-xdpool-pagetitles{
  display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;min-width:0;
}
/* 页标题：设计稿 .mhead-name —— 衬线 20px/600 */
.dsm-xdpool-pagetitle{
  margin:0;
  font-family:var(--xd-font-head);
  font-size:20px;font-weight:600;letter-spacing:-0.01em;line-height:1.3;
  color:var(--xd-text);
}
.dsm-xdpool-pageorg{font-size:12px;color:var(--xd-faint)}
.dsm-xdpool-pageactions{display:flex;gap:8px;flex-wrap:wrap}
/* 正文容器：设计稿 .mbody —— padding 0 32 48，gap 24 */
.dsm-xdpool-detailbody{
  padding:0 32px 48px;
  display:flex;flex-direction:column;gap:24px;
}
`,
  },
]

/* ---------- 追加到 detail-page-styles（账号池页注入的那份） ---------- */
const target = `${ROOT}/detail-page-styles.ts`
let text = readFileSync(target, 'utf8')
const marker = '/* xdpool-design 映射层 */'

if (text.includes(marker)) {
  // 幂等：先切掉旧的映射层
  text = text.slice(0, text.indexOf(marker))
}

const block = [
  '',
  marker,
  '/*',
  ' * 这一层照 D:\\dsh-home\\xdpool-design 的设计稿逐条对齐几何尺寸。',
  ' * 颜色不在这里 —— 归 tokens.ts（绿色主色 + 中性炭底）。',
  ' * 每条都标了设计稿来源类名，改的时候能反查。',
  ' */',
  ...MAP.map(entry => `\n/* ---- ${entry.from} ---- */\n${entry.css}`),
  '',
].join('\n')

// 插进模板字符串内部（找到最后一个反引号前）
const lastTick = text.lastIndexOf('`')
text = text.slice(0, lastTick) + block + '\n' + text.slice(lastTick)

writeFileSync(target, text, 'utf8')
console.log('映射层已写入，共', MAP.length, '组')
