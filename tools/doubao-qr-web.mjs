/**
 * Doubao QR-login, as a local web page.
 *
 * WHY A PAGE INSTEAD OF A TERMINAL SCRIPT
 *
 * A Doubao QR lives well under three minutes — shorter than the round trip of reading a
 * code off a terminal, picking up a phone, opening the app and confirming. The terminal
 * version therefore spends most of its life reporting `expired`, and every expiry costs
 * the operator a manual restart. Pushing the QR to a page that refreshes it on its own
 * turns that into a non-event: the page always shows a live code, and the moment one is
 * scanned the page says so.
 *
 * The page is served from this process on loopback and the whole flow runs server-side, so
 * the browser never touches the passport endpoints — it only polls `/state`.
 *
 * Run: node tools/doubao-qr-web.mjs
 * Then open the printed URL.
 */
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'

const BASE = 'https://www.doubao.com'
const AID = '497858'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
const HEADERS = {
  'user-agent': UA,
  accept: 'application/json, text/plain, */*',
  referer: 'https://www.doubao.com/chat/login',
  origin: 'https://www.doubao.com',
}
const PORT = Number(process.env.DOUBAO_QR_PORT ?? 8791)

/** Everything the page needs to render. */
const state = {
  phase: 'starting',
  qr: '',
  error: '',
  sessionid: '',
  cookies: {},
  startedAt: Date.now(),
  refreshedAt: 0,
  attempts: 0,
}

const jar = new Map()
let pollToken = ''
let csrf = ''

function absorb(headers) {
  const list = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie')].filter(Boolean)
  for (const line of list) {
    const [pair] = line.split(';')
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
  }
}

const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')

async function get(path) {
  const url = path.startsWith('http') ? path : BASE + path
  const response = await fetch(url, {
    headers: { ...HEADERS, cookie: cookieHeader() },
    redirect: 'manual',
  })
  absorb(response.headers)
  return { status: response.status, text: await response.text() }
}

function deviceParams() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const pick = n => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  const rand = (lo, hi) => String(Math.floor(lo + Math.random() * (hi - lo)))
  return {
    fp: `verify_${pick(8)}_${pick(4)}_${pick(4)}_${pick(4)}_${pick(12)}`,
    device_id: rand(7000000000000000, 7999999999999999),
    web_id: rand(7600000000000000000, 7690000000000000000),
  }
}

/**
 * Fetch a fresh QR and park its token for polling.
 *
 * Called on start and again on every expiry, which is what keeps the page always showing a
 * live code instead of a dead one.
 */
