/**
 * Watch the DESKTOP CLIENT's traffic for the sign-in.
 *
 * The web surface refuses the check-in with `710010702 系统错误` and its landing endpoint
 * returns no card, which is the server declining to offer the web session a check-in. The
 * client is where the card is offered, so the client is where the working request is.
 *
 * The client is a native C++ shell around Chromium, so there is no page to inspect — but it
 * takes Chromium's switches, and `--remote-debugging-port` opens the DevTools protocol
 * against the embedded web views. What is watched here is the NETWORK of those views: the
 * request the client makes for the check-in, with its body.
 *
 * The client has to be started with the port for this to work:
 *
 *   Doubao.exe --remote-debugging-port=9333
 */
const PORT = Number(process.argv[2] ?? 9333)

let targets
try {
  targets = await (await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)).json()
} catch {
  console.log('客户端调试端口没开，先用 --remote-debugging-port=9333 启动它')
  process.exit(1)
}

const pages = targets.filter(t => t.type === 'page')
console.log(`客户端 ${pages.length} 个页面：`)
for (const p of pages) console.log('  ', p.url.slice(0, 90))

/** Watch every request on every page, for the incentive endpoints. */
const watched = []
for (const target of pages) {
  if (typeof target.webSocketDebuggerUrl !== 'string') continue
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
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
      if (url.includes('doubao.com')) {
        const record = {
          url,
          method: msg.params.request.method,
          postData: msg.params.request.postData,
          headers: msg.params.request.headers,
          page: target.url,
        }
        watched.push(record)
        bodies.set(msg.params.requestId, record)
        console.log(`\n★ ${record.method} ${url.replace('https://www.doubao.com', '').split('?')[0]}`)
        console.log('  body:', (record.postData ?? '(空)').slice(0, 300))
      }
    }
    if (msg.method === 'Network.loadingFinished') {
      const record = bodies.get(msg.params.requestId)
      if (record === undefined) return
      bodies.delete(msg.params.requestId)
      void (async () => {
        try {
          record.response = (await send('Network.getResponseBody', { requestId: msg.params.requestId }))?.body ?? ''
          console.log('  响应:', record.response.slice(0, 700))
        } catch { /* evicted */ }
      })()
    }
  }
  await new Promise(resolve => { ws.onopen = resolve })
  await send('Network.enable')
  console.log('已监听:', target.url.slice(0, 60))
}

console.log('\n\n请在客户端里触发签到（打开工作任务/活动入口）。脚本会打印它发出的请求。\n')
console.log('按 Ctrl+C 结束。')

// Keep watching.
const { writeFileSync } = await import('node:fs')
setInterval(() => {
  if (watched.length > 0) {
    writeFileSync('_doubao-client-ug.json', JSON.stringify(watched, null, 2))
  }
}, 1000)
