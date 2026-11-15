/**
 * Doubao upstream client.
 *
 * Endpoint: POST https://www.doubao.com/chat/completion
 *
 * Three request details decide whether the call succeeds or is challenged with
 * a slider CAPTCHA (verified in M2 — getting any of them wrong silently turns a
 * working session into `710022004 rate limited`):
 *
 *   1. User-Agent must carry the `SamanthaDoubao/<version>` suffix.
 *   2. Referer must be the `chrome://doubao-chat/` scheme, NOT an https URL.
 *   3. sec-ch-ua must use the real client-hints brand string.
 *
 * No `a_bogus` signature is required; the server accepts a cookie-authenticated
 * request without it.
 *
 * The response is a ByteDance-specific streaming variant, NOT standard SSE.
 * Frames are three lines — `id:`, `event:`, `data:` — followed by a blank
 * line, so a generic `data:`-only SSE parser silently drops everything.
 */
import { randomUUID } from 'node:crypto'
import { hostname, homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildHeaders as buildAuthHeaders,
  cookieHeader,
  sessionUsable,
  type DoubaoSession,
} from './doubao-auth.ts'

/**
 * The reference implementation's credential shape, adapted onto this plugin's session.
 *
 * Its `credentials` carry a `pairs` map plus a ready-made header; this plugin's session
 * carries the same map and builds the header on demand. `toCredentials` bridges them so the
 * upstream code below stays exactly as measured — every function it calls here was verified
 * against the live service, and rewriting them would throw that evidence away.
 */
function toCredentials(session: DoubaoSession): {
  pairs: Map<string, string>
  header: string
  userAgent: string
} {
  return {
    pairs: new Map(Object.entries(session.cookies)),
    header: cookieHeader(session),
    userAgent: session.userAgent,
  }
}

/** The credential shape the upstream code below was written against. */
export interface DoubaoCredentials {
  pairs: Map<string, string>
  header: string
  userAgent: string
}

/**
 * How a session reaches the upstream.
 *
 * The reference implementation loads a sealed credential file; this plugin keeps one session
 * in memory and in its own store, and the route injects it. A module-level holder is what lets
 * the unchanged upstream code call `loadDoubaoCredentials()` and still be given THIS plugin's
 * session — the alternative is threading a session parameter through a thousand lines that
 * were verified as they stand.
 */
let activeSession: DoubaoSession | undefined

/** Point the upstream at a session. Called by the routes and by startup restore. */
export function setDoubaoSession(session: DoubaoSession | undefined): void {
  activeSession = session
}

/** The session currently in use, if any. */
export function currentDoubaoSession(): DoubaoSession | undefined {
  return activeSession
}

/** Throw when there is no session, with the sentence the card shows. */
export function requireDoubaoCredentials(): DoubaoCredentials {
  if (activeSession === undefined || !sessionUsable(activeSession)) {
    throw new Error('还没有浏览器登录态。请在豆包卡片里点「重新登录」扫码一次。')
  }
  return toCredentials(activeSession)
}

/** The reference's loader, answered from this plugin's session. */
function loadDoubaoCredentials(): DoubaoCredentials {
  return requireDoubaoCredentials()
}

/** The reference's cookie-name list, as this plugin knows it. */
const REQUIRED_COOKIE_NAMES: readonly string[] = ['sessionid', 'sid_tt', 'uid_tt']

/** No desktop app is involved in this lane, so there is no user-data directory to find. */
function findDoubaoUserDataDir(): string | undefined {
  return undefined
}
import {
  CHAT_AGENT_MODE,
  TASK_AGENT_MODE,
  CREATION_BLOCK_TYPE,
  DOUBAO_CONTEXT_WINDOW,
  DOUBAO_IMAGE_MODEL_ID,
  type DoubaoSkillName,
  findDoubaoModel,
  findReasoningLevel,
  inputSkillOf,
  isTaskModel,
  levelIdOf,
  needDeepThinkValue,
  TASK_RUNTIME_LOCAL_PC,
  TASK_SANDBOX_AUTH_ALLOW_ALL,
} from './doubao-catalog.ts'

export const CHAT_ENDPOINT = 'https://www.doubao.com/chat/completion'
export const QUOTA_ENDPOINT =
  'https://www.doubao.com/alice/commerce/sale/subscription/quota/summary/'
export const ACCOUNT_ENDPOINT = 'https://www.doubao.com/passport/account/info/v2/'
export const TOOL_LOCAL_ACK_ENDPOINT = 'https://www.doubao.com/alice/office/tool_local/msg/ack'
export const TOOL_LOCAL_UPLOAD_ENDPOINT =
  'https://www.doubao.com/alice/office/tool_local/upload_command_result'
export const TOOL_LOCAL_COMPLETE_ENDPOINT =
  'https://www.doubao.com/alice/office/tool_local/msg/complete'
export const ACTION_BAR_BRIEF_LIST_ENDPOINT =
  'https://www.doubao.com/alice/slot/action_bar_v3/brief_list'

/**
 * Client version strings. These are the desktop app build this was last
 * verified against (M9), and they MOVE with every Doubao release — a newer app
 * sends different values here and a very old one will eventually stop being
 * accepted. Re-check them whenever Doubao auto-updates; the risk-control layer
 * compares them against the session it sees.
 */
export const DOUBAO_VERSION = '2.31.4'
export const RUNTIME_VERSION = '3.39.0'
const CHROMIUM_VERSION = '147.0.7727.149'

/**
 * Frozen, non-secret client identity.
 *
 * These are constant across Doubao sessions and are NOT credentials. Keeping
 * them fixed is what makes an external request look like the same install to
 * the risk-control layer.
 */
export const CLIENT_PARAMS = {
  aid: '582478',
  real_aid: '582478',
  version_code: '20800',
  pc_version: DOUBAO_VERSION,
  device_id: '2697515174213273',
  tea_uuid: '2697515174213273',
  web_id: '7677868049198630415',
  fp: 'verify_2697515174213273',
  chromium_version: CHROMIUM_VERSION,
  runtime_version: RUNTIME_VERSION,
  channel: 'win',
  language: 'zh',
  region: 'CN',
  sys_region: 'CN',
  tz_name: 'Asia/Shanghai',
  pkg_type: 'release_version',
  client_platform: 'pc_client',
  device_platform: 'web',
  doubao_device_platform: 'desktop',
  web_platform: 'desktop',
  samantha_web: '1',
  'use-olympus-account': '1',
} as const

/** The default Doubao assistant; content routing means the model is chosen server-side. */
export const DEFAULT_BOT_ID = '7338286299411103781'

/** Headers that make an external request indistinguishable from the app's. */
export function buildHeaders(
  credentials: DoubaoCredentials,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      `Chrome/147.0.0.0 Safari/537.36 SamanthaDoubao/${DOUBAO_VERSION}`,
    Referer: 'chrome://doubao-chat/',
    accept: '*/*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'agw-js-conv': 'str',
    'x-flow-trace': `${randomUUID().replace(/-/g, '')}-${randomUUID().replace(/-/g, '')}-01`,
    'last-event-id': 'undefined',
    // Rotate cookies the server handed back on earlier responses
    // (x-ms-token / bd_sso_hi3jfd) so a long-lived session stays valid.
    cookie: applyRenewals(credentials.header),
    ...extra,
  }
}

export function buildQueryUrl(endpoint: string, msToken?: string): string {
  const params = new URLSearchParams({ ...CLIENT_PARAMS, web_tab_id: randomUUID() })
  if (msToken) params.set('msToken', msToken)
  return `${endpoint}?${params.toString()}`
}

export interface DoubaoMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface DoubaoUsage {
  /** Input + output token accounting when the server reports it. */
  promptTokens?: number
  completionTokens?: number
}

/** Server-reported context window breakdown from Doubao's `context_window_usage`. */
export interface DoubaoContextWindowUsage {
  systemPrompt: number
  messages: number
  skills: number
  tools: number
  totalWindowSize: number
  /** Sum of systemPrompt + messages + skills + tools reported by upstream. */
  totalUsed: number
}

/** Optional timing and window telemetry emitted on upstream SSE frames. */
export interface DoubaoUpstreamTelemetry {
  contextWindowUsage?: DoubaoContextWindowUsage
  ackCostMs?: number
  firstPacketCostMs?: number
  finishTimeMs?: number
  finishReasonChat?: string
}

/** One generated image from a creation block (`block_type: 2074`). */
export interface DoubaoImage {
  /** Server task id for this creation. */
  taskId?: string
  /** Stable asset key, e.g. `tos-cn-i-…/rc_gen_image/<uuid>.jpeg`. */
  key?: string
  /** Best available URL: original > preview > thumb. */
  url: string
  width?: number
  height?: number
}

