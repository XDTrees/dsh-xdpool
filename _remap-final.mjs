/**
 * 最后一批类名映射。
 *
 * 目标：插件里的 className 全部改用设计稿那套名字。
 * 保留的只有「结构性锚点」（测试与 JS 用来定位的），它们不承载样式。
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const CLIENT = 'D:/dsh-home/_xdpool-src/src/client'
const design = readFileSync(`${CLIENT}/design-css.ts`, 'utf8')

/** 设计稿里真实存在的类名。不在这个集合里的，一律要映射掉。 */
const defined = new Set()
for (const m of design.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) defined.add(m[1])

/**
 * 保留：这些是结构锚点 —— 测试断言用、JS 查询用，不承载样式。
 * 设计稿里没有它们是正常的（设计稿是静态页，不需要给测试留钩子）。
 */
const KEEP = new Set([
  'dsm-xdpool-body', 'dsm-xdpool-regions', 'dsm-xdpool-rail',
  'dsm-xdpool-detail', 'dsm-xdpool-cpool', 'dsm-xdpool-shell',
])

const MAP = {
  'dsm-xdpool-update-error': 'hint', 'dsm-xdpool-update-current': 'hint',
  'dsm-xdpool-update-head': 'sec-head', 'dsm-xdpool-update-hint': 'hint',
  'dsm-xdpool-update-acts': 'sec-actions', 'dsm-xdpool-update': 'sec',
  'dsm-xdpool-strip-sep': 'mono', 'dsm-xdpool-strip-caret': 'strip-caret',
  'dsm-xdpool-strip-main': 'strip-main', 'dsm-xdpool-strip-meta': 'strip-meta',
  'dsm-xdpool-strip-list': 'facts', 'dsm-xdpool-strip-ch': 'ch',
  'dsm-xdpool-strip-k': 'ch-name', 'dsm-xdpool-strip-n': 'td-num',
  'dsm-xdpool-strip': 'strip',
  'dsm-xdpool-region-state': 'pill', 'dsm-xdpool-region-seg': 'seg',
  'dsm-xdpool-region-note': 'hint', 'dsm-xdpool-region-head': 'sec-head',
  'dsm-xdpool-model-budget': 'badge',
  'dsm-xdpool-dotpanel-v': 'pop-v', 'dsm-xdpool-dotpanel-sec': 'pop-sec',
  'dsm-xdpool-dotpanel-k': 'pop-k', 'dsm-xdpool-dotpanel-row': 'pop-row',
  'dsm-xdpool-dotpanel-rowname': 'pop-rowname', 'dsm-xdpool-dotpanel-rowval': 'pop-rowval',
  'dsm-xdpool-dotpanel-more': 'pop-more', 'dsm-xdpool-dotpanel-channel': 'ch',
  'dsm-xdpool-dotpanel-empty': 'hint', 'dsm-xdpool-dotpanel': 'pop',
  'dsm-xdpool-card': 'card',
  'dsm-xdpool-bal-pack-name': 'td-name', 'dsm-xdpool-bal-pack': 'fact',
  'dsm-xdpool-bal-account-name': 'ch-name', 'dsm-xdpool-bal-account-total': 'td-num',
  'dsm-xdpool-bal-account': 'ch', 'dsm-xdpool-bal-accounts': 'facts',
  'dsm-xdpool-bal-caret': 'strip-caret', 'dsm-xdpool-bal': 'strip',
  'dsm-xdpool-auto-switch-on': 'is-on', 'dsm-xdpool-auto-switch': 'sw',
  'dsm-xdpool-account-toggle': 'sw', 'dsm-xdpool-account-tag': 'pill',
  'dsm-xdpool-account-prefer': 'tiny', 'dsm-xdpool-account': 'ch',
  'dsm-xdpool-usage-summary': 'sec-head', 'dsm-xdpool-usage-rows': 'table',
  'dsm-xdpool-usage-row': 'tr', 'dsm-xdpool-usage-numbers': 'td-num',
  'dsm-xdpool-usage-model': 'td-name', 'dsm-xdpool-usage': 'sec',
  'dsm-xdpool-btn': 'btn',
}

const files = readdirSync(CLIENT).filter(f => f.endsWith('.tsx') || f.endsWith('.ts'))
  .filter(f => f !== 'design-css.ts')

let touched = 0
for (const file of files) {
  const path = `${CLIENT}/${file}`
  let s = readFileSync(path, 'utf8')
  const before = s

  for (const [from, to] of Object.entries(MAP)) {
    s = s.replace(/className=(?:"([^"]*)"|\{'([^']*)'\})/g, (whole, dq, sq) => {
      const raw = dq ?? sq
      const words = raw.split(/\s+/).filter(Boolean)
      if (!words.includes(from)) return whole
      const next = []
      for (const w of words) {
        if (w !== from) { next.push(w); continue }
        if (to !== '') next.push(...to.split(/\s+/))
      }
      const joined = [...new Set(next)].join(' ')
      return dq === undefined ? `className={'${joined}'}` : `className="${joined}"`
    })
  }

  if (s !== before) {
    writeFileSync(path, s, 'utf8')
    const left = [...new Set(s.match(/dsm-xdpool-[a-z][a-z0-9-]*/g) ?? [])]
      .filter(n => !KEEP.has(n))
    execFileSync('git', ['add', path], { cwd: 'D:/dsh-home/_xdpool-src' })
    execFileSync('git', ['-c', 'user.email=x@local', '-c', 'user.name=xd', 'commit', '-q',
      '-m', `refactor(${file}): 类名对齐设计稿（非锚点剩 ${left.length}）`],
      { cwd: 'D:/dsh-home/_xdpool-src' })
    console.log(`${file}: 非锚点剩余 ${left.length}`, left.length > 0 ? `→ ${left.slice(0, 6).join(', ')}` : '')
    touched++
  }
}
console.log(`\n改了 ${touched} 个文件`)
