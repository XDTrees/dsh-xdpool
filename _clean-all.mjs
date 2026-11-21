/**
 * 把源码里剩下的旧类名一次清完。
 *
 * 依据是这个映射表：旧名 → 设计稿名。名字全部取自 design-css.ts 里
 * 真实定义过的类（前面几轮已核对），不是我现编的。
 *
 * 每改一个文件就提交，任何一步出问题都只退一个文件 —— 这是上上轮
 * `git checkout -- src/client/` 一次性回滚 9 个文件之后立的规矩。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const CLIENT = 'D:/dsh-home/_xdpool-src/src/client'

/** 结构锚点：测试与 JS 用来定位，不承载样式，保留。 */
const KEEP = new Set([
  'dsm-xdpool-body', 'dsm-xdpool-regions', 'dsm-xdpool-rail',
  'dsm-xdpool-detail', 'dsm-xdpool-cpool', 'dsm-xdpool-shell',
])

/**
 * 旧名 → 设计稿名。
 *
 * 值写空串＝去掉这个词（那个元素在设计稿里没有对应结构，或者只是
 * 一个纯逻辑标记，给它套个没有规则的类名只会误导后来的人）。
 */
const MAP = {
  // 账号
  'dsm-xdpool-account-meta-dead': 'ch-org',
  'dsm-xdpool-account-meta': 'ch-org',
  'dsm-xdpool-account-body': 'ch-titles',
  'dsm-xdpool-account-copy': 'ch-titles',
  'dsm-xdpool-account-head': 'ch-head',
  'dsm-xdpool-account-label': 'ch-title',
  'dsm-xdpool-account-ignore': 'ch-count',
  'dsm-xdpool-account-modelcool': 'ch-note',
  'dsm-xdpool-account-modelcool-chip': 'badge',
  'dsm-xdpool-account-modelcool-twin': 'badge',
  'dsm-xdpool-account-prefer-star': 'tiny',
  'dsm-xdpool-account-toggle-dot': 'acct-dot',
  'dsm-xdpool-account': 'ch',

  // 聚合页
  'dsm-xdpool-agg-fact-name': 'td-name',
  'dsm-xdpool-agg-fact': 'fact',
  'dsm-xdpool-agg-flash': 'hint',
  'dsm-xdpool-agg-foot': 'vd-foot',
  'dsm-xdpool-agg-lanebar': 'lane',
  'dsm-xdpool-agg-modelid': 'mono',
  'dsm-xdpool-agg-modellist': 'models',
  'dsm-xdpool-agg-modelrow': 'model',
  'dsm-xdpool-agg-open-caret': 'strip-caret',
  'dsm-xdpool-agg-pane': 'card',
  'dsm-xdpool-agg-pickeracts': 'pick-actions',
  'dsm-xdpool-agg-pickerhead': 'pick-head',
  'dsm-xdpool-agg-pickerlabel': 'pick-title',
  'dsm-xdpool-agg-picker': 'pick',
  'dsm-xdpool-agg': 'main',

  // 备份
  'dsm-xdpool-bak-head': 'sec-head',
  'dsm-xdpool-bak-title': 'sec-title',
  'dsm-xdpool-bak-warn': 'pill',

  // 登录页
  'dsm-xdpool-channel-error': 'ch-note',
  'dsm-xdpool-channel-ok': 'ch-count',

  // 账号池分区
  'dsm-xdpool-cpool-acctacts': 'sec-actions',
  'dsm-xdpool-cpool-acctlist': 'facts',
  'dsm-xdpool-cpool-acctmeta': 'ch-org',
  'dsm-xdpool-cpool-acct': 'ch',

  // 其它
  'dsm-xdpool-auto-run': 'tiny',
  'dsm-xdpool-autocheckin-note': 'hint',
  'dsm-xdpool-autocheckin': 'hint',
  'dsm-xdpool-glass': '',
  'dsm-xdpool-kpis': 'kpis',
}

const files = [
  'PoolCard.tsx', 'ChannelPoolSection.tsx', 'AggregatePage.tsx', 'RoutingPage.tsx',
  'GatewayPage.tsx', 'LedgerPage.tsx', 'ChannelsPage.tsx', 'BackupPanel.tsx',
  'ChannelDetailPage.tsx', 'AccountPoolShell.tsx', 'ChannelUsagePane.tsx',
  'region-card.tsx', 'BalancePanel.tsx', 'CreditDot.tsx', 'UpdatePanel.tsx',
  'credit-strip.tsx', 'model-facts-row.tsx', 'loading.tsx', 'brand-tile.tsx',
  'DoubaoAutomationPane.tsx', 'shell.tsx', 'page.tsx', 'index.tsx',
]

for (const file of files) {
  const path = `${CLIENT}/${file}`
  let s
  try { s = readFileSync(path, 'utf8') } catch { continue }
  const before = s

  for (const [from, to] of Object.entries(MAP)) {
    // 只改 className="..." / className={`...`} / className={'...'}
    s = s.replace(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g, (whole, dq, tpl, sq) => {
      const raw = dq ?? tpl ?? sq
      const words = raw.split(/\s+/).filter(Boolean)
      if (!words.includes(from)) return whole
      const next = []
      for (const w of words) {
        if (w !== from) { next.push(w); continue }
        if (to !== '') next.push(...to.split(/\s+/))
      }
      const joined = [...new Set(next)].join(' ')
      if (dq !== undefined) return `className="${joined}"`
      if (tpl !== undefined) return `className={\`${joined}\`}`
      return `className={'${joined}'}`
    })
  }

  if (s !== before) {
    writeFileSync(path, s, 'utf8')
    const left = [...new Set(s.match(/dsm-xdpool-[a-z][a-z0-9-]*/g) ?? [])].filter(n => !KEEP.has(n))
    try {
      execFileSync('git', ['add', path], { cwd: 'D:/dsh-home/_xdpool-src' })
      execFileSync('git', ['-c', 'user.email=x@local', '-c', 'user.name=xd', 'commit', '-q',
        '-m', `refactor(${file}): 旧类名清零（剩 ${left.length}）`],
        { cwd: 'D:/dsh-home/_xdpool-src' })
    } catch { /* 没有改动就不提交 */ }
    console.log(`${file}: 剩 ${left.length}`, left.length ? `→ ${left.slice(0, 5).join(', ')}` : '')
  }
}
console.log('完成')
