/**
 * The Marvis model catalogue.
 *
 * `model` on the wire is a SLOT name (`main-auto`), which the service routes to a real model per
 * account — and the real name comes back in the response's `model` field. So the display name is
 * the real model, and the id is the slot. Showing the slot name would tell a reader nothing about
 * what actually answered.
 *
 * @module dsh-xdpool/marvis-models
 */

/** One catalogue row. */
export interface MarvisModel {
  /** The slot name to send as `model`. */
  id: string
  /** The real model this slot has been measured to serve. */
  name: string
  contextWindow: number
  /** The reasoning ladder this model accepts, when it reasons at all. */
  efforts?: readonly string[]
  vision?: boolean
  tools?: boolean
}

/**
 * The eight models the account can use.
 *
 * The `auto` family (`main-auto`, `file-auto`, `computer-auto`, `browser-auto`) all route to the
 * same model in measurement, so only `main-auto` is listed — four identically-named rows would
 * only make the picker noisy.
 *
 * `deepseek-v4-pro-external` is kept because the auto family is re-routed PER ACCOUNT on the
 * server side, while that slot is a fixed mapping — it is the substitute when an account has been
 * moved. Its display name carries a pure-ASCII suffix: spaces and full-width brackets in a model
 * name have been observed to stall some clients during the reply phase.
 */
export const MARVIS_MODELS: readonly MarvisModel[] = [
  {
    id: 'main-auto',
    name: 'deepseek-v4-1-flash-261017',
    contextWindow: 1_000_000,
    efforts: ['low', 'high', 'max'],
    vision: true,
    tools: true,
  },
  {
    id: 'deepseek-v4-pro-external',
    name: 'deepseek-v4-1-flash-261017-antidowngrade',
    contextWindow: 1_000_000,
    efforts: ['low', 'high', 'max'],
    vision: true,
    tools: true,
  },
  {
    id: 'hy3-preview-agent',
    name: 'deepseek-v4-flash-ga-260731',
    contextWindow: 1_000_000,
    efforts: ['low', 'high', 'max'],
    tools: true,
  },
  {
    id: 'hy3-preview-agent-real',
    name: 'hy3',
    contextWindow: 1_000_000,
    efforts: ['low', 'high', 'max'],
    tools: true,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'claude-sonnet-4-6',
    contextWindow: 1_000_000,
    efforts: ['low', 'high', 'max'],
    vision: true,
    tools: true,
  },
  {
    id: 'claude-opus-4-6',
    name: 'claude-opus-4-6',
    contextWindow: 1_000_000,
    efforts: ['low', 'high', 'max'],
    vision: true,
    tools: true,
  },
  {
    id: 'gpt-5.4',
    name: 'gpt-5.4-2026-03-05',
    contextWindow: 1_000_000,
    efforts: ['low', 'high', 'max'],
    vision: true,
    tools: true,
  },
  {
    id: 'hunyuan-turbos-vision',
    name: 'HY-Vision-2.0-instruct',
    // The vision model publishes a much smaller window than the text ones, and claiming a
    // million here would let the host size a compaction against a limit nobody promised.
    contextWindow: 32_000,
    vision: true,
  },
]

/** The model a request falls back to. */
export const MARVIS_DEFAULT_MODEL = 'main-auto'

/** One entry by id, or undefined. */
export function findMarvisModel(id: string): MarvisModel | undefined {
  return MARVIS_MODELS.find(model => model.id === id)
}
