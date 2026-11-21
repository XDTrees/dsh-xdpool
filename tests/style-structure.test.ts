import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 样式表的结构守卫。
 *
 * 这一路踩了五次「改了不生效」：同一个类在两个样式表里都定义，后加载的那份
 * 只写了半截声明，把前面那份的 padding / 字号 / 行高清成默认值。每一次都
 * 表现为「代码明明改了，界面没变」，而 grep 源码看起来完全正确。
 *
 * 所以这里钉两件事：
 *   1. `SHELL_CSS` 是死代码，不要再往里加规则；
 *   2. 一个类的主规则不能同时出现在两份都进产物的样式表里。
 */
const styles = readFileSync('src/client/styles.ts', 'utf8')
const shellStyles = readFileSync('src/client/pool-shell-styles.ts', 'utf8')
const detailStyles = readFileSync('src/client/detail-page-styles.ts', 'utf8')

/**
 * 从一个样式表变量里取出**主规则**的选择器名字（不含点）。
 *
 * 只认「.cls {」这种形状 —— 子选择器（`:hover`、`[data-active]`、`::before`）
 * 是各自样式表对同一个类的补充，两份各写各的不冲突。真正会互相覆盖的是主规则：
 * 同一个 `.cls {` 出现两次时，后加载那份整条赢。
 */
function mainRulesOf(source: string, name: string): Set<string> {
  const marker = 'export const ' + name + ' = `'
  const start = source.indexOf(marker)
  if (start < 0) return new Set()
  const end = source.indexOf('\n`', start)
  const body = source.slice(start, end < 0 ? undefined : end)
  const found = new Set<string>()
  // 行首的点号类名，紧跟可选空白和 {
  /*
    只认行首无缩进的规则。

    缩进的那几条在 @container / @media 里（比如窄屏把 rail 改成横排），
    是响应式覆盖，本来就该和顶层规则并存 —— 那不是冲突。
    所以这里不 trim：前导空白本身就是「这条在媒体查询里」的信号。
  */
  for (const line of body.split('\n')) {
    const m = /^\.(dsm-xdpool-[a-z0-9-]+)\s*\{/u.exec(line)
    if (m !== null && m[1] !== undefined) found.add(m[1])
  }
  return found
}

describe('样式表结构', () => {
  it('SHELL_CSS 不参与产物，规则不要加在那里', () => {
    /*
      `styles.ts` 里只插值了 POOL_SHELL_CSS / SHELL_FRAME_CSS / DETAIL_PAGE_CSS。
      SHELL_CSS 虽然还导出着，但没有任何模板引用它 —— 往那里写的样式不会出现。
    */
    expect(styles).not.toContain('${SHELL_CSS}')

    const at = styles.indexOf('export const SHELL_CSS = `')
    expect(at, 'SHELL_CSS 还在（测试拿它当切分锚点，别删）').toBeGreaterThan(-1)
    // 而且它自己带着警示注释，说明改那里不生效。
    expect(styles.slice(Math.max(0, at - 800), at)).toContain('改这里不会生效')
  })

  it('同一个类的主规则不要被两份进产物的样式表同时定义', () => {
    /*
      POOL_SHELL_CSS 先加载、DETAIL_PAGE_CSS 后加载。两边都定义同一个类时，
      后者赢 —— 而它常常只写了半截声明（比如只有 display/gap，没有 padding），
      于是前一份的 padding 被静默清成 0。
    */
    const pool = mainRulesOf(shellStyles, 'POOL_SHELL_CSS')
    const detail = mainRulesOf(detailStyles, 'DETAIL_PAGE_CSS')

    const collision = [...detail].filter(name => pool.has(name)).sort()
    expect(collision, '这些类的主规则在两个样式表里都定义了，后者会覆盖前者').toEqual([])
  })

  it('DETAIL 若定义 pagehead，必须写全 padding', () => {
    /*
      具体守 pagehead：它在两份里都出现过，DETAIL 那份漏了 padding，
      于是页头贴到了顶上 —— 而 grep 源码看不出来，因为两份都「有」这条规则。
    */
    const detail = detailStyles.slice(
      detailStyles.indexOf('export const DETAIL_PAGE_CSS = `'),
    )
    const at = detail.indexOf('.dsm-xdpool-pagehead{')
    if (at < 0) return   // 规则只在 POOL_SHELL_CSS 里，那就没问题
    const block = detail.slice(at, detail.indexOf('}', at))
    expect(block, 'DETAIL 里的 pagehead 必须带 padding，否则会擦掉另一份的').toContain('padding:')
  })
})
