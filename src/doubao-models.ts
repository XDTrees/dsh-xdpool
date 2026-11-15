/**
 * The Doubao model list, as plain data.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * The card renders this list, and the card runs in the BROWSER. Importing it from
 * `doubao-llm.ts` dragged that module's whole dependency chain — `doubao-auth.ts`, which
 * spawns a browser and reads the filesystem — into the client bundle. A bundle containing
 * `node:fs` cannot load in a page, so the plugin's entry disappeared entirely: present and
 * enabled in the plugin list, absent from the sidebar and the settings page.
 *
 * So the DATA lives here with no imports at all, and both halves read it: the host's lane for
 * the ids it sends, the card for the names it draws.
 *
 * @module dsh-xdpool/doubao-models
 */

/** One catalog entry, as the reference implementation measured it. */
export interface DoubaoModelInfo {
  /** Catalog id, and the exact `model_item_key` to put on the wire. */
  id: string
  name: string
  /** Where the model lives: chat turns, or the work-task lane. */
  badge?: string
  /** Whether the model exposes reasoning levels. */
  reasoning?: boolean
}

/**
 * The models Doubao publishes.
 *
 * Every id was read off a real request the desktop app sent, not inferred. ⚠️ The encoding is
 * MIXED: `seed-lite-7b` is a string slug, `3`/`5`/`9` are numeric enum values — they travel as
 * JSON strings either way and must be forwarded verbatim, never parsed to a number.
 */
export const DOUBAO_MODELS: readonly DoubaoModelInfo[] = [
  { id: '0', name: '豆包 快速', reasoning: false },
  { id: '3', name: '豆包 2.1 Turbo', badge: '专家', reasoning: true },
  { id: 'seed-lite-7b', name: '豆包 2.1 Lite', badge: '工作任务', reasoning: true },
  { id: '5', name: '豆包 2.1 Pro', badge: '工作任务', reasoning: true },
  { id: '9', name: '自动', badge: '工作任务', reasoning: true },
  // Not a Doubao model_item_key — a capability alias: selecting it runs a chat turn under
  // `input_skill: imageGen`, and Doubao answers with real generated images.
  { id: 'image-gen', name: '豆包 生图', reasoning: true },
]

/** The listing rows the card and the lane both show. */
export function doubaoListing(): readonly { id: string; name: string; description?: string }[] {
  return DOUBAO_MODELS.map(model => {
    const parts: string[] = []
    if (model.badge !== undefined && model.badge !== '') parts.push(model.badge)
    if (model.reasoning === true) parts.push('推理')
    return {
      id: model.id,
      name: model.name,
      ...(parts.length === 0 ? {} : { description: parts.join(' · ') }),
    }
  })
}
