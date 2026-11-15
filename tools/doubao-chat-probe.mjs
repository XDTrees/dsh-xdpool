/**
 * Send one message to Doubao with the cookies captured from a logged-in browser.
 *
 * This exists to answer ONE question before any of it is ported into the plugin: does the
 * captured session still work against the CURRENT endpoint? Everything else about the
 * integration depends on that, and the earlier QR path died at
 * `2035 非法请求`, so the answer cannot be assumed.
 *
 * Endpoint facts established from the maintained fork (SeiShonagon520/doubao2api):
 *
 *   - `/chat/completion`, NOT the old `/samantha/chat/completion`.
 *   - The body is a `content_block` array (not `content` + `content_type`), plus a
 *     `chat_ability` object and an `ext` block carrying the device fingerprint.
 *   - `x-tt-passport-csrf-token` is required alongside the cookies.
 *   - `sse_recv_event_options.support_chunk_delta` is what makes the stream emit text
 *     deltas rather than one final frame.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const BASE = 'https://www.doubao.com'
/**
 * The bot the web client talks to by default.
 *
 * `EXTENSION_BOT_ID` from the maintained client — the web chat surface, distinct from
 * `DEFAULT_BOT_ID` (7234781073513644036) which is the generic assistant used elsewhere.
 * Sending the wrong one does not error; it answers as a different agent, which is the
 * quiet kind of wrong.
 */
const BOT_ID = '7338286299411103781'
const cookies = JSON.parse(readFileSync('D:/dsh-home/_doubao-cookies.json', 'utf8'))
const UA = readFileSync('D:/dsh-home/_doubao-ua.txt', 'utf8').trim()
const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
const csrf = cookies['passport_csrf_token'] ?? ''

/** A device identity shaped like the reference implementation's. */
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

const device = deviceParams()

/** Query parameters every call carries. */
function securityParams() {
  const params = new URLSearchParams({
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
  })
  return params.toString()
}

/** One user message, in the block shape the current endpoint expects. */
function payload(text) {
  return {
    client_meta: {
      local_conversation_id: `local_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
      conversation_id: '',
      bot_id: BOT_ID,
      last_section_id: '',
      last_message_index: 0,
    },
    messages: [{
      local_message_id: randomUUID(),
      content_block: [{
        block_type: 10000,
        /**
         * The text lives in a `text_block` OBJECT, not a JSON string.
         *
         * The old `/samantha` payload carried `content: JSON.stringify({text})` plus
         * `content_type: 2001`; the current endpoint rejects that shape with
         * `710020202 common invalid param` — which names the parameter not at all, so the
         * only way to find this is to read the field off the maintained client.
         */
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
      tts_switch: false,
      need_deep_think: 0,
      click_clear_context: false,
      from_suggest: false,
      is_regen: false,
      is_replace: false,
      disable_sse_cache: false,
      select_text_action: '',
      resend_for_regen: false,
      scene_type: 0,
      unique_key: randomUUID(),
      start_seq: 0,
      need_create_conversation: true,
      conversation_init_option: { need_ack_conversation: true },
      regen_query_id: [],
      edit_query_id: [],
      regen_instruction: '',
      no_replace_for_regen: false,
      message_from: 0,
      shared_app_name: '',
      action_bar_skill_id: 0,
      sse_recv_event_options: { support_chunk_delta: true },
      is_ai_playground: false,
    },
    chat_ability: {},
    ext: {
      use_deep_think: '0',
      fp: device.fp,
      use_submit_pipeline: '1',
      commerce_credit_config_enable: '0',
      sub_conv_firstmet_type: '1',
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

console.log('HTTP', response.status, '| content-type:', response.headers.get('content-type'))
const raw = await response.text()
writeFileSync('_doubao-raw.txt', raw)
console.log('响应长度:', raw.length, '| 已存 D:\dsh-home\_doubao-raw.txt')

// A JSON body instead of SSE is a refusal, and the body says which one.
if (raw.trimStart().startsWith('{')) {
  console.log('\n=== 非 SSE 响应（通常是拒绝）===')
  console.log(raw.slice(0, 700))
  process.exitCode = 2
} else {
  // Keep the first frames whole; they carry the conversation id if nothing else.
  const lines = raw.split('\n').filter(l => l.trim() !== '')
  console.log('\n=== 前 12 行 ===')
  for (const line of lines.slice(0, 12)) console.log(line.slice(0, 200))
}
