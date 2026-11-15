/**
 * Find the sign-in entry point on the page.
 *
 * The daily check-in is what makes the Doubao lane worth having — the page says
 * 「每天签到领 200 额度」 — and its endpoint is not in any bundle (the path is assembled at
 * runtime), so the way to find it is to look at what the page links to.
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
await send('Page.navigate', { url: 'https://www.doubao.com/chat/' })
await new Promise(resolve => setTimeout(resolve, 7000))
// The sign-in banner lives on the PLAIN conversation page (the panel that says
// 「每日签到，免费用豆包工作」), not in the work surface.
await new Promise(resolve => setTimeout(resolve, 3000))

const expression = `(() => {
  const lines = document.body.innerText.split(String.fromCharCode(10)).map(s => s.trim()).filter(Boolean)
  const hits = lines.filter(l => l.length < 60 && l.length > 1)
  const links = [...document.querySelectorAll('a')]
    .map(a => ({ text: (a.textContent || '').trim().slice(0, 24), href: a.getAttribute('href') }))
    .filter(x => /签到|积分|活动|成长|sign|point|growth/i.test(x.text + ' ' + x.href))
  const all = document.body.innerText
  const signIdx = all.indexOf('签到')
  const around = signIdx >= 0 ? all.slice(Math.max(0, signIdx - 200), signIdx + 300) : '(页面无「签到」字样)'
  return { tail: all.slice(-1200), around, links: links.slice(0, 12) }
})()`

const result = await send('Runtime.evaluate', { expression, returnByValue: true })
console.log(JSON.stringify(result?.result?.value ?? result?.exceptionDetails?.exception?.description ?? result, null, 1).slice(0, 1600))
ws.close()
