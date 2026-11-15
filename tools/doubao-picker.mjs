/**
 * Open the model picker and capture the request that produces the list.
 *
 * The picker shows models with their CREDIT MULTIPLIERS (「0.01x」, 「0.65x」 …), which is
 * the one thing the plugin cannot do without: it needs the multipliers to report what a
 * turn cost, exactly as the pool's own channels do.
 *
 * Those multipliers are NOT in the bundle — every `0.xx`-looking literal there belongs to
 * something else — so they arrive from an endpoint. This finds it by hooking `fetch` and
 * `XMLHttpRequest` in the page, then opening the picker.
 *
 * The hook is installed BEFORE the picker is opened, so the request is caught the first
 * time it happens; a second copy is also kept in `window.__dbHook` for inspection.
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

/** Install the hook in the page. */
const hooked = await send('Runtime.evaluate', {
  expression: `(() => {
    if (window.__dbHook) return { already: true }
    const log = []
    window.__dbHook = log
    const of = window.fetch
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      const res = await of.call(this, input, init)
      try {
        const clone = res.clone()
        const text = await clone.text()
        if (text && text.length < 400000) log.push({ url, method: (init&&init.method)||'GET', body: init&&init.body ? String(init.body).slice(0,4000) : '', response: text.slice(0, 400000) })
      } catch {}
      return res
    }
    const xo = XMLHttpRequest.prototype.open
    const xs = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (m, u, ...rest) { this.__dbUrl = u; this.__dbMethod = m; return xo.call(this, m, u, ...rest) }
    XMLHttpRequest.prototype.send = function (body) {
      this.addEventListener('load', () => {
        try {
          if (this.responseType === '' || this.responseType === 'text') log.push({ url: this.__dbUrl, method: this.__dbMethod, body: body ? String(body).slice(0,4000) : '', response: String(this.responseText||'').slice(0,400000) })
        } catch {}
      })
      return xs.call(this, body)
    }
    return { ok: true }
  })()`,
  returnByValue: true,
})
console.log('hook:', JSON.stringify(hooked?.result?.value))

// 1. enter the work surface.
const work = await send('Runtime.evaluate', {
  expression: `(() => {
    const all = [...document.querySelectorAll('div,span,button')]
    const el = all.find(e => (e.textContent||'').trim() === '工作' && e.getBoundingClientRect().width > 0)
    if (!el) return { ok: false }
    const b = el.getBoundingClientRect()
    return { ok: true, x: Math.round(b.left+b.width/2), y: Math.round(b.top+b.height/2) }
  })()`,
  returnByValue: true,
})
const w = work?.result?.value
console.log('「工作」:', JSON.stringify(w))
if (w?.ok) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: w.x, y: w.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 })
  }
  await new Promise(r => setTimeout(r, 2500))
}

// 2. find and click the model button in the composer row.
const btn = await send('Runtime.evaluate', {
  expression: `(() => {
    const pm = document.querySelector('.ProseMirror')
    if (!pm) return { ok: false, why: 'no editor' }
    let n = pm
    for (let i = 0; i < 10 && n; i++) {
      const t = (n.innerText || '')
      if (t.includes('云电脑')) {
        const kids = [...n.querySelectorAll('span,button')].filter(e => {
          const tt = (e.textContent||'').trim()
          const b = e.getBoundingClientRect()
          return tt.length > 0 && tt.length < 24 && b.width > 0 && b.top > 0
        })
        // The model button is the one whose text matches a known model name.
        const hit = kids.find(e => /豆包 2\.1|豆包 快速|豆包 专家|^自动$|Auto/.test((e.textContent||'').trim()))
        if (hit) { const b = hit.getBoundingClientRect(); return { ok: true, x: Math.round(b.left+b.width/2), y: Math.round(b.top+b.height/2), text: (hit.textContent||'').trim() } }
      }
      n = n.parentElement
    }
    return { ok: false, why: 'no model button in row' }
  })()`,
  returnByValue: true,
})
console.log('模型按钮:', JSON.stringify(btn?.result?.value))
const b2 = btn?.result?.value
if (b2?.ok) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: b2.x, y: b2.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 })
  }
  await new Promise(r => setTimeout(r, 3500))
}

// 3. read the picker contents and the captured requests.
const picked = await send('Runtime.evaluate', {
  expression: `(() => {
    const all = [...document.querySelectorAll('div,span,li')]
    const rows = all.filter(e => {
      const t = (e.textContent||'').trim()
      const b = e.getBoundingClientRect()
      if (b.width === 0 || b.height === 0) return false
      if (t.length === 0 || t.length > 70) return false
      if (!/豆包|DeepSeek|Kimi|GLM|自动|小额/.test(t)) return false
      // innermost: no descendant repeats the same model words
      return ![...e.children].some(c => /豆包|DeepSeek|Kimi|GLM/.test((c.textContent||'').trim()))
    })
    return { rows: rows.map(e => (e.textContent||'').trim()).slice(0, 30), log: window.__dbHook ?? [] }
  })()`,
  returnByValue: true,
})
const p = picked?.result?.value
console.log('\n=== 选择器里的条目 ===')
for (const row of p?.rows ?? []) console.log('  ', row)
console.log('\n=== 捕获的请求 ===')
for (const r of p?.log ?? []) {
  const u = String(r.url).replace('https://www.doubao.com', '').split('?')[0]
  console.log(`[${r.method}] ${u}`)
  if (/model|ability|item|menu/i.test(String(r.url)) && r.response) {
    console.log('   响应:', String(r.response).slice(0, 1500))
  }
}

const { writeFileSync } = await import('node:fs')
writeFileSync('_picker-capture.json', JSON.stringify(p ?? {}, null, 2))
console.log('\n已存 _picker-capture.json')
ws.close()
