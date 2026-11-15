/**
 * Record what the Doubao web client actually sends, so the "工作" (Work) surface and its
 * model picker can be reproduced instead of guessed at.
 *
 * WHY RECORDING RATHER THAN READING THE BUNDLE
 *
 * The page is a compiled bundle served from `lf-cdn-tos.bytescm.com`; the request shapes are
 * built at runtime and the model list is fetched, not embedded. Capturing the live traffic
 * answers three questions at once and answers them with evidence: which endpoint the Work
 * surface posts to, what a model selection looks like on the wire, and which ids are
 * offered.
 *
 * Network.enable + Network.responseReceived gives the URL and status; getResponseBody gives
 * the JSON. Only XHR/Fetch is kept — the bundle and its assets are noise.
 *
 * Run: node tools/doubao-record.mjs [seconds]
 */
const SECONDS = Number(process.argv[2] ?? 90)

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = targets.find(t => t.type === 'page' && t.url.includes('doubao.com'))
if (!page) { console.log('没有找到豆包页面'); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise(resolve => {
  const mid = ++id
  pending.set(mid, resolve)
  ws.send(JSON.stringify({ id: mid, method, params }))
})

/** url → requestId, so a finished response can be fetched by id. */
const inflight = new Map()
const caught = []

ws.onmessage = event => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); return }
  const { method, params } = msg
  if (method === 'Network.requestWillBeSent') {
    const type = params.type
    if (type !== 'XHR' && type !== 'Fetch') return
    const url = params.request.url
    // Record EVERY XHR/Fetch on the doubao hosts. The earlier filter listed the paths
    // guessed to matter and therefore threw away whatever the model picker actually calls —
    // the recording came back empty. Assets are excluded by TYPE (XHR/Fetch only), which is
    // the filter that cannot hide an API.
    if (!/doubao\.com/.test(url)) return
    if (/\.(js|css|png|jpg|jpeg|webp|svg|woff2?|mp4)(\?|$)/.test(url)) return
    inflight.set(params.requestId, { url, method: params.request.method, postData: params.request.postData })
  }
  if (method === 'Network.responseReceived') {
    const record = inflight.get(params.requestId)
    if (record === undefined) return
    record.status = params.response.status
    record.mime = params.response.mimeType
    // The body arrives after this event; fetched on load-finished below.
  }
  if (method === 'Network.loadingFinished') {
    const record = inflight.get(params.requestId)
    if (record === undefined) return
    inflight.delete(params.requestId)
    void (async () => {
      let body = ''
      try {
        const r = await send('Network.getResponseBody', { requestId: params.requestId })
        body = r?.body ?? ''
      } catch { /* some responses are unreadable once evicted */ }
      caught.push({ ...record, body: body.slice(0, 6000) })
    })()
  }
}

await new Promise(resolve => { ws.onopen = resolve })
await send('Network.enable')

console.log(`开始记录 ${SECONDS} 秒。`)
console.log('请在这个 Chrome 窗口里操作：')
console.log('  1. 点击左侧「工作」（或工作台）')
console.log('  2. 打开模型选择器，把里面的模型看一遍')
console.log('  3. 随便选一个模型，发一句话')
console.log('  4. 再切回普通对话，发一句')
console.log('')

await new Promise(resolve => setTimeout(resolve, SECONDS * 1000))

console.log(`\n抓到 ${caught.length} 个 API 请求：\n`)
for (const c of caught) {
  const short = c.url.replace('https://www.doubao.com', '').split('?')[0]
  console.log(`[${String(c.status ?? '?')}] ${c.method} ${short}`)
  if (c.postData !== undefined) console.log(`      body: ${c.postData.slice(0, 220)}`)
  // A model list is what we are really after: print keys so the shape is visible.
  if (/model|config|ability|mode|agent|task/i.test(c.url) && c.body !== '') {
    console.log(`      响应: ${c.body.slice(0, 500)}`)
  }
}

const { writeFileSync } = await import('node:fs')
writeFileSync('_doubao-record.json', JSON.stringify(caught, null, 2))
console.log('\n完整记录已存: _doubao-record.json')
ws.close()
