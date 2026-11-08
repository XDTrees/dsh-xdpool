/**
 * Password-encrypted backup envelope for the credential export.
 *
 * WHAT IS BEING PROTECTED
 *
 * The exported payload is not a summary — it contains every account's credential
 * value, which is enough to sign in as those accounts. An unencrypted file dropped in
 * a downloads folder, a chat window, or a cloud-synced desktop is a credential leak
 * with extra steps. So the default is encrypted, and the password is the only thing
 * that opens it.
 *
 * THE PRIMITIVES, AND WHY THESE
 *
 * PBKDF2-SHA256 at 310,000 iterations derives the key, then AES-GCM encrypts with a
 * random 12-byte IV. Both are in WebCrypto with no dependencies, which matters for a
 * bundle that ships into someone else's host:
 *
 *   - PBKDF2 over a raw hash because a password has no entropy of its own; the
 *     iteration count is the only thing standing between a leaked file and an
 *     offline dictionary attack. 310k follows OWASP's current floor for SHA-256.
 *   - AES-GCM (not CBC) because it authenticates: a wrong password and a tampered
 *     file are both a hard failure rather than a plausible-looking plaintext.
 *
 * The salt and IV are random per export and travel in the envelope's header — they are
 * not secrets, and reusing either across exports would be the actual mistake.
 *
 * WHAT THIS DOES NOT PROTECT AGAINST
 *
 * A weak password. Nothing here can fix that, so `MIN_PASSWORD` exists to refuse the
 * obviously-bad cases, and the UI says plainly that the file is only as strong as the
 * password.
 *
 * @module dsh-xdpool/client/backup-crypto
 */

/** Marks an encrypted envelope so a plain payload is never mistaken for one. */
export const ENCRYPTED_FORMAT = 'dsh-xdpool/backup-encrypted'

/** Shortest password accepted. Chosen to refuse "1" without pretending to policy. */
export const MIN_PASSWORD = 8

/** PBKDF2 rounds. OWASP's floor for PBKDF2-SHA256; see the module note. */
const ITERATIONS = 310_000

export interface EncryptedEnvelope {
  format: typeof ENCRYPTED_FORMAT
  version: 1
  /** Base64 salt for PBKDF2. Public: it only needs to be unique. */
  salt: string
  /** Base64 AES-GCM IV. Public, and never reused for a second message. */
  iv: string
  iterations: number
  /** Base64 ciphertext, with the GCM tag appended as WebCrypto returns it. */
  data: string
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as never, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Encrypt a JSON payload.
 *
 * `plaintext` is the payload as a string, not an object: the caller already has it in
 * the shape the pack produced, and re-serialising here would be a second chance to
 * lose a field.
 */
export async function encryptBackup(plaintext: string, password: string): Promise<EncryptedEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, ITERATIONS)
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as never },
    key,
    new TextEncoder().encode(plaintext),
  )
  return {
    format: ENCRYPTED_FORMAT,
    version: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    iterations: ITERATIONS,
    data: toBase64(new Uint8Array(cipher)),
  }
}

/** True when `value` looks like this module's envelope rather than a plain payload. */
export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record['format'] === ENCRYPTED_FORMAT
    && typeof record['salt'] === 'string'
    && typeof record['iv'] === 'string'
    && typeof record['data'] === 'string'
}

/**
 * Decrypt an envelope back to the payload string.
 *
 * Throws on a wrong password — AES-GCM's tag check fails, and there is no partial
 * plaintext to leak. The message is deliberately identical for "wrong password" and
 * "corrupt file": telling them apart would let someone confirm a guess about which it
 * was, and the user's next step is the same either way.
 */
export async function decryptBackup(envelope: EncryptedEnvelope, password: string): Promise<string> {
  const salt = fromBase64(envelope.salt)
  const iv = fromBase64(envelope.iv)
  const iterations = Number.isFinite(envelope.iterations) ? envelope.iterations : ITERATIONS
  const key = await deriveKey(password, salt, iterations)
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as never },
      key,
      fromBase64(envelope.data) as unknown as never,
    )
    return new TextDecoder().decode(plain)
  } catch {
    throw new Error('wrong password, or the file is damaged')
  }
}
