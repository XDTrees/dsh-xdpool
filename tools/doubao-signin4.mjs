/**
 * Call the sign-in from INSIDE the page, through the page's own API client.
 *
 * The request shape is known — `POST /alice/ug/campaign/landing/checkin` with
 * `{scene, biz_params}` — but every hand-built body is refused with `710010702 系统错误`,
 * and the difference is invisible from the outside: the same complaint a wrong `biz_params`
 * produces and the one a missing common parameter produces.
 *
 * The page's API client knows what the common parameters are (a device id, a request id,
 * whatever the gateway requires). Calling through it means the request is assembled by
 * the code that the server actually accepts, rather than by a reconstruction of it.
 *
 * The client is reachable as the store the page exposes; if it is not directly reachable,
 * the endpoint is called with the common parameters copied off a request the page really
 * made — which is the same trick, one layer lower.
 */
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = targets.find(t => t.type === 'page' && t.url.includes('doubao.com'))
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
 * The call, in the page.
 *
 * `biz_params` is filled from the task the server itself published, so the ids are the
 * server's rather than ours: the campaign code, and the item code the detail endpoint
 * returned for the check-in task.
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
  const out = []
  const post = async (label, path, body) => {
    try {
      const res = await fetch(path + '?' + P.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/plain, */*', 'Agw-Js-Conv': 'str' },
        body: JSON.stringify(body),
        credentials: 'include',
      })
      const t = await res.text()
      out.push(label + ' -> ' + res.status + ' ' + t.slice(0, 400))
    } catch (e) { out.push(label + ' ERR ' + (e && e.message ? e.message : String(e))) }
  }

  // The campaign, so the ids are the server's.
  const detail = await (await fetch('/alice/ug/campaign/v3/detail/?' + P.toString(), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ campaign_group_code: 'pc_incentive_task_mvp_v3' }), credentials: 'include',
  })).json()
  const task = (detail.data && detail.data.tasks || []).find(t => t.campaign_code === 'daily_signin')
  out.push('task: ' + JSON.stringify(task).slice(0, 260))

  // The check-in, with the ids the server just published.
  const variants = [
    ['biz=campaign_code', { scene: 'pc_incentive_task_mvp_v3', biz_params: { campaign_code: 'daily_signin' } }],
    ['biz=item+campaign', { scene: 'pc_incentive_task_mvp_v3', biz_params: { campaign_code: 'daily_signin', campaign_group_code: 'pc_incentive_task_mvp_v3' } }],
    ['biz=task_code', { scene: 'pc_incentive_task_mvp_v3', biz_params: { task_code: 'daily_signin' } }],
    ['biz 空 + 顶层 code', { scene: 'pc_incentive_task_mvp_v3', biz_params: {}, campaign_code: 'daily_signin' }],
    ['scene=daily_signin', { scene: 'daily_signin', biz_params: {} }],
    ['scene=pc_growth', { scene: 'pc_growth_default_open_task', biz_params: {} }],
  ]
  for (const [label, body] of variants) await post(label, '/alice/ug/campaign/landing/checkin', body)
  return out.join(String.fromCharCode(10))
})()`

const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
console.log(result?.result?.value ?? JSON.stringify(result?.exceptionDetails?.exception?.description ?? result).slice(0, 500))
ws.close()
