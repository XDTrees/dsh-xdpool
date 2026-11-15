/**
 * Compare the catalogue endpoint with one the page calls successfully, INSIDE the page.
 *
 * Both run in the page's own context, so the session, the origin and the browser's
 * defaults are identical. Whatever difference remains is in the request itself — and the
 * catalogue endpoint answers `710010202 common invalid param` ("系统错误"), which names
 * no parameter and is the reason this took a while to pin down.
 *
 * The comparison uses a request the page really made, copied verbatim, against the same
 * endpoint with the body removed.
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
await send('Page.navigate', { url: 'https://www.doubao.com/chat/' })
await new Promise(resolve => setTimeout(resolve, 9000))

const expression = `(async () => {
  const out = []
  const post = async (label, path, query, body) => {
    try {
      const res = await fetch(path + (query || ''), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/plain, */*', 'Agw-Js-Conv': 'str' },
        body: body === undefined ? '' : JSON.stringify(body),
        credentials: 'include',
      })
      const t = await res.text()
      out.push(label + ' -> ' + res.status + ' len=' + t.length + ' ' + t.slice(0, 130))
    } catch (e) {
      out.push(label + ' -> ERR ' + (e && e.message ? e.message : String(e)))
    }
  }
  const q = new URLSearchParams({
    version_code: '20800', language: 'zh', device_platform: 'web',
    doubao_device_platform: 'web', aid: '497858', real_aid: '497858',
    pkg_type: 'release_version', device_id: '7707326032512615990',
    pc_version: '3.45.5', doubao_pc_version: '3.45.5',
    web_id: '7707326040423597619', tea_uuid: '7707326040423597619',
    region: 'CN', sys_region: 'CN', samantha_web: '1', web_platform: 'browser',
    'use-olympus-account': '1', web_tab_id: 'b4202548-51a3-4ec4-a46d-8ebb883c6f3d',
  })
  const qs = '?' + q.toString()
  // One the page calls successfully — the control.
  await post('config/pull', '/alice/user/config/pull', qs, { objects: [150], reason: 1 })
  // The catalogue, in four shapes.
  await post('brief no-body', '/alice/slot/action_bar_v3/brief_list', qs, undefined)
  await post('brief {}', '/alice/slot/action_bar_v3/brief_list', qs, {})
  await post('brief no-query', '/alice/slot/action_bar_v3/brief_list', '', undefined)
  await post('brief cfg-like', '/alice/slot/action_bar_v3/brief_list', qs, { language_code: 'zh', bot_id: '7338286299411103781' })
  return out.join('\\n')
})()`

const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
console.log(result?.result?.value ?? JSON.stringify(result?.exceptionDetails?.exception?.description ?? result).slice(0, 500))
ws.close()
