/**
 * Select a model in the picker and send, capturing the REAL request.
 *
 * The `person-*` models answered `710022004 rate limited` when the payload was replayed,
 * while `seed-lite-7b` worked. The multiplier is not the issue — the request differs in some
 * way the replay does not reproduce. Rather than guess, the page is driven: pick the model
 * by name, send, and keep the request it produced.
 *
 * The picker is opened by clicking the model button in the composer row; the row is found by
 * walking up from the editor until the text 「云电脑」 appears, which is the work surface's
 * own marker.
 */
import { writeFileSync } from 'node:fs'

const TARGET = process.argv[2] ?? 'DeepSeek V4.1 Flash'

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = targets.find(t => t.type === 'page' && t.url.includes('doubao.com'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const caught = []
const send = (method, params = {}) => new Promise(resolve => {
  const mid = ++id
  pending.set(mid, resolve)
  ws.send(JSON.stringify({ id: mid, method, params }))
})
ws.onmessage = event => {
  const msg = JSON.parse(event.data)
  if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); return }
  if (msg.method === 'Network.requestWillBeSent' && (msg.params.type === 'XHR' || msg.params.type === 'Fetch')) {
    if (msg.params.request.url.includes('/chat/completion')) {
      caught.push({ url: msg.params.request.url, postData: msg.params.request.postData })
      console.log('★ 抓到 /chat/completion')
    }
  }
}
await new Promise(resolve => { ws.onopen = resolve })
await send('Network.enable')

const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

/** 1. the model button in the composer row. */
const btn = await send('Runtime.evaluate', {
  expression: `(() => {
    const pm = document.querySelector('.ProseMirror')
    if (!pm) return { ok: false, why: 'no editor' }
    let n = pm
    for (let i = 0; i < 12 && n; i++) {
      const t = n.innerText || ''
      if (t.includes('云电脑')) {
        const hit = [...n.querySelectorAll('span,button')].find(e => {
          const tt = (e.textContent||'').trim()
          const b = e.getBoundingClientRect()
          return b.width > 0 && b.top > 700 && tt.length > 0 && tt.length < 24 && !/云电脑|项目|技能|插件/.test(tt)
        })
        if (hit) { const b = hit.getBoundingClientRect(); return { ok: true, x: Math.round(b.left+b.width/2), y: Math.round(b.top+b.height/2), text:(hit.textContent||'').trim() } }
      }
      n = n.parentElement
    }
    return { ok: false, why: 'row not found' }
  })()`,
  returnByValue: true,
})
console.log('模型按钮:', JSON.stringify(btn?.result?.value))
const b = btn?.result?.value
if (!b?.ok) { ws.close(); process.exit(1) }
await click(b.x, b.y)
await new Promise(r => setTimeout(r, 2500))

/** 2. pick the target model by name. */
const pick = await send('Runtime.evaluate', {
  expression: `(() => {
    const all = [...document.querySelectorAll('div,span,li')]
    const hits = all.filter(e => {
      const t = (e.textContent||'').trim()
      const b = e.getBoundingClientRect()
      if (b.width === 0 || b.height === 0) return false
      if (t !== ${JSON.stringify(TARGET)}) return false
      // innermost
      return ![...e.children].some(c => (c.textContent||'').trim() === ${JSON.stringify(TARGET)})
    })
    if (!hits.length) {
      const names = all.map(e => (e.textContent||'').trim()).filter(t => t && t.length < 30 && /豆包|DeepSeek|Kimi|GLM/.test(t))
      return { ok: false, names: [...new Set(names)].slice(0, 20) }
    }
    const b2 = hits[0].getBoundingClientRect()
    return { ok: true, x: Math.round(b2.left+b2.width/2), y: Math.round(b2.top+b2.height/2) }
  })()`,
  returnByValue: true,
})
console.log('目标模型:', JSON.stringify(pick?.result?.value))
const p = pick?.result?.value
if (p?.ok) {
  await click(p.x, p.y)
  await new Promise(r => setTimeout(r, 2000))
} else {
  console.log('页面上的模型名:', p?.names)
}

/** 3. type and send. */
await send('Runtime.evaluate', {
  expression: `(() => {
    const el = document.querySelector('.ProseMirror')
    el.focus()
    const sel = window.getSelection(); const range = document.createRange()
    range.selectNodeContents(el); range.collapse(false)
    sel.removeAllRanges(); sel.addRange(range)
    document.execCommand('insertText', false, '说一句你好')
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '说一句你好' }))
    return true
  })()`,
  returnByValue: true,
})
await new Promise(r => setTimeout(r, 800))
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
await new Promise(r => setTimeout(r, 5000))

if (caught.length > 0) {
  writeFileSync('_real-person.json', JSON.stringify(caught[0], null, 2))
  const b3 = JSON.parse(caught[0].postData)
  console.log('\n=== 真实请求的关键字段 ===')
  console.log('model_config:', JSON.stringify(b3.option.model_config))
  console.log('aggregate_params:', JSON.stringify(b3.option.aggregate_params))
  console.log('agent_mode:', b3.option.agent_mode, '| conversation_mode:', b3.option.conversation_mode)
  console.log('ext:', JSON.stringify(b3.ext).slice(0, 300))
  console.log('\n已存 _real-person.json')
} else {
  console.log('没抓到请求')
}
ws.close()
