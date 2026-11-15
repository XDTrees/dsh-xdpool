/**
 * Why is the check-in refused?
 *
 * The desktop client sends exactly what we send — `{"scene":"pc_incentive_task_mvp_v3"}` —
 * and is refused with the same `710010702 系统错误`. So the request shape is right, and
 * whatever refuses it is the server's decision about THIS ACCOUNT.
 *
 * The account state says the check-in is available (`task_status: 1`,
 * `checked_in_today: false`), and one task in particular looks like a gate:
 *
 *   select_work_fields  选择工作领域领取奖励   status 3 (not done)
 *
 * A fresh account has not chosen its work field, and the incentive campaign may require
 * that choice before it will pay out. The endpoint that records the choice is
 * `/alice/ug/campaign/verify/` (the module pairs it with `student/verify_info` and
 * `student/verify_url`), so it is tried here.
 *
 * The point of this script is to establish WHETHER the check-in can be made to work at
 * all, before anything is written into the plugin.
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

async function post(path, body) {
  const response = await fetch(`https://www.doubao.com${path}?${P}`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify(body),
  })
  const text = await response.text()
  try { return JSON.parse(text) } catch { return { raw: text.slice(0, 150) } }
}

console.log('=== 1. 账号状态（看有没有未完成的新手步骤）===\n')
const detail = await post('/alice/ug/campaign/v3/detail/', { campaign_group_code: 'pc_incentive_task_mvp_v3' })
const tasks = detail.data?.tasks ?? []
const notDone = tasks.filter(t => t.task_status === 3)
console.log(`未完成的任务 ${notDone.length} 个:`)
for (const t of notDone) console.log('  ', t.campaign_code.padEnd(34), '|', (t.title || '').slice(0, 24), '| kind:', t.task_kind)

console.log('\n=== 2. 选择工作领域（verify 系列）===\n')
const verifies = [
  ['verify 空', '/alice/ug/campaign/verify/', {}],
  ['verify code', '/alice/ug/campaign/verify/', { code: 'select_work_fields' }],
  ['verify task', '/alice/ug/campaign/verify/', { task_code: 'select_work_fields', campaign_group_code: 'pc_incentive_task_mvp_v3' }],
  ['verify_info', '/alice/ug/campaign/student/verify_info/', {}],
  ['create', '/alice/ug/campaign/create/', { task_code: 'select_work_fields', campaign_group_code: 'pc_incentive_task_mvp_v3' }],
]
for (const [label, path, body] of verifies) {
  const r = await post(path, body)
  console.log(`  ${label.padEnd(12)} code=${r.code ?? '-'} msg=${r.msg ?? ''} ${JSON.stringify(r.data ?? null).slice(0, 120)}`)
}

console.log('\n=== 3. 再试签到 ===\n')
const r = await post('/alice/ug/campaign/landing/checkin', { scene: 'pc_incentive_task_mvp_v3' })
console.log('  checkin -> code', r.code, r.msg ?? '', JSON.stringify(r.data ?? null).slice(0, 150))

console.log('\n=== 4. 这个账号的额度记录（有没有领过 select_work_fields）===\n')
const records = await post('/alice/ug/campaign/quota/records/', {})
for (const x of records.data?.records ?? []) {
  console.log('  ', new Date(x.create_time_ms).toISOString().slice(0, 10), String(x.task_code).padEnd(32), x.amount, x.unit)
}
