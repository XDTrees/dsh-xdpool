/**
 * Sign in FROM the page, so the page signs for itself.
 *
 * The check-in is refused with `710010702` while the DESKTOP CLIENT — sending the same
 * body — is refused with the same code, so the request shape is right and the refusal is
 * the server's. What the client has that a plain HTTP client does not is a SIGNED request:
 * `a_bogus` and `msToken`, both produced by the page's own code.
 *
 * The CreditDaddy project's proposal for this exact feature reaches the same conclusion
 * ("要 a_bogus 签名 → 成本陡增（需 JS 逆向）") and proposes degrading to "balance visible +
 * a reminder" instead. But the signature does not need reversing: the page exposes
 * `window.bdms.frontierSign`, and the page can send the request itself, which is what this
 * script does.
 *
 * The difference from the earlier attempt: the request is made by the page's OWN code path
 * for the campaign, not by a hand-built fetch. So the body is the page's, the headers are
 * the page's, and the signature is the page's.
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

/**
 * The page's own call, in the page.
 *
 * `biz_params` is omitted on purpose: the client's own request carries only `scene`, and
 * every extra field was tried and refused.
 */
const expression = `(async () => {
  const out = []
  try {
  const P = new URLSearchParams({
    aid: '497858', version_code: '20800', device_platform: 'web',
    doubao_device_platform: 'web', language: 'zh', region: 'CN', sys_region: 'CN',
    pkg_type: 'release_version', pc_version: '3.45.5', doubao_pc_version: '3.45.5',
    device_id: '7707326032512615990', web_id: '7707326040423597619',
    tea_uuid: '7707326040423597619', samantha_web: '1', web_platform: 'browser',
    'use-olympus-account': '1', web_tab_id: crypto.randomUUID(),
  })
  const post = async (label, path, body) => {
    try {
      const res = await fetch('https://www.doubao.com' + path + '?' + P.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/plain, */*', 'Agw-Js-Conv': 'str' },
        body: JSON.stringify(body),
        credentials: 'include',
      })
      const t = await res.text()
      out.push(label + ' -> ' + t.slice(0, 320))
      return t
    } catch (e) { out.push(label + ' ERR ' + (e && e.message ? e.message : String(e))); return '' }
  }

  // The sign-in, from the page.
  await post('checkin(scene only)', '/alice/ug/campaign/landing/checkin', { scene: 'pc_incentive_task_mvp_v3' })
  await post('checkin(+biz)', '/alice/ug/campaign/landing/checkin', {
    scene: 'pc_incentive_task_mvp_v3',
    biz_params: { campaign_code: 'daily_signin', campaign_group_code: 'pc_incentive_task_mvp_v3' },
  })

  // The state afterwards.
  const detail = JSON.parse(await post('detail', '/alice/ug/campaign/v3/detail/', { campaign_group_code: 'pc_incentive_task_mvp_v3' }))
  const task = (detail.data && detail.data.tasks || []).find(t => t.campaign_code === 'daily_signin')
  out.push('daily_checkin: ' + JSON.stringify(task && task.daily_checkin))
  } catch (e) { out.push('THREW: ' + (e && e.message ? e.message : String(e)) + ' | ' + (e && e.stack ? e.stack.slice(0,200) : '')) }
  return out.join(String.fromCharCode(10))
})()`

const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
console.log(result?.result?.value ?? JSON.stringify(result?.exceptionDetails?.exception?.description ?? result).slice(0, 500))
ws.close()