export interface DoubaoChatResult {
  text: string
  /** Model identifier reported by the server for this reply, if any. */
  model?: string
  conversationId?: string
  messageId?: string
  reasoningText?: string
  /** True when the server routed to a thinking-capable model. */
  thinking: boolean
  /**
   * Images produced by a skill turn (`input_skill: imageGen`).
   *
   * Empty unless the request asked for a creation. The URLs are signed but
   * long-lived (`x-expires` in 2037 on the captured ones), so they can be
   * handed straight to the user or downloaded.
   */
  images: DoubaoImage[]
  /**
   * The agent the server says served this turn (`intention_agent_name`).
   *
   * Not a model identifier — it names the server-side AGENT, which is how a
   * 「工作任务」 turn becomes visible at all: chat turns and task turns use the
   * same endpoint and the same stream, and this field is the only read-back
   * evidence of which one was actually used.
   */
  intentionAgent?: string
  /** Server-side telemetry parsed from `ext.context_window_usage` and timing tags. */
  telemetry?: DoubaoUpstreamTelemetry
}

/**
 * Extra evidence about a failure, carried on the error itself.
 *
 * Classification needs more than the business code: an HTTP status, whether
 * the transport (fetch/reader) failed, and whether the answer was cut off all
 * map to different kinds and different retry decisions. Keeping that evidence
 * on the error means the classifier never has to re-derive it from a message
 * string, and a throw site can declare its own class when the shape is
 * unusual (`kind`).
 */
export interface DoubaoUpstreamErrorMeta {
  /** HTTP status of the failing response, when there was one. */
  httpStatus?: number
  /** The socket/fetch itself failed — the server never answered. */
  transport?: boolean
  /** The stream ended before the reply did: the answer is partial. */
  truncated?: boolean
  /** Classify as this kind regardless of code/status. */
  kind?: DoubaoErrorKind
}

export class DoubaoUpstreamError extends Error {
  readonly httpStatus: number | undefined
  readonly transport: boolean
  readonly truncated: boolean
  readonly kindHint: DoubaoErrorKind | undefined

  constructor(
    message: string,
    readonly code?: number,
    readonly rateLimited = false,
    meta: DoubaoUpstreamErrorMeta = {},
  ) {
    super(message)
    this.name = 'DoubaoUpstreamError'
    this.httpStatus = meta.httpStatus
    this.transport = meta.transport === true
    this.truncated = meta.truncated === true
    this.kindHint = meta.kind
  }
}

/** Per-request knobs. Every field is optional and every default reproduces the
 *  desktop app's own behaviour, so an un-parameterised call is unchanged. */
export interface ChatRequestOptions {
  /** Continue an existing conversation instead of opening a new one. */
  conversationId?: string
  /**
   * The `model_item_key` to request — one of {@link DOUBAO_MODELS}.
   *
   * Defaults to 自动, matching what the app sends when the user has not chosen.
   * Forwarded VERBATIM: the values are a mix of string slugs and numeric enums,
   * so they must never be parsed to a number.
   */
  modelKey?: string
  /**
   * Doubao SKILL to run the turn under — the capability axis.
   *
   * Orthogonal to `modelKey`: `imageGen` (3) makes Doubao answer with a
   * creation block (real generated images) while still riding the chat
   * endpoint. Verified live 2026-11-02: `input_skill: {skill_id:"3",
   * skill_type:3}` returns `rc_gen_image/*.jpeg` from Seedream 5.0.
   */
  skill?: DoubaoSkillName
  /**
   * Reasoning effort: `low` | `mid` | `high`, mapping to `reasoning_effort`
   * 3 / 4 / 5.
   *
   * Defaults to 高 (5), the level the desktop app itself starts on. All three
   * values were read off the running client — see {@link DOUBAO_REASONING_LEVELS}.
   */
  reasoningLevel?: 'low' | 'mid' | 'high' | 'xhigh' | 'max'
  /**
   * `option.agent_mode` / `ext.agent_mode`.
   *
   * VERIFIED: the desktop app sends 1 for BOTH ordinary chat and a 「工作任务」
   * (a real 2026-09-15 task request carries 1). Kept explicit so these small
   * integers are never confused with the numeric model keys, which are also
   * small integers.
   */
  agentMode?: number
  /**
   * Send the request as a 「工作任务 · 本地电脑」 instead of a plain chat.
   *
   * DEFAULTS TO TRUE. The whole point of this route is that the executing
   * machine is this one, which is where the Harness already runs its tools; the
   * cloud VM runtime (`runtime_type: 1`) puts execution somewhere we cannot
   * reach.
   *
   * What travels: `ext.general_task_param` as a JSON *string* — the client's own
   * shape, transcribed from a captured request. Its presence is what makes the
   * server treat the turn as a task (the client's `is_general_task` check is
   * `!!ext.general_task_param`); `agent_mode` stays 1.
   *
   * Set `DSH_DOUBAO_TASK=0` in the host environment to fall back to plain chat
   * without a rebuild — the escape hatch for a server-side rejection.
   */
  taskMode?: boolean
  /**
   * Ask for the 深度思考 pass (probe knob; see `buildChatBody`).
   */
  deepThink?: boolean
  /**
   * Continue the conversation named by {@link ChatRequestOptions.conversationId}
   * instead of opening a new one.
   *
   * The client sends `need_create_conversation: false` plus the id it got back;
   * omitting both starts a fresh thread. Set by the shim from its own
   * conversation store (see `doubao-session.ts`).
   */
  continueConversation?: boolean
  /**
   * Directory the task declares as its workspace.
   *
   * The cloud plans against these paths, so they must be real on THIS machine.
   * Defaults to `DSH_DOUBAO_WORKSPACE`, then `process.cwd()`.
   */
  workspace?: string
}

/* ------------------------------------------------------------------ *
 * 「工作任务 · 本地电脑」
 * ------------------------------------------------------------------ */

/**
 * Stable-per-process id that rides along as `client_env_id`.
 *
 * The client generates one per app environment; ours is per host process so a
 * restart looks like a new environment, which is exactly what it is.
 */
const CLIENT_ENV_ID = randomUUID()

/** Whether a request asks for local-PC task mode. Default: OFF — see below. */
export function taskModeEnabled(options: ChatRequestOptions): boolean {
  if (options.taskMode !== undefined) return options.taskMode
  // Selecting a 「工作任务」 model (2.1 Lite = seed-lite-7b, 2.1 Pro = 5, 自动 = 9)
  // automatically switches the turn into task mode (mode_id: "3", agent_mode: 1).
  if (isTaskModel(options.modelKey)) return true
  const flag = process.env.DSH_DOUBAO_TASK
  return flag === undefined ? false : /^(1|true|on|yes)$/i.test(flag.trim())
}

/** The directory this machine declares to the task runtime. */
export function taskWorkspaceOf(options: ChatRequestOptions): string {
  return options.workspace ?? process.env.DSH_DOUBAO_WORKSPACE ?? process.cwd()
}

/**
 * Build `ext.general_task_param` — the field that makes a turn a 工作任务.
 *
 * Transcribed field-for-field from a real 「工作任务 · 本地电脑」 request the
 * desktop client sent on 2026-09-15 (recovered from the app's own IndexedDB
 * message store), then reduced to what is portable:
 *
 *   thread_local_message_id  the local message id being submitted
 *   client_option            the workspace and the sandbox/authorisation policy
 *   runtime_type             2 — Local_PC; the cloud VM would be 1
 *   agent_task_param         the same facts again, device-side
 *   agent_task_param_change  all false: nothing is being switched mid-thread
 *
 * Paths are computed from THIS machine rather than copied, because the cloud
 * plans against them: a workspace that does not exist here would make the task
 * fail inside the runtime instead of at submit time. `local_device_id` and
 * `local_app_id` reuse the frozen client identity already in {@link CLIENT_PARAMS}
 * — the captured request carries the same two values, so they are the same
 * install identity and not per-request state.
 */
export function buildGeneralTaskParam(
  localMessageId: string,
  workspace: string,
  prompt?: string,
): Record<string, unknown> {
  const userData = findDoubaoUserDataDir()
  const agentWorkspace = userData === undefined
    ? join(tmpdir(), 'dsh-doubao-agent-workspace')
    : join(userData, 'Default', '.doubao', 'agent_mode', 'workspace')
  return {
    thread_local_message_id: [localMessageId],
    client_option: {
      shared_folder_path: [workspace, agentWorkspace],
      enable_sandbox: true,
      os: process.platform === 'win32' ? 'Windows' : process.platform,
      client_env_id: CLIENT_ENV_ID,
      sandbox_id: `route-${randomUUID()}`,
      workspace,
      agent_workspace: {
        agent_workspace: agentWorkspace,
        local_skill_paths: [join(homedir(), 'Doubao', 'skills'), join(homedir(), '.agents', 'skills')],
      },
      sandbox_auth_type: TASK_SANDBOX_AUTH_ALLOW_ALL,
    },
    runtime_type: TASK_RUNTIME_LOCAL_PC,
    need_modify_conversation: false,
    agent_task_param: {
      runtime_type: TASK_RUNTIME_LOCAL_PC,
      device_name: hostname(),
      workspace,
      local_device_id: CLIENT_PARAMS.device_id,
      local_app_id: CLIENT_PARAMS.aid,
      sandbox_auth_type: TASK_SANDBOX_AUTH_ALLOW_ALL,
    },
    agent_task_param_change: {
      runtime_changed: false,
      device_changed: false,
      sandbox_auth_type_changed: false,
    },
    ...(prompt !== undefined
      ? { task_input_json: JSON.stringify({ text: prompt, files: [], skills: [] }) }
      : {}),
  }
}

