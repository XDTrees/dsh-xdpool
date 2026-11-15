/**
 * Claim every task that is ready, and report what the server says for each.
 *
 * The check-in is refused (`710010702`) and the client is refused the same way, so it is
 * parked. The CLAIM path is different: it answered `code 0`
 * `{"code":4,"message":"已成功领取，请稍后查看"}` for `select_work_fields`, which is a real
 * success — the points were credited.
 *
 * So this walks every task the campaign publishes and claims the ones marked
 * `task_status: 1` (ready), reporting the server's own answer per task. Two ids are needed
 * and they come from the task record itself:
 *
 *   task_id              the numeric id (`60554151419246605`), present only on tasks the
 *                        server expects to be CLAIMED
 *   campaign_item_code   the task's `campaign_code`
 *
 * A task without a numeric `task_id` is a check-in or an activity the server pays
 * automatically, and is reported as such rather than being attempted.
 */
const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json()
const page = targets.find(t => t.type === 'page' && t.url.includes('doubao-chat'))
if (page === undefined) { console.log('找不到客户端页面'); process.exit(1) }

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

/**
 * The whole sweep, in the page.
 *
 * Everything runs with the page's own cookies and origin, so the session is the client's —
 * the same one whose button press reproduces the check-in refusal.
 */
const expression = `(async () => {
  const P = new URLSearchParams({
    aid: '497858', version_code: '20800', device_platform: 'web',
    doubao_device_platform: 'web', language: 'zh', region: 'CN', sys_region: 'CN',
    pkg_type: 'release_version', pc_version: '3.45.5', doubao_pc_version: '3.45.5',
    device_id: '7707326032512615990', web_id: '7707326040423597619',
    tea_uuid: '7707326040423597619', samantha_web: '1', web_platform: 'browser',
    'use-olympus-account': '1', web_tab_id: crypto.randomUUID(),
  })
  const post = async (path, body) => {
    const res = await fetch('https://www.doubao.com' + path + '?' + P.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/plain, */*', 'Agw-Js-Conv': 'str' },
      body: JSON.stringify(body),
      credentials: 'include',
    })
    const text = await res.text()
    try { return JSON.parse(text) } catch { return { raw: text.slice(0, 200) } }
  }

  const out = []
  const before = await post('/alice/ug/campaign/v3/detail/', { campaign_group_code: 'pc_incentive_task_mvp_v3' })
  const tasks = (before.data && before.data.tasks) || []
  const milestones = (before.data && before.data.milestones) || []
  out.push('BEFORE progress: ' + JSON.stringify(before.data && before.data.progress))

  // Every claimable thing: tasks and milestones, both carry a numeric task_id when the
  // server expects a claim.
  const all = [...tasks, ...milestones]
  for (const t of all) {
    const code = t.campaign_code
    const status = t.task_status
    const taskId = t.task_id
    if (status !== 1) { out.push('SKIP  ' + code + ' (status ' + status + ')'); continue }
    if (taskId === undefined) { out.push('SKIP  ' + code + ' (no task_id, not claim-based)'); continue }
    const r = await post('/alice/ug/campaign/item/reward/claim/', {
      task_id: taskId,
      campaign_group_code: 'pc_incentive_task_mvp_v3',
      campaign_item_code: code,
    })
    const biz = r.data && r.data.biz_error
    out.push('CLAIM ' + code + ' (id ' + taskId + ') -> code=' + r.code + ' ' + JSON.stringify(biz || r.data || r.msg || ''))
  }

  const after = await post('/alice/ug/campaign/v3/detail/', { campaign_group_code: 'pc_incentive_task_mvp_v3' })
  out.push('AFTER  progress: ' + JSON.stringify(after.data && after.data.progress))
  const afterTasks = (after.data && after.data.tasks) || []
  for (const t of afterTasks) out.push('  ' + String(t.campaign_code).padEnd(34) + ' status=' + t.task_status)
  return out.join(String.fromCharCode(10))
})()`

const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
console.log(result?.result?.value ?? JSON.stringify(result?.exceptionDetails?.exception?.description ?? result).slice(0, 500))
ws.close()
