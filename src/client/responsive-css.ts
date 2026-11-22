/**
 * 窄屏 / 手机适配样式。
 *
 * 设计稿 mobile.css 用 @media (max-width) 按屏幕宽度切换，但这个插件多数时候开在
 * DSH 的设置对话框里：屏幕 1920 宽，插件只有 600 像素，媒体查询永远不触发，
 * 三列硬挤在一起，详情列只剩不到 100 像素，文字一个字一行。
 *
 * 所以改成按 .app 自己的宽度分档（shell.tsx 量出来写到 data-w 上）：
 *   mid     功能页栏收成图标，三列仍在
 *   narrow  功能页栏图标 + 渠道列表变成顶部横滑条 + 详情占满
 *   phone   功能页栏变底部 dock（由设计稿 mobile.css 的 640px 段转写）
 *
 * 改设计稿 mobile.css 时这里要跟着改。
 */
export const RESPONSIVE_CSS = `
/* 按插件自己的宽度（不是屏幕宽度）分四档：wide >=1100 / mid >=820 / narrow >=560 / phone。
   宽度由 shell.tsx 的 ResizeObserver 写到 .app[data-w] 上。所有选择器都以 .app 开头，不漏到宿主。 */
.app[data-w="mid"]{grid-template-columns:64px 232px minmax(0,1fr)}
.app-wide.app[data-w="mid"]{grid-template-columns:64px minmax(0,1fr)}
.app[data-w="mid"] .rail,.app[data-w="narrow"] .rail{padding:var(--s3) 6px;align-items:stretch}
.app[data-w="mid"] .rail-brand,.app[data-w="narrow"] .rail-brand{flex-direction:column;align-items:center;gap:4px;padding:0 0 var(--s4)}
.app[data-w="mid"] .rail-brand>span,.app[data-w="narrow"] .rail-brand>span{display:flex;flex-direction:column;align-items:center}
.app[data-w="mid"] .rail-name,.app[data-w="narrow"] .rail-name{display:none}
.app[data-w="mid"] .rail-ver,.app[data-w="narrow"] .rail-ver{font-size:10px;justify-content:center;white-space:nowrap}
.app[data-w="mid"] .rail-ver svg,.app[data-w="narrow"] .rail-ver svg{width:8px;height:8px}
.app[data-w="mid"] .rail-item,.app[data-w="narrow"] .rail-item{justify-content:center;padding:0;min-height:36px;width:100%}
.app[data-w="mid"] .rail-item>span,.app[data-w="narrow"] .rail-item>span{display:none}
.app[data-w="mid"] .rail-item svg,.app[data-w="narrow"] .rail-item svg{flex:0 0 17px;width:17px;height:17px}
.app[data-w="mid"] .rail-item[aria-current="page"]::before,.app[data-w="narrow"] .rail-item[aria-current="page"]::before{left:-6px}
.app[data-w="mid"] .rail-foot .rail-item,.app[data-w="narrow"] .rail-foot .rail-item{padding:0}
.app[data-w="narrow"]{grid-template-columns:56px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}
.app-wide.app[data-w="narrow"]{grid-template-columns:56px minmax(0,1fr);grid-template-rows:minmax(0,1fr)}
.app[data-w="narrow"] .rail{grid-row:1 / -1;grid-column:1}
.app[data-w="narrow"] .list{grid-row:1;grid-column:2;border-right:0;border-bottom:1px solid var(--line);min-width:0}
.app[data-w="narrow"] .main{grid-row:2;grid-column:2}
.app-wide.app[data-w="narrow"] .main{grid-row:1}
.app[data-w="narrow"] .list-head{flex-direction:row;align-items:center;gap:var(--s3);padding:var(--s2) var(--s3)}
.app[data-w="narrow"] .list-title{white-space:nowrap;flex:0 0 auto}
.app[data-w="narrow"] .list-stats{flex:1 1 auto;max-width:300px}
.app[data-w="narrow"] .ls{padding:3px var(--s2)}
.app[data-w="narrow"] .ls-v{font-size:13px}
.app[data-w="narrow"] .list-scroll{display:flex;flex-direction:row;align-items:center;gap:6px;padding:0 var(--s3) var(--s2);overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}
.app[data-w="narrow"] .list-scroll>div{display:contents}
.app[data-w="narrow"] .list-group{display:none}
.app[data-w="narrow"] .ch{flex:0 0 auto;width:auto;max-width:180px;padding:4px 10px;min-height:28px;border:1px solid var(--line-2);border-radius:var(--r-pill);display:inline-flex;align-items:center;gap:6px}
.app[data-w="narrow"] .ch[aria-current="true"]{border-color:transparent;background:var(--accent);color:var(--accent-ink)}
.app[data-w="narrow"] .ch[aria-current="true"] .ch-n{color:var(--accent-ink);opacity:.8}
.app[data-w="narrow"] .ch-mark{width:16px;height:16px;flex-basis:16px}
.app[data-w="narrow"] .ch-name{font-size:var(--fs-xs)}
.app[data-w="narrow"] .mhead{padding:var(--s4) var(--s4) var(--s3);margin-bottom:var(--s2)}
.app[data-w="narrow"] .mhead-name{font-size:var(--fs-lg)}
.app[data-w="narrow"] .mbody{padding:0 var(--s4) var(--s5);gap:var(--s4)}
.app[data-w="narrow"] .seg{flex-wrap:wrap}
.app[data-w="narrow"] .sec-actions{margin-left:0;width:100%}
.app[data-w="narrow"] .vendors{grid-template-columns:minmax(0,1fr)}
.app[data-w="phone"]{grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(0,1fr);  padding-bottom:calc(52px + env(safe-area-inset-bottom,0px)); box-sizing:border-box;}
.app-wide[data-w="phone"]{grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr);  padding-bottom:calc(52px + env(safe-area-inset-bottom,0px)); box-sizing:border-box;}
.app[data-w="phone"] .rail{position:absolute;left:0;right:0;bottom:0; z-index:50; flex-direction:row; align-items:center; justify-content:space-around; gap:0; padding:0 4px calc(env(safe-area-inset-bottom,0px)); height:calc(52px + env(safe-area-inset-bottom,0px)); border-right:0; border-top:1px solid var(--line); background:color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter:blur(12px);}
.app[data-w="phone"] .rail-brand{flex-direction:column;align-items:center;justify-content:center; gap:0;padding:4px 0;min-width:0; flex:0 0 54px; padding-bottom:calc(4px + env(safe-area-inset-bottom,0px));}
.app[data-w="phone"] .rail-brand .rail-name{display:none}
.app[data-w="phone"] .rail-logo{width:20px;height:20px;border-radius:var(--r-sm)}
.app[data-w="phone"] .rail-ver{font-size:var(--fs-xs);min-height:24px;line-height:1; color:var(--muted);gap:1px;margin-top:0; padding:0 3px;white-space:nowrap; display:inline-flex;align-items:center;}
.app[data-w="phone"] .rail-ver svg{width:8px;height:8px}
.app[data-w="phone"] .rail-item{flex:1 1 0;min-width:0; flex-direction:column;gap:2px; padding:6px 2px; justify-content:center; border-radius:var(--r-md);}
.app[data-w="phone"] .rail-item svg{width:17px;height:17px}
.app[data-w="phone"] .rail-item span{font-size:10px;line-height:1.2;text-align:center}
.app[data-w="phone"] .rail-foot{display:none}
.app[data-w="phone"] .list{border-right:0; border-bottom:1px solid var(--line); background:var(--surface);}
.app[data-w="phone"] .list-head{flex-direction:row;align-items:center;gap:var(--s2); padding:var(--s2) var(--s3); overflow-x:auto;}
.app[data-w="phone"] .list-title{font-size:var(--fs-md);white-space:nowrap}
.app[data-w="phone"] .list-sum{font-size:var(--fs-xs);white-space:nowrap}
.app[data-w="phone"] .list-credit{padding:0;border-top:0;margin-left:auto}
.app[data-w="phone"] .list-credit-k,.app[data-w="phone"] .list-credit-note{display:none}
.app[data-w="phone"] .list-credit-v{font-size:var(--fs-md)}
.app[data-w="phone"] .list-scroll{display:flex;flex-direction:row;align-items:center;gap:6px; padding:var(--s2) var(--s3); overflow-x:auto;overflow-y:hidden; scrollbar-width:none;}
.app[data-w="phone"] .list-scroll::-webkit-scrollbar{display:none}
.app[data-w="phone"] .list-group{display:none;}
.app[data-w="phone"] .ch{flex:0 0 auto;width:auto; max-width:176px; padding:5px 10px;min-height:30px; border:1px solid var(--line-2); border-radius:var(--r-pill); background:var(--surface); display:inline-flex;align-items:center;gap:6px;}
.app[data-w="phone"] .ch[aria-current="true"]{border-color:transparent; background:var(--accent); color:var(--accent-ink);}
.app[data-w="phone"] .ch[aria-current="true"] .ch-n{color:var(--accent-ink);opacity:.8}
.app[data-w="phone"] .ch-mark{width:16px;height:16px;flex-basis:16px;flex-shrink:0}
.app[data-w="phone"] .ch-name{font-size:var(--fs-xs); flex:1 1 auto;min-width:0; overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.app[data-w="phone"] .ch-n{font-size:var(--fs-xs);flex:0 0 auto;margin-left:2px}
.app[data-w="phone"] .main{min-height:0}
.app[data-w="phone"] .mhead{padding:var(--s3); gap:var(--s2); flex-wrap:wrap; flex-direction:column; align-items:stretch;}
.app[data-w="phone"] .mhead-title{flex-direction:column; align-items:flex-start; gap:2px;}
.app[data-w="phone"] .mhead-name{font-size:var(--fs-lg);line-height:1.25}
.app[data-w="phone"] .mhead-org{font-size:var(--fs-xs);line-height:1.3}
.app[data-w="phone"] .mhead-title .pill{align-self:flex-start;margin-top:2px}
.app[data-w="phone"] .mhead-actions{width:100%;flex-wrap:wrap}
.app[data-w="phone"] .mhead-actions .btn{flex:1 1 auto;justify-content:center;min-width:0}
.app[data-w="phone"] .mbody{padding:var(--s3) var(--s3) var(--s5);gap:var(--s4)}
.app[data-w="phone"] .kpis,.app[data-w="phone"] .summary{grid-template-columns:repeat(2,minmax(0,1fr)) !important}
.app[data-w="phone"] .sum-cell{padding:var(--s2) var(--s3)}
.app[data-w="phone"] .sum-k{font-size:10px}
.app[data-w="phone"] .sum-v{font-size:var(--fs-lg)}
.app[data-w="phone"] .sum-sub{white-space:normal;overflow:visible;text-overflow:clip;font-size:10px}
.app[data-w="phone"] .kpi{padding:var(--s2) var(--s3)}
.app[data-w="phone"] .kpi-v{font-size:var(--fs-lg)}
.app[data-w="phone"] .kpi-sub{font-size:10px}
.app[data-w="phone"] .accts,.app[data-w="phone"] .acctcards{grid-template-columns:minmax(0,1fr) !important}
.app[data-w="phone"] .policies{grid-template-columns:minmax(0,1fr)}
.app[data-w="phone"] .policy{padding:var(--s2) var(--s3)}
.app[data-w="phone"] .seg{flex-wrap:wrap}
.app[data-w="phone"] .model{padding:var(--s2)}
.app[data-w="phone"] .model-side{gap:4px}
.app[data-w="phone"] .ctx-select{padding:0 18px 0 6px;font-size:10px}
.app[data-w="phone"] .badge{font-size:10px;line-height:14px}
.app[data-w="phone"] .table{border:0;background:transparent}
.app[data-w="phone"] .table-scroll{overflow:visible}
.app[data-w="phone"] .table-scroll .tr{min-width:0}
.app[data-w="phone"] .tr{display:flex !important; flex-wrap:wrap !important; align-items:baseline !important; grid-template-columns:none !important; gap:2px var(--s3); padding:var(--s2) var(--s3); border:1px solid var(--line); border-radius:var(--r-sm); background:var(--surface); min-height:0;}
.app[data-w="phone"] .tr-head{display:none}
.app[data-w="phone"] .td,.app[data-w="phone"] .td-num,.app[data-w="phone"] .td-dim{text-align:left !important;font-size:var(--fs-xs)}
.app[data-w="phone"] .tr>.td:first-child{flex:1 1 100%; display:flex !important;align-items:center;gap:6px; padding-bottom:2px; white-space:nowrap;}
.app[data-w="phone"] .td-mono{font-size:var(--fs-xs);white-space:normal;word-break:break-all}
.app[data-w="phone"] .ranks{grid-template-columns:minmax(0,1fr)}
.app[data-w="phone"] .rank-row{grid-template-columns:20px minmax(0,1fr) 64px 52px}
.app[data-w="phone"] .chart{height:100px;gap:2px}
.app[data-w="phone"] .axis{overflow-x:auto;scrollbar-width:none}
.app[data-w="phone"] .axis::-webkit-scrollbar{display:none}
.app[data-w="phone"] .axis span{font-size:var(--fs-xs);white-space:nowrap; min-width:36px;}
.app[data-w="phone"] .axis span:nth-child(even){display:none}
.app[data-w="phone"] .filters{flex-wrap:nowrap;overflow-x:auto;gap:6px; padding-bottom:2px;scrollbar-width:none;}
.app[data-w="phone"] .filters::-webkit-scrollbar{display:none}
.app[data-w="phone"] .chip{flex:0 0 auto}
.app[data-w="phone"] .btn{padding:8px 12px;min-height:36px}
.app[data-w="phone"] .tiny,.app[data-w="phone"] a.tiny{min-height:30px;padding:0 12px}
.app[data-w="phone"] .list{grid-row:1;grid-column:1;min-width:0}
.app[data-w="phone"] .main{grid-row:2;grid-column:1}
.app-wide[data-w="phone"] .main{grid-row:1}
.app[data-w="phone"] .list-scroll>div{display:contents}
.app[data-w="phone"] .list-stats{flex:0 0 auto;min-width:180px}
.app[data-w="phone"] .rail-item>span.sw{display:none}
.app[data-w="phone"] .sec-actions{margin-left:0;width:100%}
.app[data-w="phone"] .vendors{grid-template-columns:minmax(0,1fr)}
.app[data-w="phone"] .kpis .kpi:last-child:nth-child(odd){grid-column:1 / -1}
`
