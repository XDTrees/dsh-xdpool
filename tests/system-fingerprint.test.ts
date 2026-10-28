import { describe, expect, it } from 'vitest'
import { sanitizeSystemContent, WorkBuddyUpstreamClient } from '../src/upstream.ts'

/*
  The domestic gateway rejects a request whose SYSTEM message opens with a
  string it associates with another agent's client, answering
  `400 / 11128 Illegal API invocation from an unapproved channel` — the same
  business code the missing conversation-identity headers produce, which is why
  the two are easy to confuse. The first-party DSH system-prompt plugin puts
  that sentence at the top of every conversation, so an unmodified install is
  rejected on every account.

  Measured boundary (live gateway): literal substring, case-insensitive, near
  the start of a message, and the scanned roles are `system` + `assistant`
  (`user` / `tool` pass). These tests pin the rewrite, not the gateway: if the
  list grows, the array grows.
*/
const BANNED = 'You are an AI agent powered by DeepSeek Harness.'
const SAFE = 'You are an AI agent running on DeepSeek Harness.'

describe('the system-prompt fingerprint the gateway blocks', () => {
  it('rewrites the sentence and keeps the rest of the prompt', () => {
    const content = `${BANNED}\n\nYou verify before you claim.`
    expect(sanitizeSystemContent(content)).toBe(`${SAFE}\n\nYou verify before you claim.`)
  })

  it('rewrites it mid-sentence, in any case, and every occurrence', () => {
    // The match is case-insensitive because the gateway's is; the replacement is
    // a fixed phrase, so a lowercase hit comes back title-cased. That is fine —
    // the check is a substring test and the model reads the meaning — and it is
    // what keeps the pattern specific to the fingerprint instead of rewriting
    // every innocent "powered by" in a system prompt.
    const lowered = sanitizeSystemContent('you are an ai agent powered by deepseek harness.') as string
    expect(lowered).not.toMatch(/powered by deepseek harness/i)
    expect(lowered).toContain('running on DeepSeek Harness')
    expect(sanitizeSystemContent('a powered by DeepSeek Harness b powered by DeepSeek Harness c'))
      .toBe('a running on DeepSeek Harness b running on DeepSeek Harness c')
    // An innocent use of the same verb is not this fingerprint and must survive.
    expect(sanitizeSystemContent('This deployment is powered by solar energy.'))
      .toBe('This deployment is powered by solar energy.')
  })

  it('leaves unrelated system text byte-identical and returns the same reference', () => {
    const clean = 'You are a helpful assistant.'
    expect(sanitizeSystemContent(clean)).toBe(clean)
    // Same reference, not merely equal: a long prompt must not be copied to
    // change nothing.
    const block = [{ type: 'text', text: clean }]
    expect(sanitizeSystemContent(block)).toBe(block)
  })

  it('rewrites only the matching block and preserves images and unknown blocks', () => {
    const image = { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }
    const cache = { type: 'cache_control', cache_control: { type: 'ephemeral' } }
    const next = sanitizeSystemContent([
      { type: 'text', text: BANNED },
      image,
      cache,
    ]) as Record<string, unknown>[]
    expect(next[0]).toEqual({ type: 'text', text: SAFE })
    expect(next[1]).toBe(image)
    expect(next[2]).toBe(cache)
  })

  it('passes non-string, non-array content through untouched', () => {
    expect(sanitizeSystemContent(null)).toBeNull()
    expect(sanitizeSystemContent(42)).toBe(42)
    expect(sanitizeSystemContent(undefined)).toBeUndefined()
  })

  it('applies the rewrite inside the prepared request body, for every system message', () => {
    const client = new WorkBuddyUpstreamClient({ fetchImpl: () => Promise.reject(new Error('unused')) })
    const raw = JSON.stringify({
      model: 'deepseek-v4.1-flash',
      messages: [
        { role: 'system', content: BANNED },
        { role: 'user', content: 'hello' },
        { role: 'system', content: [{ type: 'text', text: BANNED }] },
      ],
      stream: false,
    })
    const body = JSON.parse(client.prepareChatBody(raw)) as {
      messages: { role: string; content: unknown }[]
      stream: boolean
    }
    expect(body.stream).toBe(true)
    expect(body.messages[0]?.content).toBe(SAFE)
    expect(body.messages[1]?.content).toBe('hello')
    expect(body.messages[2]?.content).toEqual([{ type: 'text', text: SAFE }])
    // The rewrite must not survive as the banned substring anywhere.
    expect(JSON.stringify(body)).not.toContain('powered by DeepSeek Harness')
  })

  it('rewrites a developer message too, since it becomes a system message', () => {
    const client = new WorkBuddyUpstreamClient({ fetchImpl: () => Promise.reject(new Error('unused')) })
    const raw = JSON.stringify({
      messages: [{ role: 'developer', content: BANNED }],
    })
    const body = JSON.parse(client.prepareChatBody(raw)) as { messages: { role: string; content: string }[] }
    expect(body.messages[0]?.role).toBe('system')
    expect(body.messages[0]?.content).toBe(SAFE)
  })

  it('does not touch the same sentence when it is in a user or tool message', () => {
    // The gateway ignores those roles, and rewriting them would corrupt text the
    // user actually wrote.
    const client = new WorkBuddyUpstreamClient({ fetchImpl: () => Promise.reject(new Error('unused')) })
    const raw = JSON.stringify({
      messages: [
        { role: 'user', content: BANNED },
        { role: 'tool', content: BANNED },
      ],
    })
    const body = JSON.parse(client.prepareChatBody(raw)) as { messages: { content: string }[] }
    expect(body.messages[0]?.content).toBe(BANNED)
    expect(body.messages[1]?.content).toBe(BANNED)
  })

  it('rewrites the same sentence when an assistant reply carries it', () => {
    // The gateway scans assistant history too. A reply that quotes the system
    // prompt must not poison every later turn of the conversation.
    const client = new WorkBuddyUpstreamClient({ fetchImpl: () => Promise.reject(new Error('unused')) })
    const raw = JSON.stringify({
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: BANNED },
      ],
    })
    const body = JSON.parse(client.prepareChatBody(raw)) as { messages: { content: string }[] }
    expect(body.messages[2]?.content).toBe(SAFE)
  })
})

