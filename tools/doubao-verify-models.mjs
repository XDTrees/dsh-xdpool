/**
 * Verify every model the picker offers, using a CAPTURED request as the template.
 *
 * Building the body from scratch produced `710020202 common invalid param` for every model,
 * even for ones that work when the page's own request is replayed. The difference is small
 * and invisible: the page's `client_meta` has NO `local_conversation_id` (the field is set
 * later, on the conversation object), and several option keys are absent for some model
 * families. A template is the only way to be sure.
 *
 * So this takes the captured request, swaps the model, the text and the ids, and sends that.
 * The catalogue comes from the endpoint the page itself calls
 * (`/alice/slot/action_bar_v3/brief_list`).
 *
 * Run: node tools/doubao-verify-models.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const BASE = 'https://www.doubao.com'
const cookies = JSON.parse(readFileSync('D:/dsh-home/_doubao-cookies.json', 'utf8'))
const UA = readFileSync('D:/dsh-home/_doubao-ua.txt', 'utf8').trim()
const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
const csrf = cookies['passport_csrf_token'] ?? ''

/** The catalogue, as the page's own endpoint reports it. */
const CATALOGUE = [
  { key: '9', name: '自动', multiplier: undefined, window: 256000 },
  { key: 'seed-lite-7b', name: '豆包 2.1 Lite', multiplier: 0.01, window: 256000 },
  { key: '5', name: '豆包 2.1 Pro', multiplier: 0.65, window: 256000 },
  { key: 'person-deepseek-v4-1-flash-261017', name: 'DeepSeek V4.1 Flash', multiplier: 0.01, window: 300000 },
  { key: 'person-kimi-k3-1-pro-261111', name: 'Kimi K3.1 Pro', multiplier: 0.95, window: 300000 },
  { key: 'person-kimi-k3-1-pro-highspeed-261111', name: 'Kimi K3.1 Pro 高速', multiplier: 1.44, window: 300000 },
  { key: 'person-kimi-k3-261111', name: 'Kimi K3', multiplier: 1.48, window: 300000 },
  { key: 'person-glm-5-3-261111', name: 'GLM 5.3', multiplier: 0.80, window: 300000 },
  { key: 'person-glm-5-3-flash-261111', name: 'GLM 5.3 Flash', multiplier: 0.08, window: 300000 },
  { key: 'person-deepseek-v4-pro-ga-260813', name: 'DeepSeek V4 Pro', multiplier: 0.46, window: 300000 },
]

const device = (() => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const pick = n => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  const rand = (lo, hi) => String(Math.floor(lo + Math.random() * (hi - lo)))
  return {
    fp: `verify_${pick(8)}_${pick(4)}_${pick(4)}_${pick(4)}_${pick(12)}`,
    device_id: rand(7000000000000000, 7999999999999999),
    web_id: rand(7600000000000000000, 7690000000000000000),
  }
})()

const securityParams = () => new URLSearchParams({
  aid: '497858', real_aid: '497858',
  device_id: device.device_id, tea_uuid: device.device_id, web_id: device.web_id,
  device_platform: 'web', language: 'zh', region: 'CN', sys_region: 'CN',
  pkg_type: 'release_version', version_code: '20800', pc_version: '2.1.7',
  chromium_version: '148.0.7816.0', client_platform: 'pc_client', runtime: 'web',
  runtime_version: '3.5.4', samantha_web: '1', 'use-olympus-account': '1',
  fp: device.fp, web_tab_id: randomUUID(),
}).toString()

/**
 * The two captured templates: one for the `person-*` family (no `conversation_init_ext`)
 * and one for the Doubao family (with it). Which one a model needs is not a guess — it is
 * visible in the number of option keys the page sends for it.
 */
const templates = JSON.parse(readFileSync('_doubao-templates.json', 'utf8'))

function buildBody(model, text, effort) {
  // Which template a model needs is decided by its FAMILY, not by name matching: the
  // `person-*` models are served by a different payload shape than the Doubao ones, and
  // sending the wrong shape is answered `710022004 rate limited`.
  const shape = model.key.startsWith('person-') ? 'person' : 'doubao'
  const source = JSON.parse(templates[shape].postData)
  const body = JSON.parse(JSON.stringify(source))
  const isPerson = model.key.startsWith('person-')

  // The model, everywhere it appears.
  body.option.model_config.model_item_key = model.key
  body.option.model_config.reasoning_effort = effort
  body.option.model_config.model_extra_params = isPerson
    ? { memory_profile: '300k_230', total_window_size: '300000' }
    : { memory_profile: '256k', total_window_size: '256000' }
  body.option.aggregate_params.model_item_key = model.key
  body.option.aggregate_params.reasoning_effort = String(effort)
  if (body.option.conversation_init_ext !== undefined) {
    body.option.conversation_init_ext.model_item_key = model.key
    body.option.conversation_init_ext.reasoning_effort = String(effort)
  }

  // The text.
  body.messages[0].content_block[0].content.text_block.text = text

  // Fresh ids: a replayed conversation is the one thing the server could reject as stale.
  const messageId = randomUUID()
  if (body.client_meta.local_conversation_id !== undefined) {
    body.client_meta.local_conversation_id = `local_${randomUUID().replaceAll('-', '').slice(0, 16)}`
  }
  body.messages[0].local_message_id = messageId
  body.messages[0].content_block[0].block_id = randomUUID()
  body.option.unique_key = randomUUID()
  if (body.option.general_task_param !== undefined) {
    body.option.general_task_param.thread_local_message_id = [messageId]
    body.ext.general_task_param = JSON.stringify(body.option.general_task_param)
  }
  body.option.create_time_ms = Date.now()
  if (body.option.recovery_option !== undefined) {
    body.option.recovery_option.req_create_time_sec = Math.floor(Date.now() / 1000)
  }
  return body
}

async function ask(model, effort) {
  const response = await fetch(`${BASE}/chat/completion?${securityParams()}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'accept-language': 'zh-CN,zh;q=0.9',
      'user-agent': UA,
      origin: BASE,
      referer: `${BASE}/chat/`,
      cookie: cookieHeader,
      ...(csrf === '' ? {} : { 'x-tt-passport-csrf-token': csrf }),
    },
    body: JSON.stringify(buildBody(model, '说一句你好', effort)),
  })
  const raw = await response.text()
  let text = ''
  let error = ''
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue
    let j
    try { j = JSON.parse(line.slice(6)) } catch { continue }
    if (j?.error_code !== undefined) error = `${String(j.error_code)} ${String(j.error_msg ?? '')}`
    for (const op of j?.patch_op ?? []) {
      for (const b of op?.patch_value?.content_block ?? []) {
        const t = b?.content?.text_block?.text
        if (typeof t === 'string' && t !== '') text += t
      }
    }
  }
  return { status: response.status, text, error }
}

console.log('模型可用性验证（以真实请求为模板）\n')
const results = []
for (const model of CATALOGUE) {
  let outcome
  try {
    outcome = await ask(model, 3)
  } catch (error) {
    outcome = { status: 0, text: '', error: String(error) }
  }
  const ok = outcome.text !== ''
  console.log(`${ok ? '✅' : '❌'} ${model.name.padEnd(22)} ${model.key.padEnd(38)} ${ok ? `倍率 ${model.multiplier ?? '—'}` : outcome.error}`)
  results.push({ ...model, ok, error: outcome.error })
  await new Promise(r => setTimeout(r, 1500))
}

writeFileSync('_doubao-model-results.json', JSON.stringify(results, null, 2))
console.log(`\n可用 ${results.filter(r => r.ok).length}/${results.length}`)
