/**
 * A chain that names a 扫码登录 channel model — the half of the feature that was
 * wired on the DISPLAY side only.
 *
 * The routing page could build such a chain and drew every member correctly,
 * because `combosStatusOf` is handed the host roster. Three paths were never
 * given it:
 *
 *   - the aggregate catalog's chain rows (the picker's view, and the rows the
 *     gateway serves), so a chain made only of channel members was not listed at
 *     all;
 *   - the execution sources inside `serveComboCompletion`, so a member naming a
 *     channel was filtered out as unresolvable and the `member.host` branch was
 *     dead code — the chain silently served only its remaining members;
 *   - the roster's own rows, which carried no window or modality even though the
 *     host can describe both, so every chain joined by a channel member reported
 *     the 131072 default as its own budget.
 *
 * Each assertion below pins one of those, from the caller's side where possible.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkBuddyAccountPool } from '../src/accounts.ts'
import { WorkBuddyCatalog } from '../src/catalog.ts'
import {
  createChannelLane,
  type ChannelLaneAttachments,
  type ChannelLaneLlm,
} from '../src/channel-lane.ts'
import { AggregateCatalog } from '../src/aggregate.ts'
import { createWorkBuddyShim } from '../src/shim.ts'
import type { AggregateStore } from '../src/store.ts'
import type { HostModelRow } from '../src/combos.ts'
import { WorkBuddyUpstreamClient } from '../src/upstream.ts'

const CHANNEL_ID = 'trae:kimi-k3'
/** What the host answers for that model once asked to describe it. */
const HOST_ROW: HostModelRow = {
  id: CHANNEL_ID,
  channel: 'trae',
  modelId: 'kimi-k3',
  name: 'Kimi K3',
  contextWindow: 1_000_000,
  maxOutputTokens: 64_000,
  inputModalities: ['text', 'image'],
}

const shims: { close(): Promise<void> }[] = []

afterEach(async () => {
  while (shims.length > 0) await shims.pop()?.close()
})

const toId = (channel: string, modelId: string): string => `${channel}:${modelId}`

function fakeLlm(chunks: Record<string, unknown>[]): ChannelLaneLlm & {
  streamed: { provider: string; model: string }[]
} {
  const streamed: { provider: string; model: string }[] = []
  return {
    streamed,
    async listModels(provider: string) {
      if (provider !== 'trae') throw new Error(`no adapter for ${provider}`)
      return [{ id: 'kimi-k3', name: 'Kimi K3' }]
    },
    stream(options: Record<string, unknown>) {
      streamed.push({ provider: String(options.provider), model: String(options.model) })
      return (async function* () {
        for (const chunk of chunks) yield chunk
      })()
    },
  }
}

function lane(llm: ChannelLaneLlm, attachments?: () => ChannelLaneAttachments | undefined) {
  return createChannelLane({
    llm,
    providers: () => ['trae'],
    toId,
    ...(attachments === undefined ? {} : { attachments }),
  })
}

function storeWith(models: readonly string[]): AggregateStore {
  return {
    version: 1,
    enabled: true,
    providers: {},
    combos: [{ name: 'chain', models: [...models], strategy: 'fallback', stickyLimit: 1, enabled: true }],
  }
}

async function authDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wbchain-'))
  const auth = join(dir, 'auth')
  await mkdir(auth, { recursive: true })
  await writeFile(join(auth, 'workbuddy-desktop.info'), JSON.stringify({
    auth: {
      accessToken: 't', refreshToken: 'r',
      expiresAt: Date.now() + 3_600_000, refreshExpiresAt: Date.now() + 30 * 864e5, domain: '',
    },
    account: { uid: `u-${'0'.repeat(24)}`, uin: '1', nickname: 'N' },
  }), 'utf8')
  return auth
}

describe('the catalog knows a chain made of channel members', () => {
  it('lists it, with the member resolved through the host roster', async () => {
    const catalog = new AggregateCatalog(
      () => storeWith([CHANNEL_ID]),
      () => [],
      () => [HOST_ROW],
    )
    await catalog.refresh()
    const row = catalog.findCombo('combo:chain')
    expect(row, 'the chain row is missing: a channel member cannot be resolved').toBeDefined()
    expect(row?.models).toEqual([CHANNEL_ID])
  })

  it('reports the member window and modalities instead of the defaults', async () => {
    const catalog = new AggregateCatalog(
      () => storeWith([CHANNEL_ID]),
      () => [],
      () => [HOST_ROW],
    )
    await catalog.refresh()
    const row = catalog.findCombo('combo:chain')
    expect(row?.contextWindow).toBe(1_000_000)
    expect(row?.maxOutputTokens).toBe(64_000)
    // Every member must accept images or the chain does not advertise them, so a
    // channel row reported as text-only silently removes images from the chain.
    expect(row?.supportsImages).toBe(true)
  })

  it('keeps the documented defaults when the host cannot describe the row', async () => {
    const catalog = new AggregateCatalog(
      () => storeWith([CHANNEL_ID]),
      () => [],
      () => [{ id: CHANNEL_ID, channel: 'trae', modelId: 'kimi-k3', name: 'Kimi K3' }],
    )
    await catalog.refresh()
    const row = catalog.findCombo('combo:chain')
    expect(row?.contextWindow).toBe(131_072)
    expect(row?.supportsImages).toBe(false)
  })
})

describe('the gateway runs a chain whose only member is a channel model', () => {
  it('serves it through the host lane instead of answering combo_missing', async () => {
    const seen: string[] = []
    const llm = fakeLlm([
      { type: 'text-delta', index: 0, text: 'ok' },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    const originalStream = llm.stream.bind(llm)
    llm.stream = (options: Record<string, unknown>) => {
      seen.push(String(options.model))
      return originalStream(options)
    }
    const store = storeWith([CHANNEL_ID])
    const catalog = new AggregateCatalog(() => store, () => [], () => [HOST_ROW])
    await catalog.refresh()
    const pool = new WorkBuddyAccountPool({ authDirs: [await authDir()] })
    await pool.scan()
    const shim = createWorkBuddyShim({
      pool,
      client: new WorkBuddyUpstreamClient({ fetchImpl: async () => new Response('{}') as never }),
      catalog: new WorkBuddyCatalog('cn'),
      region: 'cn',
      channels: lane(llm),
      aggregate: { catalog, readStore: () => store },
    })
    shims.push(shim)
    await shim.ready
    const response = await fetch(`${shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${shim.token()}` },
      body: JSON.stringify({ model: 'combo:chain', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(response.status).toBe(200)
    await response.text()
    // The bare id: `trae:kimi-k3` is our composite, and the adapter would look for
    // a model literally named that.
    expect(seen).toEqual(['kimi-k3'])
  })
})

