import { describe, expect, it } from 'vitest'
import {
  MONKEYCODE_CN,
  MONKEYCODE_INTL,
  MONKEYCODE_MODELS,
  MONKEYCODE_EFFORTS,
  MONKEYCODE_DEFAULT_EFFORT,
  findMonkeycodeModel,
} from '../src/monkeycode-protocol.ts'
import { signatureOf, signingPromptOf } from '../src/monkeycode-upstream.ts'
import { parseMonkeycodeCredential } from '../src/monkeycode-store.ts'

/**
 * The MonkeyCode facts that decide whether a call works.
 *
 * The gateway speaks Anthropic Messages, its catalogue cannot be fetched, and its signature
 * covers the prompt rather than the body — each of these fails in a way that reads as something
 * else entirely.
 */
describe('the two sites', () => {
  it('uses different top-level domains', () => {
    expect(MONKEYCODE_CN.platformBaseUrl).toContain('monkeycode-ai.com')
    expect(MONKEYCODE_INTL.platformBaseUrl).toContain('monkeycode-ai.net')
    expect(MONKEYCODE_CN.gatewayBaseUrl).not.toBe(MONKEYCODE_INTL.gatewayBaseUrl)
  })

  it('registers two distinct provider ids', () => {
    expect(MONKEYCODE_CN.id).not.toBe(MONKEYCODE_INTL.id)
  })
})

describe('the signature', () => {
  it('covers the prompt text, and only the prompt', () => {
    /**
     * The header is an HMAC over the system and user text. Signing the serialized body instead
     * is answered as an auth failure, which sends the reader hunting for an expired key.
     */
    const prompt = signingPromptOf({
      system: 'you are a helper',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ],
    })
    expect(prompt).toContain('you are a helper')
    expect(prompt).toContain('hello')
    // The assistant turn is not part of what gets signed.
    expect(prompt).not.toContain('hi')
  })

  it('formats as v1=<hex>', () => {
    // The prefix is part of the header value, not a display convention.
    expect(signatureOf('secret', 'prompt')).toMatch(/^v1=[0-9a-f]{64}$/u)
  })

  it('changes when the prompt changes', () => {
    expect(signatureOf('secret', 'a')).not.toBe(signatureOf('secret', 'b'))
  })
})

describe('the catalogue', () => {
  it('declares 1M for the DeepSeek family', () => {
    expect(findMonkeycodeModel('deepseek-v4-pro')?.contextWindow).toBe(1_048_576)
  })

  it('declares 128K for GLM-5, not the neighbours 1M', () => {
    /**
     * GLM-5 is not a DeepSeek and its window has nothing to do with a million. Copying the
     * neighbours would be a fabrication that also moves the host's overflow threshold past
     * anything the gateway accepts.
     */
    const glm = findMonkeycodeModel('glm-5')
    expect(glm?.contextWindow).toBe(128_000)
    expect(glm?.contextWindow).not.toBe(1_048_576)
  })

  it('gives GLM-5 no thinking ladder', () => {
    /**
     * This gateway exposes no controlled effort for it. Declaring one makes the host send a
     * thinking budget that is dropped, so the model silently behaves as if the choice were
     * ignored — worse than not offering the choice.
     */
    expect(findMonkeycodeModel('glm-5')?.reasoning).toBe(false)
    expect(findMonkeycodeModel('deepseek-v4-pro')?.reasoning).toBe(true)
  })

  it('offers both the tier-prefixed and the credit-priced ids', () => {
    // The prefixed ones spend a subscription; the bare ones spend credits. Both are real.
    const ids = MONKEYCODE_MODELS.map(model => model.id)
    expect(ids).toContain('monkeycode-pro/deepseek-v4-pro')
    expect(ids).toContain('deepseek-v4-pro')
  })

  it('uses the ladder the gateway accepts', () => {
    expect([...MONKEYCODE_EFFORTS]).toEqual(['none', 'low', 'medium', 'high'])
    expect(MONKEYCODE_EFFORTS).toContain(MONKEYCODE_DEFAULT_EFFORT)
  })
})

describe('reading a pasted session', () => {
  it('takes a bare cookie string', () => {
    expect(parseMonkeycodeCredential('monkeycode_ai_session=abc').cookie).toBe('monkeycode_ai_session=abc')
  })

  it('strips a Cookie: prefix', () => {
    // What a user copies out of the network panel.
    expect(parseMonkeycodeCredential('Cookie: a=b').cookie).toBe('a=b')
  })

  it('reads a JSON blob', () => {
    expect(parseMonkeycodeCredential(JSON.stringify({ cookie: 'x=y' })).cookie).toBe('x=y')
  })

  it('answers nothing for empty input', () => {
    expect(parseMonkeycodeCredential('  ')).toEqual({})
  })
})
