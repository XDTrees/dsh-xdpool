/**
 * Sign in with the CLIENT's session, not the browser's.
 *
 * The two are different accounts: the browser session ends `fea9ad01…` and the client's
 * ends `c801d90f…`. Everything tested through the browser — the models, the quota, the
 * campaign — was the browser's account, and the client's sign-in was failing for its own
 * account. A refusal that follows an account is a property of the ACCOUNT, not of the
 * request, and the request was never in doubt: the desktop client sends exactly
 * `{"scene": "pc_incentive_task_mvp_v3"}` and is refused with the same `710010702`.
 *
 * So this reads the client's own cookies and replays the flow with them.
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

// The client's cookies and its own User-Agent.
const cookieResult = await send('Network.getCookies', { urls: ['https://www.doubao.com'] })
const jar = Object.fromEntries((cookieResult?.cookies ?? []).map(c => [c.name, c.value]))
const uaResult = await send('Runtime.evaluate', { expression: 'navigator.userAgent', returnByValue: true })
const UA = uaResult?.result?.value ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'

console.log('客户端 sessionid:', (jar.sessionid ?? '(无)').slice(0, 20))
console.log('客户端 UA:', UA.slice(0, 70))
console.log('')

const P = 'aid=497858&version_code=20800&device_platform=web&doubao_device_platform=web&language=zh&region=CN&sys_region=CN&pkg_type=release_version&pc_version=3.45.5&doubao_pc_version=3.45.5&device_id=7707326032512615990&web_id=7707326040423597619&tea_uuid=7707326040423597619&samantha_web=1&web_platform=browser&use-olympus-account=1&web_tab_id=b4202548-51a3-4ec4-a46d-8ebb883c6f3d'
const H = {
  'content-type': 'application/json',
  accept: 'application/json, text/plain, */*',
  'user-agent': UA,
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

console.log('=== 1. 这个号的签到状态 ===\n')
const detail = await post('/alice/ug/campaign/v3/detail/', { campaign_group_code: 'pc_incentive_task_mvp_v3' })
const signin = detail.data?.tasks?.find(t => t.campaign_code === 'daily_signin')
console.log('daily_signin:', JSON.stringify(signin?.daily_checkin))
console.log('任务状态:', (detail.data?.tasks ?? []).map(t => `${t.campaign_code}=${String(t.task_status)}`).join(' '))
console.log('')

console.log('=== 2. 签到 ===\n')
const report = await post('/alice/ug/campaign/landing/report', { event_type: 'user_operate', biz_event_name: 'check_in' })
console.log('  report -> code', report.code, report.msg ?? '')
const checkin = await post('/alice/ug/campaign/landing/checkin', { scene: 'pc_incentive_task_mvp_v3' })
console.log('  checkin -> code', checkin.code, checkin.msg ?? '', JSON.stringify(checkin.data ?? null).slice(0, 200))

console.log('\n=== 3. 签到后的状态 ===\n')
const after = await post('/alice/ug/campaign/v3/detail/', { campaign_group_code: 'pc_incentive_task_mvp_v3' })
console.log('daily_checkin:', JSON.stringify(after.data?.tasks?.find(t => t.campaign_code === 'daily_signin')?.daily_checkin))

console.log('\n=== 4. 额度记录 ===\n')
const records = await post('/alice/ug/campaign/quota/records/', {})
for (const x of records.data?.records ?? []) {
  console.log('  ', new Date(x.create_time_ms).toISOString().slice(0, 10), String(x.task_code).padEnd(32), x.amount, x.unit)
}
