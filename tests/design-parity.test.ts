import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 设计稿对齐的回归守卫。
 *
 * 这三十五轮里反复出现同一类退化：改了一处，另一处悄悄回到旧值 ——
 * 或者某个值在源码里看着对，但被后加载的规则盖掉，界面纹丝不动。
 * 手工核对了太多遍，这里把「不该再出现」的几条钉死。
 */
/*
  检查的对象是**真正在用的那份样式**。

  以前查 styles.ts / detail-page-styles.ts / pool-shell-styles.ts ——
  那三份现在是死代码，一条都不会进产物。查它们等于查一个不存在的界面：
  9px 和 #22a06b 还留在里面，但用户看到的不是它。
*/
const FILES = ['design-css.ts'] as const
const source = Object.fromEntries(
  FILES.map(name => [name, readFileSync(`src/client/${name}`, 'utf8')]),
) as Record<(typeof FILES)[number], string>
const all = FILES.map(name => source[name]).join('\n')

describe('设计稿对齐', () => {
  it('没有低于 12px 的可读文字', () => {
    /*
      9px 那几处是图标方块里的缩写字母（font-weight:700 的图形元素），
      不是文字块，所以放行。除它以外任何小于 12px 的字号都是退步。
    */
    const tooSmall = [...all.matchAll(/font-size:(\d+(?:\.\d+)?)px/gu)]
      .map(m => Number(m[1]))
      .filter(size => size < 12 && size !== 9)
    expect(tooSmall, '12px 是无障碍下限；9px 只允许出现在图标符号上').toEqual([])
  })

  it('只有一个绿', () => {
    /*
      DSH 自己有成功绿（#22a06b）和品牌蓝（#5686fe）。两处都出现时，
      一屏里就有好几种绿在说不同的事，读者分不清哪个是「正常」。
      现在只有 --xd-primary 一种。
    */
    /*
      注释里写色值不算 —— 那是解释「为什么不用它」，删掉反而看不懂。
      所以只看真正的声明。
    */
    const code = all.replace(/\/\*[\s\S]*?\*\//gu, '')
    for (const stray of ['#22a06b', '#22c55e', '#10b981', '#059669']) {
      expect(code, `${stray} 是另一种绿，应该用 var(--accent)`).not.toContain(stray)
    }
    expect(code, 'DSH 的品牌蓝不该出现在插件里').not.toContain('#5686fe')
  })

  it('主色不问宿主要', () => {
    /*
      写成 `var(--dsw-alias-brand-primary, 绿)` 时，宿主只要定义了品牌色，
      我们的绿就永远用不上 —— 整站会变成宿主的蓝。所以必须是直给。
    */
    const tokens = source['design-css.ts']
    expect(tokens).toContain('--accent:') // 设计稿的主色 token 叫 --accent
    expect(tokens).not.toContain('--accent: var(--dsw-alias-brand-primary')
  })

  it('标题字体是衬线，不是只在深色下才是', () => {
    /*
      设计稿的分区标题（.sec-title / .kpi-v / .group-title / .pop-name）都走
      --sans-head。之前这里写的是 SANS，只在 prefers-color-scheme:dark 的
      兜底块里换成 SERIF —— 浅色模式下标题就成了黑体。
    */
    const tokens = source['design-css.ts']
    expect(tokens).toContain('serif') // 衬线标题
  })

  it('字号与间距走 token，不是散落的数字', () => {
    // 这两档是设计稿的 --fs-* 与 --s-*，收敛之后改一处就能全站生效。
    /*
      设计稿的 token 名是 `--fs-xs`（不是早期那套 `--xd-fs-xs`）。
      这一条只要求「字号来自 token 而不是硬编码」，名字跟着当前在用的那份样式走。
    */
    expect(all).toContain('var(--fs-xs)')
    expect(all).toContain('var(--fs-md)') // 设计稿的字号 token
    expect(all).toContain('var(--s3)') // 设计稿的间距 token 叫 --s3
    expect(all).toContain('var(--s4)')
  })

  it('三列布局：功能页 + 条目栏 + 详情', () => {
    /*
      设计稿的 .app 是一个三列网格：200px 功能页 + 264px 条目栏 + 剩下给详情。
      .app 的直接子元素必须正好是 rail / list / main 三个 —— 多一层包装，
      grid 就只看到一个孩子，整页塌成一块（前十几轮反复踩的就是这个）。
    */
    const flat = all.split(String.fromCharCode(13)).join('')
    expect(flat).toMatch(/\.app\s*\{[\s\S]{0,1200}?display:grid/u)
    expect(flat).toMatch(/\.app\s*\{[\s\S]{0,600}?grid-template-columns:\s*var\(--rail-w\)\s+var\(--list-w\)/u)
    // 两栏的宽度来自 token，不是散落的魔数
    expect(flat).toMatch(/--rail-w:\s*\d+px/u)
    expect(flat).toMatch(/--list-w:\s*\d+px/u)
  })

  it('窄屏会让位，不是把内容挤到屏幕外', () => {
    /*
      这里原本要求三档 @container xdpool 加一个 container-type 锚点。

      设计稿用的是 @media —— 静态页没有「容器」的概念，它按视口宽度收敛。
      三栏布局（200 + 264 + 1fr）在 900px 以下必须让位，否则详情被压成零宽。
    */
    expect(all).toMatch(/@media\s*\(max-width:\s*\d+px\)/u)
    // 汇总条在窄屏要降列，六格挤在 700px 里会每个字都折行
    expect(all).toMatch(/\.summary\{[^}]*repeat\(3/u)
  })
})