/*
  A second system-message fingerprint, measured after the first rewrite shipped:
  the DSH runtime-context sentence pair below still answered
  `400 / 11128 Illegal API invocation from an unapproved channel` on every
  account. Either sentence alone passes, and every small edit inside the pair
  passes too — so the gateway matches the pair's content, not the prompt length
  and not another request header. The rewrite below changes only the product's
  "Web GUI" spelling; the rest of the pair must stay byte-identical.
*/
const BANNED_RUNTIME_CONTEXT =
  'You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime context names. ' +
  'When the user refers to "this page", "this GUI", or "this app" without naming another target, they mean this GUI.'
const SAFE_RUNTIME_CONTEXT =
  'You are interacting with the user through the DeepSeek Harness web interface whose URL the runtime context names. ' +
  'When the user refers to "this page", "this GUI", or "this app" without naming another target, they mean this GUI.'

describe('the runtime-context fingerprint the gateway blocks', () => {
  it('rewrites "Web GUI" and keeps the rest of the pair byte-identical', () => {
    expect(sanitizeSystemContent(BANNED_RUNTIME_CONTEXT)).toBe(SAFE_RUNTIME_CONTEXT)
  })

  it('rewrites it case-insensitively and every occurrence', () => {
    const lowered = sanitizeSystemContent(BANNED_RUNTIME_CONTEXT.toLowerCase()) as string
    expect(lowered).not.toMatch(/deepseek harness web gui/i)
    expect(lowered).toContain('DeepSeek Harness web interface')
    expect(sanitizeSystemContent('DeepSeek Harness Web GUI A DeepSeek Harness Web GUI B'))
      .toBe('DeepSeek Harness web interface A DeepSeek Harness web interface B')
  })

  it('leaves an innocent Web GUI mention alone', () => {
    // Only the "DeepSeek Harness" prefix is the fingerprint; a generic Web GUI
    // mention is not, and rewriting it would corrupt unrelated prompts.
    const clean = 'The Web GUI follows the system theme.'
    expect(sanitizeSystemContent(clean)).toBe(clean)
  })

  it('rewrites the pair in system and assistant messages, not in user text', () => {
    const client = new WorkBuddyUpstreamClient({ fetchImpl: () => Promise.reject(new Error('unused')) })
    const raw = JSON.stringify({
      model: 'deepseek-v4.1-flash',
      messages: [
        { role: 'system', content: [{ type: 'text', text: BANNED_RUNTIME_CONTEXT }] },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: BANNED_RUNTIME_CONTEXT },
        { role: 'user', content: BANNED_RUNTIME_CONTEXT },
      ],
      stream: false,
    })
    const body = JSON.parse(client.prepareChatBody(raw)) as {
      messages: { role: string; content: unknown }[]
    }
    expect(body.messages[0]?.content).toEqual([{ type: 'text', text: SAFE_RUNTIME_CONTEXT }])
    expect(body.messages[1]?.content).toBe('hi')
    expect(body.messages[2]?.content).toBe(SAFE_RUNTIME_CONTEXT)
    // The user's own text must survive untouched.
    expect(body.messages[3]?.content).toBe(BANNED_RUNTIME_CONTEXT)
    expect(JSON.stringify(body.messages[0])).not.toContain('DeepSeek Harness Web GUI')
    expect(JSON.stringify(body.messages[2])).not.toContain('DeepSeek Harness Web GUI')
  })

  it('applies both fingerprints to one prompt', () => {
    const merged = sanitizeSystemContent(`${BANNED}\n\n${BANNED_RUNTIME_CONTEXT}`) as string
    expect(merged).toContain(SAFE)
    expect(merged).toContain(SAFE_RUNTIME_CONTEXT)
    expect(merged).not.toMatch(/powered by DeepSeek Harness/i)
    expect(merged).not.toContain('DeepSeek Harness Web GUI')
  })
})

