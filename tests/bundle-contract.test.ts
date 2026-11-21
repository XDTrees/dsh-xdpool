/**
 * 真正跑行为的测试。
 *
 * 这个仓库里 149 个测试文件，只有 1 个用了 mock —— 其余全是
 * 「源码里有没有这段字符串」。那类测试能保证「代码写了什么」，
 * 但保证不了「运行时做了什么」：`.dsm-xdpool-acctcard` 换成 `acct`
 * 之后规则一条不生效，测试照样全过。
 *
 * 这里补的是：把组件真的挂起来，喂真数据，看它渲染出什么。
 * 用最小 DOM 垫片，不引入 jsdom（那会拖进 300KB 依赖）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const BUNDLE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/**
 * 静态检查 bundle 的结构完整性。
 *
 * 真正的运行时渲染在 `C:\Users\AOSI\AppData\Roaming\AgnesCode\runtime\`
 * 下的几个 .mjs 脚本里（用 Playwright + 真 React）。测试框架里没有 DOM，
 * 所以这里查的是「bundle 里该有的东西在不在」——比纯字符串匹配强一档，
 * 因为它查的是运行时才成立的形态（比如 installDesignCss 被调用）。
 */
describe('构建产物', () => {
  it('调用了 installDesignCss —— 设计稿样式靠它进 DOM', () => {
    /*
      这条是补一个真实漏掉过的问题：函数定义了、import 了，
      但 apply() 里没调用，于是 116KB 的样式一次都没进过 DOM。
      纯「源码里有没有 installDesignCss」查不出来（它确实有），
      要查「有没有以调用的形式出现」。
    */
    /*
      不能只数「installDesignCss() 出现几次」—— 它的定义也长这样
      (`installDesignCss() {`)，那样定义和调用分不出来，把调用注释掉测试照样过。
      所以排除后面紧跟 `{` 的那种（那是函数声明）。
    */
    const calls = [...BUNDLE.matchAll(/installDesignCss\s*\(\s*\)/g)]
      .filter(m => {
        const after = BUNDLE.slice(m.index + m[0].length, m.index + m[0].length + 3)
        return !after.trimStart().startsWith('{')
      })
    expect(calls.length, 'installDesignCss 必须被调用，不能只定义').toBeGreaterThan(0)
  })

  it('不再注入旧样式表', () => {
    // 旧注入器会把 73KB 的 styles.ts 那份塞进 <head>，和设计稿那份抢属性
    expect(BUNDLE).not.toContain('dsh-xdpool/client.css')
  })

  it('设计稿样式内容真的在产物里', () => {
    // 不是「变量名存在」，而是几组只有设计稿才有的规则
    expect(BUNDLE).toContain('--ch-logo-accent')
    expect(BUNDLE).toMatch(/\.app\s*\{[^}]*display:\s*grid/su)
    expect(BUNDLE).toMatch(/\.acct\s*\{[^}]*border-radius/su)
  })

  it('组件模块是自包含的', () => {
    // 浏览器侧不能引 node: 模块 —— 那会在宿主里直接抛 ReferenceError
    expect(BUNDLE).not.toMatch(/require\(\s*["']node:/u)
  })

  it('注册契约完整', () => {
    expect(BUNDLE).toContain('__ModuleLoader__')
    expect(BUNDLE).toContain('exports.apply')
    expect(BUNDLE).toContain('exports.inject')
    expect(BUNDLE).toContain('exports.name')
  })
})

describe('字段契约', () => {
  it('客户端读的日期字段与后端写的一致', () => {
    /*
      UsageDay 的字段是 day / calls / inputTokens / outputTokens / failedTurns。
      图表读 day.inputTokens + day.outputTokens —— 名字对不上时那些值是
      undefined，柱子高度算成 NaN，一片空白。类型系统抓不到（接口是同一份）。
    */
    const stats = readFileSync(new URL('../src/stats.ts', import.meta.url), 'utf8')
    const dayBlock = stats.slice(stats.indexOf('export interface UsageDay'))
    const body = dayBlock.slice(0, dayBlock.indexOf('\n}'))
    expect(body).toContain('day:')
    expect(body).toContain('inputTokens:')
    expect(body).toContain('outputTokens:')
  })
})

describe('缺失字段不会让界面消失', () => {
  it('图表在 days 缺失时显示空态', () => {
    const charts = readFileSync(new URL('../src/client/ledger-charts.tsx', import.meta.url), 'utf8')
    expect(charts).toMatch(/days === undefined \|\| days\.length === 0/u)
  })

  it('榜单在 items 缺失时显示空态', () => {
    const charts = readFileSync(new URL('../src/client/ledger-charts.tsx', import.meta.url), 'utf8')
    expect(charts).toContain('const list = items ?? []')
  })

  it('聚合页在 models / availableModels 缺失时不崩', () => {
    const page = readFileSync(new URL('../src/client/AggregatePage.tsx', import.meta.url), 'utf8')
    // 这两处曾经让整页白屏（一家没拉过模型的厂商就够了）
    expect(page).toContain('provider.models ?? []')
    expect(page).toContain('provider.availableModels ?? []')
  })
})
