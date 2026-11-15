/**
 * Open the activity page and capture what it asks for.
 *
 * The page is `https://www.doubao.com/pc/agent-explore?enter_method=fixed_entry` — the one the
 * desktop client opens for 「免费用豆包工作」. Every scene tried against
 * `landing/get` comes back with no card, which means the scene is not the missing piece;
 * the page asks for something else, and the request it makes is the answer.
 *
 * The check-in itself is refused with `710010702` — and the DESKTOP CLIENT is refused with
 * the same code and the same body, so the request shape is right and the refusal is the
 * server's decision. What the page requests first is therefore the thing worth seeing.
 */
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = targets.find(t => t.type === 'page' && t.url.includes('doubao.com'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const caught = []
const bodies = new Map()
const send = (method, params = {}) => new Promise(resolve => {
  const mid = ++id
  pending.set(mid, resolve)
  ws.send(JSON.stringify({ id: mid, method, params }))
})
ws.onmessage = event => {
  const msg = JSON.parse(event.data)
  if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); return }
  if (msg.method === 'Network.requestWillBeSent') {
    const url = msg.params.request.url
    if (url.includes('/alice/') || url.includes('/samantha/')) {
      const record = { url, method: msg.params.request.method, postData: msg.params.request.postData }
      caught.push(record)
      bodies.set(msg.params.requestId, record)
    }
  }
  if (msg.method === 'Network.loadingFinished') {
    const record = bodies.get(msg.params.requestId)
    if (record === undefined) return
    bodies.delete(msg.params.requestId)
    void (async () => {
      try {
        record.response = (await send('Network.getResponseBody', { requestId: msg.params.requestId }))?.body ?? ''
      } catch { /* evicted */ }
    })()
  }
}
await new Promise(resolve => { ws.onopen = resolve })
await send('Network.enable')
await send('Page.navigate', { url: 'https://www.doubao.com/pc/agent-explore?enter_method=fixed_entry' })
await new Promise(resolve => setTimeout(resolve, 12000))

console.log(`抓到 ${caught.length} 个请求\n`)
for (const c of caught) {
  const path = c.url.replace('https://www.doubao.com', '').split('?')[0]
  const interesting = /ug\/|campaign|incentive|landing|task|explore|quota|reward/i.test(path)
  console.log(`${interesting ? '★' : ' '} [${c.method}] ${path}`)
  if (interesting) {
    console.log('   body:', (c.postData ?? '(空)').slice(0, 220))
    if (c.response) console.log('   响应:', c.response.slice(0, 800))
  }
}
const { writeFileSync } = await import('node:fs')
writeFileSync('_doubao-explore-capture.json', JSON.stringify(caught, null, 2))
console.log('\n已存 _doubao-explore-capture.json')
ws.close()
