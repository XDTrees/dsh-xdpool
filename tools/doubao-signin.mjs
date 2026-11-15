/**
 * Click through to the Doubao sign-in card and capture what it asks the server.
 *
 * The check-in is worth having — the page promises 「每天签到领 200 额度」 — and its
 * endpoint is assembled at runtime, so it is in none of the bundles. The way to find it is
 * to make the page perform the action and watch the network.
 *
 * The banner is a dismissible guide card on the work surface. It is found by its text, and
 * clicking the button inside it is what triggers the request.
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
await send('Page.navigate', { url: 'https://www.doubao.com/chat/' })
await new Promise(resolve => setTimeout(resolve, 7000))

// 1. find the guide card by its text.
const found = await send('Runtime.evaluate', {
  expression: `(() => {
    const all = [...document.querySelectorAll('div,span,p,button')]
    const marker = all.find(e => {
      const t = (e.textContent || '').trim()
      return t.includes('每日签到') || t.includes('每天签到')
    })
    if (!marker) {
      const body = document.body.innerText
      return { found: false, hasText: body.includes('签到'), snippet: body.slice(0, 200) }
    }
    // The button inside the card that does the claiming.
    const scope = marker.closest('div[role="dialog"]') || marker.parentElement?.parentElement || marker
    const buttons = [...scope.querySelectorAll('button, [role="button"]')].map(b => {
      const r = b.getBoundingClientRect()
      return { text: (b.textContent || '').trim().slice(0, 24), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width) }
    }).filter(b => b.w > 0)
    return { found: true, cardText: (marker.textContent || '').trim().slice(0, 200), buttons }
  })()`,
  returnByValue: true,
})
console.log('签到卡片:', JSON.stringify(found?.result?.value, null, 1).slice(0, 1200))

// 2. click the first button in it, if any.
const card = found?.result?.value
const button = card?.buttons?.find(b => /签到|领取|立即/.test(b.text)) ?? card?.buttons?.[0]
if (button) {
  console.log('点击:', JSON.stringify(button))
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: button.x, y: button.y, button: 'left', clickCount: 1, buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: button.x, y: button.y, button: 'left', clickCount: 1 })
  await new Promise(resolve => setTimeout(resolve, 6000))
}

console.log(`\n=== ${caught.length} 个请求 ===`)
for (const c of caught) {
  const path = c.url.replace('https://www.doubao.com', '').split('?')[0]
  console.log(`[${c.method}] ${path}`)
  if (/activity|reward|sign|growth|point|checkin/i.test(path) || /签到/.test(c.postData ?? '')) {
    console.log('   body:', (c.postData ?? '(空)').slice(0, 200))
    if (c.response) console.log('   响应:', c.response.slice(0, 400))
  }
}
const { writeFileSync } = await import('node:fs')
writeFileSync('_doubao-signin-capture.json', JSON.stringify(caught, null, 2))
console.log('\n已存 _doubao-signin-capture.json')
ws.close()
