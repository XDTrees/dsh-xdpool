/**
 * Is `710010702` about the CHECK-IN, or about every `reward_mode: 2` task?
 *
 * Two tasks share `reward_mode: 2` — the ones the server pays AUTOMATICALLY rather than
 * through a claim:
 *
 *   daily_signin          每日签到              200   (400 on Mondays)
 *   points_milestone_500  累计获得 500 点额度    200
 *
 * The milestone has a `task_id` and its own endpoint path; the check-in has neither and
 * goes through `landing/checkin`. The milestone's state is `task_status: 3` — the
 * threshold is not met — so it cannot be claimed yet, which makes it a poor control.
 *
 * The useful control is the CHECK-IN itself against the CLAIM path: `claim` with an
 * already-claimed item answers `code 0` ("领取结果确认中"), so the endpoint works for this
 * account. If the check-in were merely mis-addressed, the claim path would fail the same
 * way.
 *
 * So what is left is the account's eligibility for the check-in — and the one fact that
 * points at it: `continuous_days: 0` with `last_checkin_date: 2026-11-03`, i.e. the streak
 * was broken ten days ago and the daily reward lapsed with it.
 */
const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json()
const page = targets.find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise(resolve => {
  const mid = ++id
  pending.set(mid, resolve)
  ws.send(JSON.stringify({ id: mid, method, params }))
})
ws.onmessage = event => {
  const msg = JSON.parse(event.data)
  if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id) }
}
await new Promise(resolve => { ws.onopen = resolve })

const ck = await send('Network.getCookies', { urls: ['https://www.doubao.com'] })
const jar = Object.fromEntries((ck?.cookies ?? []).map(c => [c.name, c.value]))
const ua = (await send('Runtime.evaluate', { expression: 'navigator.userAgent', returnByValue: true }))?.result?.value ?? 'Mozilla/5.0'
const P = 'aid=497858&version_code=20800&device_platform=web&doubao_device_platform=web&language=zh&region=CN&sys_region=CN&pkg_type=release_version&pc_version=3.45.5&doubao_pc_version=3.45.5&device_id=7707326032512615990&web_id=7707326040423597619&tea_uuid=7707326040423597619&samantha_web=1&web_platform=browser&use-olympus-account=1&web_tab_id=b4202548-51a3-4ec4-a46d-8ebb883c6f3d'
const H = {
  'content-type': 'application/json',
  accept: 'application/json, text/plain, */*',
  'user-agent': ua,
  origin: 'https://www.doubao.com',
  referer: 'chrome://doubao-chat/',
  cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
  ...(jar.passport_csrf_token === undefined ? {} : { 'x-tt-passport-csrf-token': jar.passport_csrf_token }),
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

console.log('=== 对照组：claim 路径（同一个号）===\n')
const detail = await post('/alice/ug/campaign/v3/detail/', { campaign_group_code: 'pc_incentive_task_mvp_v3' })
const selectable = detail.data?.tasks?.find(t => t.campaign_code === 'select_work_fields')
const claim = await post('/alice/ug/campaign/item/reward/claim/', {
  task_id: selectable?.task_id ?? '',
  campaign_group_code: 'pc_incentive_task_mvp_v3',
  campaign_item_code: 'select_work_fields',
})
console.log(`claim(select_work_fields) -> code=${claim.code} ${claim.msg ?? ''} ${JSON.stringify(claim.data ?? null).slice(0, 160)}`)

console.log('\n=== 签到：各种 biz_params ===\n')
const attempts = [
  ['无 biz_params', { scene: 'pc_incentive_task_mvp_v3' }],
  ['biz 带 campaign_group', { scene: 'pc_incentive_task_mvp_v3', biz_params: { campaign_group_code: 'pc_incentive_task_mvp_v3' } }],
  ['biz 带 task_id（里程碑的）', { scene: 'pc_incentive_task_mvp_v3', biz_params: { task_id: '60371519043138562' } }],
  ['biz 带 campaign_code + group', { scene: 'pc_incentive_task_mvp_v3', biz_params: { campaign_code: 'daily_signin', campaign_group_code: 'pc_incentive_task_mvp_v3' } }],
]
for (const [label, body] of attempts) {
  const r = await post('/alice/ug/campaign/landing/checkin', body)
  console.log(`  ${label.padEnd(28)} code=${r.code} ${r.msg ?? ''} ${JSON.stringify(r.data ?? null).slice(0, 120)}`)
}

console.log('\n=== 签到任务的完整原始记录（找有没有别的 id）===\n')
const raw = JSON.stringify(detail.data)
const idx = raw.indexOf('"daily_signin"')
console.log(raw.slice(Math.max(0, idx - 200), idx + 700))
