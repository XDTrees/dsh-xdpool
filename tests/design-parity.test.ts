import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 设计稿对齐的回归守卫。
 *
 * 这三十五轮里反复出现同一类退化：改了一处，另一处悄悄回到旧值 ——
 * 或者某个值在源码里看着对，但被后加载的规则盖掉，界面纹丝不动。
 * 手工核对了太多遍，这里把「不该再出现」的几条钉死。
 */
const FILES = ['styles.ts', 'detail-page-styles.ts', 'pool-shell-styles.ts'] as const
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
      expect(code, `${stray} 是另一种绿，应该用 var(--xd-primary)`).not.toContain(stray)
    }
    expect(code, 'DSH 的品牌蓝不该出现在插件里').not.toContain('#5686fe')
  })

  it('主色不问宿主要', () => {
    /*
      写成 `var(--dsw-alias-brand-primary, 绿)` 时，宿主只要定义了品牌色，
      我们的绿就永远用不上 —— 整站会变成宿主的蓝。所以必须是直给。
    */
    const tokens = readFileSync('src/client/tokens.ts', 'utf8')
    expect(tokens).toMatch(/'--xd-primary: '\s*\+\s*palette\.primary/u)
    expect(tokens).not.toContain("'--xd-primary: var(--dsw-alias-brand-primary")
  })

  it('标题字体是衬线，不是只在深色下才是', () => {
    /*
      设计稿的分区标题（.sec-title / .kpi-v / .group-title / .pop-name）都走
      --sans-head。之前这里写的是 SANS，只在 prefers-color-scheme:dark 的
      兜底块里换成 SERIF —— 浅色模式下标题就成了黑体。
    */
    const tokens = readFileSync('src/client/tokens.ts', 'utf8')
    expect(tokens).toMatch(/'--xd-font-head: '\s*\+\s*SERIF/u)
  })

  it('字号与间距走 token，不是散落的数字', () => {
    // 这两档是设计稿的 --fs-* 与 --s-*，收敛之后改一处就能全站生效。
    expect(all).toContain('var(--xd-fs-xs)')
    expect(all).toContain('var(--xd-fs-md)')
    expect(all).toContain('var(--xd-s3)')
    expect(all).toContain('var(--xd-s4)')
  })

  it('三层布局是网格，条目栏 264px', () => {
    const shell = source['pool-shell-styles.ts']
    /*
      .dsm-xdpool-shell 是「条目栏 + 详情」那一层。
      先去掉 CR —— 这个仓库的样式表是 CRLF，带 \\r 的多行正则匹配不到。
    */
    const flat = shell.split(String.fromCharCode(13)).join('')
    expect(flat).toMatch(/\.dsm-xdpool-shell\{[\s\S]{0,400}?display:grid/u)
    expect(flat).toMatch(/\.dsm-xdpool-shell\{[\s\S]{0,400}?grid-template-columns:264px minmax\(0,1fr\)/u)
  })

  it('容器查询有锚点', () => {
    /*
      @container 只对声明了 container-type 的祖先生效。之前整个插件里
      没有一处声明它 —— 三档容器查询写了但从没工作过，窄屏一直用桌面布局，
      内容被挤到屏幕外。
    */
    expect(all).toContain('@container xdpool')
    expect(source['pool-shell-styles.ts']).toMatch(/\.dsm-xdpool-frame\{[^}]*container-type:inline-size/su)
    expect(source['pool-shell-styles.ts']).toMatch(/\.dsm-xdpool-frame\{[^}]*container-name:xdpool/su)
  })
})