/**
 * Build the request body Doubao's chat endpoint expects.
 *
 * The model and the reasoning effort are each written at TWO locations, because
 * that is what the app does and what upstream reads. Writing only one is
 * silently ignored — the request succeeds and the answer comes from whatever
 * the server last used.
 *
 * `general_task_param` is deliberately absent: it carries the desktop app's
 * local sandbox and workspace paths, none of which apply to an external client,
 * and the endpoint has been observed answering correctly without it.
 */
/**
 * Add the 「生成图片：」 prefix that Doubao's image skill requires.
 *
 * The desktop app gets this for free: its `chat_ability.ability_param` carries
 * `reply_message_format: "生成图片：%s"`, which rewrites the outgoing text before
 * the request leaves. An external client has no such hook, so the same rewrite
 * happens here. Without it the server treats the turn as ordinary chat and
 * answers with prose instead of drawing.
 *
 * Deliberately ONLY the prefix: appending extra instructions makes Doubao read
 * them as part of the subject and drop the picture entirely (measured).
 */
export function withImagePrefix(prompt: string, options: ChatRequestOptions = {}): string {
  const isImageTurn = options.skill === 'imageGen' || options.modelKey === DOUBAO_IMAGE_MODEL_ID
  if (!isImageTurn) return prompt
  if (/^\s*(生成图片|生成一张|画一张|画个|绘制)/.test(prompt)) return prompt
  return `生成图片：${prompt}`
}

export function buildChatBody(prompt: string, options: ChatRequestOptions = {}) {
  prompt = withImagePrefix(prompt, options)
  const model = findDoubaoModel(options.modelKey)
  const level = findReasoningLevel(options.reasoningLevel)
  const task = taskModeEnabled(options)
  // A DISCOVERED 「工作任务」 model (a third-party `person-*` slug, say) is not in
  // the static catalog, so `isTaskModel` cannot recognise it; the shim resolves
  // that case from the live catalog and passes it down as `taskMode`.
  const taskModelSelected = isTaskModel(model.id) || options.taskMode === true
  /**
   * Deep-thinking toggle, for probing only.
   *
   * The captured ordinary turn sends `need_deep_think: 0`; the client's 深度思考
   * switch is what turns this on, and the value it sends there has NOT been
   * captured yet. `DSH_DOUBAO_DEEP_THINK=1` reproduces the old 10000+level shape
   * so the resulting stream can be inspected.
   *
   * In 「工作任务」 mode (`seed-lite-7b`, `5`, `9`), captured requests send `10001`.
   */
  const deepThink = options.deepThink === true ||
    (options.deepThink === undefined && process.env.DSH_DOUBAO_DEEP_THINK === '1')
  const needDeepThink = taskModelSelected && options.deepThink === undefined
    ? 10001
    : needDeepThinkValue(deepThink)
  /**
   * 2 = 普通对话, 1 = 「工作任务」.
   *
   * CDP-captured from the running client on 2026-10-22. This constant was the
   * bug: the plugin sent 1 for chat, so the server answered every turn as a work
   * task — `Agent-GeneralTask`, then `710010702` because the task runtime used
   * to be the desktop app's own CUA process. Task turns now complete through the
   * `tool_local` responder, which is why `TASK_AGENT_MODE` is safe to send.
   */
  const agentMode = options.agentMode ?? (task ? TASK_AGENT_MODE : CHAT_AGENT_MODE)
  const localMessageId = randomUUID()
  /**
   * Mode id the model picker groups by. The captured chat request carries "1" in
   * BOTH `conversation_init_ext` and `aggregate_params`, whereas 「工作任务」
   * models (`seed-lite-7b`, `5`, `9`) carry "3".
   */
  // Grouped by whether this turn is a 工作任务, not by whether the id is a catalog
  // entry: a discovered task model needs mode_id "3" exactly like 2.1 Pro does.
  const modeId = (process.env.DSH_DOUBAO_MODE_ID ?? '').trim() || (task ? '3' : '1')
  /**
   * The client's own default for `general_task_param` on an ordinary turn.
   *
   * NOTE the shape: an OBJECT inside `option` and the same thing STRINGIFIED
   * inside `ext`. That asymmetry is the client's, not a mistake here.
   */
  const plainTaskParam = { server_do_compare: true }
  const taskParam = task
    ? buildGeneralTaskParam(
        localMessageId,
        taskWorkspaceOf(options),
        taskModelSelected ? prompt : undefined,
      )
    : plainTaskParam
  const modelExtraParams: Record<string, string> = taskModelSelected
    ? {
        input_token_limit: '256k',
        ...(model.id === 'seed-lite-7b' ? { reasoning_effort: levelIdOf(level.level) } : {}),
      }
    : {}

  return {
    messages: [
      {
        local_message_id: localMessageId,
        message_status: 0,
        content_block: [
          {
            block_type: 10000,
            block_id: randomUUID(),
            parent_id: '',
            meta_info: [],
            append_fields: [],
            content: {
              text_block: { text: prompt, icon_url: '', icon_url_dark: '', summary: '' },
              pc_event_block: '',
            },
          },
        ],
      },
    ],
    option: {
      send_message_scene: '',
      create_time_ms: Date.now(),
      collect_id: '',
      is_audio: false,
      answer_with_suggest: false,
      agent_mode: agentMode,
      tts_switch: false,
      // 0 on an ordinary turn. The level itself travels in `reasoning_effort`;
      // this is the (off) 深度思考 toggle, worth 10000+level when on.
      need_deep_think: needDeepThink,
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
      // A continuation reuses the server-side thread: `false` + the id it issued.
      // Anything else starts a new conversation.
      need_create_conversation: options.continueConversation !== true,
      conversation_init_option: { need_ack_conversation: true },
      ...(taskModelSelected && options.continueConversation !== true
        ? { conversation_mode: 2 }
        : {}),
      // The model and the mode are declared here as well as in `model_config`.
      // The captured request does both; the server reads this pair first.
      conversation_init_ext: {
        model_item_key: model.id,
        reasoning_effort: String(level.level),
        mode_id: modeId,
      },
      regen_query_id: [],
      edit_query_id: [],
      regen_instruction: '',
      no_replace_for_regen: false,
      message_from: 0,
      shared_app_name: '',
      shared_app_id: '',
      // Ask for incremental blocks so STREAM_CHUNK deltas actually arrive.
      sse_recv_event_options: { support_chunk_delta: true },
      support_lazy_fetch_stream: true,
      is_ai_playground: false,
      is_old_user: true,
      general_task_param: taskParam,
      recovery_option: {
        is_recovery: false,
        req_create_time_sec: Math.floor(Date.now() / 1000),
        append_sse_event_scene: 0,
      },
      message_storage_type: 0,
      related_deleted_message_ids: {},
      connector_info_list: [],
      model_config: {
        model_item_key: model.id,
        // Empty in the captured chat request; in 「工作任务」 mode, carries
        // `input_token_limit: "256k"` (and `reasoning_effort` for seed-lite-7b).
        model_extra_params: modelExtraParams,
        reasoning_effort: level.level,
      },
      aggregate_params: {
        mention_skill_list: '[]',
        mention_plugin_list: '[]',
        mention_ext: '[{}]',
        // The captured deep-think request carries "1" here while an ordinary turn
        // carries "". Without it the 10040 thinking block still appears in the
        // stream but stays empty (`deep_think_intention: "0"`), i.e. the server
        // opens the shell and skips the thinking.
        conversation_mode: taskModelSelected && options.continueConversation !== true
          ? '2'
          : deepThink
            ? '1'
            : '',
        mode_id: modeId,
        model_item_key: model.id,
        agent_mode: String(agentMode),
        reasoning_effort: String(level.level),
        provider_id: '',
      },
    },
    client_meta: {
      local_conversation_id: `local_${randomUUID()}`,
      conversation_id: options.conversationId ?? '',
      bot_id: DEFAULT_BOT_ID,
      last_section_id: '',
      last_message_index: null,
      // The client reports the permissions it holds; the server echoes them into
      // its own telemetry. Shape copied verbatim from the capture.
      local_permissions: [
        { permission_name: 'ACCESS_COARSE_LOCATION', status: 1 },
        { permission_name: 'ACCESS_FINE_LOCATION', status: 1 },
        { permission_name: 'ACCESS_BACKGROUND_LOCATION', status: 1 },
      ],
    },
    user_context: [],
    ext: {
      agent_mode: String(agentMode),
      use_deep_think: String(needDeepThink),
      sub_conv_firstmet_type: '1',
      general_task_param: JSON.stringify(taskParam),
      collection_id: '',
      is_finish: '1',
      conversation_init_option: JSON.stringify({ need_ack_conversation: true }),
      commerce_credit_config_enable: '0',
      // The skill axis. Absent (or "0") is ordinary chat; `imageGen` turns the
      // reply into a creation block with generated images. A JSON STRING — the
      // client stringifies it the same way, and a nested object is a shape the
      // server never sees from the app.
      ...(() => {
        const encoded = inputSkillOf(options.skill)
        return encoded === undefined ? {} : { input_skill: encoded }
      })(),
    },
  }
}

/* ------------------------------------------------------------------ *
 * Stream parsing
 * ------------------------------------------------------------------ */

interface StreamFrame {
  id?: string
  event?: string
  data: string
}

