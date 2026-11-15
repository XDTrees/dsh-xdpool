/**
 * Open the activity surface and capture what it calls.
 *
 * The incentive endpoints answer `code 0` with empty cards for every scene tried, which
 * means the request is well-formed and the server simply is not offering a card — so the
 * scene is not the missing piece. The card is offered somewhere else: a popup, the
 * work-task surface, or a button the page only shows under some conditions.
 *
 * So the page is asked to SHOW it. The activity popup is a known component
 * (`s2-pc-activity-pop-window`), and its trigger is one of the activity entries on the
 * work surface. Clicking each entry and watching the network is how the real request is
 * found — including its scene, which is the part guessing kept getting wrong.
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
    if (url.includes('/ug/') || url.includes('incentive') || url.includes('campaign')) {
      const record = { url, method: msg.params.request.method, postData: msg.params.request.postData }
      caught.push(record)
      bodies.set(msg.params.requestId, record)
      console.log('★', record.method, url.replace('https://www.doubao.com', '').split('?')[0], '| body:', (record.postData ?? '(空)').slice(0, 160))
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

// Enter the work surface: that is where the activity entries live.
await send('Runtime.evaluate', {
  expression: "(() => { const pm = document.querySelector('.ProseMirror'); if (pm) pm.focus(); return true })()",
  returnByValue: true,
})
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74, nativeVirtualKeyCode: 74, modifiers: 2 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74, nativeVirtualKeyCode: 74, modifiers: 2 })
await new Promise(resolve => setTimeout(resolve, 8000))

// Look for anything that could open the activity surface.
const entries = await send('Runtime.evaluate', {
  expression: `(() => {
    const all = [...document.querySelectorAll('span,div,button,a')]
    const hits = all.filter(e => {
      const t = (e.textContent || '').trim()
      const r = e.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return false
      if (t.length === 0 || t.length > 26) return false
      return /任务|活动|额度|福利|签到|积分|成长|领取|奖励/.test(t)
    })
    return hits.map(e => {
      const r = e.getBoundingClientRect()
      return { text: (e.textContent || '').trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    }).slice(0, 20)
  })()`,
  returnByValue: true,
})
console.log('\n候选入口:', JSON.stringify(entries?.result?.value))

// Click them one by one.
for (const entry of entries?.result?.value ?? []) {
  console.log('\n点击:', entry.text)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: entry.x, y: entry.y, button: 'left', clickCount: 1, buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: entry.x, y: entry.y, button: 'left', clickCount: 1 })
  await new Promise(resolve => setTimeout(resolve, 3500))
  // A popup may cover the page now; press Escape and continue.
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await new Promise(resolve => setTimeout(resolve, 1200))
}

console.log(`\n=== 共 ${caught.length} 个 ug 请求 ===`)
for (const c of caught) {
  console.log(`[${c.method}] ${c.url.replace('https://www.doubao.com', '').split('?')[0]}`)
  console.log('   body:', (c.postData ?? '(空)').slice(0, 200))
  if (c.response) console.log('   响应:', c.response.slice(0, 600))
}
const { writeFileSync } = await import('node:fs')
writeFileSync('_doubao-ug-capture.json', JSON.stringify(caught, null, 2))
console.log('\n已存 _doubao-ug-capture.json')
ws.close()
