import { readFileSync } from 'node:fs'
/**
 * Doubao model catalog.
 *
 * Doubao DOES let the caller pick a model. The choice travels in the request
 * body at TWO mirrored locations, and upstream ignores the request if only one
 * is written:
 *
 *   option.model_config.model_item_key       ← numeric or slug
 *   option.aggregate_params.model_item_key   ← same value, same body
 *
 * Every id below was read off a real request the desktop app sent, not inferred.
 * They are NOT interchangeable with numbers that appear elsewhere in the body:
 * `aggregate_params.mode_id` is also often "3", but it means the 对话/工作 mode
 * switch, NOT the Turbo model. The two are named apart throughout this codebase
 * precisely because the collision is easy to fall into.
 *
 * ⚠️ ENCODING IS MIXED. `seed-lite-7b` is a string slug; `3`, `5` and `9` are
 * numeric enum values. They travel as JSON strings either way and MUST be
 * forwarded verbatim — never parsed to a number, or the slug is lost.
 *
 * 推理强度 (reasoning effort) is a separate axis. It travels as
 * `reasoning_effort` (mirrored like the model) and, redundantly, as
 * `need_deep_think = 10000 + level` plus `ext.use_deep_think`. See
 * {@link DOUBAO_REASONING_LEVELS} for which levels are verified.
 *
 * @module dsh-connect-doubao/catalog
 */

/** Provider route id this bundle owns. */
export const DOUBAO_PROVIDER = 'doubao'

/** Shown in the DSH model picker. */
export const DOUBAO_PROVIDER_DISPLAY_NAME = '豆包（Doubao）'

/** How much context a Doubao conversation holds. */
export const DOUBAO_CONTEXT_WINDOW = 256_000

/** Generous output ceiling; the subscription quota, not this, is the real bound. */
export const DOUBAO_MAX_TOKENS = 32_000

/**
 * `option.agent_mode` / `ext.agent_mode`.
 *
 * VERIFIED AGAINST A CDP-CAPTURED REQUEST (2026-10-22, 对话 mode):
 *
 *   agent_mode 2  →  普通对话
 *   agent_mode 1  →  「工作任务」 (every turn is handed to `Agent-GeneralTask`)
 *
 * The previous revision of this constant said 1 for chat and carried a comment
 * claiming work mode sends 2 — BOTH were backwards, and sending 1 is exactly
 * what made every request from this plugin look like a work task.
 *
 * Task mode used to end in `710010702` because the executing runtime was the
 * desktop app's CUA process. Since 0.4.1 the plugin answers the server's
 * `tool_local` commands over HTTP instead, so task turns complete.
 */
export const CHAT_AGENT_MODE = 2

/** 「工作任务」 mode. Requires the `tool_local` responder — see `doubao-upstream.ts`. */
export const TASK_AGENT_MODE = 1

/**
 * Which machine runs a 「工作任务」.
 *
 * Read off the desktop client's own enum (`ai-views` bundle, module 941658):
 *
 *   RuntimeType_Cloud_VM  = 1   → 「工作任务 · 云电脑」: ByteDance's VM executes
 *   RuntimeType_Local_PC  = 2   → 「工作任务 · 本地电脑」: THIS machine executes
 *
 * The plugin uses 2 on purpose: the cloud VM's artefacts are unreachable from an
 * external client, whereas the local runtime is this very machine — the same one
 * the Harness already executes tools on.
 */
export const TASK_RUNTIME_CLOUD_VM = 1
export const TASK_RUNTIME_LOCAL_PC = 2

/**
 * Sandbox authorisation level.
 *
 * `2` is what the client sends with its 「全部允许」 authorisation setting (read
 * off the same captured task request). The cloud uses it to decide how freely it
 * may plan file and command actions inside the declared workspace.
 */
export const TASK_SANDBOX_AUTH_ALLOW_ALL = 2

