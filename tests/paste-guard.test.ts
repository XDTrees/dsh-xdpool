import { describe, expect, it } from 'vitest'
import { inspectPaste, pasteRejectionMessage } from '../src/paste-guard.ts'
import { parseAstudioCredential } from '../src/astudio-routes.ts'
import { parseAccioCredential } from '../src/accio-store.ts'
import { parseAutoclawCredential } from '../src/autoclaw-protocol.ts'

/**
 * Refusing a paste that cannot be a credential.
 *
 * Every parser accepted "whatever was pasted" as an opaque token, which is the right default —
 * the vendors use several shapes and a strict check would refuse keys that work. The cost was
 * that copying a whole page, or `null`, produced a credential that failed at the vendor with
 * `HTTP 401`: the user reads that as "my account is broken" instead of "I pasted the wrong
 * thing".
 */
describe('the shapes that cannot be a credential', () => {
  it('refuses a whole web page', () => {
    // Right-click → copy on a browser tab is a common accident.
    expect(inspectPaste('<!DOCTYPE html><html><body>x</body></html>')).toBe('html')
    expect(inspectPaste('<?xml version="1.0"?><root/>')).toBe('html')
    expect(inspectPaste('<html lang="zh">')).toBe('html')
  })

  it('refuses a JSON literal', () => {
    // None of these carries a field to read.
    for (const input of ['null', 'true', 'false', '[]', '[ ]', '12345']) {
      expect(inspectPaste(input), input).toBe('json-literal')
    }
  })

  it('refuses a document-sized paste', () => {
    expect(inspectPaste('x'.repeat(20_001))).toBe('too-long')
  })

  it('refuses punctuation only', () => {
    expect(inspectPaste('::')).toBe('punctuation')
    expect(inspectPaste('---')).toBe('punctuation')
  })
})

describe('the shapes that might be real', () => {
  it('lets an unfamiliar token through', () => {
    /**
     * The vendors use several token shapes and one of them may be one nobody documented.
     * Refusing here would be worse than letting the vendor answer.
     */
    for (const input of ['tok', 'a.b.c', 'abc-123_XYZ', '中文也可能', '"quoted"']) {
      expect(inspectPaste(input), input).toBeUndefined()
    }
  })

  it('lets a cookie string through', () => {
    expect(inspectPaste('ssoSessionId=abc; account_id=1')).toBeUndefined()
  })

  it('lets empty input through, so "nothing pasted" stays a separate state', () => {
    // The route reports "there is no credential here" itself; treating empty as a bad SHAPE
    // would give the wrong sentence.
    expect(inspectPaste('')).toBeUndefined()
    expect(inspectPaste('   ')).toBeUndefined()
  })
})

describe('the sentence', () => {
  it('says what to paste instead', () => {
    const message = pasteRejectionMessage('<!DOCTYPE html><html></html>')
    expect(message).toContain('网页')
    expect(message).toContain('HTML')
  })

  it('is absent for a paste worth trying', () => {
    expect(pasteRejectionMessage('a.b.c')).toBeUndefined()
  })
})

describe('the parsers', () => {
  it('answer nothing for a page, so no account is stored', () => {
    /**
     * The route treats an empty parse as "no usable credential" and says so. Without this guard
     * the page became the token and the failure appeared at the vendor.
     */
    const page = '<!DOCTYPE html><html><body>login</body></html>'
    expect(parseAstudioCredential(page).bearer).toBeUndefined()
    expect(parseAccioCredential(page).accessToken).toBeUndefined()
    expect(parseAutoclawCredential(page).accessToken).toBeUndefined()
  })

  it('still accept a real token', () => {
    expect(parseAstudioCredential('a.b.c').bearer).toBe('a.b.c')
    expect(parseAccioCredential('tok').accessToken).toBe('tok')
    expect(parseAutoclawCredential('tok').accessToken).toBe('tok')
  })
})
