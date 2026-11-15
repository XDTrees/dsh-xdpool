/**
 * The Doubao incentive endpoints, and the sign-in itself.
 *
 * The endpoints come from the page's own client module (`zp.e0addda087.js`), which names
 * them and their request bodies:
 *
 *   POST /alice/ug/campaign/list/                {campaign_group_code, pinned_campaign_code, scene}
 *   POST /alice/ug/campaign/landing/checkin      {scene, biz_params}
 *   POST /alice/ug/campaign/item/reward/claim/   {task_id, campaign_group_code, campaign_item_code}
 *   POST /alice/ug/campaign/landing/get         {scene}
 *   POST /alice/ug/campaign/quota/records/       — the quota history
 *
 * `scene` is the selector the page uses: `pc_incentive_task_mvp_v3` for the PC incentive
 * task surface.
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
  try {
    return { status: response.status, json: JSON.parse(text) }
  } catch {
    return { status: response.status, json: undefined, text }
  }
}

console.log('=== 1. 活动列表 ===\n')
for (const scene of ['pc_incentive_task_mvp_v3', 'pc_incentive_task']) {
  const r = await post('/alice/ug/campaign/list/', {
    campaign_group_code: '',
    pinned_campaign_code: '',
    scene,
  })
  const data = r.json?.data
  console.log(`scene=${scene} -> HTTP ${r.status} code=${r.json?.code ?? '-'} msg=${r.json?.msg ?? ''}`)
  if (data !== undefined && data !== null) {
    console.log('  数据键:', Object.keys(data).join(','))
    console.log('  内容:', JSON.stringify(data).slice(0, 900))
  }
}

console.log('\n=== 2. 签到 ===\n')
for (const scene of ['pc_incentive_task_mvp_v3', 'pc_incentive_task', 'pc_daily_checkin']) {
  const r = await post('/alice/ug/campaign/landing/checkin', { scene, biz_params: {} })
  console.log(`scene=${scene} -> HTTP ${r.status} code=${r.json?.code ?? '-'} msg=${r.json?.msg ?? ''} data=${JSON.stringify(r.json?.data ?? null).slice(0, 200)}`)
}
