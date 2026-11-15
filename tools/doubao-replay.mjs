/**
 * Replay a captured Doubao request, optionally swapping the model and the text.
 *
 * The point is to establish, without further guesswork, which fields the current endpoint
 * actually requires. The hand-written payload was refused with
 * `710020202 common invalid param` — a complaint that names no field — and the only way to
 * find the difference was to capture what the page sends and diff against it.
 *
 * The diff, for the record:
 *
 *   conversation_init_ext   must be {"agent_task_param": "<json string>",
 *                                   "model_item_key", "reasoning_effort", "mode_id"}
 *                              — not {project_id, need_ack_conversation}
 *   recovery_option         must be {is_recovery, req_create_time_sec, append_sse_event_scene}
 *   related_deleted_message_ids  is an OBJECT, not an array
 *   message_storage_type    0 on the work surface
 *   ext.use_deep_think      mirrors option.need_deep_think
 *   content_block           carries `extra_info: {}`
 *
 * Run: node tools/doubao-replay.mjs [model_item_key] [effort] [text]
 */
import { readFileSync, writeFileSync } from 'node:fs'

const MODEL_KEY = process.argv[2] ?? 'seed-lite-7b'
const EFFORT = process.argv[3] ?? '3'
const TEXT = process.argv[4] ?? '你好，介绍一下你自己'

const captured = JSON.parse(readFileSync('_real-chat.json', 'utf8'))
const body = JSON.parse(captured.postData)

// Swap in the requested model and effort, everywhere the key appears.
body.option.model_config.model_item_key = MODEL_KEY
// Each model carries its OWN memory profile, and a mismatched one is answered
// `710022004 rate limited` — a refusal that reads like throttling and is not. The
// DeepSeek family needs `300k_230`; the Doubao family `256k`. Sending the wrong profile
// for a model is indistinguishable, from the outside, from being out of quota.
const MEMORY_PROFILES = {
  'person-deepseek-v4-1-flash-261017': { memory_profile: '300k_230', total_window_size: '300000' },
  'person-deepseek-v4-pro-ga-260813': { memory_profile: '300k_230', total_window_size: '300000' },
  'person-kimi-k3-1-pro-261111': { memory_profile: '300k_230', total_window_size: '300000' },
  'person-kimi-k3-1-pro-highspeed-261111': { memory_profile: '300k_230', total_window_size: '300000' },
  'person-kimi-k3-261111': { memory_profile: '300k_230', total_window_size: '300000' },
  'person-glm-5-3-261111': { memory_profile: '300k_230', total_window_size: '300000' },
  'person-glm-5-3-flash-261111': { memory_profile: '300k_230', total_window_size: '300000' },
}
const profile = MEMORY_PROFILES[MODEL_KEY]
if (profile !== undefined) body.option.model_config.model_extra_params = { ...profile }
body.option.model_config.reasoning_effort = Number(EFFORT)
body.option.aggregate_params.model_item_key = MODEL_KEY
body.option.aggregate_params.reasoning_effort = String(EFFORT)
/**
 * `conversation_init_ext` is present for SOME models and absent for others, and ADDING it
 * where the page omits it is answered `710022004 rate limited`.
 *
 * The captured requests show the split plainly: the Doubao models carry 42 option keys, the
 * `person-*` ones 40 — the two extra are `conversation_init_ext` and `conversation_mode`.
 * Sending a model a payload shaped for a different family is indistinguishable, from the
 * outside, from being out of quota, which is why this looked like throttling.
 */
if (body.option.conversation_init_ext !== undefined) {
  body.option.conversation_init_ext.model_item_key = MODEL_KEY
  body.option.conversation_init_ext.reasoning_effort = String(EFFORT)
}
// The chat-only models (`0`, `3`) live in the plain conversation, which uses
// conversation_mode 1 and no agent task. The work models use mode 2. Sending a chat model
// with the work payload is answered `710022004 rate limited` — a refusal that reads like
// throttling and is not.
body.messages[0].content_block[0].content.text_block.text = TEXT
// Fresh ids: a replayed conversation id is the one thing the server could reject as stale.
body.client_meta.local_conversation_id = `local_${Math.random().toString(16).slice(2, 18)}`
body.messages[0].local_message_id = crypto.randomUUID()
body.messages[0].content_block[0].block_id = crypto.randomUUID()
body.option.unique_key = crypto.randomUUID()
const threadId = crypto.randomUUID()
body.option.general_task_param.thread_local_message_id = [threadId]
body.ext.general_task_param = JSON.stringify(body.option.general_task_param)
// The chat-only models (`0`, `3`) live in the plain conversation, which uses
// conversation_mode 1 and carries no agent task. The work models use mode 2. Sending a
// chat model with the work payload is answered `710022004 rate limited` — a refusal that
// reads like throttling and is not.
const CHAT_ONLY = new Set(['0', '3'])
if (CHAT_ONLY.has(MODEL_KEY)) {
  body.option.conversation_mode = 1
  body.option.aggregate_params.conversation_mode = '1'
  body.option.aggregate_params.mode_id = '1'
  body.option.agent_mode = 0
  body.option.aggregate_params.agent_mode = '0'
  body.ext.agent_mode = '0'
  delete body.option.general_task_param
  delete body.ext.general_task_param
}
body.option.recovery_option.req_create_time_sec = Math.floor(Date.now() / 1000)
body.option.create_time_ms = Date.now()

const cookies = JSON.parse(readFileSync('D:/dsh-home/_doubao-cookies.json', 'utf8'))
const UA = readFileSync('D:/dsh-home/_doubao-ua.txt', 'utf8').trim()
const csrf = cookies['passport_csrf_token'] ?? ''

// The query the page used — reused verbatim from the capture's URL.
const url = new URL(captured.url)
const response = await fetch(url.toString(), {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    'accept-language': 'zh-CN,zh;q=0.9',
    'user-agent': UA,
    origin: 'https://www.doubao.com',
    referer: 'https://www.doubao.com/chat/',
    cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '),
    ...(csrf === '' ? {} : { 'x-tt-passport-csrf-token': csrf }),
  },
  body: JSON.stringify(body),
})

console.log(`模型 ${MODEL_KEY} | effort ${EFFORT} | HTTP ${response.status} | ${response.headers.get('content-type')}`)
const raw = await response.text()
writeFileSync('_doubao-replay.txt', raw)

let text = ''
let convId = ''
const events = new Set()
for (const line of raw.split('\n')) {
  if (line.startsWith('event: ')) { events.add(line.slice(7).trim()); continue }
  if (!line.startsWith('data: ')) continue
  let j
  try { j = JSON.parse(line.slice(6)) } catch { continue }
  if (j?.ack_client_meta?.conversation_id) convId = j.ack_client_meta.conversation_id
  if (j?.error_code !== undefined) console.log(`错误 ${String(j.error_code)} ${String(j.error_msg ?? '')}`)
  for (const op of j?.patch_op ?? []) {
    for (const b2 of op?.patch_value?.content_block ?? []) {
      const t = b2?.content?.text_block?.text
      if (typeof t === 'string' && t !== '') text += t
    }
  }
}
console.log('事件:', [...events].join(', '))
console.log('会话:', convId || '(无)')
console.log('回复:', text === '' ? '(空)' : text.slice(0, 300))
