/**
 * Sign out of Doubao in the browser, so a different account can be used.
 *
 * The account matters for the sign-in: the incentive tasks are per-account, so an account
 * that has already claimed them shows nothing to claim — which is indistinguishable, in
 * the response, from an endpoint that is not the right one.
 *
 * Clearing the cookies is the reliable way to sign out: the session lives in them, and
 * the app has no other session store to clear.
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

// Clear the session cookies for the Doubao origins.
const cleared = await send('Network.clearBrowserCookies')
console.log('清除 cookie:', cleared === undefined ? '已清' : JSON.stringify(cleared).slice(0, 120))

// And the page's own storage, which holds the device identity the session is bound to.
const storage = await send('Runtime.evaluate', {
  expression: `(() => {
    let n = 0
    try { localStorage.clear(); n += 1 } catch {}
    try { sessionStorage.clear(); n += 1 } catch {}
    return n
  })()`,
  returnByValue: true,
})
console.log('清除 storage:', storage?.result?.value, '类')

await send('Page.navigate', { url: 'https://www.doubao.com/chat/' })
await new Promise(resolve => setTimeout(resolve, 9000))

const state = await send('Runtime.evaluate', {
  expression: `(() => {
    const body = document.body.innerText
    const signed = /登录|登入/.test(body.slice(0, 300))
    return JSON.stringify({
      signedIn: !signed,
      head: body.slice(0, 260).replace(/\\n/g, ' / '),
    })
  })()`,
  returnByValue: true,
})
console.log('\n当前状态:', state?.result?.value)
console.log('\n请在浏览器里登录另一个豆包账号。')
ws.close()
