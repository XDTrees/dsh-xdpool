/**
 * Declaring CodeArts' real limits to billion-context, so its rewrites stop
 * breaking every turn.
 *
 * MEASURED, 2026-11-14, live gateway, one variable at a time — the same body
 * and signature throughout, only the rewriting layer differs:
 *
 *   pack direct, max_tokens 65536                       → 200, streams
 *   through bili, max_tokens 65536 (bili raises it)    → 200 SSE
 *       {"error_code":"InferHub.001001005.400",
 *        "error_msg":"The request param is invalid, Please check it"}
 *   pack direct, max_tokens 384000                      → same frame
 *   through bili with `maas_type: benefit` stamped      → 200 SSE
 *       {"error_code":"InferHub.APIG.0101.404",
 *        "error_msg":"The API does not exist or has not been published …"}
 *   pack direct, max_tokens 65536, no `maas_type`       → 200, streams
 *
 * bili takes both values from `providers.<url>.models.<id>` in ITS config, and
 * falls back to guesses when the keys are absent: the models.dev registry
 * ceiling (384000 for this id) for `max_tokens`, and
 * `DEFAULT_BENEFIT_MODELS = ["glm-5.3-flash", "deepseek-v4.1-flash"]` for the
 * benefit header. Declaring both keys is what turns those guesses off.
 *
 * The properties pinned here are the ones whose absence makes the module
 * harmful instead of helpful: it writes into another plugin's live config, so a
 * bad merge loses the user's own providers, and a non-idempotent write rewrites
 * the file on every scan.
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CODEARTS_MAX_OUTPUT_TOKENS,
  CODEARTS_UPSTREAM,
  KNOWN_CODEARTS_MODELS,
  biliConfigPath,
  codeArtsModelIds,
  ensureCodeArtsRouteDeclarations,
  resetBiliRouteDeclarations,
  mergeRouteDeclarations,
} from '../src/bili-routes.ts'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'xdpool-bili-routes-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

/** A document shaped like a real bili config, with a provider of the user's. */
function userDocument(): Record<string, unknown> {
  return {
    providers: {
      'https://api.example.com': {
        models: { 'some-model': { output: 8192, context: 200_000 } },
        proxy: 'http://127.0.0.1:7890',
      },
      [CODEARTS_UPSTREAM]: {
        models: {
          // A user who lowered the ceiling themselves must keep it: raising it
          // back would re-create the very rejection this exists to prevent.
          'GLM-5.2': { output: 4096, context: 202_752 },
        },
        compress: { nudge: { enabled: true } },
      },
    },
    upstreamProxyMode: 'manual',
    billing: { prices: { 'some-model': { input: 1 } } },
  }
}

describe('the declared ceiling is the one the gateway enforces', () => {
  it('declares 65536, the measured ceiling', () => {
    // 131072 produces an empty stream and 384000 the 4001.200 frame; only
    // 65536 was measured to stream on this gateway.
    expect(CODEARTS_MAX_OUTPUT_TOKENS).toBe(65_536)
  })

  it('corrects the 384000 the registry would otherwise supply', () => {
    const { document } = mergeRouteDeclarations({}, ['deepseek-v4.1-flash'])
    const route = (document['providers'] as Record<string, Record<string, unknown>>)[CODEARTS_UPSTREAM]
    const entry = (route['models'] as Record<string, Record<string, unknown>>)['deepseek-v4.1-flash']
    expect(entry['output']).toBe(CODEARTS_MAX_OUTPUT_TOKENS)
  })

  it('answers the benefit question instead of leaving bili to guess', () => {
    // `false` is what stops bili stamping `maas_type: benefit`, which the
    // measured account answered with APIG.0101 on an otherwise identical body.
    const { document } = mergeRouteDeclarations({}, ['deepseek-v4.1-flash'])
    const route = (document['providers'] as Record<string, Record<string, unknown>>)[CODEARTS_UPSTREAM]
    const entry = (route['models'] as Record<string, Record<string, unknown>>)['deepseek-v4.1-flash']
    expect(entry['benefit']).toBe(false)
  })

  it('also corrects a LARGER ceiling already in the file', () => {
    // bili's own printed advice names `output` as the knob; a file left with
    // 384000 in it (by a user following that advice, or by an older build of
    // this plugin) must not be trusted.
    const existing = {
      providers: { [CODEARTS_UPSTREAM]: { models: { 'deepseek-v4.1-flash': { output: 384_000 } } } },
    }
    const { document, changed } = mergeRouteDeclarations(existing, ['deepseek-v4.1-flash'])
    const route = (document['providers'] as Record<string, Record<string, unknown>>)[CODEARTS_UPSTREAM]
    const entry = (route['models'] as Record<string, Record<string, unknown>>)['deepseek-v4.1-flash']
    expect(entry['output']).toBe(CODEARTS_MAX_OUTPUT_TOKENS)
    expect(changed).toBe(true)
  })

  it('keeps a SMALLER ceiling the user chose deliberately', () => {
    const existing = { providers: { [CODEARTS_UPSTREAM]: { models: { 'GLM-5.2': { output: 4096 } } } } }
    const { document } = mergeRouteDeclarations(existing, ['GLM-5.2'])
    const route = (document['providers'] as Record<string, Record<string, unknown>>)[CODEARTS_UPSTREAM]
    const entry = (route['models'] as Record<string, Record<string, unknown>>)['GLM-5.2']
    expect(entry['output']).toBe(4096)
  })
})

