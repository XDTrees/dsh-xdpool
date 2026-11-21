/**
 * 把插件页面的旧类名映射到设计稿的类名，每改一个文件就提交。
 *
 * 上一轮我用 `git checkout -- src/client/` 撤销，结果把 9 个文件的
 * 十几轮改动全回滚了。这次反过来：每改一个文件立刻 commit，
 * 真要撤销也只退一个文件。
 *
 * 映射依据是 ui30 产物的类名清单（已经提取到 _app-fragment.txt），
 * 以及设计稿 design-css.ts 里实际定义的类名 —— 不凭记忆。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const CLIENT = 'D:/dsh-home/_xdpool-src/src/client'

/** 旧类名 → 设计稿类名。空串＝去掉这个词。 */
const MAP = {
  // 页面外壳
  'dsm-xdpool-page': 'main',
  'dsm-xdpool-pagehead': 'mhead',
  'dsm-xdpool-pagetitles': 'mhead-title',
  'dsm-xdpool-pagename': 'mhead-name',
  'dsm-xdpool-pageorg': 'mhead-org',
  'dsm-xdpool-pageactions': 'mhead-actions',
  'dsm-xdpool-pagenote': 'note',
  'dsm-xdpool-pagestate': 'pill',

  // 三格 / 汇总
  'dsm-xdpool-statrow': 'kpis',
  'dsm-xdpool-statcell': 'kpi',
  'dsm-xdpool-statcell-wide': 'kpi',
  'dsm-xdpool-statlabel': 'kpi-k',
  'dsm-xdpool-statvalue': 'kpi-v',
  'dsm-xdpool-statunit': 'kpi-u',

  // 策略
  'dsm-xdpool-policies': 'policies',
  'dsm-xdpool-policy': 'policy',
  'dsm-xdpool-policytitle': 'policy-k',

  // 分区
  'dsm-xdpool-band': 'sec',
  'dsm-xdpool-bandhead': 'sec-head',
  'dsm-xdpool-bandtitle': 'sec-title',
  'dsm-xdpool-bandcount': 'sec-n',
  'dsm-xdpool-bandactions': 'sec-actions',
  'dsm-xdpool-bandempty': 'note',
  'dsm-xdpool-sectitle': 'sec-title',
  'dsm-xdpool-sec': 'sec',

  // 账号卡
  'dsm-xdpool-acctcards': 'accts',
  'dsm-xdpool-acctcard': 'acct',
  'dsm-xdpool-acctcardhead': 'acct-head',
  'dsm-xdpool-acctdot': 'acct-dot',
  'dsm-xdpool-acctcardname': 'acct-name',
  'dsm-xdpool-acctcardfacts': 'facts',
  'dsm-xdpool-acctcarderror': 'acct-k',
  'dsm-xdpool-accttotal': 'acct-total',
  'dsm-xdpool-accttotalval': 'acct-total-v',
  'dsm-xdpool-acctbar': 'acct-bar',
  'dsm-xdpool-acctdetail': 'acct-detail',
  'dsm-xdpool-acctwindow': 'pop',
  'dsm-xdpool-acctwindowhead': 'pop-head',
  'dsm-xdpool-acctwindowname': 'pop-name',
  'dsm-xdpool-acctwindowclose': 'pop-close',
  'dsm-xdpool-factexpiry': 'acct-soon',
  'dsm-xdpool-fact': 'fact',
  'dsm-xdpool-fact-wide': 'fact',

  // 模型
  'dsm-xdpool-modelrow': 'model',
  'dsm-xdpool-modellist': 'models',
  'dsm-xdpool-modelmain': 'model-main',
  'dsm-xdpool-modeltop': 'model-top',
  'dsm-xdpool-modelname': 'model-name',
  'dsm-xdpool-modelsub': 'model-sub',
  'dsm-xdpool-modelmult': 'model-mult',
  'dsm-xdpool-mbadge': 'badge',
  'dsm-xdpool-ctxselect': 'ctx-select',
  'dsm-xdpool-ctxchip': 'ctx-select',

  // 按钮
  'dsm-xdpool-pagebtn': 'btn',
  'dsm-xdpool-tinybtn': 'tiny',
  'dsm-xdpool-tinybtn-primary': 'tiny tiny-primary',
  'dsm-xdpool-tinybtn-danger': 'tiny btn-danger',
  'dsm-xdpool-btn': 'btn',

  // 开关
  'dsm-xdpool-switch': 'sw',
  'dsm-xdpool-switch-sm': '',
  'dsm-xdpool-switchknob': '',
  'dsm-xdpool-toggle': 'sw',

  // 其它
  'dsm-xdpool-search': 'search',
  'dsm-xdpool-note': 'note',
  'dsm-xdpool-pill': 'pill',
  'dsm-xdpool-panel-empty': 'hint',
  'dsm-xdpool-panel-error': 'hint',
  'dsm-xdpool-ellipsis': 'td-mono',
  'dsm-xdpool-num': 'num',
  'dsm-xdpool-tablewrap': 'table-scroll',
  'dsm-xdpool-table': 'table',
}

const FILES = ['PoolCard.tsx', 'ChannelPoolSection.tsx', 'AggregatePage.tsx',
               'RoutingPage.tsx', 'GatewayPage.tsx', 'LedgerPage.tsx',
               'ChannelsPage.tsx', 'BackupPanel.tsx']

/** 只替换 className="..." 里完整出现的词。 */
function rewrite(source) {
  let out = source
  for (const [from, to] of Object.entries(MAP)) {
    out = out.replace(/className=(?:"([^"]*)"|\{'([^']*)'\})/g, (whole, dq, sq) => {
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
  return out
}

let changed = 0
for (const file of FILES) {
  const path = `${CLIENT}/${file}`
  const before = readFileSync(path, 'utf8')
  const after = rewrite(before)
  if (after === before) { console.log(`— ${file} 无需改动`); continue }
  writeFileSync(path, after, 'utf8')
  const left = (after.match(/dsm-xdpool-[a-z]/g) ?? []).length
  execFileSync('git', ['add', path], { cwd: 'D:/dsh-home/_xdpool-src' })
  execFileSync('git', ['-c', 'user.email=x@local', '-c', 'user.name=xd', 'commit', '-q',
    '-m', `refactor(${file}): 类名改用设计稿那套（剩 ${left} 处）`],
    { cwd: 'D:/dsh-home/_xdpool-src' })
  console.log(`✓ ${file}  剩余旧类名 ${left} 处（已提交）`)
  changed++
}
console.log(`\n改了 ${changed} 个文件`)
