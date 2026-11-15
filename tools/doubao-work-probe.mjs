/**
 * Send one message to Doubao in the WORK ("工作") mode, exactly as the web client does.
 *
 * This is the third probe in a series, and each one answered a question the previous could
 * not:
 *
 *   1. The QR path died at `check_qrconnect` → `2035 非法请求`. The QR entrance is closed.
 *   2. Cookies from a logged-in browser + the CURRENT endpoint (`/chat/completion`, not the
 *      old `/samantha/chat/completion`) answered with a real SSE stream.
 *   3. But the plain conversation only reaches the default bot. The NEW models live in the
 *      work surface, and there they are addressed by `model_item_key` — observed live as
 *      `seed-lite-7b` for "豆包 2.1 lite" and `9` for another entry.
 *
 * So this probe sends the WORK-mode payload — `agent_mode: 1`, `conversation_mode: 2`, a
 * `model_config` carrying the model key, and `general_task_param` carrying the runtime —
 * and reports what came back.
 *
 * The runtime question is the one that decides whether this is usable at all:
 *
 *   - `runtime_type: 1` (cloud) — the agent runs on Doubao's servers. A relay reproduces
 *     this exactly: we send HTTP, the tools run server-side.
 *   - a local runtime — the DESKTOP CLIENT executes the tools, and the browser web surface
 *     cannot do that. A relay cannot reproduce it at all.
 *
 * So the cloud runtime is not a preference here; it is the only variant a relay can serve.
 * The probe proves the cloud one works.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const BASE = 'https://www.doubao.com'
const cookies = JSON.parse(readFileSync('D:/dsh-home/_doubao-cookies.json', 'utf8'))
const UA = readFileSync('D:/dsh-home/_doubao-ua.txt', 'utf8').trim()
const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
const csrf = cookies['passport_csrf_token'] ?? ''

/** Which model to ask for. Observed keys: `9`, `seed-lite-7b`. */
const MODEL_KEY = process.argv[2] ?? 'seed-lite-7b'
/** Reasoning effort. Observed: 3 = "低" on the work surface, 8 on another entry. */
const EFFORT = process.argv[3] ?? '3'

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
  aid: '497858',
  real_aid: '497858',
  device_id: device.device_id,
  tea_uuid: device.device_id,
  web_id: device.web_id,
  device_platform: 'web',
  language: 'zh',
  region: 'CN',
  sys_region: 'CN',
  pkg_type: 'release_version',
  version_code: '20800',
  pc_version: '2.1.7',
  chromium_version: '148.0.7816.0',
  client_platform: 'pc_client',
  runtime: 'web',
  runtime_version: '3.5.4',
  samantha_web: '1',
  'use-olympus-account': '1',
  fp: device.fp,
  web_tab_id: randomUUID(),
}).toString()

const messageId = randomUUID()

/**
 * The work-mode payload, transcribed from the live request the browser made.
 *
 * Two fields matter most and neither is guessable:
 *
 *   - `model_config.model_item_key` — how the work surface names a model. The plain
 *     conversation has no equivalent, which is exactly why the new models were unreachable.
 *   - `general_task_param.runtime_type` — where the agent runs. `1` is Doubao's cloud, and
 *     the other values mean the desktop client executes locally.
 */