/**
 * Parse ByteDance's three-line streaming frames out of a decoded text buffer.
 *
 * A frame is `id:` then `event:` then `data:` then a blank line. Standard SSE
 * also permits comment lines (`:`), so those are skipped. Returns the frames
 * plus whatever tail did not yet form a complete frame.
 */
export function parseFrames(buffer: string): { frames: StreamFrame[]; rest: string } {
  const frames: StreamFrame[] = []
  let rest = buffer
  // Consume complete blank-line-terminated blocks.
  while (true) {
    const boundary = rest.search(/\r?\n\r?\n/)
    if (boundary < 0) break
    const block = rest.slice(0, boundary)
    rest = rest.slice(boundary).replace(/^\r?\n\r?\n/, '')
    const frame: StreamFrame = { data: '' }
    const dataLines: string[] = []
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon < 0 ? line : line.slice(0, colon)
      let value = colon < 0 ? '' : line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'id') frame.id = value
      else if (field === 'event') frame.event = value
      else if (field === 'data') dataLines.push(value)
    }
    if (dataLines.length > 0 || frame.event) {
      frame.data = dataLines.join('\n')
      frames.push(frame)
    }
  }
  return { frames, rest }
}

/**
 * Collect assistant text and routing metadata from a decoded frame payload.
 *
 * Doubao nests message content in several differently-shaped envelopes
 * depending on the event, so this walks any `text` field it finds rather than
 * assuming one fixed path.
 */
function harvestText(node: unknown, into: { out: string[] }): void {
  if (Array.isArray(node)) {
    for (const item of node) harvestText(item, into)
    return
  }
  if (node === null || typeof node !== 'object') return
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if ((key === 'text' || key === 'content' || key === 'delta') && typeof value === 'string') {
      into.out.push(value)
    } else {
      harvestText(value, into)
    }
  }
}

/**
 * Collect answer text and thinking text, separated by block ownership.
 *
 * A deep-think reply carries a `block_type: 10040` container (the visible
 * 「正在思考 / 已完成思考」 shell) and then streams the reasoning as ordinary
 * `block_type: 10000` blocks whose `parent_id` is that container's id. The shell
 * and its children both point at `Deep_Think.png`, but `parent_id` is the
 * reliable discriminator, so it is what this uses.
 *
 * Treating every `text` as answer text — what the previous revision did — mixes
 * the model's private reasoning into the reply the user sees.
 */
const PLACEHOLDER_THINKING_TITLE_RE =
  /^(?:正在思考(?:中)?|思考中|已(?:完成)?(?:深度)?思考(?:\s*[（(].*[)）])?|深度思考(?:中)?|思考完成|正在(?:生成图片|生图)|已完成(?:图片生成|生图)|thinking|thought)(?:[.。…]+)?$/i

function nonPlaceholderTitle(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (trimmed === '' || PLACEHOLDER_THINKING_TITLE_RE.test(trimmed)) return undefined
  return trimmed
}

function trailingNewlineCount(text: string, fallback = 0): number {
  if (text === '') return fallback
  if (/(?:\r?\n){2}$/.test(text)) return 2
  if (/\r?\n$/.test(text)) return 1
  return 0
}

export interface BlockCollectState {
  thinkingIds: Set<string>
  /** Active target for id-less `CHUNK_DELTA` frames across SSE events. */
  activeTarget?: 'thinking' | 'answer'
  /** Last seen title per thinking block id. */
  lastTitles?: Map<string, string>
  /** Normalized thinking titles already emitted in this stream. */
  seenTitles?: Set<string>
  /** Last seen cumulative/snapshot `text_block.summary` per block id. */
  lastSummaries?: Map<string, string>
  /** True once full CoT `text_block.text` has appeared for a thinking block. */
  hasFullThinkingText?: boolean
  /** True when a `10040` thinking container or thinking content appeared. */
  sawThinkingBlock?: boolean
  hasEmittedThinking?: boolean
  trailingNewlines?: number
}

export function createBlockCollectState(): BlockCollectState {
  return {
    thinkingIds: new Set<string>(),
    lastTitles: new Map<string, string>(),
    seenTitles: new Set<string>(),
    lastSummaries: new Map<string, string>(),
    hasFullThinkingText: false,
    sawThinkingBlock: false,
    hasEmittedThinking: false,
    trailingNewlines: 2,
  }
}

function pushThinkingPiece(
  state: BlockCollectState,
  into: { thinking: string[] },
  piece: string,
  discrete: boolean,
): void {
  if (piece === '') return
  if (!discrete) {
    into.thinking.push(piece)
    state.hasEmittedThinking = true
    state.trailingNewlines = trailingNewlineCount(piece, state.trailingNewlines ?? 0)
    return
  }
  const nl = state.trailingNewlines ?? 0
  const prefix = !state.hasEmittedThinking ? '' : nl >= 2 ? '' : nl === 1 ? '\n' : '\n\n'
  const out = `${prefix}${piece}`
  into.thinking.push(out)
  state.hasEmittedThinking = true
  state.trailingNewlines = trailingNewlineCount(out, nl)
}

export function collectBlocks(
  node: unknown,
  into: { answer: string[]; thinking: string[]; images?: DoubaoImage[] },
  thinkingIdsOrState: Set<string> | BlockCollectState,
  depth = 0,
): void {
  const state: BlockCollectState = thinkingIdsOrState instanceof Set
    ? { thinkingIds: thinkingIdsOrState }
    : thinkingIdsOrState
  const thinkingIds = state.thinkingIds

  if (Array.isArray(node)) {
    for (const item of node) collectBlocks(item, into, state, depth)
    return
  }
  if (node === null || typeof node !== 'object') return
  const record = node as Record<string, unknown>

  const blockType = record.block_type
  if (typeof blockType === 'number') {
    const blockId = typeof record.block_id === 'string' && record.block_id !== ''
      ? record.block_id
      : undefined
    const parentId = typeof record.parent_id === 'string' ? record.parent_id : ''
    const isThinking = blockType === THINKING_BLOCK_TYPE ||
      (parentId !== '' && thinkingIds.has(parentId))

    if (blockType === THINKING_BLOCK_TYPE) {
      if (blockId !== undefined) thinkingIds.add(blockId)
    }

    // A creation block: `content.creation_block.creations[]`. Each creation
    // streams in pieces (first a placeholder with no URL, later the finished
    // one), so the same task id can arrive several times — the caller dedupes
    // by keeping the entries that actually carry a URL.
    if (blockType === CREATION_BLOCK_TYPE) {
      state.activeTarget = 'answer'
      if (into.images !== undefined) {
        const content = record.content as { creation_block?: { creations?: unknown } } | undefined
        const creations = content?.creation_block?.creations
        if (Array.isArray(creations)) {
          for (const raw of creations) {
            const image = toDoubaoImage(raw)
            if (image !== undefined) into.images.push(image)
          }
        }
      }
    }

    const content = record.content as {
      text_block?: { text?: unknown; summary?: unknown }
      thinking_block?: {
        streaming_title?: unknown
        finish_title?: unknown
        unfold_streaming_title?: unknown
        cot_ui_style?: unknown
        empty_disable_click?: unknown
      }
    } | undefined

    const thinkingBlock = content?.thinking_block
    const text = content?.text_block?.text
    const summary = content?.text_block?.summary

    if (isThinking) {
      if (
        thinkingBlock !== undefined &&
        typeof thinkingBlock === 'object' &&
        thinkingBlock !== null &&
        thinkingBlock.empty_disable_click !== true
      ) {
        const isSummaryStyle = thinkingBlock.cot_ui_style === 'summary'
        if (!state.hasFullThinkingText || isSummaryStyle) {
          const title = nonPlaceholderTitle(thinkingBlock.finish_title) ??
            nonPlaceholderTitle(thinkingBlock.unfold_streaming_title) ??
            nonPlaceholderTitle(thinkingBlock.streaming_title)
          if (title !== undefined) {
            state.sawThinkingBlock = true
            state.seenTitles ??= new Set<string>()
            state.lastTitles ??= new Map<string, string>()
            const titleKey = blockId ?? '__thinking_title__'
            if (!state.seenTitles.has(title) && state.lastTitles.get(titleKey) !== title) {
              state.seenTitles.add(title)
              state.lastTitles.set(titleKey, title)
              pushThinkingPiece(state, into, `${title}\n\n`, true)
            }
          }
        }
      }

      if (typeof text === 'string' && text !== '') {
        state.hasFullThinkingText = true
        state.sawThinkingBlock = true
        pushThinkingPiece(state, into, text, false)
      } else if (typeof summary === 'string' && summary.trim() !== '') {
        const trimmedSummary = summary.trim()
        if (!PLACEHOLDER_THINKING_TITLE_RE.test(trimmedSummary)) {
          state.sawThinkingBlock = true
          state.seenTitles ??= new Set<string>()
          state.lastSummaries ??= new Map<string, string>()
          const summaryKey = blockId ?? (parentId !== '' ? `${parentId}:summary` : '__thinking_summary__')
          const prev = state.lastSummaries.get(summaryKey) ?? ''
          if (prev === '' && state.seenTitles.has(trimmedSummary)) {
            state.lastSummaries.set(summaryKey, summary)
          } else if (summary !== prev) {
            state.lastSummaries.set(summaryKey, summary)
            if (prev !== '' && summary.startsWith(prev)) {
              const delta = summary.slice(prev.length)
              pushThinkingPiece(state, into, delta, false)
            } else {
              state.seenTitles.add(trimmedSummary)
              pushThinkingPiece(state, into, summary, true)
            }
          }
        }
      }

      if (typeof text === 'string' && text !== '' && record.is_finish !== true) {
        state.activeTarget = 'thinking'
      } else if (blockType !== THINKING_BLOCK_TYPE && record.is_finish !== true) {
        state.activeTarget = 'thinking'
      } else if (blockType === THINKING_BLOCK_TYPE && state.activeTarget === undefined && record.is_finish !== true) {
        state.activeTarget = 'thinking'
      }
    } else {
      if (typeof text === 'string' && text !== '') {
        into.answer.push(text)
      }
      if (content?.text_block !== undefined) {
        state.activeTarget = 'answer'
      }
    }
  } else if (
    typeof record.text === 'string' &&
    record.text !== '' &&
    !('content_block' in record) &&
    !('message' in record) &&
    (typeof record.id === 'string' || (depth === 0 && !('block_type' in record) && !('icon_url' in record)))
  ) {
    // `event: CHUNK_DELTA` frames carry incremental text as `{ text: "...", id: "<block_id>" }`
    // or `{ text: "..." }` without `id` (routed to the active block target).
    const isThinkingDelta = typeof record.id === 'string'
      ? thinkingIds.has(record.id)
      : state.activeTarget === 'thinking'
    if (isThinkingDelta) {
      state.sawThinkingBlock = true
      pushThinkingPiece(state, into, record.text, false)
    } else {
      into.answer.push(record.text)
    }
    return
  }

  for (const value of Object.values(record)) collectBlocks(value, into, state, depth + 1)
}

