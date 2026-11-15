/**
 * Find the sign-in banner and the request it makes.
 *
 * The banner promises 「每天签到领 200 额度」, and its button is the only thing that can
 * reveal the endpoint — the path is assembled at runtime, so it is in no bundle. Clicking
 * the button is the way to see it.
 *
 * The banner is a DISMISSIBLE GUIDE on the work surface, so the search is over the whole
 * document rather than a specific container: the text 「每日签到」 appears in the card, and
 * the button inside it says 「立即签到」 or 「去签到」.
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
await new Promise(resolve => setTimeout(resolve, 9000))

// Where is the banner?
const located = await send('Runtime.evaluate', {
  expression: `(() => {
    const all = [...document.querySelectorAll('div,span,p,button')]
    const marker = all.find(e => (e.textContent || '').includes('签到'))
    if (!marker) {
      const body = document.body.innerText
      const i = body.indexOf('签到')
      return { found: false, snippet: i >= 0 ? body.slice(Math.max(0, i - 120), i + 200) : '(无「签到」字样)' }
    }
    // The smallest element carrying the text is the label; the CARD is a few levels up.
    let card = marker
    for (let i = 0; i < 6 && card.parentElement; i += 1) {
      const text = card.innerText || ''
      if (text.includes('额度') || text.includes('签到')) { card = card.parentElement }
    }
    const buttons = [...card.querySelectorAll('button, [role="button"]')].map(b => {
      const r = b.getBoundingClientRect()
      return { text: (b.textContent || '').trim().slice(0, 20), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width) }
    }).filter(b => b.w > 0)
    return { found: true, cardText: (card.innerText || '').trim().slice(0, 300), buttons }
  })()`,
  returnByValue: true,
})
const info = located?.result?.value
console.log('签到卡片:', JSON.stringify(info, null, 1).slice(0, 1400))

const button = info?.buttons?.find(b => /签到|领取|立即|去/.test(b.text))
if (button) {
  console.log('\n点击:', JSON.stringify(button))
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: button.x, y: button.y, button: 'left', clickCount: 1, buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: button.x, y: button.y, button: 'left', clickCount: 1 })
  await new Promise(resolve => setTimeout(resolve, 6000))
} else if (info?.buttons?.length) {
  console.log('\n按钮列表里没有签到相关:', JSON.stringify(info.buttons))
}

console.log(`\n=== ${caught.length} 个请求 ===`)
for (const c of caught) {
  const path = c.url.replace('https://www.doubao.com', '').split('?')[0]
  const interesting = /sign|reward|activity|growth|point|checkin|bonus|quota|credit/i.test(path)
  console.log(`${interesting ? '★' : ' '} [${c.method}] ${path}`)
  if (interesting) {
    console.log('   body:', (c.postData ?? '(空)').slice(0, 200))
    if (c.response) console.log('   响应:', c.response.slice(0, 500))
  }
}
const { writeFileSync } = await import('node:fs')
writeFileSync('_doubao-signin-capture.json', JSON.stringify(caught, null, 2))
console.log('\n已存 _doubao-signin-capture.json')
ws.close()
