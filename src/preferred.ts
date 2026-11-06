/**
 * The preferred account: the one the user asked to be tried first.
 *
 * Distinct from `disabledAccountIds` in the opposite direction. A disabled
 * account is skipped entirely; a preferred account is merely first in line, and
 * the pool falls back to the distribution strategy the moment it fails a gate
 * (cooling, dead credential, credit reserve, switched off). So this file holds a
 * single optional id, not a list.
 *
 * It is a plugin-owned file for the same reason the ignore list is one: the CLI
 * has no settings service, so a settings-backed pin could be set from the card
 * and never from `dsh-xdpool prefer`. Both halves read this file.
 *
 * The value is deliberately NOT a credential, a token, or anything secret. It is
 * an account id the plugin already prints on the card, so there is nothing here
 * that a hand-edited file could leak.
 *
 * @module dsh-xdpool/preferred
 */

import { readFile, rename, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ensureSecretDir, writeSecretFile } from './file-perms.ts'
import { pluginDataDir } from './ignored.ts'

/** File holding the preferred account id, inside the plugin data directory. */
export const PREFERRED_FILE_NAME = 'preferred.json'

/** Absolute path of the preferred-account file. */
export function preferredIdPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(pluginDataDir(env), PREFERRED_FILE_NAME)
}

/**
 * Normalize whatever the file holds into a clean id, or nothing.
 *
 * Tolerant on purpose, and this file is hand-editable more than most: a
 * malformed document must never take the pool down. A missing, unreadable,
 * unparseable, or wrongly-typed value all mean the same thing to the caller —
 * nothing is pinned — so none of them throws. Empty and whitespace-only strings
 * are treated as "no pin" rather than as an id, because an id of `""` could
 * never match an account and would otherwise be a pin the user cannot clear from
 * the card (the clear button sends `null`, and `null` would not match `""`).
 */
function normalize(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const id = (raw as { accountId?: unknown }).accountId
  if (typeof id !== 'string') return undefined
  const trimmed = id.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Read the pinned id, tolerating every "no pin yet" shape.
 *
 * A missing file is the normal state on a fresh install, so it is not an error.
 */
export async function readPreferredId(path: string = preferredIdPath()): Promise<string | undefined> {
  try {
    return normalize(JSON.parse(await readFile(path, 'utf8')) as unknown)
  } catch {
    return undefined
  }
}

/**
 * Synchronous read, for startup.
 *
 * The host pins the account from inside `apply()`, which is synchronous, and
 * doing it there removes a startup race: an async load could resolve AFTER the
 * first account scan, so the first request of the process would be served by
 * whichever account the strategy picked rather than the one the user asked for.
 * The file is tens of bytes, so a blocking read at startup costs nothing
 * measurable.
 */
export function readPreferredIdSync(path: string = preferredIdPath()): string | undefined {
  try {
    return normalize(JSON.parse(readFileSync(path, 'utf8')) as unknown)
  } catch {
    return undefined
  }
}

/**
 * Write (or clear) the pinned id, atomically.
 *
 * Written to a sibling temp file and renamed over the target so a crash or a
 * concurrent reader can never observe a half-written document. A truncated file
 * reads as "nothing is pinned", which is survivable — the strategy takes over —
 * but a half-written file that happens to parse could pin an account nobody
 * chose, and that is the failure worth designing out.
 *
 * `accountId: undefined` DELETES the file rather than writing `{"accountId":
 * null}`. Deleting makes "no pin" the same state as "never pinned", so there is
 * exactly one way for the next read to come back empty, and the directory stays
 * free of documents that describe the absence of a decision.
 */
export async function writePreferredId(
  accountId: string | undefined,
  path: string = preferredIdPath(),
): Promise<void> {
  // Create the directory the TARGET lives in, not the default one: tests pass an
  // explicit path, and creating the wrong directory fails the write with ENOENT.
  await ensureSecretDir(dirname(path))
  if (accountId === undefined) {
    await rm(path, { force: true })
    return
  }
  const payload = JSON.stringify({ version: 1, accountId: accountId.trim() }, null, 2)
  const temp = `${path}.tmp`
  // Owner-only for consistency with its neighbours: this file names the account
  // the user pinned, which is an identity even though it is not a token. A
  // directory where one secret file is 0600 and the next is 0644 is a directory
  // nobody can reason about.
  await writeSecretFile(temp, `${payload}\n`)
  await rename(temp, path)
}