import { describe, expect, it } from 'vitest'
import { menuFromHtml, modelsFromMenu, rateFromTags } from '../src/doubao-menu.ts'

/**
 * The model menu, read from the page's own HTML.
 *
 * Doubao has no frontend endpoint for it: `slot/action_bar_v3/brief_list` answers only the skill
 * strip, and the roster is fetched by the page's server-side loader and inlined. Reading the
 * desktop client's IndexedDB worked but made the catalogue depend on having the client — so a
 * user who signed in through this plugin's browser window saw only the baseline six.
 */
describe('reading the menu out of the page', () => {
  /**
   * The value is inlined as a deep, brace-heavy JSON object inside a `<script>`. A regex cannot
   * find its end, which is why the reader walks brackets and tracks string state.
   */
  it('extracts a nested object and stops at its closing brace', () => {
    const html = `<!doctype html><html><script>window.__X__={"other":1,"modeSelectData":{"a":{"b":{"c":"}"}}},"after":2}</script></html>`
    const menu = menuFromHtml(html) as Record<string, unknown>
    expect(menu).toBeDefined()
    expect((menu['a'] as Record<string, unknown>)['b']).toEqual({ c: '}' })
  })

  it('is not fooled by a brace inside a string', () => {
    const html = `{"modeSelectData":{"name":"a}b","deep":{"ok":true}}}`
    expect(menuFromHtml(html)).toEqual({ name: 'a}b', deep: { ok: true } })
  })

  it('returns undefined when the key is absent', () => {
    expect(menuFromHtml('<html></html>')).toBeUndefined()
  })
})

/**
 * One menu entry.
 *
 * The fields were read off a live account: `model_extra_params.total_window_size` is the window,
 * `reasoning_effort_config.option_list` is the ladder, `tag_list` carries the multiplier, and
 * `subscribe_config.need_upgrade` marks a model this account has not bought.
 */
describe('one model entry', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    model_item_key: 'person-kimi-k3-261111',
    name: 'Kimi K3',
    model_extra_params: { total_window_size: '300000' },
    reasoning_effort_config: { option_list: [{ level: 3 }, { level: 4 }, { level: 5 }] },
    tag_list: [{ text: '1.48x' }],
    ...over,
  })

  const parse = (item: Record<string, unknown>) => modelsFromMenu({ modeSelectConfig: { menu_item_list: [item] } })

  it('reads the key, name, window, ladder and rate', () => {
    const [model] = parse(entry())
    expect(model?.id).toBe('person-kimi-k3-261111')
    expect(model?.name).toBe('Kimi K3')
    expect(model?.contextWindow).toBe(300000)
    expect(model?.rate).toBe('1.48x')
    expect(model?.efforts).toEqual(['low', 'medium', 'high'])
  })

  it('keeps the ladder PER MODEL', () => {
    // GLM publishes 低/高/最高 while 2.1 Lite publishes 低/中/高 — one shared list is wrong for
    // at least one of them, and offering a level upstream rejects fails the request.
    const [glm] = parse(entry({
      model_item_key: 'person-glm-5-3-261111',
      reasoning_effort_config: { option_list: [{ level: 3 }, { level: 5 }, { level: 7 }] },
    }))
    expect(glm?.efforts).toEqual(['low', 'high', 'max'])
  })

  it('skips a model the account has not subscribed to', () => {
    // Showing it would put a model in the picker that answers an upgrade prompt, not a reply.
    expect(parse(entry({ subscribe_config: { need_upgrade: true } }))).toHaveLength(0)
  })

  it('keeps a model the account HAS subscribed to', () => {
    expect(parse(entry({ subscribe_config: { need_upgrade: false } }))).toHaveLength(1)
  })

  it('survives a missing window or ladder', () => {
    const [model] = parse({ model_item_key: 'x', name: 'X' })
    expect(model?.id).toBe('x')
    expect(model?.contextWindow).toBeUndefined()
    expect(model?.efforts).toBeUndefined()
    expect(model?.reasoning).toBe(false)
  })

  it('does not list the same key twice', () => {
    const twice = modelsFromMenu({ modeSelectConfig: { menu_item_list: [entry(), entry()] } })
    expect(twice).toHaveLength(1)
  })
})

describe('the multiplier tag', () => {
  it('reads a bare rate', () => {
    expect(rateFromTags([{ text: '1.44x' }])).toBe('1.44x')
  })

  it('keeps a promotion verbatim', () => {
    // `限时优惠 0.01x` is a campaign, not a price; flattening it would state something the
    // vendor did not.
    expect(rateFromTags([{ text: '限时优惠 0.01x' }])).toBe('限时优惠 0.01x')
  })

  it('reports a free tag that carries no number', () => {
    expect(rateFromTags([{ text: '小额免费' }])).toBe('小额免费')
  })

  it('returns undefined when there is no rate at all', () => {
    expect(rateFromTags([])).toBeUndefined()
    expect(rateFromTags(undefined)).toBeUndefined()
    expect(rateFromTags([{ text: '新' }])).toBeUndefined()
  })
})