/**
 * Turn one `creations[]` entry into an image, or undefined when it carries no
 * usable URL yet (the placeholder stage).
 *
 * URL preference is original → preview → thumb: `image_ori` is the full-
 * resolution artefact, the others are watermarked/derivative variants the app
 * uses for lists and thumbnails.
 */
function toDoubaoImage(raw: unknown): DoubaoImage | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const creation = raw as Record<string, unknown>
  const image = creation.image as Record<string, unknown> | undefined
  if (image === undefined) return undefined
  const pick = (key: string): { url: string; width?: unknown; height?: unknown } | undefined => {
    const value = image[key]
    if (typeof value !== 'object' || value === null) return undefined
    const url = (value as { url?: unknown }).url
    if (typeof url !== 'string' || url === '') return undefined
    return value as { url: string; width?: unknown; height?: unknown }
  }
  // IMAGEGEN_RAW_PATCH: image_ori 带 logo 水印；image_ori_raw 才是原图。
  const best = pick('image_ori_raw') ?? pick('image_ori') ?? pick('image_preview') ?? pick('image_thumb')
  if (best === undefined) return undefined
  const taskId = typeof creation.id === 'string' ? creation.id
    : typeof creation.id === 'number' ? String(creation.id) : undefined
  const out: DoubaoImage = { url: best.url }
  if (taskId !== undefined) out.taskId = taskId
  if (typeof image.key === 'string') out.key = image.key
  if (typeof best.width === 'number') out.width = best.width
  if (typeof best.height === 'number') out.height = best.height
  return out
}

/** Read the model identifier the server actually used for a reply. */
export function extractModel(payload: unknown): string | undefined {
  const seen = new Set<string>()
  const walk = (node: unknown): string | undefined => {
    if (node === null || typeof node !== 'object') return undefined
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item)
        if (found) return found
      }
      return undefined
    }
    const record = node as Record<string, unknown>
    for (const key of ['model', 'model_name', 'model_id', 'llm_model_type', 'model_type']) {
      const value = record[key]
      if (typeof value === 'string' && value && !seen.has(value)) {
        seen.add(value)
        return value
      }
      if (typeof value === 'number' && value) {
        const text = String(value)
        if (!seen.has(text)) { seen.add(text); return text }
      }
    }
    for (const value of Object.values(record)) {
      const found = walk(value)
      if (found) return found
    }
    return undefined
  }
  return walk(payload)
}

/** True when the reply came from a reasoning-capable model. */
function extractThinking(payload: unknown): boolean {
  const record = payload as { message?: { ext?: unknown }; ext?: unknown } | null
  const ext = record?.message?.ext ?? record?.ext
  if (ext && typeof ext === 'object') {
    const useDeepThink = (ext as Record<string, unknown>).use_deep_think
    if (useDeepThink === '1' || useDeepThink === 1) return true
    if (typeof useDeepThink === 'string' && useDeepThink !== '' && useDeepThink !== '0') return true
  }
  return false
}

export interface StreamCallbacks {
  onText?: (delta: string) => void
  /** Private reasoning deltas (deep-think turns); never part of the answer. */
  onThinking?: (delta: string) => void
  onEvent?: (event: string) => void
}

/**
 * Local workspace HTTP responder for 「工作任务」 (`Agent-GeneralTask`) turns.
 *
 * When a task-mode turn starts with `option.unique_key = <U>`, the server's
 * `Agent-GeneralTask` dispatches sequential local workspace commands with
 * deterministic IDs: `${uniqueKey}:${device_id}:${aid}:message:${seq}` for
 * `seq = 0, 1, 2, ...`.
 *
 * CRITICAL: `POST /alice/office/tool_local/msg/ack` MUST be called with a
 * SINGLE `msg_id` (`{ msg_ids: [msgId] }`). If `msg_ids` contains any `seq`
 * that has not been created on the server yet, the entire `msg/ack` batch fails
 * with `710010702`. Polling one `seq` at a time and replying to `cmd_call`
 * (`command: 6003`, e.g. `local.workspace.apply`) via `upload_command_result`
 * + `msg/complete` until `agent_finished` (`command: 6004`) satisfies the server
 * runtime without requiring the Doubao desktop CUA process.
 */
async function runToolLocalResponder(
  uniqueKey: string,
  credentials: DoubaoCredentials,
  isStreamDone: () => boolean,
  signal?: AbortSignal,
): Promise<void> {
  const msToken = credentials.pairs.get('msToken')
  const postToolJson = async (endpoint: string, payload: unknown): Promise<Record<string, any> | undefined> => {
    const url = buildQueryUrl(endpoint, msToken)
    const headers = buildHeaders(credentials, {
      'content-type': 'application/json',
      accept: 'application/json, text/plain, */*',
    })
    delete headers['last-event-id']
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      ...(signal ? { signal } : {}),
    })
    absorbSetCookies(res.headers)
    const text = await res.text()
    return JSON.parse(text) as Record<string, any>
  }

  let seq = 0
  let postStreamPolls = 0
  while (!signal?.aborted) {
    if (isStreamDone()) {
      if (seq === 0 || postStreamPolls >= 8) break
      postStreamPolls += 1
    }
    const msgId = `${uniqueKey}:${CLIENT_PARAMS.device_id}:${CLIENT_PARAMS.aid}:message:${seq}`
    let ack: Record<string, any> | undefined
    try {
      ack = await postToolJson(TOOL_LOCAL_ACK_ENDPOINT, { msg_ids: [msgId] })
    } catch {
      // If fetch fails or returns non-JSON (e.g. a stubbed unit-test fetch),
      // exit quietly so the caller's stream handling is unaffected.
      return
    }
    const msg = ack?.code === 0 ? ack?.data?.msgs?.[0] : undefined
    if (msg !== undefined) {
      const cmdCall = msg?.body?.cmd_call
      const agentFinished = msg?.body?.agent_finished
      if (cmdCall !== undefined) {
        let inputObj: Record<string, any> = {}
        try {
          inputObj = JSON.parse(cmdCall.input ?? '{}') as Record<string, any>
        } catch {
          inputObj = {}
        }
        const ops = Array.isArray(inputObj.operations) ? inputObj.operations : []
        const results = ops.map((op: Record<string, any>) => ({
          ...(op.sequence !== undefined ? { sequence: op.sequence } : {}),
          id: op.id,
          type: op.type,
          path: op.path,
          status: 'success',
        }))
        const outputObj = {
          request_id: inputObj.request_id ?? '',
          status: 'success',
          results,
        }
        try {
          await postToolJson(TOOL_LOCAL_UPLOAD_ENDPOINT, {
            cmd_id: cmdCall.cmd_id,
            session_id: msg.session_id,
            msg_id: msgId,
            output: JSON.stringify(outputObj),
          })
          await postToolJson(TOOL_LOCAL_COMPLETE_ENDPOINT, { msg_id: msgId })
        } catch {
          return
        }
        seq += 1
        continue
      }
      if (agentFinished !== undefined) {
        return
      }
      seq += 1
      continue
    }
    await new Promise((resolve) => setTimeout(resolve, 180))
  }
}

/**
 * One attempt, no fallback. Split out so {@link streamChat} can retry a
 * task-mode call as plain chat when the task runtime is not attached.
 */
