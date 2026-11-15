/**
 * Sign in, and claim what is claimable.
 *
 * The campaign detail (`/alice/ug/campaign/v3/detail/` with
 * `campaign_group_code: "pc_incentive_task_mvp_v3"`) returns every task with its
 * `campaign_code`, its state, and — for the check-in — whether it has been done today:
 *
 *   {"campaign_code": "daily_signin",
 *    "daily_checkin": {"checked_in_today": false, "continuous_days": 0,
 *                      "last_checkin_date": "2026-11-03",
 *                      "reward": {"reward_amount": 200}},
 *    "task_status": 1, …}
 *
 * `task_status` is the state: 1 = ready to claim, 3 = not finished yet.
 *
 * The check-in is its own endpoint (`/alice/ug/campaign/landing/checkin`) and the CLAIM
 * is another (`/alice/ug/campaign/item/reward/claim/`), and the ids they want are not the
 * `campaign_code` — they are the ids INSIDE the task record, which the walk below reports.
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
  try { return JSON.parse(text) } catch { return { raw: text.slice(0, 200) } }
}

// The campaign, and the task record in full.
const campaign = await post('/alice/ug/campaign/v3/detail/', {
  campaign_group_code: 'pc_incentive_task_mvp_v3',
})
const tasks = campaign.data?.tasks ?? []
console.log(`任务 ${tasks.length} 个\n`)

const signin = tasks.find(t => t.campaign_code === 'daily_signin')
console.log('=== 签到任务完整记录 ===')
console.log(JSON.stringify(signin, null, 2).slice(0, 900))

console.log('\n=== 1. 签到 ===\n')
for (const biz of [
  {},
  { campaign_code: 'daily_signin' },
  { task_code: 'daily_signin' },
  { campaign_code: 'daily_signin', task_code: 'daily_signin' },
  { campaign_code: 'daily_signin', scene: 'pc_incentive_task_mvp_v3' },
]) {
  const r = await post('/alice/ug/campaign/landing/checkin', {
    scene: 'pc_incentive_task_mvp_v3',
    biz_params: biz,
  })
  console.log(`  biz_params=${JSON.stringify(biz).slice(0, 60).padEnd(62)} code=${r.code} msg=${r.msg ?? ''} data=${JSON.stringify(r.data ?? null).slice(0, 120)}`)
  if (r.code === 0) { console.log('  ✅ 签到成功'); break }
}

console.log('\n=== 2. 领取（用任务记录里的 id 字段）===\n')
for (const task of tasks.slice(0, 3)) {
  console.log(`  ${task.campaign_code} 的字段: ${Object.keys(task).join(', ')}`)
}
