/**
 * Work out what the sign-in endpoint actually needs.
 *
 * `POST /alice/ug/campaign/landing/checkin` answers `710010702 系统错误` for every scene and
 * an empty `biz_params`, and `landing/get` answers `code 0` with no cards. The request is
 * reaching the server; the body is what it rejects.
 *
 * The body comes from the page's own client module:
 *
 *   DailyCheckIn({ scene, biz_params })  →  { scene, biz_params }
 *
 * `biz_params` is the interesting half. The module that CALLS `DailyCheckIn` is where its
 * shape is decided, so that is what is searched here — and it is also where the campaign
 * and card ids come from, which `landing/get` is supposed to supply.
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

/**
 * Candidate bodies.
 *
 * The shapes are taken from the module: `biz_params` carries the card and the campaign, so
 * both plausible keys are tried, with and without a target card group.
 */
const bodies = [
  ['scene only', { scene: 'pc_incentive_task_mvp_v3' }],
  ['scene + empty biz_params', { scene: 'pc_incentive_task_mvp_v3', biz_params: {} }],
  ['scene + biz_params {}', { scene: 'pc_incentive_task_mvp_v3', biz_params: {} }],
  ['biz_params 带 card', { scene: 'pc_incentive_task_mvp_v3', biz_params: { card_group_id: '' } }],
  ['biz_params 带 campaign', { scene: 'pc_incentive_task_mvp_v3', biz_params: { campaign_group_code: '' } }],
  ['带 target_card_group_id', { scene: 'pc_incentive_task_mvp_v3', target_card_group_id: '', biz_params: {} }],
  ['landing/checkin 无 body', {}],
]

for (const [label, body] of bodies) {
  const r = await post('/alice/ug/campaign/landing/checkin', body)
  const code = r.code ?? '-'
  const msg = r.msg ?? r.message ?? ''
  const data = r.data === null || r.data === undefined ? '' : JSON.stringify(r.data).slice(0, 200)
  console.log(`${label.padEnd(30)} code=${String(code).padEnd(12)} ${String(msg).slice(0, 20)} ${data}`)
}

// The quota history says whether a check-in ever happened for this account.
console.log('\n=== 额度记录 ===')
for (const path of ['/alice/ug/campaign/quota/records/', '/alice/commerce/sale/subscription/quota/summary/']) {
  const r = await post(path, { product_line: 'membership' })
  console.log(path, '->', JSON.stringify(r).slice(0, 400))
}
