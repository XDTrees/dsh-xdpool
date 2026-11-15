/**
 * The incentive campaign, in full.
 *
 * `POST /alice/ug/campaign/v3/detail/` with
 * `{campaign_group_code: "pc_incentive_task_mvp_v3"}` is the endpoint that answers: the
 * others (`list/`, `landing/get`) return nothing for this account, while this one returns
 * the campaign — the codes, the items, and the ids the claim endpoint needs.
 *
 * The output is flattened to the fields that matter for the plugin:
 *
 *   - `task_code`      the server's name for a task (`daily_signin`, …)
 *   - `task_id`         what `item/reward/claim/` wants
 *   - `campaign_item_code`
 *   - the points each is worth
 *   - whether it is already done today
 */
import { readFileSync } from 'node:fs'

const cookies = JSON.parse(readFileSync('D:/dsh-home/_doubao-cookies.json', 'utf8'))
const UA = readFileSync('D:/dsh-home/_doubao-ua.txt', 'utf8').trim()
const P = 'aid=497858&version_code=20800&device_platform=web&doubao_device_platform=web&language=zh&region=CN&sys_region=CN&pkg_type=release_version&pc_version=3.45.5&doubao_pc_version=3.45.5&device_id=7707326032512615990&web_id=7707326040423597619&tea_uuid=7707326040423597619&samantha_web=1&web_platform=browser&use-olympus-account=1&web_tab_id=b4202548-51a3-4ec4-a46d-8ebb883c6f3d'
const H = {
  'content-type': 'application/json',
  accept: 'application/json, text/plain, */*',
  'user-agent': UA,
  origin: 'https://www.doubao.com',
  referer: 'https://www.doubao.com/chat/',
  cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '),
  ...(cookies.passport_csrf_token === undefined ? {} : { 'x-tt-passport-csrf-token': cookies.passport_csrf_token }),
}

const response = await fetch(`https://www.doubao.com/alice/ug/campaign/v3/detail/?${P}`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ campaign_group_code: 'pc_incentive_task_mvp_v3' }),
})
const json = JSON.parse(await response.text())
const data = json.data
const { writeFileSync } = await import('node:fs')
writeFileSync('_doubao-campaign.json', JSON.stringify(json, null, 2))

console.log('顶层键:', Object.keys(data ?? {}).join(', '))
console.log('')

/** Walk the tree and report every object that looks like a task. */
const tasks = []
const seen = new Set()
const walk = (node, path = '') => {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((item, i) => walk(item, `${path}[${i}]`)); return }
  const record = node
  const code = record.task_code ?? record.code ?? record.item_code
  if (typeof code === 'string' && code !== '' && !seen.has(code)) {
    seen.add(code)
    tasks.push({ path, record })
  }
  for (const [key, value] of Object.entries(record)) walk(value, path === '' ? key : `${path}.${key}`)
}
walk(data)

console.log(`找到 ${tasks.length} 个任务条目:\n`)
for (const { path, record } of tasks) {
  const name = record.task_name ?? record.name ?? record.title ?? ''
  const amount = record.amount ?? record.point ?? record.points ?? record.reward_amount ?? ''
  const taskId = record.task_id ?? ''
  const itemCode = record.campaign_item_code ?? record.item_code ?? ''
  const done = record.task_status ?? record.status ?? record.finish_status ?? record.is_finish ?? ''
  console.log(`  ${String(code).padEnd(34)} ${String(name).slice(0, 26).padEnd(28)} ${String(amount).padEnd(6)} ${String(taskId).padEnd(22)} ${String(itemCode).padEnd(26)} ${done}`)
  if (Object.keys(record).length <= 12) console.log(`      字段: ${Object.keys(record).join(', ')}`)
}
console.log('\n已存 _doubao-campaign.json')
