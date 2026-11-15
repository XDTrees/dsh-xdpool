/**
 * Send the work-mode request FROM INSIDE the page.
 *
 * WHY FROM INSIDE
 *
 * A hand-written payload produced `710020202 common invalid param` — a complaint that names
 * no field, so the only way to find the difference is to compare against something the
 * page itself produced. But the page's own request cannot be replayed either, because it
 * carries a fresh device identity and a live CSRF token.
 *
 * Executing the fetch in the page sidesteps the whole question: the browser supplies its
 * own cookies, its own `msToken`, and whatever headers its own code adds, so the request
 * is the same kind the page makes. What is left to supply is only the payload — and the
 * payload can be taken from the bundle's own model table.
 *
 * The bundle defines the work models as:
 *
 *   key              name            modes                window
 *   0                豆包 快速        chat, creation       —
 *   3                豆包 专家        chat, creation       128000
 *   9                自动             office, creation     256000
 *   seed-lite-7b     豆包 2.1 Lite    office, creation     256000
 *   5                豆包 2.1 Pro     office, creation     256000
 *
 * Run: node tools/doubao-inpage.mjs [model_item_key] [effort]
 */
const MODEL_KEY = process.argv[2] ?? 'seed-lite-7b'
const EFFORT = Number(process.argv[3] ?? 8)

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = targets.find(t => t.type === 'page' && t.url.includes('doubao.com'))
if (page === undefined) { console.log('没有豆包页面'); process.exit(1) }

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

/**
 * The expression evaluated IN the page.
 *
 * It builds the work-mode payload and posts it, returning the raw SSE text. Everything
 * credential-shaped comes from the page's own context.
 */
const expression = `(async () => {
  const text = '用一句话介绍你自己'
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2))
  const messageId = uuid()
  const generalTaskParam = {
    action: 0,
    thread_local_message_id: [messageId],
    project_id: '',
    runtime_type: 1,
    agent_task_param: {
      runtime_type: 1, folder_name: '', device_name: '', workspace: '',
      local_app_id: '', local_device_id: '',
    },
    server_do_compare: true,
  }
  const body = {
    client_meta: {
      local_conversation_id: 'local_' + uuid().replaceAll('-','').slice(0,16),
      conversation_id: '',
      bot_id: '7338286299411103781',
      last_section_id: '',
      last_message_index: null,
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
        content: { text_block: { text, icon_url: '', icon_url_dark: '', summary: '' }, pc_event_block: '' },
        block_id: uuid(), parent_id: '', meta_info: [], append_fields: [], is_finish: true, patch_type: 2,
      }],
      message_status: 0,
    }],
    option: {
      send_message_scene: '', create_time_ms: 0, collect_id: '', is_audio: false,
      answer_with_suggest: true, agent_mode: 1, tts_switch: false, need_deep_think: 10001,
      click_clear_context: false, from_suggest: false, is_regen: false, is_replace: false,
      is_from_click_option: false, is_from_click_softlink: false, disable_sse_cache: false,
      select_text_action: '', is_select_text: false, resend_for_regen: false, scene_type: 0,
      unique_key: uuid(), start_seq: 0, need_create_conversation: true,
      conversation_init_option: { need_ack_conversation: true },
      conversation_init_ext: { project_id: '', need_ack_conversation: true },
      regen_query_id: [], edit_query_id: [], regen_instruction: '', no_replace_for_regen: false,
      message_from: 0, shared_app_name: '', shared_app_id: '',
      sse_recv_event_options: { support_chunk_delta: true },
      support_lazy_fetch_stream: true, is_ai_playground: false, is_old_user: false,
      general_task_param: generalTaskParam,
      recovery_option: {}, message_storage_type: 1, related_deleted_message_ids: [],
      connector_info_list: [],
      model_config: {
        model_item_key: ${JSON.stringify(MODEL_KEY)},
        model_extra_params: { memory_profile: '256k', total_window_size: '256000' },
        reasoning_effort: ${EFFORT},
      },
      aggregate_params: {
        mention_skill_list: '[]', mention_plugin_list: '[]', mention_ext: '[{}]',
        conversation_mode: '2', mode_id: '3',
        model_item_key: ${JSON.stringify(MODEL_KEY)}, agent_mode: '1',
        reasoning_effort: '${EFFORT}', provider_id: '',
      },
      conversation_mode: 2,
    },
    user_context: {},
    ext: {
      general_task_param: JSON.stringify(generalTaskParam),
      use_deep_think: '9', agent_mode: '1',
      conversation_init_option: JSON.stringify({ project_id: '', need_ack_conversation: true }),
      sub_conv_firstmet_type: '1', collection_id: '', is_finish: '1',
      commerce_credit_config_enable: '0',
    },
  }
  // The same query the page sends.
  const params = new URLSearchParams({
    aid: '497858', real_aid: '497858',
    device_id: '7000000000000000', tea_uuid: '7000000000000000',
    web_id: '7600000000000000000', device_platform: 'web', language: 'zh',
    region: 'CN', sys_region: 'CN', pkg_type: 'release_version', version_code: '20800',
    pc_version: '2.1.7', chromium_version: '148.0.7816.0', client_platform: 'pc_client',
    runtime: 'web', runtime_version: '3.5.4', samantha_web: '1',
    'use-olympus-account': '1', fp: 'verify_probe_probe_probe_probe',
    web_tab_id: uuid(),
  })
  const response = await fetch('/chat/completion?' + params.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
    credentials: 'include',
  })
  const raw = await response.text()
  return JSON.stringify({ status: response.status, type: response.headers.get('content-type'), raw: raw.slice(0, 40000) })
})()`

const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
const raw = result?.result?.value
if (typeof raw !== 'string') {
  console.log('页面内异常:', JSON.stringify(result?.exceptionDetails?.exception?.description ?? result).slice(0, 400))
  process.exitCode = 1
} else {
  const parsed = JSON.parse(raw)
  console.log(`模型 ${MODEL_KEY} | effort ${EFFORT} | HTTP ${parsed.status} | ${parsed.type}`)
  let text = ''
  let convId = ''
  const events = new Set()
  for (const line of parsed.raw.split('\n')) {
    if (line.startsWith('event: ')) { events.add(line.slice(7).trim()); continue }
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
  console.log('事件:', [...events].join(', '))
  console.log('会话:', convId || '(无)')
  console.log('回复:', text === '' ? '(空)' : text.slice(0, 300))
}
ws.close()