async function streamOnce(
  prompt: string,
  options: ChatRequestOptions & {
    signal?: AbortSignal
    callbacks?: StreamCallbacks
    credentials?: DoubaoCredentials
  } = {},
): Promise<DoubaoChatResult> {
  const credentials = options.credentials ?? loadDoubaoCredentials()
  /**
   * No cookie means "sign in again", not "the network is down".
   *
   * `loadDoubaoCredentials` throws when there is no session, and the message it carries is
   * the sentence the card shows. The `session_dead` kind is what stops the caller from
   * treating it as a transport failure and retrying.
   */
  if (credentials.pairs.size === 0) {
    throw new DoubaoUpstreamError(
      '还没有浏览器登录态。请在豆包卡片里点「重新登录」扫码一次。',
      undefined,
      false,
      { kind: 'session_dead' },
    )
  }
  const missing = REQUIRED_COOKIE_NAMES.filter((name) => !credentials.pairs.get(name))
  if (missing.length > 0) {
    throw new DoubaoUpstreamError(
      `Doubao session cookies missing: ${missing.join(', ')}`,
      undefined,
      false,
      { kind: 'session_dead' },
    )
  }

  const msToken = credentials.pairs.get('msToken')
  const url = buildQueryUrl(CHAT_ENDPOINT, msToken)
  const headers = buildHeaders(credentials, { 'content-type': 'application/json' })
  const bodyObj = buildChatBody(prompt, options)
  const uniqueKey = bodyObj.option.unique_key
  const body = JSON.stringify(bodyObj)
  const isTask = taskModeEnabled(options)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (error) {
    // A caller abort is not a failure — let the AbortError through untouched so
    // the shim can tell "user cancelled" from "network broke".
    if (options.signal?.aborted) throw error
    throw new DoubaoUpstreamError(
      `Doubao request did not reach the server: ${(error as Error).message}`,
      undefined,
      false,
      { transport: true },
    )
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new DoubaoUpstreamError(
      `Doubao chat request failed with HTTP ${response.status}. ${detail.slice(0, 200)}`,
      undefined,
      false,
      { httpStatus: response.status },
    )
  }

  // Fold the server's credential refreshes back into our in-memory jar so the
  // next call stays authenticated.
  absorbSetCookies(response.headers)

  let streamDone = false
  const responderPromise = isTask
    ? runToolLocalResponder(uniqueKey, credentials, () => streamDone, options.signal).catch(() => {})
    : Promise.resolve()

  try {
    const result = await consumeStream(response, options.callbacks, {
      harvestNotifyText: isTask,
    })
    return result
  } finally {
    streamDone = true
    await responderPromise
  }
}

/**
 * Stream one completion and return the assembled reply.
 *
 * Rejects with `DoubaoUpstreamError` when the server answers with a business
 * error frame — notably `710022004 rate limited`, which is risk control asking
 * for a slider CAPTCHA rather than an authentication failure.
 *
 * TASK MODE FALLBACK. Since 0.4.1 a task-mode turn is served by the
 * `tool_local` responder above, so it normally completes. This is now a
 * last-resort net: if the responder cannot satisfy the runtime (upstream change,
 * network failure), the server answers with `710010702 system error` instead of
 * a reply (verified: the stream still names `Agent-GeneralTask`, so the mode
 * itself was accepted). Rather than hand that placeholder to the user, the call
 * is retried ONCE as plain chat — and only when the failed attempt emitted no
 * text, so a fallback can never duplicate a partially streamed answer.
 */
export async function streamChat(
  prompt: string,
  options: ChatRequestOptions & {
    signal?: AbortSignal
    callbacks?: StreamCallbacks
    credentials?: DoubaoCredentials
  } = {},
): Promise<DoubaoChatResult> {
  let emittedText = false
  const wrapped: StreamCallbacks = {
    onText: (delta) => {
      if (delta) emittedText = true
      options.callbacks?.onText?.(delta)
    },
    // Forwarded, or the deep-think deltas die here: consumeStream emits them
    // through this wrapper, so omitting the field silently swallowed every
    // reasoning delta and `reasoning_content` was always empty.
    onThinking: (delta) => options.callbacks?.onThinking?.(delta),
    onEvent: (event) => options.callbacks?.onEvent?.(event),
  }
  const wanted = taskModeEnabled(options)
  const call = (taskMode: boolean): Promise<DoubaoChatResult> =>
    streamOnce(prompt, { ...options, callbacks: wrapped, taskMode })
  try {
    return await call(wanted)
  } catch (error) {
    const taskRuntimeMissing = error instanceof DoubaoUpstreamError &&
      (error.code === CODE_TASK_RUNTIME_UNAVAILABLE || /agent_err_real_answer/.test(error.message))
    if (!wanted || !taskRuntimeMissing || emittedText) throw error
    return call(false)
  }
}

const renewals = new Map<string, string>()

/**
 * Drop every rotated cookie this module has absorbed.
 *
 * MUST be called together with `invalidateCredentialCache()`. The two caches
 * hold halves of one credential: the auth cache holds what was decrypted from
 * disk, and `renewals` holds what the server rotated onto us afterwards
 * (`x-ms-token`, `bd_sso_hi3jfd`). Clearing one without the other leaves the
 * stale half behind — after a credential refresh the freshly-read cookies
 * would immediately be overwritten by values from the previous session, and
 * the user would be told to sign in again for no real reason.
 */
export function invalidateRenewals(): void {
  renewals.clear()
}

/** Record rotated cookies (`x-ms-token`, `bd_sso_hi3jfd`) for the next request. */
function absorbSetCookies(headers: Headers): void {
  const msToken = headers.get('x-ms-token')
  if (msToken) renewals.set('msToken', msToken)
  const setCookie = headers.get('set-cookie')
  if (!setCookie) return
  for (const part of setCookie.split(/,\s*(?=[A-Za-z0-9_-]+=)/)) {
    const [pair] = part.split(';')
    if (!pair) continue
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (name && value) renewals.set(name, value)
  }
}

/** Cookie header with any rotated values overlaid. Values never leave memory. */
export function applyRenewals(header: string): string {
  if (renewals.size === 0) return header
  const pairs = new Map<string, string>()
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=')
    if (eq > 0) pairs.set(part.slice(0, eq).trim(), part.slice(eq + 1))
  }
  for (const [name, value] of renewals) pairs.set(name, value)
  return [...pairs.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
}

async function consumeStream(
  response: Response,
  callbacks?: StreamCallbacks,
  options: { harvestNotifyText?: boolean } = {},
): Promise<DoubaoChatResult> {
  const reader = response.body?.getReader()
  if (!reader) throw new DoubaoUpstreamError('Doubao returned an empty response body.')
  const decoder = new TextDecoder()
  let buffer = ''
  const texts: string[] = []
  /** Text carried by STREAM_MSG_NOTIFY instead of by chunk deltas. */
  const notifyTexts: string[] = []
  /** Generated images, in arrival order (may repeat a task while it streams). */
  const images: DoubaoImage[] = []
  /** Private reasoning (deep-think turns), kept out of the answer. */
  const reasoningParts: string[] = []
  /** Shared per-stream state across `10040` / `10000` / `CHUNK_DELTA` frames. */
  const blockState = createBlockCollectState()
  let conversationId: string | undefined
  let messageId: string | undefined
  let model: string | undefined
  let thinking = false
  let reasoningText: string | undefined
  let lastEventId: string | undefined
  let ended = false
  /**
   * Every event name seen, in arrival order (deduped).
   *
   * Task mode answers with a richer event vocabulary than chat, so an empty
   * completion is usually "the text lives in an event we do not harvest yet"
   * rather than "the server said nothing". Naming the events turns an opaque
   * failure into a next step.
   */
function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value !== 'string' || value.trim() === '') return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* best-effort telemetry parse */
  }
  return undefined
}

function parseContextWindowUsage(raw: unknown): DoubaoContextWindowUsage | undefined {
  const obj = parseJsonObject(raw)
  if (obj === undefined) return undefined
  const systemPrompt = toFiniteNumber(obj.system_prompt)
  const messages = toFiniteNumber(obj.messages)
  const skills = toFiniteNumber(obj.skills)
  const tools = toFiniteNumber(obj.tools)
  const totalWindowSize = toFiniteNumber(obj.total_window_size)
  if (
    systemPrompt === undefined &&
    messages === undefined &&
    skills === undefined &&
    tools === undefined &&
    totalWindowSize === undefined
  ) {
    return undefined
  }
  const s = Math.max(0, systemPrompt ?? 0)
  const m = Math.max(0, messages ?? 0)
  const k = Math.max(0, skills ?? 0)
  const t = Math.max(0, tools ?? 0)
  const w = Math.max(0, totalWindowSize ?? 0)
  return {
    systemPrompt: s,
    messages: m,
    skills: k,
    tools: t,
    totalWindowSize: w,
    totalUsed: s + m + k + t,
  }
}

