/**
 * Reject input that cannot be a credential before it reaches the vendor.
 *
 * WHY
 *
 * Every paste parser accepts "whatever was pasted" as an opaque token, which is the right
 * default — the vendors use several token shapes and a strict check would refuse keys that work.
 * But it means a user who copies a whole error page, a sentence, or `null` gets a stored shape
 * that fails at the vendor with `HTTP 401`, which reads as "my account is broken" rather than
 * "I pasted the wrong thing".
 *
 * So the obviously-impossible cases are refused here, with a sentence that says what to paste
 * instead. The test is deliberately narrow: ONLY shapes that cannot be a credential are
 * rejected, never a token whose format merely looks unfamiliar.
 *
 * @module dsh-xdpool/paste-guard
 */

/** What a paste looks like it was, when it is not a credential. */
export type PasteRejection = 'html' | 'json-literal' | 'too-long' | 'punctuation'

/** The sentence a user needs, per rejection. */
const REASONS: Readonly<Record<PasteRejection, string>> = {
  html: '粘贴的内容是一个网页（HTML），不是凭据。请复制 token / Cookie 本身，而不是页面源码。',
  'json-literal': '粘贴的内容是 JSON 的字面量（null / 数字 / 空数组），不是凭据。',
  'too-long': '粘贴的内容太长，不像凭据。请确认复制的是 token 而不是整段页面。',
  punctuation: '粘贴的内容只有标点，不是凭据。',
}

/** Whether a paste is obviously not a credential. */
export function inspectPaste(input: string): PasteRejection | undefined {
  const text = input.trim()
  if (text === '') return undefined
  /**
   * A page is what a user gets when they copy the wrong thing entirely — right-click → copy on
   * a browser tab is a common accident.
   */
  if (/^<(!doctype|html|\?xml)/iu.test(text)) return 'html'
  // A bare JSON literal carries no field to read.
  if (/^(?:null|true|false|\[\s*\]|\d+)$/u.test(text)) return 'json-literal'
  /**
   * A real token is a dense string. A hundred kilobytes is a document, and a token that long
   * would be refused by the vendor anyway — catching it here names the actual mistake.
   */
  if (text.length > 20_000) return 'too-long'
  // Nothing but punctuation: no token is one character.
  if (/^[^\p{L}\p{N}]+$/u.test(text)) return 'punctuation'
  return undefined
}

/** The sentence to show for a rejection, or undefined when the paste is worth trying. */
export function pasteRejectionMessage(input: string): string | undefined {
  const rejection = inspectPaste(input)
  return rejection === undefined ? undefined : REASONS[rejection]
}