/**
 * A reasoning-effort level.
 *
 * `level` is Doubao's own ordinal and maps onto the wire as
 * `reasoning_effort` and `need_deep_think = 10000 + level`.
 *
 * `level` IS Doubao's `reasoning_effort` — the two are the same number, not two
 * parallel scales. It also feeds `need_deep_think = 10000 + level` and
 * `ext.use_deep_think`. So 高 is `reasoning_effort: 5` AND
 * `need_deep_think: 10005`; there is no separate "tier" numbering anywhere.
 *
 * All three values were read off the running desktop app by diffing the config
 * it re-serialises when the level is switched (M8 续二). They are not inferred
 * and not extrapolated from a pattern.
 */
export interface DoubaoReasoningLevel {
  /**
   * DSH-facing label. The five this catalog names are `low|mid|high|xhigh|max`,
   * but the client menu is not limited to them (自动 publishes 中 at ordinal 8), so
   * an unnamed ordinal carries its own decimal spelling instead of being dropped.
   */
  id: 'low' | 'mid' | 'high' | 'xhigh' | 'max' | (string & {})
  name: string
  /** The value sent as `reasoning_effort`; also `need_deep_think - 10000`. */
  level: number
  /** True when `level` was observed on the running client. */
  verified: boolean
}

export const DOUBAO_REASONING_LEVELS: readonly DoubaoReasoningLevel[] = [
  { id: 'low',  name: '低', level: 3, verified: true },
  { id: 'mid',  name: '中', level: 4, verified: true },
  { id: 'high', name: '高', level: 5, verified: true },
  // 6 and 7 are declared by the client's own menu for the newer models
  // (DeepSeek / Kimi / 2.1 Max all publish 极高 / 最高). Not yet observed on a
  // completed request, so `verified` stays false and the probe reports it.
  { id: 'xhigh', name: '极高', level: 6, verified: false },
  { id: 'max',   name: '最高', level: 7, verified: false },
]

/** The level used when a request names none. Verified on the wire. */
export const DEFAULT_REASONING_LEVEL_ID = 'high'

/** Reasoning level for an id, falling back to the default. */
export function findReasoningLevel(id: string | undefined): DoubaoReasoningLevel {
  const known = DOUBAO_REASONING_LEVELS.find((level) => level.id === id)
  if (known !== undefined) return known
  // A bare ordinal. The client menu is not limited to the rungs this catalog
  // names: 自动 publishes 中 at 8, and collapsing that to the default would send
  // 高 instead of the level the user actually picked.
  if (id !== undefined && /^\d{1,3}$/.test(id)) {
    const ordinal = Number(id)
    const named = DOUBAO_REASONING_LEVELS.find((level) => level.level === ordinal)
    if (named !== undefined) return named
    return { id, name: String(ordinal), level: ordinal, verified: false }
  }
  return DOUBAO_REASONING_LEVELS.find((level) => level.id === DEFAULT_REASONING_LEVEL_ID)!
}

/** The catalog entry for a wire ordinal, or undefined for one it does not know. */
export function reasoningLevelOf(ordinal: number | undefined): DoubaoReasoningLevel | undefined {
  if (ordinal === undefined) return undefined
  return DOUBAO_REASONING_LEVELS.find((level) => level.level === ordinal)
}

/**
 * The wire spelling of an ordinal.
 *
 * `model_extra_params.reasoning_effort` for 2.1 Lite is a STRING in the captured
 * request, and that string is the level's name-id, not its number. An ordinal
 * with no catalog entry falls back to its own decimal form, so a level Doubao
 * adds later still travels instead of snapping back to 高.
 */
export function levelIdOf(ordinal: number): string {
  return reasoningLevelOf(ordinal)?.id ?? String(ordinal)
}

/**
 * `need_deep_think` / `ext.use_deep_think` — the 深度思考 switch.
 *
 * CDP-captured 2026-10-23, the same conversation sent with the switch OFF and ON:
 *
 *   off →  option.need_deep_think: 0   ext.use_deep_think: "0"
 *   on  →  option.need_deep_think: 3   ext.use_deep_think: "3"
 *
 * `3` is what the switch sends — NOT `10000 + reasoning_effort`. That shape
 * (10005 at 高) was this plugin's own invention, and sending it produced no
 * thinking at all: every frame still carried `block_type: 10000` and the reply
 * agent was `pc_general_nocot_agent` (no-CoT).
 *
 * The two axes are independent: effort still travels as `reasoning_effort`
 * 3/4/5, while this flag only says whether the model may think before answering.
 */
