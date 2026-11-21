/**
 * The detail page's styles.
 *
 * The page is a column of bands, each one a labelled group, and its hierarchy comes from space and
 * one surface step — not from boxes inside boxes. A reader scanning it sees four questions in
 * order; the styling exists to keep that order visible.
 *
 * Every value is a token from `tokens.ts`, so the light and dark palettes both apply without a
 * rule here changing.
 *
 * @module dsh-xdpool/client/detail-page-styles
 */

export const DETAIL_PAGE_CSS = `
/* xdpool-design 映射层 */
/*
 * 这一层照 xdpool-design 目录 的设计稿逐条对齐几何尺寸。
 * 颜色不在这里 —— 归 tokens.ts（绿色主色 + 中性炭底）。
 * 每条都标了设计稿来源类名，改的时候能反查。
 */

/* ---- .rail-brand + .rail-name + .rail-ver ---- */

/* 品牌区：设计稿 .rail-brand —— padding 4 8 24，logo 26px */
.dsm-xdpool-shellbrand{
  display:flex;align-items:center;gap:var(--xd-s2);
  padding:var(--xd-s1) var(--xd-s2) 24px;min-width:0;
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
  font-size:var(--xd-fs-md);font-weight:600;line-height:20px;letter-spacing:0;
  color:var(--xd-text);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
/* 版本：设计稿 .rail-ver —— 12px，min-height 24，hover 转主色 */
.dsm-xdpool-shellversion{
  display:inline-flex;align-items:center;gap:3px;
  border:0;background:transparent;padding:0;min-height:24px;
  font-size:var(--xd-fs-xs);line-height:16px;color:var(--xd-faint);
  font-variant-numeric:tabular-nums;text-decoration:none;cursor:pointer;
  transition:color 140ms var(--xd-ease-out);
}
.dsm-xdpool-shellversion:hover{color:var(--xd-primary)}
.dsm-xdpool-shellversion svg{width:10px;height:10px;opacity:.65}
.dsm-xdpool-shellversion:hover svg{opacity:1}


/* ---- .rail-item ---- */

/* 行：设计稿 .rail-item —— padding 7 8，圆角 6，13px */
.dsm-xdpool-shellnavrow{
  position:relative;
  display:flex;align-items:center;gap:var(--xd-s2);width:100%;
  padding:7px 8px;border:0;border-radius:6px;background:transparent;
  color:var(--xd-muted);
  font:inherit;font-size:var(--xd-fs-sm);line-height:19px;text-align:left;
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
.dsm-xdpool-shellnavglyph{flex:0 0 auto;width:15px;font-size:var(--xd-fs-xs);line-height:1;opacity:.7}
.dsm-xdpool-shellnavrow[data-active="true"] .dsm-xdpool-shellnavglyph{opacity:1;color:var(--xd-primary)}
.dsm-xdpool-shellnavlabel{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 计数：设计稿 .rail-item .badge —— 药丸，主色淡底 */
.dsm-xdpool-shellnavnum{
  flex:0 0 auto;font-size:var(--xd-fs-xs);line-height:15px;
  padding:0 5px;border-radius:999px;
  background:var(--xd-primary-dim);color:var(--xd-primary);
  font-variant-numeric:tabular-nums;
}


/* ---- .list / .list-head / .list-title / .list-group / .ch ---- */

/* 条目栏：设计稿 .list —— surface 底，右侧发丝线 */
/* 头部：设计稿 .list-head —— padding 16 12 12，gap 8 */
/* 滚动区：设计稿 .list-scroll */
/* 分组标题：设计稿 .list-group —— 12px，前面一个 4px 点 */
.dsm-xdpool-railsection::before{
  content:'';width:4px;height:4px;border-radius:50%;
  background:var(--xd-primary);flex:0 0 auto;
}
.dsm-xdpool-railrow:hover{background:var(--xd-surface-2);color:var(--xd-text)}
.dsm-xdpool-railrow[data-active="true"]{
  background:var(--xd-surface-2);color:var(--xd-text);font-weight:500;
}
.dsm-xdpool-railmark img{width:20px;height:20px;object-fit:contain}
/* 未登录：图标去色，名字更淡（设计稿 .ch[data-bound=false]） */
.dsm-xdpool-railrow[data-state="idle"] .dsm-xdpool-railmark{opacity:.4;filter:grayscale(1)}
.dsm-xdpool-railrow[data-state="idle"] .dsm-xdpool-railname{color:var(--xd-faint)}


/* ---- the page ------------------------------------------------------------ */
.dsm-xdpool-page{
  display:flex;
  flex-direction:column;
  gap:14px;
  padding:14px;
  min-width:0;
  min-height:0;
}

/* ---- header -------------------------------------------------------------- */
/*
  页头：设计稿 .mhead。

  这一份在 DETAIL_PAGE_CSS 里，比 POOL_SHELL_CSS 后加载 —— 所以它必须把
  padding 写全。之前只写了 display/gap，浏览器按「未声明」处理，等于把
  pool-shell 那份的 24/32/16 擦成 0，页头就贴到顶上去了。
*/
.dsm-xdpool-pagehead{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:var(--xd-s4);
  padding:var(--xd-s5) var(--xd-s6) var(--xd-s4);
  margin-bottom:16px;
  flex-wrap:wrap;
  min-width:0;
}
.dsm-xdpool-pagename{
  margin:0;
  font-family:var(--xd-font-head);
  font-size:16px;
  font-weight:600;
  line-height:23px;
  color:var(--xd-text);
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.dsm-xdpool-pagestate{
  flex:0 0 auto;
  font-size:var(--xd-fs-xs);
  line-height:16px;
  padding:1px 8px;
  border-radius:999px;
  border:1px solid var(--xd-divider);
  color:var(--xd-faint);
}
.dsm-xdpool-pagestate[data-state="ok"]{
  border-color:color-mix(in srgb, var(--xd-primary) 45%, transparent);
  background:color-mix(in srgb, var(--xd-primary) 12%, transparent);
  color:var(--xd-primary);
}
.dsm-xdpool-pagestate[data-state="error"]{
  border-color:color-mix(in srgb, var(--xd-danger) 45%, transparent);
  background:color-mix(in srgb, var(--xd-danger) 10%, transparent);
  color:var(--xd-danger);
}
.dsm-xdpool-pagenote{
  margin:0;
  font-size:var(--xd-fs-xs);
  line-height:18px;
  color:var(--xd-muted);
}
.dsm-xdpool-pageactions{
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:wrap;
  flex:0 1 auto;
}
.dsm-xdpool-pagebtn{
  padding:5px 11px;
  border-radius:8px;
  border:1px solid var(--xd-line-2);
  background:transparent;
  color:var(--xd-text);
  font:inherit;
  font-size:var(--xd-fs-xs);
  line-height:16px;
  cursor:pointer;
  white-space:nowrap;
  transition:background var(--xd-dur-sm) var(--xd-ease-out),border-color var(--xd-dur-sm) var(--xd-ease-out);
}
.dsm-xdpool-pagebtn:hover:not(:disabled){background:var(--xd-surface);border-color:var(--xd-line-3)}
.dsm-xdpool-pagebtn:disabled{opacity:.45;cursor:default}
.dsm-xdpool-pagebtn-primary{
  border-color:transparent;
  background:var(--xd-primary);
  color:var(--xd-on-primary);
}
.dsm-xdpool-pagebtn-primary:hover:not(:disabled){background:var(--xd-primary);filter:brightness(1.08)}

/* ---- figures ------------------------------------------------------------- */
.dsm-xdpool-statrow{
  display:grid;
  grid-template-columns:repeat(3, minmax(0,1fr));
  gap:var(--xd-s2);
  min-width:0;
}
/* 统计格：设计稿 .kpi —— padding 12、圆角 12、带一条发丝边框。 */
.dsm-xdpool-statcell{
  display:flex;
  flex-direction:column;
  gap:2px;
  padding:var(--xd-s3);
  border-radius:var(--xd-radius-panel);
  border:1px solid var(--xd-line);
  background:var(--xd-surface);
  min-width:0;
}
.dsm-xdpool-statlabel{
  font-size:var(--xd-fs-xs);
  line-height:16px;
  color:var(--xd-faint);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.dsm-xdpool-statvalue{
  display:flex;
  align-items:baseline;
  gap:2px;
  font-size:24px;
  font-weight:700;
  letter-spacing:-0.03em;
  line-height:1.2;
  color:var(--xd-text);
  font-variant-numeric:tabular-nums;
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.dsm-xdpool-statunit{font-size:var(--xd-fs-xs);font-weight:400;color:var(--xd-faint)}

/* ---- usage mode + automation, side by side ------------------------------- */
/*
  Two policies about one subject, so they sit together and above the accounts.

  Side by side rather than stacked: each is one short control, and stacking them wasted a screen
  band on two lines of text.
*/

/*
  账号使用方式：五个档位的分段控件。

  之前这里是一行静态文字「跟随池设置」—— 读者能看见状态，但没有地方改，
  而写接口一直都在。控件把那个能力露出来。

  五档在窄卡里会换行，所以用 flex-wrap 而不是 grid：让它按可用宽度自己排，
  挤的时候换成两行，而不是把「轮换」压成「轮
换」。
*/
/*
  积分自动化：开关 + 今日已领。

  开关回答「会不会自动领」，分数回答「今天领到了没」。分开两个控件会让读者
  在两个地方各看一次，所以并排放，中间留一个词的距离。
*/
.dsm-xdpool-automationrow{
  display:flex;
  align-items:center;
  gap:var(--xd-s2);
  min-width:0;
}
.dsm-xdpool-automationnote{
  font-size:var(--xd-fs-xs);
  line-height:18px;
  color:var(--xd-muted);
  font-variant-numeric:tabular-nums;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.dsm-xdpool-distseg{
  display:flex;
  flex-wrap:wrap;
  gap:2px;
  padding:2px;
  border-radius:6px;
  background:var(--xd-surface-2);
}
.dsm-xdpool-distseg>button{
  flex:0 0 auto;
  border:0;
  border-radius:5px;
  background:transparent;
  color:var(--xd-muted);
  font:inherit;
  font-size:var(--xd-fs-xs);
  line-height:19px;
  padding:0 10px;
  min-height:24px;
  white-space:nowrap;
  cursor:pointer;
  transition:background var(--xd-dur-sm) var(--xd-ease-out),color var(--xd-dur-sm) var(--xd-ease-out);
}
.dsm-xdpool-distseg>button:hover{color:var(--xd-text)}
.dsm-xdpool-distseg>button[aria-pressed="true"]{
  background:var(--xd-surface-3);
  color:var(--xd-text);
  font-weight:500;
}
.dsm-xdpool-distseg>button:disabled{opacity:.45;cursor:default}

.dsm-xdpool-policies{
  display:grid;
  grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));
  gap:var(--xd-s2);
  min-width:0;
}
/* 策略卡：设计稿 .policy —— padding 12、圆角 12、发丝边框、gap 8。 */
.dsm-xdpool-policy{
  display:flex;
  flex-direction:column;
  gap:var(--xd-s2);
  padding:var(--xd-s3);
  border-radius:var(--xd-radius-panel);
  border:1px solid var(--xd-line);
  background:var(--xd-surface);
  min-width:0;
}
.dsm-xdpool-policytitle{
  font-size:var(--xd-fs-xs);
  line-height:15px;
  font-weight:600;
  color:var(--xd-muted);
}

/* ---- a band -------------------------------------------------------------- */
.dsm-xdpool-band{
  display:flex;
  flex-direction:column;
  gap:var(--xd-s2);
  min-width:0;
}
.dsm-xdpool-bandhead{
  display:flex;
  align-items:center;
  gap:var(--xd-s2);
  flex-wrap:wrap;
  min-width:0;
}
.dsm-xdpool-bandtitle{
  font-size:var(--xd-fs-xs);
  line-height:18px;
  font-weight:600;
  color:var(--xd-text);
  white-space:nowrap;
}
.dsm-xdpool-bandcount{
  font-size:var(--xd-fs-xs);
  line-height:15px;
  padding:0 6px;
  border-radius:999px;
  background:var(--xd-surface-2);
  color:var(--xd-faint);
  font-variant-numeric:tabular-nums;
}
.dsm-xdpool-bandactions{
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:wrap;
  margin-left:auto;
  min-width:0;
}
.dsm-xdpool-bandempty{
  margin:0;
  padding:14px;
  border-radius:10px;
  border:1px dashed var(--xd-divider);
  font-size:var(--xd-fs-xs);
  line-height:17px;
  color:var(--xd-faint);
  text-align:center;
}

/* ---- one account, one card ---------------------------------------------- */
/*
  A card each, because the numbers belong to the credential.

  As rows they had to line up in columns shared with every other account, and an account with an
  error has no numbers — so the columns only worked when every account happened to be healthy.
*/
/* 账号卡网格：设计稿 .accts —— 248px 起，展开的卡只把自己撑高。 */
.dsm-xdpool-acctcards{
  display:grid;
  grid-template-columns:repeat(auto-fill, minmax(248px, 1fr));
  gap:var(--xd-s2);
  align-items:start;
  grid-auto-rows:min-content;
  min-width:0;
}
/* 账号卡：设计稿 .acct —— padding 12、圆角 12、gap 8。 */
.dsm-xdpool-acctcard{
  display:flex;
  flex-direction:column;
  gap:var(--xd-s2);
  padding:var(--xd-s3);
  border-radius:12px;
  border:1px solid var(--xd-line);
  background:var(--xd-surface);
  min-width:0;
  transition:border-color var(--xd-dur-sm) var(--xd-ease-out);
}
.dsm-xdpool-acctcard{cursor:pointer}
.dsm-xdpool-acctcard:hover{border-color:color-mix(in srgb, var(--xd-primary) 40%, var(--xd-divider))}
/* The card's own controls must not open the window as a side effect. */
.dsm-xdpool-acctcard button{cursor:pointer}
.dsm-xdpool-acctcard button:active{transform:scale(.97)}
.dsm-xdpool-acctcard[data-off="true"]{opacity:.6}
.dsm-xdpool-acctcardhead{
  display:flex;
  align-items:center;
  gap:7px;
  min-width:0;
}
.dsm-xdpool-acctdot{
  flex:0 0 6px;
  width:6px;
  height:6px;
  border-radius:999px;
  background:var(--xd-faint);
}
.dsm-xdpool-acctdot[data-on="true"]{background:var(--xd-primary)}
.dsm-xdpool-acctcardname{
  flex:1 1 auto;
  min-width:0;
  font-size:var(--xd-fs-xs);
  line-height:18px;
  font-weight:600;
  color:var(--xd-text);
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.dsm-xdpool-acctcardset{flex:0 0 auto}
.dsm-xdpool-acctcarderror{
  margin:0;
  padding:6px 8px;
  border-radius:6px;
  background:color-mix(in srgb, var(--xd-danger) 10%, transparent);
  font-size:var(--xd-fs-xs);
  line-height:16px;
  color:var(--xd-danger);
  overflow-wrap:anywhere;
}


/* ---- 积分总数 + 可折叠明细 --------------------------------------------- */
/*
  卡片上先给总数，分项折在 <details> 里。

  到期提示和总数同行：读者看「还剩多少」时紧接着要知道「什么时候清掉」，
  分开两行会让第二个问题变成要去别处找。
*/
/* 账号卡上那条细进度条：3px，主色，低于 15% 转警告色。 */
.dsm-xdpool-acctbar{
  height:3px;
  border-radius:999px;
  background:var(--xd-surface-3);
  overflow:hidden;
}
.dsm-xdpool-acctbar>span{
  display:block;
  height:100%;
  border-radius:999px;
  background:var(--xd-primary);
  transition:width var(--xd-dur-sm) var(--xd-ease-out);
}
.dsm-xdpool-acctbar[data-low="true"]>span{background:var(--xd-warn)}

.dsm-xdpool-accttotal{
  display:flex;
  align-items:baseline;
  gap:6px;
  flex-wrap:wrap;
  min-width:0;
}
.dsm-xdpool-accttotalval{
  font-size:var(--xd-fs-xl);
  font-weight:700;
  letter-spacing:-.03em;
  line-height:1.2;
  color:var(--xd-text);
  font-variant-numeric:tabular-nums;
}
.dsm-xdpool-accttotalval .dsm-xdpool-statunit{
  font-size:var(--xd-fs-xs);
  font-weight:400;
  color:var(--xd-faint);
  margin-left:2px;
}

/*
  <details> 的展开靠浏览器，但默认的三角在我们这套配色里太吵，换成一个 4px 的箭头。
  收起时明细必须真正不占位：没写 display:none 的 dl 会带着默认 margin 参与布局，
  把下面一行顶下去 —— 之前正是这个原因让卡片看起来「叠字」。
*/
.dsm-xdpool-acctdetail{
  margin-top:auto;
}
.dsm-xdpool-acctdetail>summary{
  display:inline-flex;
  align-items:center;
  gap:var(--xd-s1);
  min-height:24px;
  padding:0 9px;
  border:1px solid var(--xd-line-2);
  border-radius:6px;
  background:transparent;
  color:var(--xd-muted);
  font-size:var(--xd-fs-xs);
  line-height:1;
  cursor:pointer;
  list-style:none;
  transition:background var(--xd-dur-sm) var(--xd-ease-out),color var(--xd-dur-sm) var(--xd-ease-out);
}
.dsm-xdpool-acctdetail>summary::-webkit-details-marker{display:none}
.dsm-xdpool-acctdetail>summary::after{
  content:'';
  width:0;height:0;
  border-left:3px solid transparent;
  border-right:3px solid transparent;
  border-top:4px solid currentColor;
  opacity:.65;
  transition:transform var(--xd-dur-sm) var(--xd-ease-out);
}
.dsm-xdpool-acctdetail[open]>summary::after{transform:rotate(180deg)}
.dsm-xdpool-acctdetail>summary:hover{
  background:var(--xd-surface-2);
  color:var(--xd-text);
}
.dsm-xdpool-acctdetail:not([open])>.dsm-xdpool-acctcardfacts{display:none}
.dsm-xdpool-acctdetail[open]>.dsm-xdpool-acctcardfacts{
  margin-top:6px;
  padding-top:6px;
  border-top:1px solid var(--xd-line);
}

/* ---- facts as a definition list ----------------------------------------- */
.dsm-xdpool-acctcardfacts{
  display:flex;
  flex-direction:column;
  gap:var(--xd-s1);
  margin:0;
  min-width:0;
}
.dsm-xdpool-fact{
  display:flex;
  align-items:baseline;
  gap:var(--xd-s2);
  min-width:0;
}
.dsm-xdpool-fact>dt{
  flex:0 0 auto;
  font-size:var(--xd-fs-xs);
  line-height:16px;
  color:var(--xd-faint);
  white-space:nowrap;
}
.dsm-xdpool-fact>dd{
  flex:1 1 auto;
  min-width:0;
  margin:0;
  display:flex;
  align-items:baseline;
  gap:6px;
  font-size:var(--xd-fs-xs);
  line-height:16px;
  color:var(--xd-text);
  font-variant-numeric:tabular-nums;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.dsm-xdpool-fact>dd[data-done="true"]{color:var(--xd-primary)}
.dsm-xdpool-factexpiry{
  font-size:var(--xd-fs-xs);
  line-height:16px;
  color:var(--xd-faint);
}
.dsm-xdpool-factexpiry[data-soon="true"]{color:var(--xd-danger);font-weight:600}
.dsm-xdpool-fact-wide{flex-direction:column;gap:2px;align-items:flex-start}
.dsm-xdpool-fact-wide>dd{white-space:normal;overflow-wrap:anywhere}

.dsm-xdpool-acctcardfoot{
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:wrap;
  margin-top:auto;
  padding-top:2px;
}

/* ---- an account's window ------------------------------------------------- */
/*
  Anchored to its card, fixed to the viewport.

  Fixed rather than absolute because the account list scrolls inside a bounded column: an absolute
  window would be clipped by that column the moment the card sat near its edge.

  The entrance is 6px and 120ms. Rule 1f: a control opening what it controls grows from its own
  corner — enough to read as "this came from the card I clicked", short enough that the reader is
  never waiting on it.
*/
/* 账号浮窗：设计稿 .pop —— 宽 340、padding 16、圆角 12、gap 12。 */
.dsm-xdpool-acctwindow{
  position:fixed;
  z-index:80;
  width:min(340px, calc(100vw - 32px));
  display:flex;
  flex-direction:column;
  gap:var(--xd-s3);
  padding:var(--xd-s4);
  border-radius:12px;
  border:1px solid var(--xd-line-2);
  background:var(--xd-surface);
  box-shadow:var(--xd-shadow);
  transform-origin:top left;
  animation:dsm-xdpool-window-in 120ms var(--xd-ease-out) both;
}
@keyframes dsm-xdpool-window-in{
  from{opacity:0;transform:translateY(-4px) scale(.98)}
  to{opacity:1;transform:none}
}
.dsm-xdpool-acctwindowhead{
  display:flex;
  align-items:center;
  gap:7px;
  min-width:0;
}
.dsm-xdpool-acctwindowname{
  flex:1 1 auto;
  min-width:0;
  /* 设计稿 .pop-name：18px/600 —— 浮层标题要比正文明显大，它是这个窗的名字 */
  font-size:var(--xd-fs-lg);
  line-height:24px;
  font-weight:600;
  color:var(--xd-text);
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  font-family:var(--xd-font-head);
}
.dsm-xdpool-acctwindowclose{
  flex:0 0 auto;
  /* 设计稿 .pop-close：26×26 —— 20px 的关闭键在触屏上点不准 */
  width:26px;
  height:26px;
  border:0;
  border-radius:6px;
  background:transparent;
  color:var(--xd-faint);
  font-size:16px;
  line-height:1;
  cursor:pointer;
  transition:background var(--xd-dur-sm) var(--xd-ease-out);
}
.dsm-xdpool-acctwindowclose:hover{background:var(--xd-surface-2);color:var(--xd-text)}
.dsm-xdpool-acctwindowid{
  font-family:var(--xd-font-mono);
  font-size:var(--xd-fs-xs);
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

/* ---- the switch --------------------------------------------------------- */
.dsm-xdpool-switch{
  position:relative;
  flex:0 0 auto;
  width:32px;
  height:18px;
  padding:0;
  border:0;
  border-radius:999px;
  background:var(--xd-surface-2);
  box-shadow:inset 0 0 0 1px var(--xd-divider);
  cursor:pointer;
  transition:background var(--xd-dur-sm) var(--xd-ease-out);
}
.dsm-xdpool-switch-sm{width:28px;height:16px}
.dsm-xdpool-switch[data-on="true"]{background:var(--xd-primary);box-shadow:none}
.dsm-xdpool-switch:disabled{opacity:.45;cursor:default}
.dsm-xdpool-switchknob{
  position:absolute;
  top:2px;
  left:2px;
  width:14px;
  height:14px;
  border-radius:999px;
  background:var(--xd-surface);
  transition:transform var(--xd-dur-sm) var(--xd-ease-overshoot);
}
.dsm-xdpool-switch-sm .dsm-xdpool-switchknob{width:12px;height:12px}
.dsm-xdpool-switch[data-on="true"] .dsm-xdpool-switchknob{transform:translateX(14px)}
.dsm-xdpool-switch-sm[data-on="true"] .dsm-xdpool-switchknob{transform:translateX(12px)}

/* ---- a small button ----------------------------------------------------- */
.dsm-xdpool-tinybtn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-height:24px;
  padding:0 9px;
  border-radius:6px;
  border:1px solid var(--xd-line-2);
  background:transparent;
  color:var(--xd-muted);
  font:inherit;
  font-size:var(--xd-fs-xs);
  line-height:16px;
  white-space:nowrap;
  cursor:pointer;
  transition:background var(--xd-dur-sm) var(--xd-ease-out),color var(--xd-dur-sm) var(--xd-ease-out);
}
.dsm-xdpool-tinybtn:hover:not(:disabled){background:var(--xd-surface-2);color:var(--xd-text)}
.dsm-xdpool-tinybtn:disabled{opacity:.45;cursor:default}
.dsm-xdpool-tinybtn-primary{border-color:transparent;background:var(--xd-primary);color:var(--xd-on-primary)}
.dsm-xdpool-tinybtn-danger:hover:not(:disabled){background:color-mix(in srgb, var(--xd-danger) 12%, transparent);color:var(--xd-danger)}

.dsm-xdpool-search{
  min-width:110px;
  max-width:170px;
  padding:3px 9px;
  border-radius:6px;
  border:1px solid var(--xd-divider);
  background:var(--xd-surface);
  color:var(--xd-text);
  font:inherit;
  font-size:var(--xd-fs-xs);
  line-height:17px;
}
.dsm-xdpool-search::placeholder{color:var(--xd-faint)}

/* ---- the model list ----------------------------------------------------- */
/*
  Its own scroll area with a height cap.

  A channel with 91 models would otherwise push the accounts off the screen, and the accounts are
  what the reader came for; the models are the setting they adjust less often.
*/
.dsm-xdpool-modellist{
  display:flex;
  flex-direction:column;
  gap:1px;
  margin:0;
  padding:0;
  list-style:none;
  max-height:44vh;
  overflow-y:auto;
  overscroll-behavior:contain;
  min-width:0;
}
.dsm-xdpool-modellist::-webkit-scrollbar{width:8px}
.dsm-xdpool-modellist::-webkit-scrollbar-thumb{background:color-mix(in srgb, var(--xd-text) 16%, transparent);border-radius:999px}
/* ---- 模型行：两行布局 + 徽章 + 档位下拉 -------------------------------- */
/*
  一行放不下「名字 + 三个徽章 + 倍率 + 档位」。挤下来的结果是每样只剩两个字宽，
  模型名被截成 "deepseek-v4..."，谁是谁全靠猜。
  分两行之后名字能完整显示，档位下拉有固定位置，扫一眼就知道能改。
*/
/*
  模型行：设计稿 .model —— padding 8 12、底边一条发丝线分隔。

  之前是圆角胶囊 + 悬停换底色。设计稿的列表用横线分隔：模型是一个一个往下
  排的清单，圆角块会让每一行都像一个独立的按钮，读者会以为点它才有反应。
*/
.dsm-xdpool-modelrow{
  display:grid;
  grid-template-columns:auto minmax(0,1fr) auto;
  align-items:center;
  gap:0 12px;
  padding:var(--xd-s2) var(--xd-s3);
  border-bottom:1px solid var(--xd-line);
  min-width:0;
}
.dsm-xdpool-modelrow:last-child{border-bottom:0}
.dsm-xdpool-modelmain{
  display:flex;
  flex-direction:column;
  gap:2px;
  min-width:0;
}
.dsm-xdpool-modeltop{
  display:flex;
  align-items:center;
  gap:5px;
  min-width:0;
  flex-wrap:wrap;
}
.dsm-xdpool-modelsub{
  display:flex;
  align-items:center;
  gap:6px;
}

/*
  徽章：描边胶囊，不做实色填充。

  三种各自一色，但都压得很低 —— 一行里最多三个徽章，实色会把模型名淹掉。
  免费=主色绿、订阅=金色、图像=蓝色，和设计稿一致。
*/
.dsm-xdpool-mbadge{
  flex:0 0 auto;
  /* 12px 是无障碍下限，11 会让「免费」两个字在小屏上糊 */
  font-size:var(--xd-fs-xs);
  line-height:16px;
  padding:0 6px;
  border-radius:999px;
  border:1px solid var(--xd-line-2);
  color:var(--xd-faint);
  white-space:nowrap;
}
.dsm-xdpool-mbadge[data-kind="free"]{
  border-color:color-mix(in oklch, var(--xd-primary) 42%, transparent);
  background:color-mix(in oklch, var(--xd-primary) 13%, transparent);
  color:var(--xd-primary);
  font-weight:600;
}
.dsm-xdpool-mbadge[data-kind="plan"]{
  border-color:color-mix(in oklch, var(--xd-warn) 42%, transparent);
  background:color-mix(in oklch, var(--xd-warn) 12%, transparent);
  color:var(--xd-warn);
  font-weight:600;
}
.dsm-xdpool-mbadge[data-kind="vision"]{
  border-color:color-mix(in oklch, var(--xd-info) 42%, transparent);
  background:color-mix(in oklch, var(--xd-info) 12%, transparent);
  color:var(--xd-info);
}

/* 倍率：免费时用主色并加粗，一眼看出这个不花积分 */
.dsm-xdpool-modelmult[data-free="true"]{
  color:var(--xd-primary);
  font-weight:600;
}

/*
  档位下拉。

  原生 <select> 而不是自绘菜单：它在手机上会拉起系统选择器，键盘也能用，
  自己画一个只是把这些白白丢掉。外观用 appearance:none 抹平，箭头自己画。
*/
/* 只读的档位 chip：和下拉同一个位置、同一个字号，只是不可点。 */
.dsm-xdpool-ctxchip{
  flex:0 0 auto;
  font-size:var(--xd-fs-xs);
  line-height:15px;
  padding:0 7px;
  min-height:24px;
  display:inline-flex;
  align-items:center;
  border-radius:6px;
  border:1px solid var(--xd-line);
  color:var(--xd-faint);
  font-variant-numeric:tabular-nums;
  white-space:nowrap;
}

.dsm-xdpool-ctxselect{
  appearance:none;
  flex:0 0 auto;
  border:1px solid var(--xd-line-2);
  background-color:var(--xd-surface);
  color:var(--xd-text);
  font:inherit;
  font-size:var(--xd-fs-xs);
  line-height:15px;
  padding:0 20px 0 7px;
  min-height:24px;
  height:24px;
  border-radius:6px;
  cursor:pointer;
  font-variant-numeric:tabular-nums;
  background-image:
    linear-gradient(45deg, transparent 50%, currentColor 50%),
    linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position:
    calc(100% - 11px) 10px,
    calc(100% - 7px) 10px;
  background-size:4px 4px, 4px 4px;
  background-repeat:no-repeat;
}
.dsm-xdpool-ctxselect:focus-visible{
  outline:2px solid var(--xd-primary);
  outline-offset:1px;
}
.dsm-xdpool-ctxselect:disabled{opacity:.45;cursor:default}
.dsm-xdpool-ctxselect>option{background:var(--xd-surface);color:var(--xd-text)}

.dsm-xdpool-modelrow{
  display:flex;
  align-items:center;
  gap:var(--xd-s2);
  padding:5px 8px;
  border-radius:6px;
  min-width:0;
}
.dsm-xdpool-modelrow:hover{background:var(--xd-surface-2)}
.dsm-xdpool-modelrow[data-off="true"] .dsm-xdpool-modelname{color:var(--xd-faint)}
.dsm-xdpool-modelname{
  flex:1 1 auto;
  min-width:0;
  font-size:var(--xd-fs-xs);
  line-height:17px;
  color:var(--xd-text);
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.dsm-xdpool-modelvip{
  flex:0 0 auto;
  font-size:var(--xd-fs-xs);
  line-height:14px;
  padding:0 5px;
  border-radius:999px;
  border:1px solid color-mix(in srgb, var(--xd-accent) 55%, transparent);
  color:var(--xd-muted);
}
.dsm-xdpool-modelmult{
  flex:0 0 auto;
  font-size:var(--xd-fs-xs);
  line-height:15px;
  color:var(--xd-faint);
  font-variant-numeric:tabular-nums;
}
.dsm-xdpool-modelctx{
  flex:0 0 auto;
  min-width:34px;
  text-align:right;
  font-size:var(--xd-fs-xs);
  line-height:15px;
  color:var(--xd-faint);
  font-variant-numeric:tabular-nums;
}

/* ---- a toggle with a label ---------------------------------------------- */
.dsm-xdpool-toggle{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  min-width:0;
  cursor:pointer;
}
.dsm-xdpool-togglecopy{display:flex;flex-direction:column;gap:1px;min-width:0}
.dsm-xdpool-togglelabel{font-size:var(--xd-fs-xs);line-height:17px;color:var(--xd-text)}
.dsm-xdpool-togglehint{font-size:var(--xd-fs-xs);line-height:16px;color:var(--xd-faint)}

/* ---- narrow: figures stack ---------------------------------------------- */
@container xdpool (max-width:560px){
  .dsm-xdpool-statrow{grid-template-columns:repeat(2, minmax(0,1fr))}
  .dsm-xdpool-statcell-wide{grid-column:1/-1}
  .dsm-xdpool-policies{grid-template-columns:minmax(0,1fr)}
  .dsm-xdpool-acctcards{grid-template-columns:minmax(0,1fr)}
  .dsm-xdpool-page{padding:10px;gap:var(--xd-s3)}
  .dsm-xdpool-modellist{max-height:36vh}
}

@media (prefers-reduced-motion:reduce){
  .dsm-xdpool-pagebtn,.dsm-xdpool-tinybtn,.dsm-xdpool-switch,.dsm-xdpool-switchknob,.dsm-xdpool-acctcard{transition:none}
}`