function collectTelemetryFromExt(ext: unknown, target: DoubaoUpstreamTelemetry): void {
  const record = parseJsonObject(ext)
  if (record === undefined) return
  const contextWindow = parseContextWindowUsage(record.context_window_usage)
  if (contextWindow !== undefined) {
    target.contextWindowUsage = contextWindow
  }
  const teaCost = parseJsonObject(record.tea_tags_time_cost)
  if (teaCost !== undefined) {
    const ack = toFiniteNumber(teaCost.ack_cost_time)
    if (ack !== undefined && ack >= 0) target.ackCostMs = ack
    const firstPacket = toFiniteNumber(teaCost.first_packet_cost_time)
    if (firstPacket !== undefined && firstPacket >= 0) target.firstPacketCostMs = firstPacket
  }
  const finishTime = toFiniteNumber(record.finish_time_ms)
  if (finishTime !== undefined && finishTime >= 0) target.finishTimeMs = finishTime
  if (typeof record.finish_reason_chat === 'string' && record.finish_reason_chat !== '') {
    target.finishReasonChat = record.finish_reason_chat
  }
}

function collectTelemetry(payload: unknown, target: DoubaoUpstreamTelemetry): void {
  if (payload === null || typeof payload !== 'object') return
  const record = payload as {
    ext?: unknown
    content?: { ext?: unknown }
    message?: { ext?: unknown }
    patch_op?: Array<{ patch_value?: { ext?: unknown } }>
  }
  collectTelemetryFromExt(record.ext, target)
  collectTelemetryFromExt(record.content?.ext, target)
  collectTelemetryFromExt(record.message?.ext, target)
  if (Array.isArray(record.patch_op)) {
    for (const op of record.patch_op) {
      collectTelemetryFromExt(op?.patch_value?.ext, target)
    }
  }
}

  const events = new Set<string>()
  /** The agent that served this turn, when the server names one. */
  let intentionAgent: string | undefined
  /** Server-side timing & context window telemetry harvested across SSE frames. */
  const telemetry: DoubaoUpstreamTelemetry = {}
  /**
   * `expose_reason` of a task turn whose runtime was unreachable.
   *
   * Recorded instead of surfacing its placeholder text (「出了点问题，请稍后重试。」),
   * which reads like a transient glitch and hides the actual cause.
   */
  let taskAgentError: string | undefined

  const handle = (frame: StreamFrame): void => {
    const name = frame.event ?? ''
    if (name) events.add(name)
    // Task mode answers with frames chat mode never emits. Dump them on demand
    // rather than guessing which envelope carries the text.
    if (process.env.DSH_DOUBAO_DEBUG_FRAMES === '1' && frame.data) {
      process.stderr.write(`[frame ${name || '(none)'}] ${frame.data.slice(0, 1500)}\n`)
    }
    if (name && callbacks?.onEvent) callbacks.onEvent(name)
    if (frame.id) lastEventId = frame.id
    if (!frame.data) return

    let payload: unknown
    try {
      payload = JSON.parse(frame.data)
    } catch {
      return
    }
    collectTelemetry(payload, telemetry)

    if (name === 'STREAM_ERROR') {
      const record = payload as { error_code?: number; error_msg?: string }
      const code = record.error_code
      const message = record.error_msg ?? 'unknown stream error'
      const rateLimited = code === 710022004 || /rate limit/i.test(message)
      throw new DoubaoUpstreamError(
        rateLimited
          ? 'Doubao risk control challenged this request (710022004). Slow down and retry later.'
          : `Doubao stream error ${code ?? '?'}: ${message}`,
        code,
        rateLimited,
      )
    }

    if (name === 'SSE_ACK') {
      const ack = payload as { query_list?: Array<{ question_id?: string }>; ack_client_meta?: { conversation_id?: string } }
      conversationId = ack.ack_client_meta?.conversation_id ?? conversationId
      messageId = ack.query_list?.[0]?.question_id ?? messageId
      return
    }

    if (name === 'FULL_MSG_NOTIFY' || name === 'STREAM_MSG_NOTIFY') {
      const record = payload as {
        message?: { message_id?: string; ext?: unknown; content?: unknown }
        content?: { ext?: unknown; content_block?: unknown }
        ext?: unknown
      }
      messageId = record.message?.message_id ?? messageId
      model = model ?? extractModel(payload)
      thinking = thinking || extractThinking(payload)

      const ext = (record.content?.ext ?? record.message?.ext ?? record.ext) as
        | Record<string, unknown>
        | undefined
      if (ext !== undefined && ext !== null && typeof ext === 'object') {
        const agent = ext.intention_agent_name
        if (typeof agent === 'string' && agent !== '') intentionAgent = agent
        const reason = ext.expose_reason
        if (typeof reason === 'string' && /agent_err_real_answer/.test(reason)) {
          taskAgentError = reason
        }
      }

      // Chat mode streams the answer as STREAM_CHUNK deltas; a TASK turn instead
      // delivers the whole reply in THIS frame's content_block. Harvest both and
      // decide afterwards which one was real (chunks win), so neither shape is
      // lost — and so an empty `texts` can no longer hide a reply that arrived
      // here instead.
      //
      // FULL_MSG_NOTIFY stays excluded: it carries the USER's own message, so
      // harvesting it would replay the prompt into the answer.
      if (name === 'STREAM_MSG_NOTIFY') {
        thinking = thinking || extractThinking(payload)
        const acc = { answer: [] as string[], thinking: [] as string[], images }
        collectBlocks(record.content?.content_block, acc, blockState)
        const joinedAccThinking = acc.thinking.join('')
        const priorThinking = reasoningParts.join('')
        const isDuplicateThinkingReplay = joinedAccThinking !== '' && priorThinking !== '' && joinedAccThinking === priorThinking
        if (!isDuplicateThinkingReplay) {
          for (const piece of acc.thinking) {
            if (!piece) continue
            reasoningParts.push(piece)
            if (callbacks?.onThinking) callbacks.onThinking(piece)
          }
        }
        for (const piece of acc.answer) {
          if (!piece) continue
          notifyTexts.push(piece)
          // Emitted live: this frame carries the OPENING of the reply, and the
          // chunk patches that follow are deltas appended after it.
          if (callbacks?.onText) callbacks.onText(piece)
        }
      }
      return
    }

    if (name === 'STREAM_CHUNK' || name === 'CHUNK_DELTA') {
      model = model ?? extractModel(payload)
      thinking = thinking || extractThinking(payload)
      const acc = { answer: [] as string[], thinking: [] as string[], images }
      collectBlocks(payload, acc, blockState)
      for (const piece of acc.thinking) {
        if (!piece) continue
        reasoningParts.push(piece)
        if (callbacks?.onThinking) callbacks.onThinking(piece)
      }
      for (const text of acc.answer) {
        if (!text) continue
        if (callbacks?.onText) callbacks.onText(text)
        texts.push(text)
      }
      return
    }

    if (name === 'SSE_REPLY_END') {
      ended = true
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const { frames, rest } = parseFrames(buffer)
      buffer = rest
      for (const frame of frames) handle(frame)
      if (ended) break
    }
    // Flush the decoder and parse whatever trailing bytes are still buffered:
    // when the socket closes without a final blank line, the last frame was
    // left in `buffer` and dropped.
    const tail = decoder.decode()
    if (tail) {
      const { frames, rest } = parseFrames(buffer + tail)
      buffer = rest
      for (const frame of frames) handle(frame)
    }
  } finally {
    // Cancel before releasing: releasing the lock with the body still unread
    // leaves the connection (and the upstream turn) running to completion.
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }

  const chunkText = texts.join('')
  const notifyText = notifyTexts.join('')
  const raw = assembleReplyText(notifyText, chunkText)
  const text = stripPromptEcho(raw)
  if (taskAgentError !== undefined) {
    // Checked BEFORE the empty-completion branch: the placeholder text is
    // non-empty, so ordering it after would report a generic failure and lose
    // the one fact that matters — the task runtime was never reached.
    throw new DoubaoUpstreamError(
      `Doubao accepted the task but its executing runtime was unreachable ` +
      `(${taskAgentError}). The 「工作任务」 runtime is attached by the desktop ` +
      `client; without it the agent has nowhere to run.`,
      CODE_TASK_RUNTIME_UNAVAILABLE,
    )
  }
  // TERMINAL VERDICT.
  //
  // Only SSE_REPLY_END means the server finished this reply. A socket that
  // closes early (proxy reset, idle timeout, client gone) used to be treated as
  // success: the partial text was returned and the shim wrote
  // finish_reason:"stop" + [DONE], so a truncated answer looked complete.
  if (!ended) {
    const received = texts.join('').length + notifyTexts.join('').length
    throw new DoubaoUpstreamError(
      `Doubao closed the stream before the reply finished` +
        `${received > 0 ? ` after ${received} characters` : ''}; ` +
        `the answer is incomplete. Retry the turn.`,
      undefined,
      false,
      { truncated: true },
    )
  }

  // A creation streams the same task several times (placeholder → filled), so
  // collapse by URL and keep first-seen order.
  const uniqueImages = [...new Map(images.map((image) => [image.url, image])).values()]
  if (!text && uniqueImages.length === 0) {
    const seen = [...events]
    throw new DoubaoUpstreamError(
      `Doubao returned an empty completion` +
      `${lastEventId ? ` (last event id ${lastEventId})` : ''}` +
      `${seen.length > 0 ? `; events seen: ${seen.join(', ')}` : '; no events at all'}.`,
    )
  }
  return {
    text,
    ...(model !== undefined ? { model } : {}),
    ...(conversationId !== undefined ? { conversationId } : {}),
    ...(messageId !== undefined ? { messageId } : {}),
    ...(reasoningParts.length > 0 ? { reasoningText: reasoningParts.join('') } : {}),
    ...(intentionAgent !== undefined ? { intentionAgent } : {}),
    ...(Object.keys(telemetry).length > 0 ? { telemetry } : {}),
    images: uniqueImages,
    thinking: thinking || blockState.sawThinkingBlock === true || reasoningParts.length > 0,
  }
}

