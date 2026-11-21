/**
 * 设计稿的骨架接管层。
 *
 * 用户的原话：「你就只加载我们设计的，不用之前的元素了」。
 *
 * 这一份把插件多出来的三层（.body / .shellpanel / .shell）压平，让插件的
 * DOM 表现得和设计稿的 `.app > rail + list + main` 一样，然后用设计稿的
 * CSS 原样接管外观。
 *
 * 为什么不直接改 DOM：那三层被 tests 和几处兼容代码依赖（见 shell.tsx 的
 * 注释），删掉会连带断掉十几处。压平成同样的视觉与尺寸，效果一样而风险小。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const DESIGN = 'D:/dsh-home/xdpool-design'

const tokens = readFileSync(`${DESIGN}/tokens.css`, 'utf8')
const app = readFileSync(`${DESIGN}/app.css`, 'utf8')
const colors = readFileSync(`${DESIGN}/channel-colors.css`, 'utf8')
/*
  mobile.css：窄屏适配的那批规则（.dock / .list-credit / 表格在窄屏下的折叠）。

  之前没读它，于是 760px 窗口里手机的布局规则一条都没生效 ——
  页面靠 app.css 的媒体查询勉强撑着，但那些是「缩小」，不是「重排」。
  文件不存在时跳过，不打断构建。
*/
let mobile = ''
try { mobile = readFileSync(`${DESIGN}/mobile.css`, 'utf8') } catch { mobile = '' }

/** build-a.mjs 里的页面级 CSS（.kpi / .acct / .policy / .seg …）。 */
function pageCss() {
  /*
    所有 build-*.mjs 的页面级 CSS，**加上每个 html 里 <style> 块的规则**。

    两处都有：build-*.mjs 里是生成脚本用的 CSS 常量，而设计稿最终落地的
    html 里还有一段 <style>（每个页面自己的），两者不完全重合。
    只读 mjs 会漏掉 .summary 的主规则 —— 结果只剩下媒体查询里的降级版本，
    六格的汇总条被压成三列。
  */
  const FILES = ['build-a', 'build-login', 'build-aggregate', 'build-pick',
                 'build-ledger', 'build-b', 'build-c', 'build-d', 'build-marvis']
  const out = []
  for (const file of FILES) {
    let src = ''
    try {
      src = readFileSync(`${DESIGN}/${file}.mjs`, 'utf8')
    } catch {
      continue
    }
    for (const m of src.matchAll(/const\s+\w+\s*=\s*`([\s\S]*?)`/gu)) {
      const body = m[1]
      if (body.includes('{') && body.includes('.') && !body.includes('import ')) out.push(body)
    }
  }
  /*
    每个 html 的 <style> 块 —— 扫目录，不写死清单。

    写死清单漏过 aggregate-models.html，于是 .mp-row / .mp-name / .mp-id
    这些规则从来没被提取出来：插件用了类名，但没有任何样式命中它们。
    以后设计稿再加页面也不用回来改这里。
  */
  let htmls = []
  try {
    htmls = readdirSync(DESIGN).filter(f => f.endsWith('.html'))
  } catch {
    htmls = []
  }
  for (const file of htmls) {
    let src = ''
    try {
      src = readFileSync(`${DESIGN}/${file}`, 'utf8')
    } catch {
      continue
    }
    for (const m of src.matchAll(/<style>([\s\S]*?)<\/style>/gu)) out.push(m[1])
  }
  return out.join('\n')
}

/** body/html 那些全局规则去掉 —— 插件在宿主的对话框里，不该改宿主。 */
const scoped = app
  .replace(/html,\s*body\s*\{[^}]*\}/gu, '')
  .replace(/^\s*\*\s*\{\s*box-sizing:\s*border-box;?\s*\}/gmu, '')
  .replace(/::-webkit-scrollbar/gu, '.app ::-webkit-scrollbar')

