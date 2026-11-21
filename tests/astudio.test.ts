import { describe, expect, it } from 'vitest'
import {
  ASTUDIO_CHAT_PATH,
  ASTUDIO_DAILY_REWARD_COMPONENT,
  ASTUDIO_DEFAULT_MODEL,
  ASTUDIO_MODELS,
  ASTUDIO_RESPONSES_PATH,
  ASTUDIO_WEB,
  findAstudioModel,
} from '../src/astudio-models.ts'
import { parseAstudioCredential } from '../src/astudio-routes.ts'

/**
 * AStudio's protocol facts.
 *
 * The channel separates the web account from the model gateway, and each needs its own
 * credential; the daily reward is proven by a ledger line rather than by the claim's own reply.
 */
describe('the catalogue', () => {
  it('carries the measured models', () => {
    expect(ASTUDIO_MODELS.length).toBeGreaterThanOrEqual(7)
    expect(findAstudioModel('spark-x2.6')).toBeDefined()
    expect(findAstudioModel(ASTUDIO_DEFAULT_MODEL)).toBeDefined()
  })

  it('declares the window each model actually has', () => {
    // Spark-X2.6 is a 256K model; the 1M rows are the ones the vendor publishes as such.
    expect(findAstudioModel('spark-x2.6')?.contextWindow).toBe(256_000)
    expect(findAstudioModel('xopglm52')?.contextWindow).toBe(1_000_000)
  })

  it('marks the launch promotion as free', () => {
    // The Lite row is the one the vendor gives away, and saying so is what makes it findable.
    const free = ASTUDIO_MODELS.filter(model => model.free === true)
    expect(free.length).toBeGreaterThan(0)
    expect(free[0]?.id).toBe('spark-x2.6-4b')
  })

  it('gives every model the ladder the gateway accepts', () => {
    for (const model of ASTUDIO_MODELS) {
      expect(model.efforts, model.id).toContain('none')
      expect(model.efforts, model.id).toContain('high')
      expect(model.efforts, model.id).toContain('max')
    }
  })
})

describe('the endpoints', () => {
  it('separates the gateway from the web account', () => {
    /**
     * The model call and the points read are different hosts with different auth — a bearer
     * for one, cookies for the other. Confusing them is answered as an unauthenticated request.
     */
    expect(ASTUDIO_WEB).toContain('agent.xfyun.cn')
    expect(ASTUDIO_CHAT_PATH).toContain('/model-gateway/')
    expect(ASTUDIO_RESPONSES_PATH).toBe('/model-gateway/v1/responses')
  })

  it('names the popup that carries the daily reward', () => {
    // The field is `componentType`; reading `type` finds nothing and reports 「已领取」 forever.
    expect(ASTUDIO_DAILY_REWARD_COMPONENT).toBe('DAILY_REWARD_DIALOG')
  })
})

describe('reading a pasted credential', () => {
  it('takes a bare JWT', () => {
    expect(parseAstudioCredential('a.b.c').bearer).toBe('a.b.c')
  })

  it('takes a cookie string and its account id', () => {
    const parsed = parseAstudioCredential('ssoSessionId=S; account_id=A1')
    expect(parsed.cookie).toContain('ssoSessionId=S')
    expect(parsed.accountId).toBe('A1')
  })

  it('takes a whole session document', () => {
    /**
     * The user copies `astron-session.json`, which carries the bearer, the uid and the session
     * together. All three are used: the bearer for the gateway, the other two for points.
     */
    const parsed = parseAstudioCredential(JSON.stringify({
      modelBearerToken: 'B',
      accountId: 'U1',
      ssoSessionId: 'S1',
    }))
    expect(parsed.bearer).toBe('B')
    expect(parsed.accountId).toBe('U1')
    expect(parsed.cookie).toContain('ssoSessionId=S1')
  })

  it('answers nothing for empty input', () => {
    expect(parseAstudioCredential('   ')).toEqual({})
  })
})
