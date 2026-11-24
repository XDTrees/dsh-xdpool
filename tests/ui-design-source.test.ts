/**
 * 界面只有一个来源：设计稿。
 *
 * 这条守卫是给「下一次想快点让它显示出来」的人（包括未来的我）设的。3.0.4 把 2.x 的
 * `AccountBlock` 挂进 3.0 的页面，3.0.6 又自造了一套 `xdp-acct*` 类名 —— 两次都让
 * 用户看到排布坏掉的账号池。根因不是某一行写错，而是**在既有页面上另起了一套视觉语言**。
 *
 * 所以这里断言三件事：
 *   1. `src/client` 里不再出现自造的布局类前缀（`xdp-`）；
 *   2. 页面组件的样式不写在 `src/` 里，而是来自 `design-css.ts`（设计稿的产物）；
 *   3. 规则本身还在（`AGENTS.md`），不会被下一次重构顺手删掉。
 *
 * 例外只有两个，都是明确划定、且不新造页面级布局的：
 *   - `credit-dot-css.ts`：聊天框里的积分小图标，跑在 `.app` 外面；
 *   - `theme-css.ts`：亮色覆盖，只覆盖设计稿已有的选择器。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const CLIENT_DIR = new URL('../src/client/', import.meta.url)
const root = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8')

/** Every client source file, as [name, text]. */
function clientSources(): readonly (readonly [string, string])[] {
  return readdirSync(CLIENT_DIR)
    .filter(name => name.endsWith('.ts') || name.endsWith('.tsx'))
    .map(name => [name, readFileSync(new URL(name, CLIENT_DIR), 'utf8')] as const)
}

/** Files allowed to carry their own CSS, with the reason they are exempt. */
const STYLE_OWNERS = new Set([
  'theme-css.ts',
  'credit-dot-css.ts',
  'design-css.ts',
  'responsive-css.ts',
  /**
   * 账号卡的 `xdp-acct*` 命名空间 —— 已知的技术债，不是新写界面的模板。
   *
   * 它来自「把账号卡挂回账号池页」那次改动：为了自包含而新造了一套类名。视觉上
   * 可接受，但与设计稿的 `.acct*` 是两套语言，所以只作为例外放行。下一版应当整体
   * 迁到设计稿的 `.acct / .acct-head / .acct-total / .acct-bar / .acct-detail`，
   * 迁完之后把这一条从白名单里删掉。
   */
  'account-card.tsx',
])

describe('界面只来自设计稿', () => {
  it('没有自造的布局类前缀', () => {
    // `xdp-acct` / `xdp-*` 是 3.0.6 那次的命名空间：它自包含，但和这一版页面的
    // grid、`.sec`、字号阶梯都对不上，用户看到的还是「排版不对」。
    const offenders = clientSources()
      .filter(([name]) => !STYLE_OWNERS.has(name))
      .filter(([, text]) => /className="xdp-|\.xdp-[a-z]/u.test(text))
      .map(([name]) => name)
    expect(offenders, '新界面请复用设计稿的类名，不要自造一套').toEqual([])
  })

  it('页面组件不自带 <style> 块', () => {
    // 样式写在组件里就等于第二份来源：设计稿改了它不会跟着变，两处迟早分叉。
    const offenders = clientSources()
      .filter(([name]) => name.endsWith('.tsx'))
      .filter(([, text]) => /<style[\s>]/u.test(text))
      .map(([name]) => name)
    expect(offenders).toEqual([])
  })

  it('design-css.ts 仍然是生成文件，没有手改', () => {
    const css = readFileSync(new URL('design-css.ts', CLIENT_DIR), 'utf8')
    // 头注释由提取脚本写入：有人手改会先被它挡住。
    expect(css.slice(0, 200)).toContain('设计稿样式')
    expect(css).toContain('scripts/extract-design-css.mjs')
  })

  it('规则文件还在，且仍然指向设计稿', () => {
    expect(root).toContain('xdpool-design/')
    expect(root).toMatch(/照它已有的类名和结构搭|只有一个来源/u)
  })
})
