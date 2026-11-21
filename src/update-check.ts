/**
 * Whether a newer build of this plugin exists.
 *
 * WHY IT LIVES IN THE PLUGIN
 *
 * Updating meant watching the repository by hand or asking an agent to check — neither is
 * something a user should have to do to stay current. A version read from the registry on demand
 * answers the only question worth asking ("is there something newer than what I run?") without a
 * background task that phones home on its own schedule.
 *
 * WHAT IT ASKS
 *
 * The npm registry's abbreviated document for this package: `dist-tags.latest` and the publish
 * time of that version. Nothing else is read, nothing is sent beyond the package name, and the
 * answer is cached for a few minutes so opening the panel repeatedly is one request.
 *
 * A FAILURE IS AN ORDINARY ANSWER
 *
 * A machine behind a proxy, offline, or with no registry access still has a working plugin. The
 * result carries `error` and the card says "could not check" rather than hiding the control or
 * claiming there is nothing new — telling a user they are current when the check did not run is
 * the one wrong answer here.
 *
 * @module dsh-xdpool/update-check
 */
import { POOL_VERSION } from './version.ts'

/** The package name this plugin publishes under. */
const PACKAGE = 'dsh-xdpool'

/** The registries tried, in order. npm first: it is the canonical one. */
const REGISTRIES = [
  `https://registry.npmjs.org/${PACKAGE}/latest`,
  `https://registry.npmjs.org/${PACKAGE}`,
]

/** How long an answer is reused. */
const TTL_MS = 10 * 60 * 1000

/** What the card shows. */
export interface UpdateStatus {
  /** The version this process is running. */
  current: string
  /** The newest published version, when the registry answered. */
  latest?: string
  /** Whether `latest` is newer than `current`. */
  newer: boolean
  /** When the newest version was published, ISO, when known. */
  publishedAt?: string
  /** Why the check did not produce a version. */
  error?: string
  /** When this answer was produced. */
  checkedAt: string
  /**
   * The release notes for `latest`, as a short list of headings.
   *
   * The registry publishes the package README, not a changelog. Rather than render 12KB of
   * install instructions inside a settings dialog, the check extracts only the section that
   * lists what changed — see `extractNotes`.
   */
  notes?: readonly string[]
  /** The heading those notes were found under, so the panel can say where they came from. */
  notesTitle?: string
}

let cached: { at: number; status: UpdateStatus } | undefined

/**
 * Compare two dotted versions.
 *
 * Numeric segments compare as numbers and everything else as text, which is the ordering npm
 * itself uses for the plain `x.y.z` releases this package publishes. A prerelease tag is older
 * than its release (`2.7.3-rc.1 < 2.7.3`), which is what the `-` check below states.
 */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string): { parts: number[]; pre: string } => {
    const [core, ...rest] = value.trim().replace(/^v/u, '').split('-')
    const parts = (core ?? '').split('.').map(segment => {
      const number = Number.parseInt(segment, 10)
      return Number.isFinite(number) ? number : 0
    })
    return { parts, pre: rest.join('-') }
  }
  const a = parse(left)
  const b = parse(right)
  const length = Math.max(a.parts.length, b.parts.length)
  for (let i = 0; i < length; i += 1) {
    const left1 = a.parts[i] ?? 0
    const right1 = b.parts[i] ?? 0
    if (left1 !== right1) return left1 < right1 ? -1 : 1
  }
  // Same numbers: a prerelease is older than the release it precedes.
  if (a.pre === '' && b.pre !== '') return 1
  if (a.pre !== '' && b.pre === '') return -1
  return a.pre === b.pre ? 0 : (a.pre < b.pre ? -1 : 1)
}

