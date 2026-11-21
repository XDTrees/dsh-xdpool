import { describe, expect, it } from 'vitest'
import {
  ACCIO_BUCKETS,
  ACCIO_GATEWAY,
  ACCIO_LLM_PATH,
  normalizeAccioModel,
} from '../src/accio-protocol.ts'
import { parseAccioCredential } from '../src/accio-store.ts'

/**
 * Accio's protocol facts.
 *
 * The gateway is Gemini-shaped with the token inside the body, and the catalogue is nested and
 * filtered — two things that fail in ways which read like something else.
 */
describe('the wire', () => {
  it('is a different shape from the OpenAI channels', () => {
    // `/api/adk/llm/generateContent`, not `/v1/chat/completions`. Sharing the OpenAI wire would
    // be answered as an unknown route.
    expect(ACCIO_LLM_PATH).toBe('/api/adk/llm/generateContent')
    expect(ACCIO_GATEWAY).toContain('alibaba.com')
  })
})

describe('the catalogue', () => {
  it('keeps a visible row and reads its real limits', () => {
    const model = normalizeAccioModel({
      visible: true,
      modelCode: 'code-1',
      modelDisplayName: 'Qwen Test',
      contextWindow: 1_000_000,
      maxTokens: 64_000,
      effectiveMultiple: 0.5,
      multimodal: true,
    })
    expect(model?.id).toBe('code-1')
    expect(model?.name).toBe('Qwen Test')
    expect(model?.contextWindow).toBe(1_000_000)
    expect(model?.multiple).toBe(0.5)
    expect(model?.supportsImage).toBe(true)
  })

  it('drops a row that is not explicitly visible', () => {
    /**
     * The exclusion test is `visible !== true`, not `visible === false` — a retired row may
     * omit the field entirely, and treating that as visible would list models that cannot answer.
     */
    expect(normalizeAccioModel({ modelCode: 'x', visible: false })).toBeUndefined()
    expect(normalizeAccioModel({ modelCode: 'x' })).toBeUndefined()
  })

  it('reads a null effort list as "no ladder"', () => {
    /**
     * `reasoningEfforts` is present but null on most rows. A truthiness test would call every
     * model reasoning-capable and make the host send an effort the gateway ignores.
     */
    const model = normalizeAccioModel({ visible: true, modelCode: 'x', reasoningEfforts: null })
    expect(model?.efforts).toBeUndefined()
  })

  it('keeps a real effort list', () => {
    const model = normalizeAccioModel({
      visible: true,
      modelCode: 'x',
      reasoningEfforts: ['low', 'high'],
      defaultReasoningEffort: 'high',
    })
    expect(model?.efforts).toEqual(['low', 'high'])
    expect(model?.defaultEffort).toBe('high')
  })

  it('drops a row with no modelCode', () => {
    // The code is what the request carries; a row without one names nothing callable.
    expect(normalizeAccioModel({ visible: true, modelDisplayName: 'Ghost' })).toBeUndefined()
  })
})

describe('the quota buckets', () => {
  it('reports the three allowances separately', () => {
    /**
     * Daily, monthly and referral are separate pools — spending one does not touch another, so
     * summing them would misreport every account that has more than one.
     */
    expect(ACCIO_BUCKETS.map(bucket => bucket.key)).toEqual(['daily', 'monthly', 'referral'])
  })
})

describe('reading a pasted credential', () => {
  it('takes a bare token', () => {
    expect(parseAccioCredential('tok').accessToken).toBe('tok')
  })

  it('reads a JSON blob with both tokens', () => {
    const parsed = parseAccioCredential(JSON.stringify({ access_token: 'A', refresh_token: 'R' }))
    expect(parsed.accessToken).toBe('A')
    expect(parsed.refreshToken).toBe('R')
  })

  it('answers nothing for empty input', () => {
    expect(parseAccioCredential('  ')).toEqual({})
  })
})
