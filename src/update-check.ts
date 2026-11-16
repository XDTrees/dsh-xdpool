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

/** Read `dist-tags.latest` and its publish time from a registry document. */
function parseRegistry(body: unknown): { latest?: string; publishedAt?: string } {
  if (body === null || typeof body !== 'object') return {}
  const record = body as Record<string, unknown>
  // `/latest` answers the version document; the full document nests it under dist-tags.
  const direct = record['version']
  if (typeof direct === 'string' && direct !== '') return { latest: direct }
  const tags = record['dist-tags']
  if (tags !== null && typeof tags === 'object') {
    const latest = (tags as Record<string, unknown>)['latest']
    if (typeof latest === 'string' && latest !== '') {
      const times = record['time']
      const when = times !== null && typeof times === 'object'
        ? (times as Record<string, unknown>)[latest]
        : undefined
      return { latest, ...(typeof when === 'string' ? { publishedAt: when } : {}) }
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
      const status: UpdateStatus = {
        current: POOL_VERSION,
        latest: parsed.latest,
        newer: compareVersions(parsed.latest, POOL_VERSION) > 0,
        ...(parsed.publishedAt === undefined ? {} : { publishedAt: parsed.publishedAt }),
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

/** Drop the cache, for a test. */
export function resetUpdateCache(): void {
  cached = undefined
}
