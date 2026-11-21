import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { compareVersions, extractNotes } from '../src/update-check.ts'

/**
 * Comparing the version this build runs against the published one.
 *
 * The panel has three honest answers — newer, current, could not check — and this is the half
 * that decides "newer". Getting the ordering wrong makes the panel claim an update exists when
 * it does not, or hide one that does.
 */
describe('version comparison', () => {
  it('orders patch releases', () => {
    expect(compareVersions('2.7.3', '2.7.2')).toBeGreaterThan(0)
    expect(compareVersions('2.7.2', '2.7.3')).toBeLessThan(0)
    expect(compareVersions('2.7.3', '2.7.3')).toBe(0)
  })

  it('compares numerically, not as text', () => {
    // Text ordering would put "2.7.9" after "2.7.10" — the bug this guards.
    expect(compareVersions('2.7.10', '2.7.9')).toBeGreaterThan(0)
    expect(compareVersions('2.10.0', '2.9.9')).toBeGreaterThan(0)
  })

  it('handles a shorter or longer version', () => {
    expect(compareVersions('2.8', '2.7.9')).toBeGreaterThan(0)
    expect(compareVersions('2.7.3.1', '2.7.3')).toBeGreaterThan(0)
  })

  it('treats a prerelease as older than its release', () => {
    // npm's own ordering: 2.7.3-rc.1 < 2.7.3, so a user on the prerelease IS offered the release.
    expect(compareVersions('2.7.3-rc.1', '2.7.3')).toBeLessThan(0)
    expect(compareVersions('2.7.3', '2.7.3-rc.1')).toBeGreaterThan(0)
  })

  it('ignores a leading v', () => {
    expect(compareVersions('v2.7.3', '2.7.3')).toBe(0)
  })

  it('is symmetric', () => {
    for (const [a, b] of [['2.7.3', '2.8.0'], ['1.0.0', '1.0.1'], ['3.0.0', '2.99.99']]) {
      expect(Math.sign(compareVersions(a!, b!)), `${a} vs ${b}`).toBe(-Math.sign(compareVersions(b!, a!)))
    }
  })
})

/**
 * 从 README 里裁「更新公告」。
 *
 * registry 只发布 README，不发布 changelog，所以更新内容必须从正文里按标题找。
 * 这几条测试守的是三个具体的失败：
 *   1. 把「安装」小节里的命令行当成更新内容
 *   2. 越过小节边界，把后面的「功能」也吃进来
 *   3. README 里没有公告小节时，返回 undefined 而不是空数组（面板据此整块不显示）
 */
describe('更新内容提取', () => {
  const readme = [
    '# 插件名',
    '',
    '## 安装',
    '- npm i dsh-xdpool',
    '',
    '## 更新公告',
    '',
    '### 3.0.0 — 改了亿点点东西，累了',
    '- 界面整体重做',
    '- **重要**：修了已登录渠道被归到未登录',
    '- `GatewayPage` 加了关闭按钮',
    '',
    '## 功能',
    '- 这段不该被提取',
  ].join('\n')

  it('只取公告小节里的条目', () => {
    const { title, notes } = extractNotes(readme)
    expect(title).toBe('更新公告')
    expect(notes).toEqual([
      '界面整体重做',
      '重要：修了已登录渠道被归到未登录',
      'GatewayPage 加了关闭按钮',
    ])
  })

  it('不越过小节边界', () => {
    const { notes } = extractNotes(readme)
    expect(notes?.some(n => n.includes('不该被提取'))).toBe(false)
    expect(notes?.some(n => n.includes('npm i'))).toBe(false)
  })

  it('没有公告小节时不编内容', () => {
    expect(extractNotes('# 只有标题\n\n## 安装\n- 一条命令').notes).toBeUndefined()
    expect(extractNotes(undefined).notes).toBeUndefined()
    expect(extractNotes('').notes).toBeUndefined()
  })

  it('认得英文标题', () => {
    const en = "## What's new\n- Faster startup"
    expect(extractNotes(en).notes).toEqual(['Faster startup'])
  })
})

/**
 * 这个仓库自己的 README 必须能被面板读出来。
 *
 * 上面几条测的是「给定格式能解析」；这条测的是「我们真的按那个格式写了」。
 * 少了它，README 某次改版把「更新公告」换成别的标题，解析函数照旧全部通过，
 * 而面板在用户手里会静默空白 —— 这类失败只在发布后才被发现。
 */
describe('README 的更新公告小节', () => {
  it('能被解析出小标题和若干条目', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
    const { title, notes } = extractNotes(readme)
    // 发版前这一节可能还没写；一旦写了就必须解析得出东西。
    if (!readme.includes('## 更新公告') && title === undefined) return
    expect(title, 'README 有「更新公告」小节，却解析不出标题').toBe('更新公告')
    expect(notes?.length ?? 0, '更新公告里应当有若干列表项').toBeGreaterThan(0)
  })
})
