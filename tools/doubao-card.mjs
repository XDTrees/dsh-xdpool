/**
 * Why does `landing/get` return no cards?
 *
 * The campaign says `daily_signin` is `task_status: 1` (available) and
 * `checked_in_today: false`, yet `landing/get` answers `code 0` with `landing_cards: []`.
 * The check-in then fails with `710010702`.
 *
 * That sequence reads as: the CARD is what authorises the check-in, and the server is not
 * issuing a card to this session. The card carries an id (`campaign_item_code`,
 * `target_card_group_id`) that the check-in would then be made against.
 *
 * So the question is what makes the server issue a card. Candidates, each tried:
 *
 *   - a `target_card_group_id` the page supplies from its own config;
 *   - a scene other than the one assumed;
 *   - a `need_login` / onboarding state the account has not reached.
 *
 * The page's own request for this endpoint is captured too, so its exact body is known
 * rather than guessed.
 */
const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json()
const page = targets.find(t => t.type === 'page' && t.url.includes('doubao-chat'))
if (page === undefined) { console.log('找不到页面'); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const landingCalls = []
const send = (method, params = {}) => new Promise(resolve => {
  const mid = ++id
  pending.set(mid, resolve)
  ws.send(JSON.stringify({ id: mid, method, params }))
})
ws.onmessage = event => {
  const msg = JSON.parse(event.data)
  if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); return }
  if (msg.method === 'Network.requestWillBeSent' && msg.params.request.url.includes('landing/get')) {
    landingCalls.push(msg.params.request.postData)
  }
}
await new Promise(resolve => { ws.onopen = resolve })
await send('Network.enable')

// Ask the page to refresh its own landing state — that is the call worth copying.
await send('Runtime.evaluate', {
  expression: `(() => {
    // Reload the activity panel if the page exposes it; otherwise just re-run a fetch the
    // page itself uses.
    const btn = [...document.querySelectorAll('button,div,span')]
      .find(e => /立即签到|去完成|领取/.test((e.textContent || '').trim()) && e.getBoundingClientRect().width > 0)
    if (btn) { btn.click() }
    return true
  })()`,
  returnByValue: true,
})
await new Promise(resolve => setTimeout(resolve, 4000))

console.log('页面自己发出的 landing/get body:')
for (const body of landingCalls) console.log('  ', body ?? '(空)')
if (landingCalls.length === 0) console.log('  (页面没有重新请求，缓存命中)')

console.log('\n=== 尝试 target_card_group_id 的候选值 ===\n')
const expression = `(async () => {
  const P = new URLSearchParams({
    aid: '497858', version_code: '20800', device_platform: 'web',
    doubao_device_platform: 'web', language: 'zh', region: 'CN', sys_region: 'CN',
    pkg_type: 'release_version', pc_version: '3.45.5', doubao_pc_version: '3.45.5',
    device_id: '7707326032512615990', web_id: '7707326040423597619',
    tea_uuid: '7707326040423597619', samantha_web: '1', web_platform: 'browser',
    'use-olympus-account': '1', web_tab_id: crypto.randomUUID(),
  })
  const out = []
  const post = async (label, body) => {
    const res = await fetch('https://www.doubao.com/alice/ug/campaign/landing/get?' + P.toString(), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), credentials: 'include',
    })
    const text = await res.text()
    try {
      const j = JSON.parse(text)
      const cards = Array.isArray(j.data && j.data.landing_cards) ? j.data.landing_cards.length : 0
      out.push(label + ' -> code=' + j.code + ' cards=' + cards + (cards ? ' ' + JSON.stringify(j.data.landing_cards).slice(0, 400) : ''))
    } catch { out.push(label + ' -> ' + text.slice(0, 100)) }
  }
  for (const id of ['daily_signin', 'pc_incentive_task', 'sign_in', '0', '1']) {
    await post('target=' + id, { scene: 'pc_incentive_task_mvp_v3', target_card_group_id: id })
  }
  return out.join(String.fromCharCode(10))
})()`

const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
console.log(result?.result?.value ?? JSON.stringify(result).slice(0, 300))
ws.close()
