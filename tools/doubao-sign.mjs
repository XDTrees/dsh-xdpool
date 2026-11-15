/**
 * Ask the page to sign a request, and use the result.
 *
 * WHY THE BROWSER HAS TO DO THIS
 *
 * The chat endpoint needs `a_bogus`, a per-request signature computed by ByteDance's
 * `window.bdms.frontierSign`. It is not a cookie and it cannot be derived from one — the
 * upstream checks the signature against the request, so a stale or missing one is answered
 * `710020202 common invalid param`, which names no field and is why this looked like a
 * payload problem for a long time.
 *
 * The maintained reverse-engineering projects solve this by driving a HEADLESS browser
 * (Playwright) purely to obtain the signature. That is a heavy dependency to add to a
 * plugin that already runs beside a browser, and it is unnecessary here: the user is signed
 * in in a real browser, and that browser can sign.
 *
 * So the lane signs through the user's own browser over the DevTools protocol: the plugin
 * asks the page to sign the URL, and sends the signed URL itself.
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

/**
 * The signing call.
 *
 * `frontierSign` takes the URL (and the body, for a POST) and returns the query string
 * carrying `a_bogus` — the reference projects call it with the serialised body so the
 * signature covers it.
 */
const expression = `(async () => {
  try {
    const body = JSON.stringify({ language_code: 'zh', bot_id: '7338286299411103781' })
    const url = 'https://www.doubao.com/alice/slot/action_bar_v3/brief_list?aid=497858&version_code=20800'
    const fn = window.bdms.frontierSign
    // The signature function's shape varies between builds; try the shapes in turn and
    // keep the first that produces an a_bogus.
    const attempts = [
      { label: 'url+body', args: [url, body] },
      { label: 'url', args: [url] },
      { label: 'body', args: [body] },
    ]
    for (const attempt of attempts) {
      try {
        const result = await fn.apply(window.bdms, attempt.args)
        const text = typeof result === 'string' ? result : JSON.stringify(result)
        if (text && text.includes('a_bogus')) {
          return JSON.stringify({ ok: true, via: attempt.label, sample: text.slice(0, 200) })
        }
      } catch (e) {
        // try the next shape
      }
    }
    return JSON.stringify({ ok: false, why: 'no shape produced an a_bogus' })
  } catch (e) {
    return JSON.stringify({ ok: false, why: 'threw: ' + (e && e.message ? e.message : String(e)) })
  }
})()`

const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
console.log(result?.result?.value ?? JSON.stringify(result?.exceptionDetails?.exception?.description ?? result).slice(0, 400))
ws.close()
