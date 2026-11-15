/**
 * Sweep the Doubao UI for the sign-in banner.
 *
 * The page promises 「每日签到，免费用豆包工作 / 每天签到领 200 额度」 — and that text is
 * the only handle on the endpoint, which is assembled at runtime.
 *
 * The banner may be a MODAL that appears on first load, a side panel, or a card in the
 * work surface. Rather than guess where it is, this opens every plausible surface and
 * reports which one contains the text.
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
  const out = []
  const body = document.body.innerText
  const marks = ['签到', '每日签到', '免费用豆包工作', '额度翻倍', '8800']
  for (const m of marks) {
    const i = body.indexOf(m)
    out.push(m + ': ' + (i >= 0 ? '出现 @' + i : '无'))
  }
  // Dialogs and drawers, which a guide banner usually is.
  for (const sel of ['[role="dialog"]', '[role="banner"]', '.semi-modal-content', '[class*="sign"]', '[class*="Sign"]', '[class*="checkin"]', '[class*="daily"]']) {
    const els = [...document.querySelectorAll(sel)]
    for (const e of els.slice(0, 4)) {
      const t = (e.innerText || '').trim()
      if (t !== '') out.push(sel + ' -> ' + t.slice(0, 160).replace(/\\n/g, ' / '))
    }
  }
  // Every link that could lead to the task centre.
  for (const a of document.querySelectorAll('a[href]')) {
    const h = a.getAttribute('href') || ''
    if (/task|activity|sign|incentive|reward|growth|point/i.test(h)) out.push('link ' + h + ' -> ' + (a.textContent || '').trim().slice(0, 30))
  }
  return out.join(' | ')
})()`

for (const url of ['https://www.doubao.com/chat/', 'https://www.doubao.com/']) {
  await send('Page.navigate', { url })
  await new Promise(resolve => setTimeout(resolve, 8000))
  const result = await send('Runtime.evaluate', { expression, returnByValue: true })
  console.log(`\n=== ${url} ===`)
  console.log(result?.result?.value ?? '(无结果)')
}
ws.close()