describe('the merge only touches what it owns', () => {
  it('preserves every other provider and top-level block', () => {
    const before = userDocument()
    const { document } = mergeRouteDeclarations(before, ['deepseek-v4.1-flash'])
    const providers = document['providers'] as Record<string, unknown>
    // Another vendor's route is untouched, proxy included.
    expect(providers['https://api.example.com']).toEqual(
      (before['providers'] as Record<string, unknown>)['https://api.example.com'],
    )
    expect(document['upstreamProxyMode']).toBe('manual')
    expect(document['billing']).toEqual({ prices: { 'some-model': { input: 1 } } })
  })

  it('preserves the CodeArts route’s other keys and other models', () => {
    const { document } = mergeRouteDeclarations(userDocument(), ['deepseek-v4.1-flash'])
    const route = (document['providers'] as Record<string, Record<string, unknown>>)[CODEARTS_UPSTREAM]
    expect(route['compress']).toEqual({ nudge: { enabled: true } })
    const models = route['models'] as Record<string, Record<string, unknown>>
    // A model we did not declare keeps its own context window.
    expect(models['GLM-5.2']?.['context']).toBe(202_752)
    expect(models['GLM-5.2']?.['output']).toBe(4096)
  })

  it('does not mutate the document it was given', () => {
    // bili's `GET` payload is parsed fresh per call, but an in-place edit would
    // still corrupt the comparison that decides whether a write is needed.
    const before = userDocument()
    const snapshot = JSON.stringify(before)
    mergeRouteDeclarations(before, ['deepseek-v4.1-flash'])
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('reports no change when the file already says this', () => {
    const first = mergeRouteDeclarations({}, KNOWN_CODEARTS_MODELS)
    const second = mergeRouteDeclarations(first.document, KNOWN_CODEARTS_MODELS)
    expect(first.changed).toBe(true)
    expect(second.changed).toBe(false)
    expect(second.document).toEqual(first.document)
  })
})

describe('the model roster comes from the pack’s own catalog', () => {
  it('reads ids out of the cached catalog shape', () => {
    const catalog = [{ id: 'GLM-5.2', name: 'GLM-5.2' }, { id: 'kimi-k3', name: 'Kimi-K3' }]
    expect(codeArtsModelIds(catalog)).toContain('kimi-k3')
  })

  it('unions the catalog with the fallback roster', () => {
    // A catalog fetched before a model was published must not drop the model
    // the user is about to pick; the fallback is the safety net.
    const ids = codeArtsModelIds([{ id: 'kimi-k3' }])
    expect(ids).toContain('kimi-k3')
    expect(ids).toContain('deepseek-v4.1-flash')
  })

  it('survives a missing or junk catalog', () => {
    expect(codeArtsModelIds(undefined)).toEqual([...KNOWN_CODEARTS_MODELS])
    expect(codeArtsModelIds('not a catalog')).toEqual([...KNOWN_CODEARTS_MODELS])
    expect(codeArtsModelIds([{ name: 'no id' }, 42, null])).toEqual([...KNOWN_CODEARTS_MODELS])
  })

  it('does not repeat an id the catalog and the fallback share', () => {
    const ids = codeArtsModelIds([{ id: 'GLM-5.2' }], ['GLM-5.2'])
    expect(ids.filter((id) => id === 'GLM-5.2')).toHaveLength(1)
  })
})

describe('the config file is resolved the way bili resolves it', () => {
  it('honours BILI_CONFIG_FILE', () => {
    expect(biliConfigPath({ BILI_CONFIG_FILE: '/custom/bili.json' } as NodeJS.ProcessEnv)).toBe('/custom/bili.json')
  })

  it('honours XDG_CONFIG_HOME over the home fallback', () => {
    expect(biliConfigPath({ XDG_CONFIG_HOME: '/xdg' } as NodeJS.ProcessEnv)).toBe(
      join('/xdg', 'billion-context', 'billion-context.json'),
    )
  })
})

describe('applying to a live proxy', () => {
  /** A fetch double that serves and accepts bili's config API. */
  function proxyDouble(initial: Record<string, unknown>): {
    fetchImpl: typeof fetch
    state: { document: Record<string, unknown>; puts: string[] }
  } {
    const state = { document: JSON.parse(JSON.stringify(initial)) as Record<string, unknown>, puts: [] as string[] }
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      if (!url.endsWith('/__bili/config')) throw new Error(`unexpected URL ${url}`)
      if ((init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ path: '/x', raw: JSON.stringify(state.document, null, 2) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      const body = JSON.parse(String(init?.body)) as { file?: string }
      if (typeof body.file !== 'string') {
        return new Response(JSON.stringify({ error: 'expected file' }), { status: 400 })
      }
      state.puts.push(body.file)
      state.document = JSON.parse(body.file) as Record<string, unknown>
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch
    return { fetchImpl, state }
  }

  it('writes the merged document through the live proxy', async () => {
    const before = userDocument()
    const { fetchImpl, state } = proxyDouble(before)
    const outcome = await ensureCodeArtsRouteDeclarations({
      env: { HOME: home, BILI_CONFIG_FILE: join(home, 'bili.json') } as NodeJS.ProcessEnv,
      origin: 'http://127.0.0.1:18787',
      fetchImpl,
    })
    expect(outcome.applied).toBe('proxy')
    expect(state.puts).toHaveLength(1)
    // The proxy was handed the WHOLE document, not just our route: bili's
    // provider PUT replaces the map, so a partial payload would delete the
    // user's other providers.
    const sent = JSON.parse(state.puts[0] ?? '{}') as Record<string, unknown>
    const providers = sent['providers'] as Record<string, unknown>
    expect(providers['https://api.example.com']).toBeDefined()
    expect(sent['billing']).toBeDefined()
    const route = (providers[CODEARTS_UPSTREAM] as Record<string, Record<string, unknown>>)['models'] as Record<
      string,
      Record<string, unknown>
    >
    expect(route['deepseek-v4.1-flash']?.['output']).toBe(CODEARTS_MAX_OUTPUT_TOKENS)
    expect(route['deepseek-v4.1-flash']?.['benefit']).toBe(false)
  })

  it('sends nothing when the proxy already has the declarations', async () => {
    // Runs on every pool scan; an unconditional PUT would rewrite the config
    // continuously and restart bili's route table with it.
    const { fetchImpl, state } = proxyDouble(userDocument())
    const env = { HOME: home, BILI_CONFIG_FILE: join(home, 'bili.json') } as NodeJS.ProcessEnv
    const first = await ensureCodeArtsRouteDeclarations({ env, origin: 'http://127.0.0.1:18787', fetchImpl })
    expect(first.applied).toBe('proxy')
    const second = await ensureCodeArtsRouteDeclarations({ env, origin: 'http://127.0.0.1:18787', fetchImpl })
    expect(second.applied).toBe('already-declared')
    expect(state.puts).toHaveLength(1)
  })

  it('falls back to the config file when no proxy answers', async () => {
    const target = join(home, 'billion-context', 'billion-context.json')
    await mkdir(join(home, 'billion-context'), { recursive: true })
    await writeFile(target, JSON.stringify(userDocument()), 'utf8')
    const fetchImpl = (async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:18787')
    }) as unknown as typeof fetch
    const outcome = await ensureCodeArtsRouteDeclarations({
      env: { HOME: home, BILI_CONFIG_FILE: target } as NodeJS.ProcessEnv,
      origin: 'http://127.0.0.1:18787',
      fetchImpl,
    })
    expect(outcome.applied).toBe('file')
    const written = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>
    const providers = written['providers'] as Record<string, unknown>
    // Still the user's document, now with our declarations merged in.
    expect(providers['https://api.example.com']).toBeDefined()
    expect(written['billing']).toBeDefined()
    const route = (providers[CODEARTS_UPSTREAM] as Record<string, Record<string, unknown>>)['models'] as Record<
      string,
      Record<string, unknown>
    >
    expect(route['deepseek-v4.1-flash']?.['output']).toBe(CODEARTS_MAX_OUTPUT_TOKENS)
  })

  it('creates the config file when none exists', async () => {
    const target = join(home, 'fresh', 'billion-context.json')
    const outcome = await ensureCodeArtsRouteDeclarations({
      env: { HOME: home, BILI_CONFIG_FILE: target } as NodeJS.ProcessEnv,
      fetchImpl: (async () => {
        throw new Error('no proxy')
      }) as unknown as typeof fetch,
    })
    expect(outcome.applied).toBe('file')
    const written = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>
    expect((written['providers'] as Record<string, unknown>)[CODEARTS_UPSTREAM]).toBeDefined()
  })

  it('never throws when the filesystem refuses the write', async () => {
    // This runs on the sign-in path: a failure here must not turn a working
    // login into an error. A path whose parent is a regular FILE cannot be
    // created, so `mkdir` fails and the write with it.
    const blocker = join(home, 'blocker')
    await writeFile(blocker, 'not a directory', 'utf8')
    const outcome = await ensureCodeArtsRouteDeclarations({
      env: { HOME: home, BILI_CONFIG_FILE: join(blocker, 'config.json') } as NodeJS.ProcessEnv,
      fetchImpl: (async () => {
        throw new Error('no proxy')
      }) as unknown as typeof fetch,
    })
    expect(outcome.applied).toBe('no-config')
    expect(outcome.error).toBeDefined()
  })
})

describe('repeated scans do not re-probe the proxy', () => {
  it('serves the cached outcome to an unparameterised caller', async () => {
    // This runs on EVERY pool scan, and a scan rides every lazy model load. A
    // local HTTP round trip plus a file read on that path is pure waste once
    // the declarations are known, and bili re-reads its file when it spawns.
    resetBiliRouteDeclarations()
    const count = { get: 0, put: 0 }
    const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        count.get += 1
        return new Response(JSON.stringify({ raw: '{}' }), { status: 200 })
      }
      count.put += 1
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch
    const target = join(home, 'billion-context.json')
    const first = await ensureCodeArtsRouteDeclarations({
      env: { HOME: home, BILI_CONFIG_FILE: target } as NodeJS.ProcessEnv,
      origin: 'http://127.0.0.1:18787',
      fetchImpl,
    })
    expect(first.applied).toBe('proxy')
    // A later call with no explicit options hits the latch instead of the proxy.
    const second = await ensureCodeArtsRouteDeclarations()
    expect(second).toBe(first)
    expect(count.put).toBe(1)
  })

  it('does not latch a failure', async () => {
    resetBiliRouteDeclarations()
    const failing = (async () => {
      throw new Error('no proxy')
    }) as unknown as typeof fetch
    const blocker = join(home, 'blocker2')
    await writeFile(blocker, 'x', 'utf8')
    const bad = await ensureCodeArtsRouteDeclarations({
      env: { HOME: home, BILI_CONFIG_FILE: join(blocker, 'config.json') } as NodeJS.ProcessEnv,
      fetchImpl: failing,
    })
    expect(bad.error).toBeDefined()
    // A failed attempt must be retried on the next scan, not remembered.
    const retried = await ensureCodeArtsRouteDeclarations({
      env: { HOME: home, BILI_CONFIG_FILE: join(home, 'ok.json') } as NodeJS.ProcessEnv,
      fetchImpl: failing,
    })
    expect(retried.applied).toBe('file')
  })
})
