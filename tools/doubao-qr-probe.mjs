/**
 * Standalone Doubao QR-login probe.
 *
 * Runs the login flow outside the plugin so the protocol can be verified against the live
 * service before any of it is ported: get a QR, print it, poll until the phone confirms,
 * then write the resulting cookies to a file.
 *
 * The steps, and why each exists:
 *
 *   1. GET /                       — seeds `ttwid`, the device cookie the passport
 *                                    endpoints expect on every later call.
 *   2. GET /passport/safe/csrf_token — a CSRF token is REQUIRED by the two passport
 *                                    endpoints below; without it they answer a bare refusal.
 *   3. GET /passport/web/get_qrcode — returns a base64 PNG plus a poll `token`.
 *   4. GET /passport/web/check_qrconnect — polled until the phone confirms. Status moves
 *                                    new → scanned → confirmed.
 *   5. follow redirect_url          — this is where `sessionid` is finally issued.
 *
 * Run: node tools/doubao-qr-probe.mjs
 * Output: writes `_doubao-session.json` on success, prints the QR path either way.
 */
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

/** Cookies the server set across the whole flow. */
const jar = new Map()

/**
 * Merge `set-cookie` headers into the jar.
 *
 * Uses `getSetCookie()` when present because `headers.get('set-cookie')` joins multiple
 * cookies with a comma, and a cookie value may itself contain one.
 */
function absorb(headers) {
  const list = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie')].filter(Boolean)
  for (const line of list) {
    const [pair] = line.split(';')
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (name !== '') jar.set(name, value)
  }
}

/** Cookie header for a request. */
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

/** One GET, absorbing cookies and returning the body text. */
async function get(path, extraHeaders = {}) {
  const url = path.startsWith('http') ? path : BASE + path
  const response = await fetch(url, {
    headers: { ...HEADERS, ...extraHeaders, cookie: cookieHeader() },
    redirect: 'manual',
  })
  absorb(response.headers)
  const text = await response.text()
  return { status: response.status, text, headers: response.headers }
}

/** A fresh device identity, per the reference implementation. */
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

const next = encodeURIComponent('https://www.doubao.com')

async function main() {
  // 1. homepage — seeds ttwid.
  const home = await get('/')
  console.log(`1. 首页 ${home.status} | cookies: ${[...jar.keys()].join(', ') || '(无)'}`)

  // 2. csrf token.
  let csrf = jar.get('passport_csrf_token') ?? jar.get('passport_csrf_token_default') ?? ''
  if (csrf === '') {
    const r = await get(`/passport/safe/csrf_token/?aid=${AID}`)
    try {
      const j = JSON.parse(r.text)
      csrf = j?.data?.passport_csrf_token ?? ''
    } catch { /* fall through to the jar */ }
    csrf = csrf || jar.get('passport_csrf_token') || ''
  }
  console.log(`2. csrf ${csrf === '' ? '❌ 未取到' : `✅ ${csrf.slice(0, 12)}…`}`)
  if (csrf === '') throw new Error('没有 csrf token，后续 passport 接口会被拒')

  // 3. QR code.
  const qr = await get(`/passport/web/get_qrcode/?next=${next}&aid=${AID}`, {
    'x-tt-passport-csrf-token': csrf,
  })
  let qrJson
  try { qrJson = JSON.parse(qr.text) } catch { qrJson = {} }
  const qrData = qrJson?.data ?? {}
  const token = qrData.token ?? ''
  const image = qrData.qrcode ?? qrData.qrcode_url ?? ''
  console.log(`3. 二维码 ${qr.status} | token ${token === '' ? '❌' : '✅'} | 图片 ${image === '' ? '❌' : `${image.length} 字符`}`)
  if (token === '') {
    console.log('   响应:', qr.text.slice(0, 400))
    throw new Error('没有拿到二维码 token')
  }
  // Written out so it can be opened in a viewer; base64 PNG, not a data URI.
  const b64 = image.startsWith('data:') ? image.split(',')[1] : image
  writeFileSync('_doubao-qr.png', Buffer.from(b64, 'base64'))
  console.log('   二维码已存: D:\\dsh-home\\_doubao-qr.png')

  // 4. poll.
  const started = Date.now()
  let last = ''
  /**
   * The server expires a QR on its own schedule — measured well under three minutes, and
   * the reference implementation allows only 120 s. Polling past `expired` cannot succeed,
   * so the wait is bounded and the message says to re-run rather than hanging.
   */
  const WAIT_MS = 240_000
  while (Date.now() - started < WAIT_MS) {
    const r = await get(`/passport/web/check_qrconnect/?next=${next}&token=${encodeURIComponent(token)}&aid=${AID}`, {
      'x-tt-passport-csrf-token': csrf,
    })
    let j = {}
    try { j = JSON.parse(r.text) } catch { /* keep polling */ }
    const d = j?.data ?? {}
    const code = d.error_code ?? j?.error_code ?? -1
    const status = d.status ?? ''
    if (code === 0 && status !== '' && status !== last) {
      last = status
      const label = { new: '等待扫码', scanned: '已扫描，请在手机上确认', confirmed: '已确认', expired: '已过期' }[status] ?? status
      console.log(`4. ${label} (${status})  已等待 ${Math.round((Date.now() - started) / 1000)}s`)
      if (status === 'confirmed') {
        const redirect = d.redirect_url ?? ''
        if (redirect !== '') {
          // The sessionid rides on the redirect response's Set-Cookie.
          await get(redirect)
        }
        const sessionid = jar.get('sessionid') ?? ''
        console.log(`    sessionid ${sessionid === '' ? '❌ 未取到' : `✅ ${sessionid.slice(0, 10)}…`}`)
        if (sessionid !== '') {
          writeFileSync('_doubao-session.json', JSON.stringify({
            cookies: Object.fromEntries(jar),
            device: deviceParams(),
            savedAt: new Date().toISOString(),
          }, null, 2))
          console.log('    已写入 D:\\dsh-home\\_doubao-session.json')
          return
        }
      }
      if (status === 'expired') {
        // Not fatal: a QR has a short life, and re-running by hand between attempts wastes
        // the one thing the flow needs — the user's attention. Reported distinctly so the
        // caller can print a fresh code without treating it as a protocol failure.
        throw new Error('QR_EXPIRED')
      }
    }
    await new Promise(r2 => setTimeout(r2, 1500))
  }
  throw new Error('QR_EXPIRED')
}

/**
 * Run the flow, refreshing the code when the server expires it.
 *
 * A Doubao QR lives well under three minutes, which is shorter than a person takes to pick
 * up a phone and confirm — so a single attempt fails often enough to be the normal case
 * rather than an error. Retrying here keeps one terminal session alive across several
 * codes instead of making the operator restart the script between attempts.
 */
async function run() {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await main()
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message === 'QR_EXPIRED' && attempt < 3) {
        console.log(`\n二维码过期，正在生成第 ${attempt + 1} 个…\n`)
        continue
      }
      throw error
    }
  }
}

run().catch(error => {
  console.error('失败:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