/** Read `dist-tags.latest`, its publish time and the README from a registry document. */
function parseRegistry(body: unknown): { latest?: string; publishedAt?: string; readme?: string } {
  if (body === null || typeof body !== 'object') return {}
  const record = body as Record<string, unknown>
  // `/latest` answers the version document; the full document nests it under dist-tags.
  const readmeRaw = record['readme']
  const readme = typeof readmeRaw === 'string' ? readmeRaw : undefined
  const direct = record['version']
  if (typeof direct === 'string' && direct !== '') {
    return { latest: direct, ...(readme === undefined ? {} : { readme }) }
  }
  const tags = record['dist-tags']
  if (tags !== null && typeof tags === 'object') {
    const latest = (tags as Record<string, unknown>)['latest']
    if (typeof latest === 'string' && latest !== '') {
      const times = record['time']
      const when = times !== null && typeof times === 'object'
        ? (times as Record<string, unknown>)[latest]
        : undefined
      return {
        latest,
        ...(typeof when === 'string' ? { publishedAt: when } : {}),
        ...(readme === undefined ? {} : { readme }),
      }
    }
  }
  return {}
}

/**
 * Ask the registry, or answer from the cache.
 *
 * `force` skips the cache — that is what the card's button does, and a button that silently
 * returns a ten-minute-old answer is indistinguishable from one that did nothing.
 */
export async function checkForUpdate(options: { force?: boolean; now?: number } = {}): Promise<UpdateStatus> {
  const now = options.now ?? Date.now()
  if (options.force !== true && cached !== undefined && now - cached.at < TTL_MS) return cached.status

  const checkedAt = new Date().toISOString()
  for (const url of REGISTRIES) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
        // Bounded: this runs from a panel render path and must not hold it open.
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) continue
      const parsed = parseRegistry(await response.json())
      if (parsed.latest === undefined) continue
      const extracted = extractNotes(parsed.readme)
      const status: UpdateStatus = {
        current: POOL_VERSION,
        latest: parsed.latest,
        newer: compareVersions(parsed.latest, POOL_VERSION) > 0,
        ...(parsed.publishedAt === undefined ? {} : { publishedAt: parsed.publishedAt }),
        ...(extracted.title === undefined ? {} : { notesTitle: extracted.title }),
        ...(extracted.notes === undefined ? {} : { notes: extracted.notes }),
        checkedAt,
      }
      cached = { at: now, status }
      return status
    } catch {
      // Try the next registry; a failure is reported only when every one fails.
    }
  }
  const status: UpdateStatus = {
    current: POOL_VERSION,
    newer: false,
    error: '无法访问 npm registry（离线或代理未放行）',
    checkedAt,
  }
  // A failure is cached for the shorter of the two intervals, so a transient outage does not
  // pin "could not check" for ten minutes.
  cached = { at: now - TTL_MS + 60_000, status }
  return status
}


/**
 * Pull the "what changed" section out of a README.
 *
 * The registry only publishes the README, so the release notes live in a section of it. The
 * search is by heading text rather than by position: the section moves every release, and a
 * fixed slice would drift onto the install instructions the first time it did.
 *
 * Returns the bullet lines under the first matching heading, stopping at the next heading of
 * the same or higher level. Bullets only, because prose paragraphs in a settings dialog read
 * as marketing and the reader came here for a list.
 */
export function extractNotes(readme: string | undefined): { title?: string; notes?: readonly string[] } {
  if (readme === undefined || readme === '') return {}
  const HEADINGS = /更新公告|更新内容|更新日[志志]|变更记录|更新记录|what'?s\s+new|changelog|release\s+notes/iu
  const lines = readme.split(/\r?\n/u)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line)
    if (heading === null) continue
    if (!HEADINGS.test(heading[2] ?? '')) continue
    const level = (heading[1] ?? '#').length
    const title = (heading[2] ?? '').trim()
    const notes: string[] = []
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j] ?? ''
      const nextHeading = /^(#{1,6})\s+/u.exec(next)
      // A heading at the same or a higher level ends the section.
      if (nextHeading !== null && (nextHeading[1] ?? '#').length <= level) break
      // Bullets and numbered items only; blank lines and prose are skipped rather than kept.
      const bullet = /^\s*(?:[-*+]|\d+\.)\s+(.+)$/u.exec(next)
      if (bullet !== null) {
        const text = (bullet[1] ?? '').replace(/\*\*/gu, '').replace(/`/gu, '').trim()
        if (text !== '' && text.length <= 160) notes.push(text)
      }
      if (notes.length >= 12) break
    }
    if (notes.length > 0) return { title, notes }
  }
  return {}
}

/** Drop the cache, for a test. */
export function resetUpdateCache(): void {
  cached = undefined
}
