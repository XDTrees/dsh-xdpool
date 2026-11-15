/**
 * Probe the incentive-task endpoints for the sign-in card.
 *
 * The endpoint is known — `POST /alice/ug/campaign/landing/get` with a `scene` — and the
 * scene the page sends is `pc_incentive_task_mvp_v3`, which comes back with EMPTY cards.
 * The sign-in card is the thing the page promises（「每天签到领 200 额度」), so it must be
 * under a different scene, or under a different endpoint.
 *
 * Each candidate is tried and the response's shape reported: a scene that carries the
 * card returns a non-empty `landing_cards`.
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
    return { status: response.status, json: JSON.parse(text), text }
  } catch {
    return { status: response.status, json: undefined, text }
  }
}

const SCENES = [
  'pc_incentive_task_mvp_v3',
  'pc_incentive_task_v3',
  'pc_incentive_task',
  'pc_sign_in',
  'pc_signin',
  'pc_daily_sign',
  'pc_daily_sign_in',
  'pc_activity_reward',
  'pc_activity_reward_quota',
  'pc_checkin',
  'pc_check_in',
  'pc_incentive',
  'pc_task_center',
  'pc_task',
]

console.log('=== 试 scene ===\n')
for (const scene of SCENES) {
  const r = await post('/alice/ug/campaign/landing/get', { scene })
  const data = r.json?.data
  const cards = Array.isArray(data?.landing_cards) ? data.landing_cards.length : 0
  const buttons = Array.isArray(data?.main_page_info?.buttons) ? data.main_page_info.buttons.length : 0
  const title = String(data?.main_page_info?.title ?? '')
  const content = String(data?.main_page_info?.content ?? '')
  const hit = cards > 0 || buttons > 0 || title !== '' || content !== ''
  console.log(`${hit ? '★' : ' '} ${scene.padEnd(30)} cards=${cards} buttons=${buttons} ${title.slice(0, 30)}${content.slice(0, 40)}`)
  if (hit) {
    console.log('     完整:', JSON.stringify(data).slice(0, 700))
  }
}
