/**
 * The incentive tasks, and the one that is a CLAIM rather than a check-in.
 *
 * The quota records give the whole task list for this account, with the codes the server
 * uses:
 *
 *   daily_signin                        每日签到                              200 (400 on Mondays)
 *   pc_task_complete_work_task_v1       用「工作任务」模式完成一项复杂工作        100
 *   pc_task_generate_ppt_v1             用豆包制作一份完整的 PPT               100
 *   pc_task_generate_excel_v1           用豆包制作一份专业表格                100
 *   pc_task_generate_document_v1        把零散想法整理成一份完整文档           100
 *   pc_task_complete_computer_task_v1   用豆包查找并整理电脑文件               100
 *   browser_tool                        豆包帮你完成一次网页任务              100
 *   select_work_fields                  选择工作领域领取奖励                  100
 *   points_milestone_500                累计获得 500 点额度                  200
 *
 * `daily_signin` is a CHECK-IN and the rest are CLAIMS, and the endpoint that claims an
 * item is `/alice/ug/campaign/item/reward/claim/` with
 * `{task_id, campaign_group_code, campaign_item_code}`.
 *
 * Those three ids come from the campaign detail, which the server only returns when there
 * is a campaign to describe. So the sequence is: list the campaigns → detail the one that
 * applies → claim its items → check in.
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

console.log('=== 1. 活动详情（v3）===\n')
for (const code of ['pc_growth_default_open_task', 'pc_incentive_task_mvp_v3', 'daily_signin', '']) {
  const r = await post('/alice/ug/campaign/v3/detail/', { campaign_group_code: code })
  const data = r.data
  console.log(`group=${code || '(空)'} -> code=${r.code} ${JSON.stringify(data ?? null).slice(0, 260)}`)
}

console.log('\n=== 2. 活动列表（试 scene 组合）===\n')
for (const scene of ['pc_incentive_task_mvp_v3', 'pc_growth_default_open_task', 'pc_incentive_task_mvp_v1']) {
  for (const group of ['', 'pc_growth_default_open_task', 'daily_signin']) {
    const r = await post('/alice/ug/campaign/list/', {
      campaign_group_code: group,
      pinned_campaign_code: '',
      scene,
    })
    const data = r.data
    if (r.code === 0 && data !== null && data !== undefined) {
      console.log(`★ scene=${scene} group=${group || '(空)'} -> ${JSON.stringify(data).slice(0, 400)}`)
    } else {
      console.log(`  scene=${scene} group=${group || '(空)'} -> code=${r.code}`)
    }
  }
}

console.log('\n=== 3. 领取奖励（试 task_code 作 task_id）===\n')
for (const taskCode of ['select_work_fields', 'daily_signin', 'pc_task_generate_ppt_v1']) {
  const r = await post('/alice/ug/campaign/item/reward/claim/', {
    task_id: taskCode,
    campaign_group_code: '',
    campaign_item_code: taskCode,
  })
  console.log(`${taskCode.padEnd(30)} code=${r.code} msg=${r.msg ?? ''} data=${JSON.stringify(r.data ?? null).slice(0, 200)}`)
}
