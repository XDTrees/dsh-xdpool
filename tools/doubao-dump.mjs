/**
 * Dump the campaign's own reasoning about this account.
 *
 * Every request shape has been tried — the client's own button press included — and all of
 * them get `710010702`. So the document the server publishes about the campaign is the only
 * remaining source: it may carry an explicit reason (an ineligible flag, a closed window, a
 * required prerequisite) in a field we have not read yet.
 *
 * This prints the WHOLE document, keyed by path, so nothing is filtered out by a guess about
 * what matters.
 */
const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json()
const page = targets.find(t => t.type === 'page' && t.url.includes('doubao-chat'))
if (page === undefined) { console.log('找不到页面'); process.exit(1) }

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
  const res = await fetch('https://www.doubao.com/alice/ug/campaign/v3/detail/?' + P.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/plain, */*' },
    body: JSON.stringify({ campaign_group_code: 'pc_incentive_task_mvp_v3' }),
    credentials: 'include',
  })
  const text = await res.text()
  return text
})()`

const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
const raw = result?.result?.value
if (typeof raw !== 'string') {
  console.log('失败:', JSON.stringify(result).slice(0, 300))
} else {
  const json = JSON.parse(raw)
  const data = json.data

  // Every scalar in the document, with its path — no filtering.
  const flat = (node, path = '') => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) { node.forEach((v, i) => flat(v, `${path}[${i}]`)); return }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) flat(v, path === '' ? k : `${path}.${k}`)
      return
    }
    if (path === '') return
    const text = String(node)
    if (text === '' || text === '0' || text === 'false' || text === 'null') return
    console.log(`  ${path} = ${text.slice(0, 80)}`)
  }

  console.log('=== 活动文档里的所有非空字段 ===\n')
  flat(data)
}
ws.close()