function payload(text) {
  const generalTaskParam = {
    action: 0,
    thread_local_message_id: [messageId],
    project_id: '',
    runtime_type: 1,
    agent_task_param: {
      runtime_type: 1,
      folder_name: '',
      device_name: '',
      workspace: '',
      local_app_id: '',
      local_device_id: '',
    },
    server_do_compare: true,
  }
  return {
    client_meta: {
      local_conversation_id: `local_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
      conversation_id: '',
      bot_id: '7338286299411103781',
      last_section_id: '',
      last_message_index: null,
      /**
       * The location permissions.
       *
       * Present in every live request and absent from the first hand-written one, which
       * was answered `710020202 common invalid param` — a complaint that names no field, so
       * the only way to find it was to compare against a captured request.
       */
      local_permissions: [
        { permission_name: 'ACCESS_COARSE_LOCATION', status: 3 },
        { permission_name: 'ACCESS_FINE_LOCATION', status: 3 },
        { permission_name: 'ACCESS_BACKGROUND_LOCATION', status: 3 },
      ],
    },
    messages: [{
      local_message_id: messageId,
      content_block: [{
        block_type: 10000,
        content: {
          text_block: { text, icon_url: '', icon_url_dark: '', summary: '' },
          pc_event_block: '',
        },
        block_id: randomUUID(),
        parent_id: '',
        meta_info: [],
        append_fields: [],
        is_finish: true,
        patch_type: 2,
      }],
      message_status: 0,
    }],
    option: {
      send_message_scene: '',
      create_time_ms: 0,
      collect_id: '',
      is_audio: false,
      answer_with_suggest: true,
      /** Work mode. */
      agent_mode: 1,
      tts_switch: false,
      need_deep_think: 10001,
      click_clear_context: false,
      from_suggest: false,
      is_regen: false,
      is_replace: false,
      is_from_click_option: false,
      is_from_click_softlink: false,
      disable_sse_cache: false,
      select_text_action: '',
      is_select_text: false,
      resend_for_regen: false,
      scene_type: 0,
      unique_key: randomUUID(),
      start_seq: 0,
      need_create_conversation: true,
      conversation_init_option: { need_ack_conversation: true },
      conversation_init_ext: { project_id: '', need_ack_conversation: true },
      regen_query_id: [],
      edit_query_id: [],
      regen_instruction: '',
      no_replace_for_regen: false,
      message_from: 0,
      shared_app_name: '',
      shared_app_id: '',
      sse_recv_event_options: { support_chunk_delta: true },
      support_lazy_fetch_stream: true,
      is_ai_playground: false,
      is_old_user: false,
      general_task_param: generalTaskParam,
      recovery_option: {},
      message_storage_type: 1,
      related_deleted_message_ids: [],
      connector_info_list: [],
      /** The model. */
      model_config: {
        model_item_key: MODEL_KEY,
        model_extra_params: { memory_profile: '256k', total_window_size: '256000' },
        reasoning_effort: Number(EFFORT),
      },
      aggregate_params: {
        mention_skill_list: '[]',
        mention_plugin_list: '[]',
        mention_ext: '[{}]',
        conversation_mode: '2',
        mode_id: '3',
        model_item_key: MODEL_KEY,
        agent_mode: '1',
        reasoning_effort: EFFORT,
        provider_id: '',
      },
      conversation_mode: 2,
    },
    user_context: {},
    ext: {
      general_task_param: JSON.stringify(generalTaskParam),
      use_deep_think: '9',
      agent_mode: '1',
      conversation_init_option: JSON.stringify({ project_id: '', need_ack_conversation: true }),
      sub_conv_firstmet_type: '1',
      collection_id: '',
      is_finish: '1',
      commerce_credit_config_enable: '0',
    },
  }
}

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
  body: JSON.stringify(payload('用一句话介绍你自己')),
})

console.log(`模型 ${MODEL_KEY} | 推理强度 ${EFFORT} | runtime_type 1（云）`)
console.log('HTTP', response.status, '|', response.headers.get('content-type'))
const raw = await response.text()
writeFileSync('_doubao-work-raw.txt', raw)

let text = ''
let convId = ''
const events = new Set()
for (const line of raw.split('\n')) {
  if (line.startsWith('event: ')) { events.add(line.slice(7).trim()); continue }
  if (!line.startsWith('data: ')) continue
  let j
  try { j = JSON.parse(line.slice(6)) } catch { continue }
  if (j?.ack_client_meta?.conversation_id) convId = j.ack_client_meta.conversation_id
  for (const op of j?.patch_op ?? []) {
    for (const b of op?.patch_value?.content_block ?? []) {
      const t = b?.content?.text_block?.text
      if (typeof t === 'string' && t !== '') text += t
    }
  }
  if (j?.error_code !== undefined) {
    console.log(`错误: ${String(j.error_code)} ${String(j.error_msg ?? '')}`)
  }
}
console.log('事件:', [...events].join(', '))
console.log('会话:', convId || '(无)')
console.log('回复:', text === '' ? '(空)' : text.slice(0, 400))
