/**
 * Prompt stripping, and the meter's request-budget gate.
 *
 * Two things the dashboard depends on that are easy to get subtly wrong:
 *
 * 1. **`stripUsagePrompts`** rewrites a JSON document textually. A bug there does not
 *    crash — it drops or shifts a row, which reads as a missing charge. Measured on a
 *    real page the two prompt fields are 52% of the body after truncation (82% of the
 *    raw field bytes), so it is worth doing, but only if it is exact.
 *
 * 2. **`MeterGate`** is the only thing standing between a nine-account cold read and
 *    the meter's burst limit. Too polite and it serialises the work into a 17-second
 *    read; too eager and it earns a wall of refusals.
 *
 * @module dsh-xdpool/tests/meter-payload
 */
import { describe, expect, it } from 'vitest'
import { stripUsagePrompts } from '../src/upstream.ts'

describe('prompt stripping', () => {
  /** One row, in the shape the meter sends. */
  function row(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      requestId: 'abc-123',
      credit: 9.75,
      model: 'deepseek-v4.1-flash',
      client: 'CodeBuddy',
      requestTime: '2026-11-16 15:16:00',
      agentPurpose: 'conversation',
      appType: 'codebuddy',
      subscribeType: 'advanced',
      input: 'a long prompt',
      inputTrunc: 'a long prom',
      ...over,
    }
  }

  function doc(rows: readonly Record<string, unknown>[]): string {
    return JSON.stringify({ code: 0, msg: 'OK', requestId: 'r', data: { total: rows.length, data: rows } })
  }

  it('empties both prompt fields and changes nothing else', () => {
    const original = doc([row(), row({ requestId: 'def-456', credit: 0, model: 'hy4-free' })])
    const parsed = JSON.parse(stripUsagePrompts(original)) as {
      code: number
      data: { total: number; data: Record<string, unknown>[] }
    }
    expect(parsed.code).toBe(0)
    expect(parsed.data.total).toBe(2)
    expect(parsed.data.data).toHaveLength(2)
    for (const entry of parsed.data.data) {
      // Present but empty: "the field exists and was elided", not "the field is
      // missing", which a caller could reasonably read as a different shape.
      expect(entry['input']).toBe('')
      expect(entry['inputTrunc']).toBe('')
    }
    // Every field the dashboard reads must survive untouched.
    expect(parsed.data.data[0]?.['requestId']).toBe('abc-123')
    expect(parsed.data.data[0]?.['credit']).toBe(9.75)
    expect(parsed.data.data[0]?.['model']).toBe('deepseek-v4.1-flash')
    expect(parsed.data.data[0]?.['requestTime']).toBe('2026-11-16 15:16:00')
    expect(parsed.data.data[1]?.['model']).toBe('hy4-free')
  })

  it('survives quotes, backslashes, newlines and JSON inside a prompt', () => {
    // A prompt is arbitrary text. If the scanner mistook a `\"` for the end of the
    // literal it would misread every key after it and silently reshape the document.
    const nasty = 'he said "hi" \\ then\n{"nested": "}"} and a tab\there'
    const parsed = JSON.parse(stripUsagePrompts(doc([row({ input: nasty, inputTrunc: nasty })]))) as {
      data: { data: Record<string, unknown>[] }
    }
    expect(parsed.data.data).toHaveLength(1)
    expect(parsed.data.data[0]?.['input']).toBe('')
    expect(parsed.data.data[0]?.['credit']).toBe(9.75)
    expect(parsed.data.data[0]?.['requestId']).toBe('abc-123')
  })

  it('leaves a document with no prompts byte-identical', () => {
    const plain = doc([{ requestId: 'a', credit: 1, model: 'm' }])
    expect(stripUsagePrompts(plain)).toBe(plain)
  })

  it('does not touch a field whose name merely starts with "input"', () => {
    // `inputTokens` is a real field elsewhere in this plugin, and a prefix match
    // would blank it.
    const original = doc([row({ inputTokens: 1234, inputCost: 'x' })])
    const parsed = JSON.parse(stripUsagePrompts(original)) as {
      data: { data: Record<string, unknown>[] }
    }
    expect(parsed.data.data[0]?.['inputTokens']).toBe(1234)
    expect(parsed.data.data[0]?.['inputCost']).toBe('x')
    expect(parsed.data.data[0]?.['input']).toBe('')
  })

  it('gives up rather than truncate when a string never closes', () => {
    // Malformed input must come back untouched so the caller's `JSON.parse` fails
    // loudly, instead of receiving a half-document that parses into fewer rows.
    const broken = '{"data":{"data":[{"input":"unterminated'
    expect(stripUsagePrompts(broken)).toBe(broken)
  })

  it('substantially shrinks a realistic page', () => {
    // The point of the exercise: on real data the prompts were the majority of the
    // bytes. A page of 200 rows with 2 KB prompts must lose the bulk of its size.
    const rows = Array.from({ length: 200 }, (_, index) => row({
      requestId: `id-${String(index)}`,
      input: 'x'.repeat(2000),
      inputTrunc: 'x'.repeat(300),
    }))
    const original = doc(rows)
    const stripped = stripUsagePrompts(original)
    expect(stripped.length).toBeLessThan(original.length * 0.2)
    // And it is still valid JSON with all 200 rows.
    const parsed = JSON.parse(stripped) as { data: { data: unknown[] } }
    expect(parsed.data.data).toHaveLength(200)
  })
})