export const DEEP_THINK_OFF = 0
export const DEEP_THINK_ON = 3

/** `need_deep_think` value for the switch state. */
export function needDeepThinkValue(deepThink: boolean): number {
  return deepThink ? DEEP_THINK_ON : DEEP_THINK_OFF
}

/* ------------------------------------------------------------------ *
 * Skills — the capability axis, separate from the model axis
 * ------------------------------------------------------------------ */

/**
 * Doubao's skill table, transcribed verbatim from the client bundle
 * (`{FreeChat:0, SkillWrite:2, SkillImageGen:3, …}`), not inferred.
 *
 * `skill_id` is the decimal string of `skill_type`; the two are ALWAYS the same
 * number, which is why a plain turn carries `{"skill_id":"0","skill_type":0}`.
 * On the wire it is a JSON STRING inside `ext.input_skill`.
 *
 * There is no separate HTTP endpoint for text-to-image in the client — the only
 * generation URL is `/creativity/canvas/exec`, which is the image EDITOR
 * (cutout / outpaint / layer split). So a skill turn must go through
 * `/chat/completion`, and it does: verified 2026-11-02, `skill_type: 3` returns
 * real `rc_gen_image/*.jpeg` artefacts from Seedream 5.0.
 */
export const DOUBAO_SKILLS = {
  freeChat: 0,
  write: 2,
  imageGen: 3,
  search: 4,
  translate: 5,
  read: 6,
  webpage: 7,
  deepSearch: 8,
  musicGen: 9,
  edu: 11,
  codeInterpreter: 13,
  codeAssistant: 16,
  videoGeneration: 17,
  aiPPT: 18,
} as const

export type DoubaoSkillName = keyof typeof DOUBAO_SKILLS

/** The `ext.input_skill` JSON string for a skill; undefined means plain chat. */
export function inputSkillOf(skill: DoubaoSkillName | undefined): string | undefined {
  if (skill === undefined || skill === 'freeChat') return undefined
  const type = DOUBAO_SKILLS[skill]
  return JSON.stringify({ skill_id: String(type), skill_type: type, variables: {} })
}

/**
 * `block_type` of a creation (image-generation) block.
 *
 * Shape, from a captured stream:
 *   content.creation_block.creations[] = {
 *     type: 1,                       // 1 = image
 *     id: "<task id>",
 *     image: { key, status, image_ori{url,width,height}, image_preview{…}, image_thumb{…} }
 *   }
 */
export const CREATION_BLOCK_TYPE = 2074

/**
 * DSH-side alias for "generate an image".
 *
 * NOT a Doubao `model_item_key` — Doubao has no model by this name. Selecting it
 * makes the shim send an ordinary chat turn with `input_skill: imageGen`, and
 * Doubao answers with Seedream. Keeping it in the catalog is what puts 生图 in
 * DSH's model picker without inventing a second UI.
 */
export const DOUBAO_IMAGE_MODEL_ID = 'image-gen'
/**
 * IMAGEGEN_LABEL_OVERLAY: 生图版本名以插件根目录的 image-models.json 为准，
 * 该文件由 doubao_imagemodels.py --sync 从服务端 get_item_conf 生成。
 */
function imageModelLabelFromOverlay(): string | undefined {
  try {
    const url = new URL('../image-models.json', import.meta.url)
    const parsed = JSON.parse(readFileSync(url, 'utf8')) as { label?: unknown }
    return typeof parsed.label === 'string' && parsed.label !== '' ? parsed.label : undefined
  } catch {
    return undefined
  }
}

export const DOUBAO_IMAGE_MODEL_NAME =
  imageModelLabelFromOverlay() ?? '豆包 生图（Seedream 5.5）'

/** The chat model a skill turn rides on: the app's own default. */
export const SKILL_CARRIER_MODEL_ID = '0'

