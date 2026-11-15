/**
 * Ask the live page to make two of Doubao's own calls, so the answer comes from the page's
 * context rather than from a hand-built request.
 *
 * The point of this comparison: `notice/info` and `brief_list` are both `alice`/`samantha`
 * endpoints on the same origin with the same session, so whichever one works tells us
 * whether the session is good and the difference is in the request, or the session is the
 * problem.
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
  try {
    const lines = []
    const p = new URLSearchParams({
      version_code: '20800', language: 'zh', device_platform: 'web',
      doubao_device_platform: 'web', aid: '497858', real_aid: '497858',
      pkg_type: 'release_version', device_id: '7707326032512615990',
      pc_version: '3.45.5', doubao_pc_version: '3.45.5',
      web_id: '7707326040423597619', tea_uuid: '7707326040423597619',
      region: 'CN', sys_region: 'CN', samantha_web: '1', web_platform: 'browser',
      'use-olympus-account': '1', web_tab_id: 'b4202548-51a3-4ec4-a46d-8ebb883c6f3d',
    })
    const one = await fetch('/samantha/notice/info', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: '{}', credentials: 'include',
    })
    const t1 = await one.text()
    lines.push('notice: ' + one.status + ' len=' + t1.length + ' ' + t1.slice(0, 90))
    const two = await fetch('/alice/slot/action_bar_v3/brief_list?' + p.toString(), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: '{}', credentials: 'include',
    })
    const t2 = await two.text()
    lines.push('brief: ' + two.status + ' len=' + t2.length + ' ' + t2.slice(0, 160))
    return lines.join(' | ')
  } catch (e) {
    return 'ERR ' + (e && e.message ? e.message : String(e))
  }
})()`

const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
console.log(result?.result?.value ?? JSON.stringify(result?.exceptionDetails?.exception?.description ?? '').slice(0, 300))
ws.close()
