/**
 * Create the GitHub release for v2.5.1 with the human author.
 *
 * The repo's own `release.yml` deliberately does NOT create releases: it only
 * has `secrets.GITHUB_TOKEN`, and a release made with that shows
 * `github-actions[bot]` as the author while every earlier release on this page
 * is authored by XDTrees. The workflow even says so, and points at "建 Release
 * 由维护者用本人凭据". This script is that step, run with the maintainer's own
 * token.
 *
 * Refuses to run if:
 *   - the tag does not resolve to a commit on `main` (a release for an
 *     unreachable commit is a page nobody can build from);
 *   - a release for the tag already exists (the API would 422, but the message
 *     here says why instead of a bare status);
 *   - the body file is empty.
 *
 * Run: node tools/create-release.mjs v2.5.1 _release-2.5.1.md
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const TOKEN = process.env.GH_TOKEN ?? ''
if (TOKEN === '') throw new Error('GH_TOKEN is not set')

const tag = process.argv[2]
const bodyFile = process.argv[3]
if (tag === undefined || bodyFile === undefined) {
  throw new Error('usage: node tools/create-release.mjs <tag> <body.md>')
}
const body = readFileSync(join(ROOT, bodyFile), 'utf8').trim()
if (body === '') throw new Error(`${bodyFile} is empty`)

const REPO = 'XDTrees/dsh-xdpool'
const API = 'https://api.github.com'

async function gh(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `token ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-xdpool-release',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
  })
  const text = await response.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = text }
  if (!response.ok) {
    throw new Error(`GitHub ${String(response.status)} on ${path}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`)
  }
  return parsed
}

// 1. The tag must exist and be reachable from main. A tag pointing at an
//    unmerged commit would publish a release whose source is not the branch.
const ref = await gh(`/repos/${REPO}/git/ref/tags/${tag}`)
const tagged = ref.object.type === 'tag'
  ? (await gh(`/repos/${REPO}/git/tags/${ref.object.sha}`)).object.sha
  : ref.object.sha
const branch = await gh(`/repos/${REPO}/branches/main`)
const headSha = branch.commit.sha
if (tagged !== headSha) {
  throw new Error(`${tag} points at ${tagged}, but main is at ${headSha}; refusing to release a commit main does not carry`)
}
console.log(`tag ${tag} -> ${tagged} (== main)`)

// 2. It must not already have a release.
const existing = await fetch(`${API}/repos/${REPO}/releases/tags/${tag}`, {
  headers: { authorization: `token ${TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'dsh-xdpool-release' },
})
if (existing.ok) {
  const found = await existing.json()
  throw new Error(`a release for ${tag} already exists: ${found.html_url}`)
}

// 3. Title follows the house style: `v<version> — <subtitle>`, where the
//    subtitle is the CHANGELOG heading's own tail. Deriving it instead of
//    typing it is what keeps the release page and the changelog from drifting.
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
const version = tag.replace(/^v/u, '')
const heading = changelog.split('\n').find(line => line.startsWith(`## ${version} `))
if (heading === undefined) throw new Error(`CHANGELOG has no "## ${version} " heading`)
const dash = heading.indexOf(' — ')
const subtitle = dash === -1 ? '' : heading.slice(dash + 3).trim()
const name = subtitle === '' ? tag : `${tag} — ${subtitle}`
console.log(`title: ${name}`)

const created = await gh(`/repos/${REPO}/releases`, {
  method: 'POST',
  body: JSON.stringify({ tag_name: tag, name, body, draft: false, prerelease: false, make_latest: 'true' }),
})
console.log(`created ${created.tag_name}: author=${created.author.login} draft=${String(created.draft)} latest=true`)
console.log(created.html_url)
