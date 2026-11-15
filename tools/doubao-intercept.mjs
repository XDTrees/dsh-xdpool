/**
 * Let the PAGE send the request, with a body we supply.
 *
 * WHY THIS SHAPE
 *
 * The chat endpoint needs a per-request signature (`a_bogus`) and a session token
 * (`msToken`). Both are computed by the page at the moment it sends, and neither is
 * reachable from outside: the signature comes from `window.bdms.frontierSign`, and the
 * token is not in any cookie or storage the plugin can read. The maintained
 * reverse-engineering projects solve this by driving a HEADLESS browser purely to obtain
 * them — a heavy dependency for a plugin that already runs beside a browser.
 *
 * Reconstructing the URL by hand is what failed: the request answered
 * `710020202 common invalid param`, which names no field, and every shape tried failed
 * the same way.
 *
 * So the page is asked to make its OWN request, and only the BODY is replaced. The
 * interception happens at the DevTools protocol's request stage: the request is paused,
 * the body is swapped, and it continues. The URL, the signature and the token are the
 * page's own — which is the only combination the server accepts.
 *
 * This script is the proof of the arrangement. The plugin will do the same thing over the
 * same protocol.
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
  if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); return }
  if (msg.method === 'Fetch.requestPaused') {
    void handlePaused(msg.params)
  }
}

const MODEL = process.argv[2] ?? 'person-deepseek-v4-1-flash-261017'
const EFFORT = Number(process.argv[3] ?? 3)
const TEXT = process.argv[4] ?? '用一句话介绍你自己'

/**
 * The body to substitute.
 *
 * A transcription of a request the page sent, with the model, the text and the ids
 * replaced. The two families differ — the Doubao models carry `conversation_init_ext` and
 * `conversation_mode`, the `person-*` ones do not — and sending a model the other
 * family's shape is answered `710022004 rate limited`, which reads like quota exhaustion
 * and is not.
 */
function bodyFor(model, effort, text) {
  const isPerson = model.startsWith('person-')
  const botId = '7338286299411103781'
  const messageId = crypto.randomUUID()
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
  const memory = isPerson
    ? { memory_profile: '300k_230', total_window_size: '300000' }
    : { memory_profile: '256k', total_window_size: '256000' }
  const option = {
    send_message_scene: '', create_time_ms: Date.now(), collect_id: '', is_audio: false,
    answer_with_suggest: false, agent_mode: 1, tts_switch: false, need_deep_think: 10001,
    click_clear_context: false, from_suggest: false, is_regen: false, is_replace: false,
    is_from_click_option: false, is_from_click_softlink: false, disable_sse_cache: false,
    select_text_action: '', is_select_text: false, resend_for_regen: false, scene_type: 0,
    unique_key: crypto.randomUUID(), start_seq: 0, need_create_conversation: true,
    conversation_init_option: { need_ack_conversation: true },
    regen_query_id: [], edit_query_id: [], regen_instruction: '', no_replace_for_regen: false,
    message_from: 0, shared_app_name: '', shared_app_id: '',
    sse_recv_event_options: { support_chunk_delta: true }, support_lazy_fetch_stream: true,
    is_ai_playground: false, is_old_user: true,
    general_task_param: generalTaskParam,
    recovery_option: { is_recovery: false, req_create_time_sec: Math.floor(Date.now() / 1000), append_sse_event_scene: 0 },
    message_storage_type: 0, related_deleted_message_ids: {}, connector_info_list: [],
    model_config: { model_item_key: model, model_extra_params: memory, reasoning_effort: effort },
    aggregate_params: {
      mention_skill_list: '[]', mention_plugin_list: '[]', mention_ext: '[{}]',
      conversation_mode: '', mode_id: '3', model_item_key: model,
      agent_mode: '1', reasoning_effort: String(effort), provider_id: '',
    },
  }
  if (!isPerson) {
    option.conversation_init_ext = {
      agent_task_param: JSON.stringify(generalTaskParam.agent_task_param),
      model_item_key: model, reasoning_effort: String(effort), mode_id: '3',
    }
    option.conversation_mode = 2
  }
  return {
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
        content: { text_block: { text, icon_url: '', icon_url_dark: '', summary: '' }, pc_event_block: '' },
        block_id: crypto.randomUUID(), parent_id: '', meta_info: [], extra_info: {},
        append_fields: [], is_finish: true, patch_type: 2,
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
}

/** Handle a paused request: swap the body and let it continue. */
async function handlePaused(params) {
  const url = params.request.url
  const isChat = url.includes('/chat/completion')
  if (!isChat) {
    await send('Fetch.continueRequest', { requestId: params.requestId })
    return
  }
  const body = JSON.stringify(bodyFor(MODEL, EFFORT, TEXT))
  console.log('拦截到 chat/completion，替换 body，长度', body.length)
  await send('Fetch.continueRequest', {
    requestId: params.requestId,
    postData: Buffer.from(body, 'utf8').toString('base64'),
  })
}

await new Promise(resolve => { ws.onopen = resolve })
await send('Fetch.enable', {
  patterns: [{ urlPattern: '*/chat/completion*', requestStage: 'Request' }],
})
await send('Runtime.evaluate', {
  expression: "(() => { const pm = document.querySelector('.ProseMirror'); if (pm) pm.focus(); return true })()",
  returnByValue: true,
})
// 触发一次发送：用 CDP 的 insertText，编辑器认这个事件
await send('Input.insertText', { text: TEXT })
await new Promise(r => setTimeout(r, 1200))
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
await new Promise(r => setTimeout(r, 6000))
await send('Fetch.disable')
console.log('完成')
ws.close()