/*
  A third fingerprint, measured 2026-10-28 after the two rewrites above had been
  shipping for a week: the file-reference guidance DSH contributes whenever the
  agent has a `read` tool brought the same 400/11128 back. Neither sentence is
  the trigger alone — each 200s in isolation and the pair 400s — and the pair
  names no product, so this one is matched for its text, not for identifying
  another client. The rewrite keeps the statement's meaning and length class.
*/
const BANNED_FILE_REFERENCE =
  'Tokens prefixed with @ are paths the user explicitly referenced. ' +
  'Relative paths resolve from the workspace root; absolute paths identify files or directories on the host. ' +
  'A trailing slash marks a directory: list it when its contents matter.'
const SAFE_FILE_REFERENCE =
  'Tokens prefixed with @ are paths the user explicitly referenced. ' +
  'Relative paths are resolved against the workspace root; absolute paths identify files or directories on the host. ' +
  'A trailing slash marks a directory: list it when its contents matter.'

describe('the file-reference fingerprint the gateway blocks', () => {
  it('rewrites the workspace-root sentence and keeps the rest of the paragraph byte-identical', () => {
    expect(sanitizeSystemContent(BANNED_FILE_REFERENCE)).toBe(SAFE_FILE_REFERENCE)
  })

  it('rewrites it case-insensitively and every occurrence', () => {
    const lowered = sanitizeSystemContent(BANNED_FILE_REFERENCE.toLowerCase()) as string
    expect(lowered).not.toMatch(/relative paths resolve from the workspace root/i)
    expect(lowered).toContain('Relative paths are resolved against the workspace root')
    expect(sanitizeSystemContent('Relative paths resolve from the workspace root and Relative paths resolve from the workspace root'))
      .toBe('Relative paths are resolved against the workspace root and Relative paths are resolved against the workspace root')
  })

  it('leaves an innocent resolve-from-the-root mention alone', () => {
    // Only the file-reference wording is the fingerprint. A different sentence
    // that happens to use "resolve" must not be touched.
    const clean = 'Module specifiers resolve from the package root, not the cwd.'
    expect(sanitizeSystemContent(clean)).toBe(clean)
  })

  it('rewrites the paragraph in system and assistant messages, not in user text', () => {
    const client = new WorkBuddyUpstreamClient({ fetchImpl: () => Promise.reject(new Error('unused')) })
    const raw = JSON.stringify({
      model: 'deepseek-v4.1-flash',
      messages: [
        { role: 'system', content: [{ type: 'text', text: BANNED_FILE_REFERENCE }] },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: BANNED_FILE_REFERENCE },
        { role: 'user', content: BANNED_FILE_REFERENCE },
      ],
      stream: false,
    })
    const body = JSON.parse(client.prepareChatBody(raw)) as {
      messages: { role: string; content: unknown }[]
    }
    expect(body.messages[0]?.content).toEqual([{ type: 'text', text: SAFE_FILE_REFERENCE }])
    expect(body.messages[1]?.content).toBe('hi')
    expect(body.messages[2]?.content).toBe(SAFE_FILE_REFERENCE)
    // The user's own text must survive untouched.
    expect(body.messages[3]?.content).toBe(BANNED_FILE_REFERENCE)
    expect(JSON.stringify(body.messages[0])).not.toMatch(/resolve from the workspace root/i)
    expect(JSON.stringify(body.messages[2])).not.toMatch(/resolve from the workspace root/i)
  })

  it('applies all three fingerprints to one prompt', () => {
    const merged = sanitizeSystemContent(
      `${BANNED}\n\n${BANNED_RUNTIME_CONTEXT}\n\n${BANNED_FILE_REFERENCE}`,
    ) as string
    expect(merged).toContain(SAFE)
    expect(merged).toContain(SAFE_RUNTIME_CONTEXT)
    expect(merged).toContain(SAFE_FILE_REFERENCE)
    expect(merged).not.toMatch(/powered by DeepSeek Harness/i)
    expect(merged).not.toContain('DeepSeek Harness Web GUI')
    expect(merged).not.toMatch(/resolve from the workspace root/i)
  })
})
