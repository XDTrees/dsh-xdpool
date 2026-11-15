/**
 * Send a chat request FROM INSIDE the page, signed by the page.
 *
 * This is the arrangement that works, and the reasons are worth recording:
 *
 *   - `a_bogus` is a per-request signature computed by `window.bdms.frontierSign`. It is
 *     not a cookie and cannot be derived from one; the upstream checks it against the
 *     request. Without it every chat call is answered `710020202 common invalid param` —
 *     a complaint that names no field, which is why this looked like a payload problem.
 *   - `msToken` is a session token the page carries, also not a cookie.
 *
 * The maintained reverse-engineering projects solve this by running a HEADLESS browser
 * (Playwright) purely to sign. That is a heavy dependency, and unnecessary here: the user is
 * signed in in a real browser, and that browser can both sign and carry the token.
 *
 * So the plugin asks the page to sign and to send, over the DevTools protocol. The
 * alternative — reimplementing the signature in TypeScript — would mean porting the
 * anti-bot bundle, which changes on every deploy.
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

const MODEL = process.argv[2] ?? 'person-deepseek-v4-1-flash-261017'
const EFFORT = Number(process.argv[3] ?? 3)
const TEXT = process.argv[4] ?? '用一句话介绍你自己'

/**
 * The whole exchange, in one page-side expression.
 *
 * The body is a transcription of a request the page sent. The two families differ — the
 * Doubao models carry `conversation_init_ext` and `conversation_mode`, the `person-*` ones
 * do not — and sending a model the other family's shape is answered
 * `710022004 rate limited`, which reads like quota exhaustion and is not.
 */
