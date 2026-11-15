/**
 * Sign in: report the click first, then check in.
 *
 * The page's own flow for the check-in card is a PAIR of calls: a `landing/report` that
 * records the click and a `landing/checkin` that performs it. The check-in alone is refused
 * with `710010702 系统错误` — a different code from the `710010202` that a wrong body
 * produces, so it is a refusal of the OPERATION rather than of its parameters.
 *
 * The report carries the card the click came from, which is what the check-in is then
 * allowed against. So the order matters, and the report has to name a real card.
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
      out.push(label + ' -> ' + t.slice(0, 260))
      return t
    } catch (e) { out.push(label + ' ERR ' + (e && e.message ? e.message : String(e))); return '' }
  }

  // The campaign, for the ids.
  const detail = JSON.parse(await (await fetch('/alice/ug/campaign/v3/detail/?' + P.toString(), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ campaign_group_code: 'pc_incentive_task_mvp_v3' }), credentials: 'include',
  })).text())
  const task = (detail.data?.tasks || []).find(t => t.campaign_code === 'daily_signin')

  // The landing page, for the card the click is reported against.
  const landing = JSON.parse(await post('landing/get', '/alice/ug/campaign/landing/get', {
    scene: 'pc_incentive_task_mvp_v3', target_card_group_id: '',
  }))

  // Report the click, then check in.
  const reports = [
    ['report + checkin', {
      event_type: 'click', biz_event_name: 'daily_signin',
      biz_params: { campaign_code: 'daily_signin', campaign_group_code: 'pc_incentive_task_mvp_v3' },
      card_event: { card_group_id: '', campaign_code: 'daily_signin' },
    }],
    ['report 简单', { event_type: 'click', biz_event_name: 'daily_signin' }],
    ['report checkin', { event_type: 'checkin', biz_event_name: 'daily_signin' }],
  ]
  for (const [label, body] of reports) {
    await post(label + ' / report', '/alice/ug/campaign/landing/report', body)
    await post(label + ' / checkin', '/alice/ug/campaign/landing/checkin', {
      scene: 'pc_incentive_task_mvp_v3',
      biz_params: { campaign_code: 'daily_signin', campaign_group_code: 'pc_incentive_task_mvp_v3' },
    })
  }
  return out.join(String.fromCharCode(10))
})()`

const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
console.log(result?.result?.value ?? JSON.stringify(result?.exceptionDetails?.exception?.description ?? result).slice(0, 600))
ws.close()