export interface DoubaoModelInfo {
  /**
   * Catalog id, and the exact `model_item_key` to put on the wire. These are the
   * same string on purpose: DSH keys every join on the model id, so keeping them
   * identical removes a translation layer that could only be wrong.
   */
  id: string
  /** UI name, verbatim from the desktop app's picker. */
  name: string
  /**
   * Status badge shown next to the name, exactly as the app renders it.
   * `undefined` when the app shows no badge.
   *
   * Note 「即将下线」 is NOT a property of the Turbo model: the app publishes
   * TWO Turbo entries and only the retiring one carries it.
   */
  badge?: string
  /**
   * Whether this route can actually think.
   *
   * NOT the same as "the app shows a reasoning-effort picker for it": the picker
   * is drawn from the app's own model menu, while this flag is what DSH uses to
   * decide whether to offer 低/中/高 at all. Measured 2026-11-07 — see
   * {@link NO_THINKING_MODEL_IDS}.
   */
  reasoning: boolean
  /** True when the model runs in 「工作任务」 (`mode_id: "3"`, `agent_mode: 1`) mode. */
  taskMode?: boolean
  /**
   * Billing-multiplier tag exactly as the client menu renders it ("0.65x"), or
   * a campaign label ("限时优惠 0.01x").
   *
   * DISPLAY ONLY. The plugin bills nothing and cannot verify what the server will
   * charge, so this is the client's own claim, shown unchanged and attributed.
   */
  rate?: DoubaoModelRate
  /**
   * The thinking levels THIS model offers, in the client menu's own order.
   *
   * Absent on entries read from the IndexedDB cache (that source carries no
   * config) and on the static catalog, where the catalog-wide list applies. It
   * matters because the menu is per-model: GLM publishes 低/高/最高 while 2.1 Lite
   * publishes 低/中/高, so one shared list is wrong for at least one of them.
   */
  reasoningOptions?: readonly DoubaoReasoningOption[]
}

/** A menu tag that states a price multiplier or a campaign. */
export interface DoubaoModelRate {
  /** The tag text verbatim, e.g. "0.65x" or "限时优惠 0.01x". */
  text: string
  /** `ratio` is a plain multiplier; `promo` is a campaign label. */
  kind: 'ratio' | 'promo'
}

/** One selectable thinking level, as the client declares it for ONE model. */
export interface DoubaoReasoningOption {
  /** Doubao's ordinal, sent as `reasoning_effort`. */
  level: number
  /** The client's own label for it (低 / 中 / 高 / 极高 / 最高). */
  name: string
}

/**
 * The entries DSH may offer.
 *
 * WHY THESE ENTRIES. Doubao groups models by MODE, and the model list is per-mode:
 *
 *   对话       → 豆包 快速 (0), 豆包 2.1 Turbo·专家 (3)
 *   工作任务   → 自动 (9), 2.1 Lite (seed-lite-7b), 2.1 Pro (5), Turbo (3)
 *
 * The 「工作任务」 group (`seed-lite-7b`, `5`, `9`) runs through `Agent-GeneralTask`
 * (`mode_id: "3"`, `agent_mode: 1`) and is accompanied by an HTTP `tool_local`
 * workspace responder (`msg/ack` -> `upload_command_result` -> `msg/complete`)
 * so external turns complete without `710010702`.
 *
 * MEASURED, 2026-10-22: `model_item_key` is forwarded verbatim (the server stores
 * it on the message), but in 对话 mode it does NOT change what answers —
 * 0 / 3 / 5 / seed-lite-7b AND a deliberately bogus key all returned answers of
 * indistinguishable length and latency (12.3–14.0 s). So this list is honest
 * about what the PICKER can offer; it does not claim per-key routing.
 *
 * 「豆包 快速」 leads because it is the app's own chat-mode default, so an
 * unconfigured install reproduces the app rather than something that merely
 * happens to work.
 */
