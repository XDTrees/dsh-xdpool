/**
 * Find the check-in's body, using what the CLAIM taught us.
 *
 * The claim endpoint answered `code 0` for `{task_id: "", campaign_group_code: …, …}` — an
 * EMPTY id still reached the processing stage ("领取结果确认中"), while a made-up id was
 * refused with `710010202`. So the endpoint identifies the item by its numeric id, and the
 * numeric ids come from somewhere this account's campaign detail does not carry.
 *
 * The check-in is the same kind of call, so its body probably needs the same kind of id.
 * `biz_params` is the place for it.
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

const cookieResult = await send('Network.getCookies', { urls: ['https://www.doubao.com'] })
const jar = Object.fromEntries((cookieResult?.cookies ?? []).map(c => [c.name, c.value]))
const uaResult = await send('Runtime.evaluate', { expression: 'navigator.userAgent', returnByValue: true })
const UA = uaResult?.result?.value ?? 'Mozilla/5.0'

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

// The numeric ids the server uses for items — from the quota records, which carry
// `record_id`, and from the campaign, which may carry them under a name this account's
// detail does not show.
const records = await post('/alice/ug/campaign/quota/records/', {})
const recordIds = (records.data?.records ?? []).map(r => ({ task: r.task_code, id: r.record_id }))
console.log('额度记录里的 id:')
for (const r of recordIds) console.log('  ', String(r.task).padEnd(34), r.id)

console.log('\n=== 用记录里的 id 试签到 ===\n')
for (const record of recordIds.slice(0, 4)) {
  for (const key of ['task_id', 'record_id', 'item_id']) {
    const r = await post('/alice/ug/campaign/landing/checkin', {
      scene: 'pc_incentive_task_mvp_v3',
      biz_params: { campaign_code: 'daily_signin', [key]: record.id },
    })
    if (r.code !== 710010702) {
      console.log(`★ biz_params.${key}=${record.id} -> code=${r.code} ${r.msg ?? ''} ${JSON.stringify(r.data ?? null).slice(0, 160)}`)
    }
  }
}

console.log('\n=== 直接用 task_id 试 claim（对照）===\n')
for (const record of recordIds.slice(0, 3)) {
  const r = await post('/alice/ug/campaign/item/reward/claim/', {
    task_id: record.id,
    campaign_group_code: 'pc_incentive_task_mvp_v3',
    campaign_item_code: record.task,
  })
  console.log(`  ${record.task.padEnd(34)} task_id=${record.id} -> code=${r.code} ${r.msg ?? ''} ${JSON.stringify(r.data ?? null).slice(0, 140)}`)
}
