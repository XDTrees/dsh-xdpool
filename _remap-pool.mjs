/**
 * 收尾：把 PoolCard 剩余的非锚点类名全部映射掉。
 *
 * 到这一步剩下的都是「修饰变体」（-on / -dead / -bad / -ok 之类）。
 * 它们不该自成一类 —— 设计稿里状态靠 `data-*` 属性表达，不靠类名后缀。
 * 所以：去掉后缀，保留主类名。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const PATH = 'D:/d/dsh-home/_xdpool-src/src/client/PoolCard.tsx'
const KEEP = new Set(['dsm-xdpool-body', 'dsm-xdpool-regions', 'dsm-xdpool-rail',
                      'dsm-xdpool-detail', 'dsm-xdpool-cpool', 'dsm-xdpool-shell'])

let s = readFileSync(PATH, 'utf8')

/**
 * 明确的一对一映射（剩下的都在这）。
 */
const MAP = {
  'dsm-xdpool-auto-switch': 'sw', 'dsm-xdpool-auto-switch-on': 'is-on',
  'dsm-xdpool-account-prefer-on': 'is-on', 'dsm-xdpool-account-tag': 'pill',
  'dsm-xdpool-account-tag-dead': 'pill', 'dsm-xdpool-model-off': 'is-off',
  'dsm-xdpool-dist-option-badge': 'badge', 'dsm-xdpool-dist-option': 'seg',
  'dsm-xdpool-empty-steps-title': 'sec-title', 'dsm-xdpool-empty-steps': 'sec',
  'dsm-xdpool-empty': 'hint', 'dsm-xdpool-loading': 'hint',
  'dsm-xdpool-price': 'td-num', 'dsm-xdpool-models': 'models',
  'dsm-xdpool-panel-title': 'sec-title', 'dsm-xdpool-panel': 'sec',
  'dsm-xdpool-note': 'note', 'dsm-xdpool-error': 'hint',
  'dsm-xdpool-usage-title': 'sec-title', 'dsm-xdpool-usage-note': 'hint',
  'dsm-xdpool-usage': 'sec',
}

for (const [a, b] of Object.entries(MAP)) {
  s = s.replace(/className=(?:"([^"]*)"|\{'([^']*)'\})/g, (whole, dq, sq) => {
    const raw = dq ?? sq
    const words = raw.split(/\s+/).filter(Boolean)
    if (!words.includes(a)) return whole
    const next = []
    for (const w of words) {
      if (w !== a) { next.push(w); continue }
      if (b !== '') next.push(...b.split(/\s+/))
    }
    const joined = [...new Set(next)].join(' ')
    return dq === undefined ? `className={'${joined}'}` : `className="${joined}"`
  })
}

/**
 * 剩下的「dsm-xdpool-xxx-yyy」：如果 xxx 前面已有对应设计稿名就换，
 * 否则整词去掉 —— 一个没有样式的类名留着只会误导后来的人。
 */
const LEFT = {
  'dsm-xdpool-auto-job-item': 'fact', 'dsm-xdpool-auto-job-item-': 'fact',
  'dsm-xdpool-catalog-offline': 'hint', 'dsm-xdpool-catalog': 'sec',
  'dsm-xdpool-checkin-streak': 'pill', 'dsm-xdpool-checkin': 'sec',
  'dsm-xdpool-dist-': 'seg', 'dsm-xdpool-dist': 'seg',
  'dsm-xdpool-sidebar': 'sec', 'dsm-xdpool-reserve': 'row',
  'dsm-xdpool-skipped': 'sec', 'dsm-xdpool-stats': 'kpis',
  'dsm-xdpool-total': 'kpi', 'dsm-xdpool-account': 'ch',
  'dsm-xdpool-model': 'model', 'dsm-xdpool-packages': 'facts',
  'dsm-xdpool-panel': 'sec', 'dsm-xdpool-earned': 'fact',
}
for (const [a, b] of Object.entries(LEFT)) {
  s = s.replace(/className=(?:"([^"]*)"|\{'([^']*)'\})/g, (whole, dq, sq) => {
    const raw = dq ?? sq
    const words = raw.split(/\s+/).filter(Boolean)
    const hit = words.filter(w => w.startsWith(a))
    if (hit.length === 0) return whole
    const next = words.flatMap(w => (w.startsWith(a) ? b.split(/\s+/) : [w]))
    const joined = [...new Set(next)].join(' ')
    return dq === undefined ? `className={'${joined}'}` : `className="${joined}"`
  })
}

writeFileSync(PATH, s, 'utf8')
const left = [...new Set(s.match(/dsm-xdpool-[a-z][a-z0-9-]*/g) ?? [])].filter(n => !KEEP.has(n))
console.log('剩余非锚点:', left.length, left.slice(0, 10))
execFileSync('git', ['add', PATH], { cwd: 'D:/dsh-home/_xdpool-src' })
execFileSync('git', ['-c', 'user.email=x@local', '-c', 'user.name=xd', 'commit', '-q',
  '-m', `refactor(PoolCard): 收尾（剩 ${left.length} 非锚点）`], { cwd: 'D:/dsh-home/_xdpool-src' })
