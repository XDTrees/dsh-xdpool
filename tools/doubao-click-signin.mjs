/**
 * Click the client's own 「立即签到」 button, and capture everything around it.
 *
 * The signed-in check-in is refused with `710010702`, and every hand-built variant is
 * refused the same way — including from inside the client's own page with its own cookies.
 * That rules out the request shape, the signature and the session.
 *
 * So the thing to watch is the CLIENT'S OWN CLICK: whatever it sends when the button is
 * pressed, in the order it sends it. If the client follows the report with something else
 * before the check-in, that something else is the missing piece.
 *
 * The button is located by its text and clicked by position — the client's UI is a normal
 * web page inside a Chromium shell, so a pointer event at the element's centre is what a
 * user's finger would produce.
 */
const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json()
const page = targets.find(t => t.type === 'page' && t.url.includes('doubao-chat'))
if (page === undefined) { console.log('找不到 doubao-chat 页面'); process.exit(1) }

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
    if (url.includes('doubao.com') && !/\.(js|css|png|jpg|webp|svg|woff2?)($|\?)/.test(url)) {
      const record = {
        url: url.replace('https://www.doubao.com', '').split('?')[0],
        method: msg.params.request.method,
        postData: msg.params.request.postData,
      }
      caught.push(record)
      bodies.set(msg.params.requestId, record)
      if (/ug\/|campaign|checkin/i.test(url)) {
        console.log(`★ ${record.method} ${record.url}`)
        console.log('   body:', (record.postData ?? '(空)').slice(0, 300))
      }
    }
  }
  if (msg.method === 'Network.loadingFinished') {
    const record = bodies.get(msg.params.requestId)
    if (record === undefined) return
    bodies.delete(msg.params.requestId)
    void (async () => {
      try {
        record.response = (await send('Network.getResponseBody', { requestId: msg.params.requestId }))?.body ?? ''
        if (/ug\/|campaign|checkin/i.test(record.url)) {
          console.log('   响应:', record.response.slice(0, 700))
        }
      } catch { /* evicted */ }
    })()
  }
}
await new Promise(resolve => { ws.onopen = resolve })
await send('Network.enable')

// Find the sign-in button.
const located = await send('Runtime.evaluate', {
  expression: `(() => {
    const all = [...document.querySelectorAll('button,div,span,a')]
    const hits = all.filter(e => {
      const t = (e.textContent || '').trim()
      const r = e.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) return false
      return /立即签到|签到|领取/.test(t) && t.length <= 12
    })
    return hits.map(e => {
      const r = e.getBoundingClientRect()
      return { text: (e.textContent || '').trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })
  })()`,
  returnByValue: true,
})
const buttons = located?.result?.value ?? []
console.log('\n找到签到按钮:', JSON.stringify(buttons))

const target = buttons.find(b => /立即签到/.test(b.text)) ?? buttons[0]
if (target === undefined) {
  console.log('页面上没有签到按钮 —— 请先让客户端显示「立即签到」')
} else {
  console.log(`\n点击「${target.text}」(${target.x}, ${target.y})\n`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1, buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 })
  await new Promise(resolve => setTimeout(resolve, 6000))
}

console.log(`\n=== 共捕获 ${caught.length} 个请求 ===`)
for (const c of caught) console.log(`  ${c.method} ${c.url}`)

const { writeFileSync } = await import('node:fs')
writeFileSync('D:/dsh-home/_client-click.json', JSON.stringify(caught, null, 2))
console.log('\n已存 _client-click.json')
ws.close()