const expression = `(async () => {
  const MODEL = ${JSON.stringify(MODEL)}
  const EFFORT = ${EFFORT}
  const TEXT = ${JSON.stringify(TEXT)}
  const isPerson = MODEL.startsWith('person-')
  const botId = '7338286299411103781'
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2))
  const messageId = uuid()

  const generalTaskParam = {
    action: 0, thread_local_message_id: [messageId], project_id: '', runtime_type: 1,
    agent_task_param: {
      runtime_type: 1, folder_name: '', device_name: '', workspace: '',
      local_app_id: '', local_device_id: '',
    },
    server_do_compare: true,
  }
  const memory = isPerson
    ? { memory_profile: '300k_230', total_window_size: '300000' }
    : { memory_profile: '256k', total_window_size: '256000' }

  const option = {
    send_message_scene: '', create_time_ms: Date.now(), collect_id: '', is_audio: false,
    answer_with_suggest: false, agent_mode: 1, tts_switch: false, need_deep_think: 10001,
    click_clear_context: false, from_suggest: false, is_regen: false, is_replace: false,
    is_from_click_option: false, is_from_click_softlink: false, disable_sse_cache: false,
    select_text_action: '', is_select_text: false, resend_for_regen: false, scene_type: 0,
    unique_key: uuid(), start_seq: 0, need_create_conversation: true,
    conversation_init_option: { need_ack_conversation: true },
    regen_query_id: [], edit_query_id: [], regen_instruction: '', no_replace_for_regen: false,
    message_from: 0, shared_app_name: '', shared_app_id: '',
    sse_recv_event_options: { support_chunk_delta: true }, support_lazy_fetch_stream: true,
    is_ai_playground: false, is_old_user: true,
    general_task_param: generalTaskParam,
    recovery_option: { is_recovery: false, req_create_time_sec: Math.floor(Date.now()/1000), append_sse_event_scene: 0 },
    message_storage_type: 0, related_deleted_message_ids: {}, connector_info_list: [],
    model_config: {
      model_item_key: MODEL, model_extra_params: memory, reasoning_effort: EFFORT,
    },
    aggregate_params: {
      mention_skill_list: '[]', mention_plugin_list: '[]', mention_ext: '[{}]',
      conversation_mode: '', mode_id: '3', model_item_key: MODEL,
      agent_mode: '1', reasoning_effort: String(EFFORT), provider_id: '',
    },
  }
  if (!isPerson) {
    option.conversation_init_ext = {
      agent_task_param: JSON.stringify(generalTaskParam.agent_task_param),
      model_item_key: MODEL, reasoning_effort: String(EFFORT), mode_id: '3',
    }
    option.conversation_mode = 2
  }

  const body = {
    client_meta: {
      conversation_id: '', bot_id: botId, last_section_id: '', last_message_index: null,
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
        content: { text_block: { text: TEXT, icon_url: '', icon_url_dark: '', summary: '' }, pc_event_block: '' },
        block_id: uuid(), parent_id: '', meta_info: [], extra_info: {}, append_fields: [],
        is_finish: true, patch_type: 2,
      }],
      message_status: 0,
    }],
    option,
    user_context: {},
    ext: {
      general_task_param: JSON.stringify(generalTaskParam),
      use_deep_think: '10001', agent_mode: '1', collection_id: '', is_finish: '1',
      commerce_credit_config_enable: '0',
    },
  }
  const payload = JSON.stringify(body)

  const params = new URLSearchParams({
    aid: '497858', real_aid: '497858', version_code: '20800',
    device_platform: 'web', doubao_device_platform: 'web',
    language: 'zh', region: 'CN', sys_region: 'CN',
    pkg_type: 'release_version', pc_version: '3.45.5', doubao_pc_version: '3.45.5',
    device_id: String(7707326032512615990n > 0 ? 7707326032512615990 : 7707326032512615990),
    web_id: '7707326040423597619', tea_uuid: '7707326040423597619',
    samantha_web: '1', web_platform: 'browser', 'use-olympus-account': '1',
    web_tab_id: uuid(),
  })
  let url = 'https://www.doubao.com/chat/completion?' + params.toString()

  // Sign it. The signature covers the payload, so it must be computed over the FINAL body.
  let signed = null
  try {
    const result = window.bdms.frontierSign({ 'X-MS-PAYLOAD': payload })
    if (result && result['X-Bogus']) signed = result['X-Bogus']
  } catch (e) {}

  const headers = { 'content-type': 'application/json', accept: 'text/event-stream', 'Agw-Js-Conv': 'str' }
  if (signed) headers['X-Bogus'] = signed
  // The token travels as a query parameter. The page computes it per request; asking the
  // page for the request it would make is the only way to get a fresh one.
  const msToken = (() => {
    try {
      const cached = localStorage.getItem('__tea_cache_tokens_497858')
      if (cached) {
        const o = JSON.parse(cached)
        if (o && o.msToken) return o.msToken
      }
    } catch {}
    try {
      const c = window.byted_acrawler && window.byted_acrawler.getToken
      if (typeof c === 'function') return c()
    } catch {}
    return null
  })()
  if (msToken) params.set('msToken', msToken)
  url = 'https://www.doubao.com/chat/completion?' + params.toString()

  // One parameter set, one URL: the earlier version appended the parameters twice and
  // the server answered '710020202 common invalid param'.
  const response = await fetch(url, {
    method: 'POST', headers, body: payload, credentials: 'include',
  })
  const raw = await response.text()
  return JSON.stringify({ status: response.status, signed: !!signed, msToken: !!msToken, len: raw.length, raw: raw.slice(0, 30000) })
})()`

const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
const value = result?.result?.value
if (typeof value !== 'string') {
  console.log('异常:', JSON.stringify(result?.exceptionDetails?.exception?.description ?? result).slice(0, 400))
  process.exitCode = 1
} else {
  const parsed = JSON.parse(value)
  console.log(`模型 ${MODEL} | HTTP ${parsed.status} | 签名 ${parsed.signed ? '有' : '无'} | msToken ${parsed.msToken ? '有' : '无'} | ${parsed.len} 字符`)
  let text = ''
  let convId = ''
  for (const line of parsed.raw.split('\n')) {
    if (!line.startsWith('data: ')) continue
    let j
    try { j = JSON.parse(line.slice(6)) } catch { continue }
    if (j?.ack_client_meta?.conversation_id) convId = j.ack_client_meta.conversation_id
    if (j?.error_code !== undefined) console.log(`错误 ${String(j.error_code)} ${String(j.error_msg ?? '')}`)
    for (const op of j?.patch_op ?? []) {
      for (const b of op?.patch_value?.content_block ?? []) {
        const t = b?.content?.text_block?.text
        if (typeof t === 'string' && t !== '') text += t
      }
    }
  }
  console.log('会话:', convId || '(无)')
  console.log('回复:', text === '' ? '(空)' : text.slice(0, 300))
}
ws.close()
