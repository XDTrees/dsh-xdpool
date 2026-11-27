/**
 * 输入框旁边那个积分小图标（CreditDot）的样式。
 *
 * 必须单独一份、不能用设计稿的类名：
 *   设计稿的样式（design-css.ts）只在插件页面的 .app 里生效，变量（--accent 等）也定义在 .app 上。
 *   小图标长在 DSH 的聊天输入框里，面板 portal 到 document.body —— 都在 .app 外面。
 *   改版时它的类名被换成了 strip / ch-dot / pop，结果在聊天框里一条样式都没有：
 *   小图标只剩一个空的圆角框，点开的面板也没有定位和背景（「点不出来」）。
 *
 * 所以恢复成 2.7.x 的 dsm-xdpool-dot* 命名空间和这份样式（原样取自 styles.ts 的 CREDIT_DOT_CSS），
 * 颜色走宿主自己的 --dsw-alias-* 变量，深浅色都跟着 DSH 走。
 */
export const CREDIT_DOT_CSS = `
/* ── Composer credit dot ────────────────────────────────────────────────────
   A 9px dot on the composer's own row, beside the model name it describes. Its COLOUR
   is the whole at-a-glance message — green while the serving channel has credits, grey
   once it does not — and the detail lives behind a click, because that row already
   holds a back button, a model name, a multiplier and a reasoning level. */
.dsm-xdpool-dotwrap{position:relative;display:inline-flex;align-items:center;flex:none;margin:0 2px}
.dsm-xdpool-dot{appearance:none;-webkit-appearance:none;display:grid;place-items:center;width:16px;height:16px;padding:0;margin:0;border:0;background:none;cursor:pointer;flex:none;border-radius:4px;transition:background-color .16s ease}
.dsm-xdpool-dot:hover{background:color-mix(in srgb, var(--dsw-alias-label-primary,#e8eaf0) 12%, transparent)}
.dsm-xdpool-dot-glyph{display:block;width:13px;height:13px;background-color:currentColor;-webkit-mask-image:var(--xdpool-dot-mask, none);mask-image:var(--xdpool-dot-mask, none);-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;-webkit-mask-size:13px 13px;mask-size:13px 13px;transition:color .18s ease}
.dsm-xdpool-dot[data-state='alive']{color:#22c55e}
.dsm-xdpool-dot[data-state='empty']{color:color-mix(in srgb, var(--dsw-alias-label-tertiary,#8a90a0) 85%, transparent)}
.dsm-xdpool-dot:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:3px}
/* Measured coordinates, not flow: the composer sits at the bottom of the viewport, so a
   panel laid out downward would be clipped. */
.dsm-xdpool-dotpanel{position:fixed;z-index:80;width:max-content;min-width:172px;max-width:min(280px,calc(100vw - 24px));display:flex;flex-direction:column;gap:7px;padding:10px 12px 11px;border-radius:14px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2,#ffffff1f) 92%, transparent);background:var(--dsw-alias-bg-layer-2,#1c1e22);box-shadow:0 18px 48px rgb(0 0 0 / 44%),0 3px 10px rgb(0 0 0 / 24%),inset 0 1px 0 rgb(255 255 255 / 7%);animation:dsm-xdpool-dotpanel-in .16s cubic-bezier(.16,1,.3,1)}
@keyframes dsm-xdpool-dotpanel-in{from{opacity:0;transform:translateY(5px) scale(.985)}to{opacity:1;transform:none}}
.dsm-xdpool-dotpanel-head{display:flex;align-items:center;gap:8px;min-width:0}
.dsm-xdpool-dotpanel-channel{font-size:12.5px;font-weight:600;letter-spacing:.01em;color:var(--dsw-alias-label-primary,#e8eaf0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.dsm-xdpool-dotpanel-chip{margin-left:auto;padding:1px 8px;border-radius:999px;font-size:10px;line-height:16px;font-weight:500}
.dsm-xdpool-dotpanel-chip[data-state='alive']{color:#22c55e;background:rgb(34 197 94 / 15%)}
.dsm-xdpool-dotpanel-chip[data-state='empty']{color:var(--dsw-alias-label-tertiary,#8a90a0);background:color-mix(in srgb, var(--dsw-alias-label-tertiary,#8a90a0) 15%, transparent)}
.dsm-xdpool-dotpanel-sec{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:baseline;font-size:12px;line-height:18px}
.dsm-xdpool-dotpanel-k{color:var(--dsw-alias-label-tertiary,#8a90a0);white-space:nowrap}
.dsm-xdpool-dotpanel-v{text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#e8eaf0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The spend bar. A fuller bar means MORE used, so it reads as a fuel gauge draining
   toward the right; it turns amber past 90% because that is the point at which a long
   task becomes a gamble. */
.dsm-xdpool-dotbar{height:4px;border-radius:999px;overflow:hidden;background:color-mix(in srgb, var(--dsw-alias-label-tertiary,#8a90a0) 22%, transparent);margin:1px 0 2px}
.dsm-xdpool-dotbar-fill{height:100%;border-radius:999px;background:#22c55e;transition:width .3s cubic-bezier(.16,1,.3,1),background-color .2s ease}
.dsm-xdpool-dotbar-fill[data-full='true']{background:#f59e0b}
.dsm-xdpool-dotpanel-more{display:flex;flex-direction:column;gap:2px;padding-top:6px;margin-top:1px;border-top:1px solid color-mix(in srgb, var(--dsw-alias-border-l2,#ffffff1f) 62%, transparent)}
.dsm-xdpool-dotpanel-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;font-size:11px;line-height:16px}
.dsm-xdpool-dotpanel-rowname{color:var(--dsw-alias-label-tertiary,#8a90a0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The channel that served today gets a brighter label; the rest still count
   toward the total and are shown, because hiding them is what made the composer
   dot disagree with the account-pool card. */
.dsm-xdpool-dotpanel-rowname[data-used='true']{color:var(--dsw-alias-label-secondary,#b9bfcc)}
.dsm-xdpool-dotpanel-rowval{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#b9bfcc)}

/* 面板里的提示行、说明（旧版没有的两个类） */
.dsm-xdpool-dotpanel-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a90a0)}
.dsm-xdpool-dot[data-state='none']{color:var(--dsw-alias-label-secondary,#b9bfcc)}
/* 认出渠道的依据、「同一模型的其他渠道」这种小字 */
.dsm-xdpool-dotpanel-k-sub{display:block;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#8a90a0);margin-top:-3px}
.dsm-xdpool-dotpanel-more .dsm-xdpool-dotpanel-k-sub{margin:0 0 2px}
/* 工具行里的落位：20px 高，与模型选择器那一排对齐。克劳德风格把工具行收进卡片，
   圆点落在模型名左边；它自家的 seat 自带 4px 内边距，这里再让出 6px 呼吸。 */
.dsm-xdpool-dotwrap{height:20px}
body[data-dsh-claude-style] .dsm-xdpool-dotwrap{margin:0 6px 0 0}
`
