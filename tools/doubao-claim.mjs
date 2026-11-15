/**
 * Is the refusal specific to the CHECK-IN, or does it apply to every claim?
 *
 * `daily_signin` is refused with `710010702`. The campaign has other tasks with
 * `task_status: 1` — ready to claim — and one of them is a plain
 * `pc_task_complete_work_task_daily` (50 points, no interaction required beyond using the
 * work mode).
 *
 * If THAT claim succeeds while the check-in fails, the refusal is a rule about the
 * check-in (a streak that was broken, or a window that closed) and not about the request or
 * the account. If it fails the same way, the refusal is about the account or the
 * campaign as a whole.
 *
 * The claim endpoint wants `{task_id, campaign_group_code, campaign_item_code}`, and the
 * campaign detail carries no `task_id` — so the id is derived: the task's own
 * `campaign_code` is the item code, and the id is looked for in the raw document.
 */
import { readFileSync } from 'node:fs'

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

const detail = await post('/alice/ug/campaign/v3/detail/', { campaign_group_code: 'pc_incentive_task_mvp_v3' })
const tasks = detail.data?.tasks ?? []

console.log('=== 可领任务（status=1）及其可用 id ===\n')
for (const t of tasks.filter(x => x.task_status === 1)) {
  const ids = Object.entries(t)
    .filter(([, v]) => typeof v === 'string' && /^\d{6,}$/.test(v))
    .map(([k, v]) => `${k}=${v}`)
  console.log(`  ${t.campaign_code.padEnd(34)} ${(t.title || '').slice(0, 22).padEnd(24)} 数字字段: ${ids.join(', ') || '(无)'}`)
}

console.log('\n=== 尝试领取（各种 id 组合）===\n')
const claimable = tasks.find(t => t.campaign_code === 'pc_task_complete_work_task_daily')
const variants = [
  ['task_id=code', { task_id: 'pc_task_complete_work_task_daily', campaign_group_code: 'pc_incentive_task_mvp_v3', campaign_item_code: 'pc_task_complete_work_task_daily' }],
  ['task_id=code, group 空', { task_id: 'pc_task_complete_work_task_daily', campaign_group_code: '', campaign_item_code: 'pc_task_complete_work_task_daily' }],
  ['task_id=数字 task_id', { task_id: String(claimable?.task_id ?? ''), campaign_group_code: 'pc_incentive_task_mvp_v3', campaign_item_code: 'pc_task_complete_work_task_daily' }],
]
for (const [label, body] of variants) {
  const r = await post('/alice/ug/campaign/item/reward/claim/', body)
  console.log(`  ${label.padEnd(24)} code=${r.code} msg=${r.msg ?? ''} ${JSON.stringify(r.data ?? null).slice(0, 120)}`)
}
