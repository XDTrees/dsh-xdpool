import { describe, expect, it } from 'vitest'
import {
  AUTOCLAW_CN,
  AUTOCLAW_INTL,
  AUTOCLAW_MODELS,
  AUTOCLAW_SYSTEM_PREFIX,
  AUTOCLAW_WALLET_LABELS,
  autoclawSign,
  parseAutoclawCredential,
} from '../src/autoclaw-protocol.ts'

/**
 * AutoClaw's protocol facts.
 *
 * The gateway wants a signature on every request and a fixed system prefix in every body; either
 * one missing is answered as an auth failure, which reads like a broken account.
 */
describe('the two sites', () => {
  it('uses entirely different hosts', () => {
    expect(AUTOCLAW_INTL.apiBase).toContain('autoglm.ai')
    expect(AUTOCLAW_CN.apiBase).toContain('zhipuai.cn')
    expect(AUTOCLAW_INTL.apiBase).not.toBe(AUTOCLAW_CN.apiBase)
  })

  it('registers two distinct provider ids', () => {
    expect(AUTOCLAW_INTL.id).not.toBe(AUTOCLAW_CN.id)
  })
})

describe('the signature', () => {
  it('is md5 of appId & timestamp & appKey', () => {
    // 32 lowercase hex characters, and deterministic for the same inputs.
    const signature = autoclawSign('1700000000000')
    expect(signature).toMatch(/^[0-9a-f]{32}$/u)
    expect(autoclawSign('1700000000000')).toBe(signature)
  })

  it('changes with the timestamp', () => {
    // A fixed signature would be a replay; the vendor would reject every request after the first.
    expect(autoclawSign('1700000000000')).not.toBe(autoclawSign('1700000000001'))
  })
})

describe('the system prefix', () => {
  it('is the sentence the proxy looks for', () => {
    // Copied verbatim: a paraphrase is not recognised.
    expect(AUTOCLAW_SYSTEM_PREFIX).toContain('You are AutoClaw')
    expect(AUTOCLAW_SYSTEM_PREFIX).toContain('concisely')
  })
})

describe('the models', () => {
  it('carries the free flash model the remote catalogue omits', () => {
    /**
     * It is the only free option, and the vendor's catalogue does not list it — so it lives in
     * this table or nowhere.
     */
    const free = AUTOCLAW_MODELS.filter(model => model.free)
    expect(free).toHaveLength(1)
    expect(free[0]?.id).toBe('zai_glm-5.3-flash')
  })

  it('offers the coding and auto routes', () => {
    const ids = AUTOCLAW_MODELS.map(model => model.id)
    expect(ids).toContain('zaicoding_glm-5.3')
    expect(ids).toContain('zai_auto')
  })
})

describe('the wallet vocabulary', () => {
  it('names the buckets the way the vendor does', () => {
    // A user comparing the card with the console needs the same words.
    expect(AUTOCLAW_WALLET_LABELS['reward']).toBe('奖励积分')
    expect(AUTOCLAW_WALLET_LABELS['daily']).toBe('每日积分')
    expect(AUTOCLAW_WALLET_LABELS['subscription']).toBe('签约积分')
    expect(AUTOCLAW_WALLET_LABELS['fuel_pack']).toBe('加油包积分')
  })
})

describe('reading a pasted credential', () => {
  it('reads a JSON blob with both tokens', () => {
    const parsed = parseAutoclawCredential(JSON.stringify({ accessToken: 'A', refreshToken: 'R' }))
    expect(parsed.accessToken).toBe('A')
    expect(parsed.refreshToken).toBe('R')
  })

  it('reads key=value lines', () => {
    const parsed = parseAutoclawCredential('accessToken=A\nrefreshToken=R')
    expect(parsed.accessToken).toBe('A')
    expect(parsed.refreshToken).toBe('R')
  })

  it('strips a Bearer prefix from a bare token', () => {
    // What a user copies out of a request header.
    expect(parseAutoclawCredential('Bearer abc123').accessToken).toBe('abc123')
  })

  it('answers nothing for empty input', () => {
    expect(parseAutoclawCredential('   ')).toEqual({})
  })
})