/**
 * Join the two halves of a reply.
 *
 * The opening of every answer arrives in STREAM_MSG_NOTIFY and the remainder as
 * patch deltas in STREAM_CHUNK. Reading only the chunks swallowed the first
 * character of EVERY reply — 「1+1等于2。」 came back as 「+1等于2。」, 「我是豆包」
 * as 「是豆包」 — and nothing failed loudly, which is exactly why it survived.
 *
 * A cumulative chunk stream (one that re-sends what was already delivered)
 * already starts with the notification text; that case is detected rather than
 * concatenated twice. Exported so the rule can be tested without a live stream.
 */
export function assembleReplyText(notifyText: string, chunkText: string): string {
  if (notifyText === '') return chunkText
  if (chunkText === '') return notifyText
  return chunkText.startsWith(notifyText) ? chunkText : notifyText + chunkText
}

/**
 * Remove the echoed user prompt from the front of the assembled text.
 *
 * Doubao's first chunk replays the inbound message; keeping it would make every
 * reply appear to start with the user's own words.
 */
function stripPromptEcho(raw: string): string {
  const trimmed = raw.trimStart()
  return trimmed
}

/* ------------------------------------------------------------------ *
 * Non-streaming entry point
 * ------------------------------------------------------------------ */

/**
 * Collect a complete reply. Convenience wrapper over `streamChat` for callers
 * that do not need incremental deltas.
 */
export async function chat(
  prompt: string,
  options: ChatRequestOptions & { signal?: AbortSignal; callbacks?: StreamCallbacks } = {},
): Promise<DoubaoChatResult> {
  return streamChat(prompt, options)
}

/**
 * Doubao's failure classes.
 *
 * Deliberately five, not the seven the WorkBuddy route needs: Doubao has a
 * single account with no pool to rotate through, so there is nothing to fail
 * over to and no failover path to classify.
 *
 *   rate_limited     710022004 — risk control wants a slider CAPTCHA. NOT a
 *                    bandwidth limit and NOT transient: the user must clear it
 *                    once in the Doubao client. Retrying in place makes the
 *                    challenge stricter, so this never enters the retry set.
 *   quota_exhausted  the account's 5-hour or weekly window is spent.
 *   session_dead     credentials unreadable, or the server answers with its
 *                    "session expired" business code. Fix: sign in again.
 *   network          transport failure or timeout.
 *   upstream         anything else Doubao returns.
 */
export type DoubaoErrorKind =
  | 'rate_limited'
  | 'quota_exhausted'
  | 'session_dead'
  | 'network'
  | 'upstream'
  /**
   * The account is routing to the 「工作任务」 agent, whose executing runtime is
   * the desktop app's own process.
   *
   * Kept as its own class because the fix is a single toggle, and calling it
   * `network` (which is where the old classifier dropped it) sends the user to
   * check their Wi-Fi for a problem that is one switch away from solved.
   */
  | 'task_runtime_unavailable'

/** The server's business code for "this session is not valid". */
const CODE_SESSION_DEAD = 710012001
/** The server's business code for a risk-control slider challenge. */
const CODE_RATE_LIMITED = 710022004
/**
 * `block_type` of the deep-think container.
 *
 * A 深度思考 turn opens one `10040` block (the 「正在思考 / 已完成思考」 shell) and
 * then streams the reasoning as `10000` blocks whose `parent_id` is its id.
 * Captured 2026-10-23.
 */
const THINKING_BLOCK_TYPE = 10040
/**
 * The server's business code when a 「工作任务」 was accepted but its executing
 * runtime could not be reached (`expose_reason: agent_err_real_answer`).
 *
 * This is the signature of "the mode is right, the local runtime is not
 * attached" — the desktop client's CUA runtime registers itself; an external
 * client has nothing to register, so the agent has nowhere to run.
 */
const CODE_TASK_RUNTIME_UNAVAILABLE = 710010702

/**
 * Map one upstream error onto its class.
 *
 * Order matters: the explicit evidence (code, hint, HTTP status) is consulted
 * before the generic `upstream` bucket, and the old catch-all was wrong — every
 * unrecognised failure was reported as `network`, i.e. "check your connection",
 * for HTTP 400s and business errors that a retry cannot fix.
 */
export function classifyDoubaoFailure(error: DoubaoUpstreamError): DoubaoErrorKind {
  if (error.kindHint !== undefined) return error.kindHint
  if (error.rateLimited || error.code === CODE_RATE_LIMITED) return 'rate_limited'
  if (error.code === CODE_TASK_RUNTIME_UNAVAILABLE) return 'task_runtime_unavailable'
  if (error.code === CODE_SESSION_DEAD) return 'session_dead'
  if (error.httpStatus === 401 || error.httpStatus === 403) return 'session_dead'
  if (error.httpStatus === 429) return 'quota_exhausted'
  if (error.transport) return 'network'
  return 'upstream'
}

/**
 * Whether the host should retry this failure.
 *
 * Deliberately narrow. Re-sending a turn costs quota AND opens a server-side
 * thread, so only a failure that provably never produced an answer qualifies:
 * a transport error before any bytes, or a 5xx. A truncated stream is NOT
 * retryable here — the retry would be a fresh conversation that silently
 * abandons the half-received one, so the user is told instead.
 */
export function isRetryableFailure(error: unknown): boolean {
  if (!(error instanceof DoubaoUpstreamError)) return false
  if (error.transport) return true
  if (error.httpStatus !== undefined) return error.httpStatus >= 500
  return false
}

/**
 * User-facing text per class.
 *
 * The slider wording matters: it is the one failure the user can actually fix,
 * and the only place they can fix it is the Doubao desktop client — retrying
 * from the Harness will never clear it.
 */
export const DOUBAO_ERROR_HINTS: Readonly<Record<DoubaoErrorKind, string>> = {
  rate_limited:
    '豆包触发了风控验证（710022004）。请打开豆包客户端，手动发送一条消息完成滑块验证，然后再回到这里重试。反复重试只会让验证更严格。',
  quota_exhausted:
    '豆包额度已用尽。请等待额度窗口重置，或在豆包客户端查看「订阅与额度管理」。',
  session_dead:
    '豆包登录态失效。请在豆包客户端重新登录，然后重试。',
  network:
    '连接豆包失败（网络或超时）。请检查网络后重试。',
  task_runtime_unavailable:
    '豆包把这个账号路由到了「工作任务」代理，而该任务的执行运行时只存在于豆包客户端进程里，外部客户端接不上。请打开豆包客户端，把输入框上方的开关切回「对话」，然后重试；需要多步执行的话，交给 DSH 自己的工具来做。',
  upstream:
    '豆包返回了错误响应（不是网络问题，重试通常无效）。',
}

/** Build a user-facing message for a Doubao failure. */
export function describeDoubaoFailure(error: unknown): string {
  if (error instanceof DoubaoUpstreamError) {
    return `${DOUBAO_ERROR_HINTS[classifyDoubaoFailure(error)]}（${error.message}）`
  }
  // Not an upstream failure at all — a bug here, not a bad connection.
  return `豆包请求失败：${(error as Error)?.message ?? String(error)}`
}

/** Quick reachability probe that does not consume any inference quota. */
/**
 * The account's own display name.
 *
 * The card showed "豆包账号" for every account, because the session carries no name — only
 * cookies. `passport/account/info/v2` answers `data.name`, which is what the vendor calls the
 * user, so a pool with two Doubao accounts can tell them apart.
 *
 * A failed read returns undefined rather than throwing: the name is cosmetic, and a card
 * without it is still correct.
 */
export async function fetchAccountName(session: DoubaoSession | undefined): Promise<string | undefined> {
  if (session === undefined || !sessionUsable(session)) return undefined
  try {
    const response = await fetch(buildQueryUrl(ACCOUNT_ENDPOINT), {
      method: 'GET',
      headers: buildAuthHeaders(session),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return undefined
    const payload = await response.json() as { data?: { name?: unknown; screen_name?: unknown } }
    for (const candidate of [payload.data?.name, payload.data?.screen_name]) {
      if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim()
    }
    return undefined
  } catch {
    return undefined
  }
}

export async function probeAccount(credentials: DoubaoCredentials): Promise<{ ok: boolean; detail: string }> {
  if (credentials.pairs.size === 0) return { ok: false, detail: 'no credentials' }
  const url = buildQueryUrl(ACCOUNT_ENDPOINT)
  const headers = buildHeaders(credentials)
  delete headers['content-type']
  delete headers['last-event-id']
  try {
    const response = await fetch(url, { method: 'GET', headers })
    const payload = (await response.json()) as { data?: { name?: string; is_blocked?: number } }
    if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` }
    if (payload.data?.name) return { ok: true, detail: 'signed in' }
    return { ok: false, detail: 'session rejected by server' }
  } catch (error) {
    return { ok: false, detail: (error as Error).message }
  }
}