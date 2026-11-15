/**
 * Switch to the work surface and open the model picker, capturing every request.
 *
 * The picker and its credit multipliers are the missing piece for the plugin: it reports
 * what a turn cost, and Doubao's own numbers are the only ground truth for that. The
 * multipliers are not in any bundle — every `0.xx` literal in the shipped code belongs to
 * something else — so they come from the server.
 *
 * Clicking proved unreliable (the control is a custom widget that ignores synthetic
 * `.click()`), so the page is driven the way a person drives it: the keyboard shortcut the
 * page itself advertises for a new work task, then the model button by its real position.
 *
 * A hook on `fetch` AND `XMLHttpRequest` is installed first, so whichever transport the page
 * uses is caught.
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

await send('Runtime.evaluate', {
  expression: `(() => {
    if (window.__dbHook) { window.__dbHook.length = 0; return }
    const log = []
    window.__dbHook = log
    const of = window.fetch
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      const res = await of.call(this, input, init)
      try {
        const t = await res.clone().text()
        if (t && t.length < 500000) log.push({ url: String(url), method: (init&&init.method)||'GET', request: init&&init.body ? String(init.body).slice(0,3000) : '', response: t.slice(0,500000) })
      } catch {}
      return res
    }
    const xo = XMLHttpRequest.prototype.open
    const xs = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (m, u, ...rest) { this.__u = u; this.__m = m; return xo.call(this, m, u, ...rest) }
    XMLHttpRequest.prototype.send = function (body) {
      this.addEventListener('load', () => { try { if (!this.responseType || this.responseType==='text') log.push({ url:String(this.__u||''), method:this.__m, request: body?String(body).slice(0,3000):'', response:String(this.responseText||'').slice(0,500000) }) } catch {} })
      return xs.call(this, body)
    }
  })()`,
  returnByValue: true,
})

/** Press a key with the platform's modifier held. */
async function press(key, code, vk, mods = 2) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods })
}

const shot = async label => {
  const r = await send('Runtime.evaluate', { expression: `document.body.innerText`, returnByValue: true })
  const txt = (r?.result?.value ?? '')
  const lines = [...new Set(txt.split('\n').map(s => s.trim()).filter(s => s && /豆包|DeepSeek|Kimi|GLM|自动|小额|优惠|推理|x\s*$|额度/.test(s)))]
  console.log(`\n[${label}]`, lines.slice(0, 24).join(' | '))
  return txt
}

// 1. Focus the page, then the editor.
await send('Runtime.evaluate', {
  expression: `(() => { const pm = document.querySelector('.ProseMirror'); if (pm) { pm.focus(); const r = pm.getBoundingClientRect(); return { x: Math.round(r.left+40), y: Math.round(r.top+r.height/2) } } return null })()`,
  returnByValue: true,
}).then(async v => {
  const p = v?.result?.value
  if (p) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1, buttons: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    await new Promise(r => setTimeout(r, 500))
  }
})

// 2. Ctrl+J — the page advertises this for a new work task.
await press('j', 'KeyJ', 74, 2)
await new Promise(r => setTimeout(r, 3000))
await shot('Ctrl+J 后')

// 3. The composer row now carries the work controls; find the model button.
const btn = await send('Runtime.evaluate', {
  expression: `(() => {
    const all = [...document.querySelectorAll('span,button')]
    const hits = all.filter(e => {
      const t = (e.textContent||'').trim()
      const r = e.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return false
      return /^(自动|Auto|豆包 2\.1 Lite|豆包 快速|豆包 专家)$/.test(t) && r.top > 700
    })
    if (!hits.length) return { ok: false }
    const el = hits[hits.length-1]; const r = el.getBoundingClientRect()
    return { ok: true, x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2), text: (el.textContent||'').trim() }
  })()`,
  returnByValue: true,
})
console.log('\n模型按钮:', JSON.stringify(btn?.result?.value))
const b = btn?.result?.value
if (b?.ok) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', clickCount: 1, buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 })
  await new Promise(r => setTimeout(r, 4000))
  await shot('打开选择器后')
}

const cap = await send('Runtime.evaluate', {
  expression: `(() => ({ log: window.__dbHook ?? [] }))()`,
  returnByValue: true,
})
const log = cap?.result?.value?.log ?? []
console.log(`\n=== 捕获 ${log.length} 个请求 ===`)
for (const r of log) {
  const u = String(r.url).replace('https://www.doubao.com', '')
  console.log(`[${r.method}] ${u.slice(0, 130)}`)
}
const { writeFileSync } = await import('node:fs')
writeFileSync('_picker-hook.json', JSON.stringify(log, null, 2))
console.log('\n已存 _picker-hook.json')
ws.close()