async function refreshQr() {
  state.attempts += 1
  state.phase = 'fetching'
  state.qr = ''
  state.error = ''
  try {
    await get('/')
    csrf = jar.get('passport_csrf_token') ?? jar.get('passport_csrf_token_default') ?? ''
    if (csrf === '') {
      const r = await get(`/passport/safe/csrf_token/?aid=${AID}`)
      try { csrf = JSON.parse(r.text)?.data?.passport_csrf_token ?? '' } catch { /* jar fallback */ }
      csrf = csrf || jar.get('passport_csrf_token') || ''
    }
    if (csrf === '') throw new Error('csrf token 未取到')

    const next = encodeURIComponent('https://www.doubao.com')
    const r = await get(`/passport/web/get_qrcode/?next=${next}&aid=${AID}`)
    const data = JSON.parse(r.text)?.data ?? {}
    pollToken = data.token ?? ''
    const raw = data.qrcode ?? data.qrcode_url ?? ''
    if (pollToken === '' || raw === '') throw new Error('二维码响应缺少 token 或图片')
    // A data URI renders directly in an <img>; a bare base64 needs the prefix.
    state.qr = raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`
    writeFileSync('_doubao-qr.png', Buffer.from(state.qr.split(',')[1] ?? '', 'base64'))
    state.refreshedAt = Date.now()
    state.phase = 'waiting'
  } catch (error) {
    state.phase = 'error'
    state.error = error instanceof Error ? error.message : String(error)
  }
}

/**
 * Poll the current QR until it is scanned, confirmed or expired.
 *
 * Only one loop runs at a time; `refreshQr` restarts it after an expiry by reassigning
 * `pollToken`, and the loop exits as soon as its token no longer matches.
 */
async function pollLoop() {
  const next = encodeURIComponent('https://www.doubao.com')
  let holding = ''
  while (state.phase !== 'done') {
    if (pollToken === '') { await sleep(800); continue }
    if (holding !== pollToken) { holding = pollToken }
    const token = pollToken
    try {
      const r = await get(`/passport/web/check_qrconnect/?next=${next}&token=${encodeURIComponent(token)}&aid=${AID}`)
      const j = JSON.parse(r.text)
      const d = j?.data ?? {}
      const code = d.error_code ?? j?.error_code ?? -1
      const status = d.status ?? ''
      if (code === 0 && status !== '') {
        if (status === 'new' && state.phase === 'fetching') state.phase = 'waiting'
        if (status === 'scanned') state.phase = 'scanned'
        if (status === 'expired') {
          // A fresh code, immediately — the page swaps it in without a reload.
          console.log('[qr] 过期，换新码')
          await refreshQr()
          continue
        }
        if (status === 'confirmed') {
          const redirect = d.redirect_url ?? ''
          if (redirect !== '') await get(redirect)
          const sessionid = jar.get('sessionid') ?? ''
          if (sessionid !== '') {
            state.sessionid = sessionid
            state.cookies = Object.fromEntries(jar)
            state.phase = 'done'
            writeFileSync('_doubao-session.json', JSON.stringify({
              cookies: state.cookies,
              device: deviceParams(),
              savedAt: new Date().toISOString(),
            }, null, 2))
            console.log('[qr] 登录成功，sessionid 已保存')
            return
          }
          state.phase = 'error'
          state.error = '已确认，但没有拿到 sessionid'
          return
        }
      }
    } catch { /* transient: keep polling */ }
    await sleep(1500)
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

const PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>豆包扫码登录</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1115;color:#e8eaf0;
 font:15px/1.6 -apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
.card{width:min(420px,92vw);padding:28px 26px 24px;border-radius:18px;background:#171a21;
 border:1px solid #ffffff1f;box-shadow:0 24px 60px #0008;text-align:center}
h1{margin:0 0 6px;font-size:17px;font-weight:650;letter-spacing:.01em}
.sub{margin:0 0 18px;font-size:12.5px;color:#8a90a0}
.frame{position:relative;width:min(280px,74vw);aspect-ratio:1;margin:0 auto;padding:12px;border-radius:14px;
 background:#fff;transition:opacity .2s}
.frame.dim{opacity:.25}
img{display:block;width:100%;height:100%;image-rendering:pixelated}
.note{margin:14px 0 0;font-size:12.5px;min-height:20px;color:#8a90a0;transition:color .2s}
.note.ok{color:#22c55e;font-weight:600}
.note.warn{color:#f59e0b}
.note.err{color:#e5534b}
.meta{margin:10px 0 0;font-size:11px;color:#5f6675;font-family:ui-monospace,Menlo,Consolas,monospace}
button{margin-top:16px;padding:7px 16px;border-radius:8px;border:1px solid #ffffff26;background:#ffffff0d;
 color:#e8eaf0;font:inherit;font-size:13px;cursor:pointer}
button:hover{background:#ffffff17}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;word-break:break-all;color:#9aa2b1}
</style></head><body>
<div class="card">
  <h1>豆包扫码登录</h1>
  <p class="sub">用手机豆包 App 扫描下方二维码，并在手机上确认</p>
  <div class="frame" id="frame"><img id="qr" alt="登录二维码"></div>
  <p class="note" id="note">正在获取二维码…</p>
  <p class="meta" id="meta"></p>
  <button id="again" hidden>换一个二维码</button>
  <div id="done" hidden>
    <p class="note ok">登录成功</p>
    <code id="sid"></code>
  </div>
</div>
<script>
const qr = document.getElementById('qr')
const note = document.getElementById('note')
const meta = document.getElementById('meta')
const frame = document.getElementById('frame')
const again = document.getElementById('again')
const done = document.getElementById('done')
let lastQr = ''
const LABEL = { starting:['正在获取二维码…',''], fetching:['正在获取二维码…',''],
  waiting:['等待扫码',''], scanned:['已扫描，请在手机上确认','warn'], done:['登录成功','ok'],
  error:['出错了','err'] }

async function tick(){
  let s
  try { s = await (await fetch('/state')).json() } catch { setTimeout(tick,1200); return }
  if (s.qr && s.qr !== lastQr) { lastQr = s.qr; qr.src = s.qr; frame.classList.remove('dim') }
  const [text,cls] = LABEL[s.phase] ?? [s.phase,'']
  note.textContent = s.error || text
  note.className = 'note ' + (s.error ? 'err' : cls)
  if (s.phase === 'error') { again.hidden = false }
  if (s.phase === 'done') {
    frame.classList.add('dim'); done.hidden = false
    document.getElementById('sid').textContent = s.sessionid
    again.hidden = true
  } else { done.hidden = true }
  // Age of the current code, so an expiring one is visible rather than mysterious.
  if (s.refreshedAt) {
    const age = Math.round((Date.now() - s.refreshedAt)/1000)
    meta.textContent = '第 ' + s.attempts + ' 个二维码 · 已 ' + age + ' 秒'
  } else meta.textContent = ''
  setTimeout(tick, 1000)
}
again.onclick = () => { again.hidden = true; fetch('/again').catch(()=>{}) }
tick()
</script></body></html>`

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/state') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({
      phase: state.phase,
      qr: state.qr,
      error: state.error,
      sessionid: state.sessionid,
      refreshedAt: state.refreshedAt,
      attempts: state.attempts,
    }))
    return
  }
  if (url.pathname === '/again') {
    void refreshQr()
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(PAGE)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`豆包扫码登录页: http://127.0.0.1:${PORT}`)
  console.log('用手机豆包 App 扫码；二维码过期会自动换新')
  void refreshQr().then(() => { void pollLoop() })
})