const bridge = `
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
  /* 厂商色多为浅亮（橙、绿），纯白字在上面只有 2.3:1。
     加一层暗影把字压出来，不改品牌色。 */
  text-shadow:0 1px 2px rgba(0,0,0,.55);
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


/* ============================================================
   按下反馈
   ------------------------------------------------------------
   设计稿是静态稿，没有 :active。但真实界面里，按下去没有任何变化
   会让人不确定「点到了没有」——尤其是慢操作（重新获取模型要几秒）。
   这里只加一点点下沉，不动配色。
   ============================================================ */
.btn:active:not(:disabled),
.tiny:active:not(:disabled),
.rail-item:active { transform: translateY(1px) }
.sw:active:not(:disabled) { filter: brightness(.94) }
button:disabled { cursor: not-allowed }


/* ============================================================
   渠道详情：单列铺满
   ------------------------------------------------------------
   .accts 是账号卡的网格（auto-fill 248px），用在设计稿的详情页正合适 ——
   六个账号排成三列两行。

   但渠道详情只有一个「卡」，放进那个网格会只占一列 248px，右边空一大片。
   这一层是单列容器：它里面只有一张卡，卡就该铺满。
   ============================================================ */
/* 渠道详情里只有一个 .card（后面跟着它自己的动作行），让卡铺满整行 */
.accts > .card:first-child { grid-column: 1 / -1 }
.accts > .sec-actions { grid-column: 1 / -1 }


/* ============================================================
   开关里的真实 checkbox 要藏起来
   ------------------------------------------------------------
   设计稿的 .sw 是一个按钮（40×24，用 ::after 画滑块）。
   插件有三处把它套在 <label> 上，里面放真的 <input type="checkbox">，
   为的是让键盘和读屏能操作。

   于是浏览器的原生复选框就画在滑块旁边 —— 聚合页那个勾选框跑出
   开关右边，就是这么来的。藏掉 input，滑块照旧由 .sw 的伪元素画。
   ============================================================ */
label.sw > input[type="checkbox"] {
  position: absolute;
  width: 1px; height: 1px;
  opacity: 0;
  pointer-events: none;
}
label.sw { cursor: pointer }
label.sw:has(input:checked)::after { transform: translateX(16px) }
label.sw:has(input:disabled) { opacity: .5; cursor: not-allowed }


/* 搜索框那一行：输入框 + 命中数提示 */
.search-wrap {
  display: flex;
  align-items: center;
  gap: var(--s2);
  margin: var(--s2) 0;
}
.search-wrap > .search { flex: 1 1 auto; min-width: 0 }
.search-wrap > .hint { flex: 0 0 auto; margin: 0 }


/* 窄屏侧栏（60px）里，版本号竖排会换行成两行 —— 藏掉，鼠标悬停时用 title 看 */
@media (max-width: 1180px) {
  .rail-ver { display: none }
}

.strip-caret{width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--faint);transition:transform var(--t-base) var(--ease)}
.strip-caret[data-open="true"]{transform:rotate(180deg)}
`

/*
  设计稿里有几处 10px 的小字（.badge 一类）。10px 在 1080p 上已经要凑近看，
  这里统一提到 12px —— 做法是把生成结果里的 font-size:10px 换掉，
  而不是改设计稿源文件：源文件要保持原样，便于以后重新提取时对照。
*/
const MIN_FONT_FIX = (css) => css.replace(/font-size:1[01]px/gu, 'font-size:12px')

/**
 * mobile.css —— 窄屏重排规则（自带 @media）。
 */
const scopedMobile = MIN_FONT_FIX(mobile)

const out = `/**
 * 设计稿样式，原样接管。
 *
 * 来源：xdpool-design 的 tokens.css / app.css / channel-colors.css / build-a.mjs。
 * 改样式请改设计稿源文件，再跑 scripts/extract-design-css.mjs。
 */
export const DESIGN_TOKENS_CSS = \`${tokens}\n${colors}\`

export const DESIGN_DETAIL_CSS = \`${MIN_FONT_FIX(scoped)}\n${MIN_FONT_FIX(pageCss())}\n${scopedMobile}\n${bridge}\`
`

writeFileSync('D:/dsh-home/_xdpool-src/src/client/design-css.ts', out, 'utf8')
console.log('生成 design-css.ts:', Math.round(out.length / 1024), 'KB')
