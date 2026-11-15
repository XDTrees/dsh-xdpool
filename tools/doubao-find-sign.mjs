/**
 * Look for `msToken` and `a_bogus` inside the live page.
 *
 * The chat endpoint needs both, and neither is a cookie:
 *
 *   - `msToken` is ByteDance's session token, kept in the page's own storage;
 *   - `a_bogus` is a REQUEST SIGNATURE, computed per call by
 *     `window.bdms.frontierSign` — which is exactly why the maintained reverse-engineering
 *     projects drive a headless browser: the browser can sign, a plain HTTP client cannot.
 *
 * So the question this answers is narrow and decisive: does the page expose a signing
 * function we can call, and where does the token live?
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

const expression = `(() => {
  const out = { sign: null, storage: [], globals: [] }

  // 1. the signing function the frontend exposes.
  const candidates = [
    () => window.bdms && typeof window.bdms.frontierSign === 'function' ? 'window.bdms.frontierSign' : undefined,
    () => window.byted_acrawler && typeof window.byted_acrawler.sign === 'function' ? 'window.byted_acrawler.sign' : undefined,
    () => window.__acrawler && typeof window.__acrawler.sign === 'function' ? 'window.__acrawler.sign' : undefined,
    () => window.webmssdk && typeof window.webmssdk.sign === 'function' ? 'window.webmssdk.sign' : undefined,
    () => window.byted_acrawler ? 'window.byted_acrawler (no .sign)' : undefined,
    () => window.bdms ? 'window.bdms (no .frontierSign)' : undefined,
  ]
  for (const probe of candidates) {
    try {
      const found = probe()
      if (found !== undefined) { out.sign = found; break }
    } catch {}
  }

  // 2. where the token lives.
  for (const store of [localStorage, sessionStorage]) {
    try {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i)
        if (key === null) continue
        if (/ms_?token|bogus|tt_?token|verify/i.test(key)) {
          out.storage.push({ where: store === localStorage ? 'local' : 'session', key, value: String(store.getItem(key)).slice(0, 60) })
        }
      }
    } catch {}
  }

  // 3. globals whose name hints at a token.
  for (const key of Object.keys(window)) {
    if (/ms_?token|bogus|tt_?token/i.test(key)) {
      try {
        const value = window[key]
        out.globals.push({ key, type: typeof value, value: typeof value === 'string' ? value.slice(0, 50) : undefined })
      } catch {}
    }
  }
  return JSON.stringify(out)
})()`

const result = await send('Runtime.evaluate', { expression, returnByValue: true })
console.log(result?.result?.value ?? JSON.stringify(result?.exceptionDetails?.exception?.description ?? result).slice(0, 400))
ws.close()