export const DOUBAO_MODELS: readonly DoubaoModelInfo[] = [
  // 「豆包 快速」 is the no-CoT route: measured 2026-11-07 with the 深度思考
  // switch ON and effort 高, the reply still came back `thinking: false` and the
  // frames carried no 10040 container, while the same request on 2.1 Pro flipped
  // to `thinking: true`. Declaring `reasoning: false` is therefore what makes the
  // picker honest — it stops offering 低/中/高 on a route that cannot think.
  { id: '0', name: '豆包 快速', reasoning: false },
  { id: '3', name: '豆包 2.1 Turbo', badge: '专家', reasoning: true },
  { id: 'seed-lite-7b', name: '豆包 2.1 Lite', badge: '工作任务', reasoning: true, taskMode: true },
  { id: '5', name: '豆包 2.1 Pro', badge: '工作任务', reasoning: true, taskMode: true },
  { id: '9', name: '自动', badge: '工作任务', reasoning: true, taskMode: true },
  // Not a Doubao model_item_key — a DSH-side capability alias. Selecting it runs
  // a chat turn under `input_skill: imageGen`, and Doubao answers with real
  // generated images (Seedream 5.0), verified live 2026-11-02.
  { id: DOUBAO_IMAGE_MODEL_ID, name: DOUBAO_IMAGE_MODEL_NAME, reasoning: true },
]

/** True when `id` is a 「工作任务」-mode model (`seed-lite-7b`, `5`, `9`). */
export function isTaskModel(id: string | undefined): boolean {
  if (id === undefined) return false
  return DOUBAO_MODELS.some((model) => model.id === id && model.taskMode === true)
}

/**
 * Entries that exist in the desktop app but are deliberately NOT offered here.
 *
 * Kept as data rather than a comment so the README and any future UI can state
 * the reason from one place — and so re-adding one is a deliberate act that has
 * to confront this note.
 */
export const DOUBAO_UNAVAILABLE_MODELS: readonly { id: string; name: string; reason: string }[] = [
  { id: '4', name: '豆包 2.1 Turbo（即将下线）', reason: '客户端已用「即将下线」标注，不引导用户选择' },
]

/**
 * The model used when a request names none.
 *
 * 「豆包 快速」 is the app's own chat-mode default — `menuConfV2`'s
 * `default_select_mode_map.chat` points at it — so leaving it unnamed here
 * reproduces what the desktop app would have done. Spelled out rather than
 * taken from `DOUBAO_MODELS[0]`, so reordering the list cannot silently change
 * which model an unconfigured session gets.
 */
export const DOUBAO_DEFAULT_MODEL_ID = '0'

/**
 * Catalog entry for a model id, falling back to {@link DOUBAO_DEFAULT_MODEL_ID}.
 *
 * An id the catalog does not know resolves to the default rather than throwing:
 * a stale id in a saved session should degrade to a working model, not break
 * the request. `describeRequestedModel` in the shim is what surfaces the miss.
 */
export function findDoubaoModel(id: string | undefined): DoubaoModelInfo {
  if (id === undefined) return DOUBAO_MODELS.find((model) => model.id === DOUBAO_DEFAULT_MODEL_ID)!
  const known = DOUBAO_MODELS.find((model) => model.id === id)
  if (known !== undefined) return known
  // A DISCOVERED model: the client menu listed it after this release shipped, so
  // this catalog has no name or badge for it — but the key is real, and forwarding
  // it verbatim is the only honest option. Falling back to the default would send
  // 豆包 快速 instead and make the picker entry a lie.
  return { id, name: id, reasoning: true }
}

/** True when the key is a catalog entry this release knows by name. */
export function isKnownModelId(id: string | undefined): boolean {
  return id !== undefined && DOUBAO_MODELS.some((model) => model.id === id)
}

/** Entries as pi-ai-shaped descriptors, for model discovery. */
export interface DiscoveredDoubaoModel {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  inputModalities: ('text' | 'image')[]
  reasoning: boolean
}

/**
 * Model ids measured to never think, whatever the 深度思考 switch says.
 *
 * 「豆包 快速」 is served by a no-CoT agent: with the switch ON and effort 高 the
 * reply still came back `thinking: false` and the frames carried no 10040
 * container, while the identical request on 2.1 Pro flipped to `thinking: true`.
 * Discovered catalogs come from the client's own menu dump, which marks every
 * entry as reasoning-capable, so this set has to be applied AFTER discovery —
 * otherwise the picker would keep advertising a control that does nothing.
 */
export const NO_THINKING_MODEL_IDS: ReadonlySet<string> = new Set(['0'])

