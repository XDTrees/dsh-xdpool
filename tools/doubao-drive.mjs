/**
 * Drive the browser itself and capture what it sends.
 *
 * Two things are hard to get right by transcription: the exact request body the work
 * surface builds, and the list of models its picker offers. Both are answers the page
 * already knows — so rather than guessing at them, this drives the page.
 *
 * WHAT IT DOES
 *
 *   1. Enables Network capture on the Doubao tab.
 *   2. Clicks through to the work surface and opens the model picker, by dispatching
 *      pointer events at the elements it finds.
 *   3. Records every XHR/Fetch, including the bodies, so the picker request and the
 *      completion request are both available verbatim.
 *
 * The capture is the point: a hand-written payload produced `710020202 common invalid
 * param`, which names no field. The only way to find the difference is to diff against a
 * request the page actually sent.
 */
import { writeFileSync } from 'node:fs'

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = targets.find(t => t.type === 'page' && t.url.includes('doubao.com'))
if (page === undefined) { console.log('没有豆包页面'); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise(resolve => {
  const mid = ++id
  pending.set(mid, resolve)
  ws.send(JSON.stringify({ id: mid, method, params }))
})

const caught = []
const bodies = new Map()

ws.onmessage = event => {
  const msg = JSON.parse(event.data)
  if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); return }
  const { method, params } = msg
  if (method === 'Network.requestWillBeSent') {
    if (params.type !== 'XHR' && params.type !== 'Fetch') return
    bodies.set(params.requestId, {
      url: params.request.url,
      method: params.request.method,
      postData: params.request.postData,
    })
  }
  if (method === 'Network.responseReceived') {
    const record = bodies.get(params.requestId)
    if (record !== undefined) record.status = params.response.status
  }
  if (method === 'Network.loadingFinished') {
    const record = bodies.get(params.requestId)
    if (record === undefined) return
    bodies.delete(params.requestId)
    void (async () => {
      let body = ''
      try {
        const r = await send('Network.getResponseBody', { requestId: params.requestId })
        body = r?.body ?? ''
      } catch { /* evicted */ }
      caught.push({ ...record, body: body.slice(0, 20000) })
    })()
  }
}

await new Promise(resolve => { ws.onopen = resolve })
await send('Network.enable')
await send('Page.enable')

/**
 * Click an element by matching its text.
 *
 * `Input.dispatchMouseEvent` is used rather than `element.click()` because the picker is a
 * custom widget that listens for pointer events; a synthetic `.click()` is ignored by some
 * of them.
 */
async function clickByText(text, tag = '*') {
  const found = await send('Runtime.evaluate', {
    expression: `(() => {
      const all = [...document.querySelectorAll('${tag}')]
      const el = all.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}) && e.offsetParent !== null)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName, cls: (el.className || '').toString().slice(0, 80) }
    })()`,
    returnByValue: true,
  })
  const point = found?.result?.value
  if (point === null || point === undefined) return null
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 })
  }
  return point
}

/** What is on screen, so the next click can be aimed at something real. */
async function visibleText() {
  const r = await send('Runtime.evaluate', {
    expression: `document.body.innerText.slice(0, 1500)`,
    returnByValue: true,
  })
  return r?.result?.value ?? ''
}

console.log('已接管页面，开始自动操作。\n')

// 1. find the work entry.
console.log('页面可见文本（前 400 字）:')
console.log((await visibleText()).slice(0, 400))
console.log('')

const work = await clickByText('工作', 'div')
console.log('点击「工作」:', work === null ? '未找到' : JSON.stringify(work))
await new Promise(r => setTimeout(r, 2500))

// 2. open the model picker. Several labels are tried because the control is renamed often.
let picker = null
for (const label of ['豆包 2.1 Lite', '豆包 2.1', 'Lite', '模型']) {
  picker = await clickByText(label, 'div')
  if (picker !== null) { console.log('打开模型选择器:', label, JSON.stringify(picker)); break }
  picker = await clickByText(label, 'span')
  if (picker !== null) { console.log('打开模型选择器:', label, JSON.stringify(picker)); break }
}
if (picker === null) console.log('未找到模型选择器入口')
await new Promise(r => setTimeout(r, 2500))

console.log('\n展开后的可见文本:\n')
console.log((await visibleText()).slice(0, 1200))

await new Promise(r => setTimeout(r, 3000))

console.log(`\n\n抓到 ${caught.length} 个请求：\n`)
for (const c of caught) {
  const short = c.url.replace('https://www.doubao.com', '').split('?')[0]
  const interesting = /model|ability|config|menu|item/i.test(c.url)
  console.log(`${interesting ? '★' : ' '} [${c.status ?? '?'}] ${c.method} ${short}`)
  if (interesting || c.url.includes('/chat/completion')) {
    console.log(`    body: ${(c.postData ?? c.body ?? '').slice(0, 700)}`)
  }
}

writeFileSync('_doubao-driven.json', JSON.stringify(caught, null, 2))
console.log('\n已存 _doubao-driven.json')
ws.close()