/** Whether a model can think, by measurement rather than by menu declaration. */
export function supportsReasoning(id: string): boolean {
  return !NO_THINKING_MODEL_IDS.has(id)
}

/**
 * Publish the catalog as pi-ai model descriptors.
 *
 * `models` defaults to the static list but is normally the DISCOVERED one — the
 * caller passes whatever the client cache currently reports, so a model Doubao
 * ships appears without a plugin release.
 */
export function discoverDoubaoModels(
  models: readonly DoubaoModelInfo[] = DOUBAO_MODELS,
): DiscoveredDoubaoModel[] {
  return models.map((model) => ({
    id: model.id,
    name: model.badge === undefined ? model.name : `${model.name} · ${model.badge}`,
    contextWindow: DOUBAO_CONTEXT_WINDOW,
    maxTokens: DOUBAO_MAX_TOKENS,
    // Text-only: this route sends one Doubao text_block and never forwards
    // image parts, so advertising otherwise would be a lie the picker honours.
    inputModalities: ['text'],
    reasoning: model.reasoning,
  }))
}

/**
 * Narrow the catalog to the ids the user has ticked.
 *
 * Selecting an entry now genuinely selects a model, so this is a real
 * restriction — but it still only decides WHICH ENTRIES APPEAR IN DSH's MODEL
 * PICKER; the per-request choice is made by the DSH session, not here.
 *
 * `undefined` (never configured) serves the whole catalog: a first-run install
 * must show its models. Ids that no longer exist are dropped.
 *
 * A model DISCOVERED after the user last saved is kept even when it is not in
 * their tick list — otherwise a new Doubao release would be invisible until the
 * user thought to reopen the card and re-save, which is exactly the staleness
 * this path exists to remove.
 */
export function enabledModelsOf(
  enabledIds: string[] | undefined,
  models: readonly DoubaoModelInfo[] = DOUBAO_MODELS,
): DoubaoModelInfo[] {
  if (enabledIds === undefined || enabledIds.length === 0) return [...models]
  const wanted = new Set(enabledIds)
  const known = new Set(DOUBAO_MODELS.map((model) => model.id))
  return models.filter((model) => wanted.has(model.id) || !known.has(model.id))
}

/** One catalog entry as the card's checklist consumes it. */
export interface DoubaoCatalogEntry {
  /** The real `model_item_key`. */
  id: string
  name: string
  /** Status badge, or null when the app shows none. */
  badge: string | null
  /** Billing-multiplier / campaign tag from the client, or null. Display only. */
  rate: DoubaoModelRate | null
  /** Reasoning-effort levels this model offers. */
  reasoningLevels: Array<{ id: string; name: string; level: number; verified: boolean }>
}

export function doubaoCatalogEntries(
  models: readonly DoubaoModelInfo[] = DOUBAO_MODELS,
): DoubaoCatalogEntry[] {
  return models.map((model) => ({
    id: model.id,
    name: model.name,
    badge: model.badge ?? null,
    rate: model.rate ?? null,
    // Empty for a no-CoT route. Advertising 低/中/高 here while the DSH picker
    // hides them would make the card and the picker disagree about the same
    // model, and the card is the one a user checks first.
    //
    // A discovered model states its OWN list, so the card shows that instead of
    // the catalog-wide default — the two disagree exactly where a user looks.
    reasoningLevels: model.reasoning
      ? model.reasoningOptions !== undefined && model.reasoningOptions.length > 0
        ? model.reasoningOptions.map((option) => ({
          id: levelIdOf(option.level),
          name: option.name,
          level: option.level,
          verified: reasoningLevelOf(option.level)?.verified ?? false,
        }))
        // No per-model list (the static catalog, the IndexedDB source, and the image
        // alias): offer only the levels MEASURED on a real request. Advertising 极高 /
        // 最高 here would promise a rung nothing has exercised — the image alias in
        // particular rides 豆包快速, which cannot think at all.
        : DOUBAO_REASONING_LEVELS.filter((level) => level.verified).map((level) => ({
          id: level.id,
          name: level.name,
          level: level.level,
          verified: level.verified,
        }))
      : [],
  }))
}