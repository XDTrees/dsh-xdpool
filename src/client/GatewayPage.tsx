/**
 * The gateway page: the relay that re-exposes the pool to the rest of the LAN.
 *
 * The page is written around one fact that is easy to get wrong and expensive to
 * get wrong twice: the key shown here is the RELAY key, not the shim's secret.
 * The shim's secret is minted per process, so if it were the thing a phone held,
 * every DSH restart would break every configured client. This page therefore
 * never hands out a credential that outlives a restart.
 *
 * Three deliberate honesty choices:
 *
 * 1. Defaulting to loopback. The bind address is a choice with a network-visible
 *    consequence, so it starts at `127.0.0.1` and says plainly what that means
 *    ("only this computer"). Turning it to `0.0.0.0` is a separate, explicit act.
 * 2. A key is minted the moment the relay is enabled, not on first use. An
 *    enabled relay with no key would have to either refuse everyone (so the
 *    switch silently does nothing) or accept everyone.
 * 3. A failed bind is reported as a failure, not as "off". The difference matters
 *    because "off" tells the user to turn on something that is already on.
 *
 * Class names: this page reuses the shell's generic `.dsm-xdpool-sec`
 * and `-sectitle` instead of redefining a section frame per panel. The few
 * classes it does own are prefixed `-gw-` and all live in `GATEWAY_CARD_CSS`.
 *
 * @module dsh-xdpool/client/GatewayPage
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { POOL_RELAY_PATH, type PoolWebRelayStatus } from '../status-paths.ts'
import { copyText } from './clipboard.ts'
import { GATEWAY_CARD_CSS } from './styles.ts'
import { PageHero } from './shell.tsx'
import type { XdPoolSettingsKey } from './locales.ts'
/** The translator the settings section injects. */
type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string
export interface GatewayPageProps {
  t?: Translate | undefined
}
/**
 * The only two bind addresses offered.
 *
 * Mirrors `RELAY_HOSTS` in `src/relay.ts`. Duplicated rather than imported
 * because the server module imports `node:http` and this bundle is built for the
 * browser — importing it would drag a Node listener into the card.
 * `tests/relay-page.test.ts` asserts the two lists cannot drift apart.
 */
const HOSTS = [
  { value: '127.0.0.1', fallback: 'localhost only' },
  { value: '0.0.0.0', fallback: 'every device on this network' },
] as const
/** Poll interval. Slower than the pool card: a relay does not change on its own. */
const POLL_MS = 15_000
/**
 * A masked key for display, never the full value.
 *
 * The card renders a reveal button instead of printing the key, because a
 * screenshot of the settings panel is a normal thing to share and a settings
 * screenshot should not hand out a credential. The value is still in the
 * document — the user asked for it and has to paste it into another device — it
 * is just not pre-rendered.
 */
function maskOf(key: string): string {
  if (key.length <= 8) return '•'.repeat(Math.max(4, key.length))
  return `${key.slice(0, 4)}${'•'.repeat(8)}${key.slice(-4)}`
}
export function GatewayPage({ t }: GatewayPageProps) {
  const [status, setStatus] = useState<PoolWebRelayStatus | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [flash, setFlash] = useState<string | undefined>(undefined)
  /**
   * Which field was last copied, so its own button can say "Copied" for a moment.
   *
   * Held per-field rather than one global flag: a single boolean would put "Copied"
   * on the key button right after the base URL was copied, which reads as a bug in a
   * panel whose whole job is to hand over exactly the right strings.
   */
  const [copiedField, setCopiedField] = useState<string | undefined>(undefined)
  const copyTimer = useRef<number | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [host, setHost] = useState<string>('127.0.0.1')
  const [port, setPort] = useState<string>('8326')
  /**
   * The in-progress share list, or undefined while it still mirrors the server.
   *
   * Held as a draft for the same reason the model card holds one: saving is a
   * deliberate act here, because every unchecked row stops working on whatever
   * device is already pointed at the gateway.
   */
  const [draftShared, setDraftShared] = useState<ReadonlySet<string> | undefined>(undefined)
  /**
   * Which ids are shared right now.
   *
   * `status.shared === undefined` means the user has never chosen, and the
   * gateway is serving everything — so the picker must show every row ticked
   * rather than an empty list, which would read as "nothing is shared" and invite
   * a save that closes a gateway that was open.
   */
  const candidates = status?.candidates ?? []
  const serverShared = status?.shared ?? candidates.map(row => row.id)
  const shared = draftShared ?? new Set(serverShared)
  const sharedDirty = draftShared !== undefined
    && (draftShared.size !== serverShared.length
      || [...draftShared].some(id => !serverShared.includes(id)))
  const toggleShared = (id: string): void => {
    const next = new Set(shared)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setDraftShared(next)
  }
  const setAllShared = (on: boolean): void => {
    setDraftShared(on ? new Set(candidates.map(row => row.id)) : new Set<string>())
  }
  /** True once the server's values were adopted, so polls do not stomp edits. */
  const seeded = useRef(false)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const response = await fetch(POOL_RELAY_PATH, {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        ...signal === undefined ? {} : { signal },
      })
      const value: unknown = await response.json().catch(() => undefined)
      if (!response.ok) {
        const detail = value as { error?: string } | undefined
        if (mounted.current) setError(detail?.error ?? `HTTP ${response.status}`)
        return
      }
      if (mounted.current && signal?.aborted !== true) {
        const next = value as PoolWebRelayStatus
        setStatus(next)
        setError(undefined)
        // Adopt the stored address ONCE. After that the fields belong to the
        // user: a poll landing mid-edit must not replace a half-typed port.
        if (!seeded.current) {
          seeded.current = true
          if (next.host !== '') setHost(next.host)
          if (next.port > 0) setPort(String(next.port))
        }
      }
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    const timer = setInterval(() => { void load(controller.signal) }, POLL_MS)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [load])
  /**
   * Send one patch.
   *
   * The response IS the new state, so the panel never has to guess what the
   * server decided: a port it refused, a key it minted, a bind it failed all
   * come back as facts rather than as the optimistic local edit.
   */
  const write = useCallback(async (patch: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    try {
      const response = await fetch(POOL_RELAY_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(patch),
      })
      const value: unknown = await response.json().catch(() => undefined)
      if (!response.ok) {
        const detail = value as { error?: string } | undefined
        if (mounted.current) setFlash(`${t?.('gw.saveFailed') ?? 'Could not save'}: ${detail?.error ?? `HTTP ${response.status}`}`)
        return
      }
      if (!mounted.current) return
      const next = value as PoolWebRelayStatus
      setStatus(next)
      setFlash(undefined)
      setError(undefined)
      // A freshly minted key is a new secret; hide it again so it is not left on
      // screen after the user copies it.
      setRevealed(false)
    } catch (cause: unknown) {
      if (mounted.current) setFlash(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [t])
  /**
   * Copy one of the strings a client needs, and say so on that field's own button.
   *
   * A copy button earns its place here because the alternative is transcription: the
   * base URL, the key and the `/v1` suffix have to reach another program exactly, and
   * a masked key cannot be read off the screen at all. The reference gateway solves
   * the same problem by printing a shell one-liner that pipes a file into the
   * clipboard — necessary there because its key lives only in a local file. Here the
   * key is already in this document, so the button can be honest and direct.
   *
   * Failures are reported rather than swallowed: a copy that silently does nothing
   * leaves the user pasting a stale value and blaming the key.
   */
  const copy = useCallback(async (field: string, value: string): Promise<void> => {
    const ok = await copyText(value)
    if (!mounted.current) return
    if (!ok) {
      setFlash(t?.('gw.copyFailed') ?? 'Could not copy — select the text and copy it manually.')
      return
    }
    setFlash(undefined)
    setCopiedField(field)
    if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
    // Long enough to be noticed, short enough that the label is back to normal before
    // the reader wants to press it again.
    copyTimer.current = window.setTimeout(() => {
      if (mounted.current) setCopiedField(undefined)
    }, 1600)
  }, [t])
  // The timer would otherwise fire into an unmounted component.
  useEffect(() => () => {
    if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
  }, [])
  const enabled = status?.enabled === true
  const listening = status?.listening === true
  const key = status?.key ?? ''
  const parsedPort = Number(port)
  const portUsable = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535
  /**
   * The two strings a client actually needs, derived from the LIVE bound address.
   *
   * `status.endpoint` is what the listener really bound, which is not always what was
   * requested: port 0 asks the OS for a free port, and a host of 0.0.0.0 binds every
   * interface but cannot be dialled — a client on the same machine has to use
   * 127.0.0.1. Copying the requested values would hand out a URL that does not answer.
   */
  const endpoint = status?.endpoint ?? ''
  /**
   * The origin, without `/v1`.
   *
   * WHAT GETS COPIED DEPENDS ON THE CLIENT, and getting it wrong produces a 404 that
   * blames the relay:
   *
   *   - clients that append the path themselves (`{base}/v1/chat/completions`) want
   *     the BARE origin — handed `/v1`, they ask for `/v1/v1/chat/completions`,
   *     which is exactly the `404 /v1/v1/responses` a user reported;
   *   - clients that want the full prefix pasted in (many "OpenAI compatible"
   *     fields, and `OPENAI_BASE_URL`) want it WITH `/v1`.
   *
   * There is no single right answer, so the panel offers both and labels each with
   * the client behaviour it suits. Silently picking one is what produced the report.
   */
  const origin = endpoint.replace(/\/+$/u, '')
  const baseUrl = origin === '' ? '' : `${origin}/v1`
  /**
   * Base URL and key together, in the shape every OpenAI client asks for.
   *
   * Not JSON: pasting a JSON blob into a client that wants two separate fields is
   * more work than pasting nothing, and the user still has to split it by eye. Two
   * labelled lines survive that trip — and if they paste it into a chat to ask a
   * question, the labels make it readable.
   */
  const configSnippet = baseUrl === '' || key === ''
    ? ''
    : `Base URL: ${baseUrl}\nAPI Key: ${key}`
  return (
    <div className="dsm-xdpool-gw">
      <style>{GATEWAY_CARD_CSS}</style>
      <PageHero
        title={t?.('gw.title') ?? 'Gateway'}
        sub={t?.('gw.sub') ?? ''}
        pills={<>
          <span className="dsm-xdpool-pill" data-tone={enabled ? 'ok' : 'off'}>
            {enabled ? (t?.('gw.on') ?? 'On') : (t?.('gw.off') ?? 'Off')}
          </span>
          {/* Two different states, on purpose. "On but not listening" is a
              failure the user has to be able to see; collapsing it into "off"
              would tell them to switch on something that is already on. */}
          <span className="dsm-xdpool-pill" data-tone={listening ? 'ok' : enabled ? 'warn' : 'off'}>
            {listening
              ? (t?.('gw.listening') ?? 'Listening')
              : enabled
                ? (t?.('gw.notListening') ?? 'On, not listening')
                : (t?.('gw.idle') ?? 'Idle')}
          </span>
        </>}
      />
      {error !== undefined
        ? <p className="dsm-xdpool-panel-error">{error}</p>
        : null}
      {flash !== undefined
        ? <p className="dsm-xdpool-gw-flash">{flash}</p>
        : null}
      {status?.error !== undefined && status.error !== ''
        ? <p className="dsm-xdpool-panel-error">{status.error}</p>
        : null}
      {status === undefined && error === undefined
        ? <p className="dsm-xdpool-panel-empty">{t?.('gw.loading') ?? 'Reading…'}</p>
        : null}
      <div className="dsm-xdpool-sec">
        <p className="dsm-xdpool-sectitle">{t?.('gw.switch') ?? 'Relay'}</p>
        <div>
          <button
            type="button"
            className="dsm-xdpool-gw-btn"
            data-on={enabled ? 'true' : 'false'}
            disabled={busy}
            onClick={() => { void write({ enabled: !enabled }) }}
          >
            {enabled ? (t?.('gw.turnOff') ?? 'Turn off') : (t?.('gw.turnOn') ?? 'Turn on')}
          </button>
        </div>
        <p className="dsm-xdpool-gw-note">{t?.('gw.switchHint') ?? ''}</p>
      </div>
      <div className="dsm-xdpool-sec">
        <p className="dsm-xdpool-sectitle">{t?.('gw.address') ?? 'Address'}</p>
        <label className="dsm-xdpool-gw-field">
          <span>{t?.('gw.host') ?? 'Bind address'}</span>
          <select value={host} disabled={busy} onChange={event => { setHost(event.target.value) }}>
            {HOSTS.map(option => (
              <option key={option.value} value={option.value}>
                {option.value} — {t?.('gw.hostFallback', { fallback: option.fallback }) ?? option.fallback}
              </option>
            ))}
          </select>
        </label>
        <label className="dsm-xdpool-gw-field">
          <span>{t?.('gw.port') ?? 'Port'}</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={port}
            disabled={busy}
            onChange={event => { setPort(event.target.value) }}
          />
        </label>
        <div>
          <button
            type="button"
            className="dsm-xdpool-gw-btn"
            data-on="false"
            disabled={busy || !portUsable}
            onClick={() => { void write({ host, port: parsedPort }) }}
          >
            {t?.('gw.saveAddress') ?? 'Save address'}
          </button>
        </div>
        {portUsable ? null : <p className="dsm-xdpool-gw-warn">{t?.('gw.portInvalid') ?? ''}</p>}
        {listening && status?.endpoint !== undefined && status.endpoint !== ''
          ? (
            <>
              <p className="dsm-xdpool-gw-note">
                {t?.('gw.endpoint', { endpoint: status.endpoint }) ?? status.endpoint}
              </p>
              {/* Two forms, because clients disagree about who appends `/v1` —
                  see the `origin` comment above. Each button names the client
                  behaviour it suits so the reader picks, instead of guessing and
                  getting a 404 that blames the relay. */}
              <div className="dsm-xdpool-gw-actions">
                <button
                  type="button"
                  className="dsm-xdpool-gw-btn"
                  data-on={copiedField === 'base' ? 'true' : 'false'}
                  onClick={() => { void copy('base', origin) }}
                  title={t?.('gw.copyOriginHint') ?? '客户端自己会补 /v1 时用这个（大多数 SDK）'}
                >
                  {copiedField === 'base'
                    ? (t?.('gw.copied') ?? 'Copied')
                    : (t?.('gw.copyOrigin') ?? 'Copy base URL')}
                </button>
                <button
                  type="button"
                  className="dsm-xdpool-gw-btn"
                  data-on={copiedField === 'baseV1' ? 'true' : 'false'}
                  onClick={() => { void copy('baseV1', baseUrl) }}
                  title={t?.('gw.copyV1Hint') ?? '要填完整前缀时用这个（含 /v1）'}
                >
                  {copiedField === 'baseV1'
                    ? (t?.('gw.copied') ?? 'Copied')
                    : (t?.('gw.copyV1') ?? 'Copy with /v1')}
                </button>
                <button
                  type="button"
                  className="dsm-xdpool-gw-btn"
                  data-on={copiedField === 'all' ? 'true' : 'false'}
                  onClick={() => { void copy('all', configSnippet) }}
                  title={t?.('gw.copyAllHint') ?? 'base URL + key，可直接粘进客户端'}
                >
                  {copiedField === 'all'
                    ? (t?.('gw.copied') ?? 'Copied')
                    : (t?.('gw.copyAll') ?? 'Copy both')}
                </button>
              </div>
              {/* The wire this relay speaks, stated plainly. A client set to the
                  Responses API asks for `/v1/responses`, which is NOT forwarded —
                  saying so here is cheaper than the 404 that says it later. */}
              <p className="dsm-xdpool-gw-note">
                {t?.('gw.wire') ?? '只支持 Chat Completions（/v1/chat/completions 与 /v1/models）。若客户端用 Responses 或 Anthropic 协议，请改成 Chat Completions。'}
              </p>
            </>
          )
          : null}
      </div>
      <div className="dsm-xdpool-sec">
        <p className="dsm-xdpool-sectitle">{t?.('gw.key') ?? 'Key'}</p>
        <p className="dsm-xdpool-gw-key">
          {key === '' ? (t?.('gw.noKey') ?? 'No key yet') : revealed ? key : maskOf(key)}
        </p>
        <div className="dsm-xdpool-gw-actions">
          <button
            type="button"
            className="dsm-xdpool-gw-btn"
            data-on={copiedField === 'key' ? 'true' : 'false'}
            disabled={busy || key === ''}
            // Copies the REAL key even while it is masked on screen: the mask is a
            // shoulder-surfing guard, not a statement that the value is unavailable,
            // and forcing a reveal-then-copy would undo the guard it exists for.
            onClick={() => { void copy('key', key) }}
          >
            {copiedField === 'key'
              ? (t?.('gw.copied') ?? 'Copied')
              : (t?.('gw.copyKey') ?? 'Copy key')}
          </button>
          <button
            type="button"
            className="dsm-xdpool-gw-btn"
            data-on="false"
            disabled={busy || key === ''}
            onClick={() => { setRevealed(current => !current) }}
          >
            {revealed ? (t?.('gw.hideKey') ?? 'Hide') : (t?.('gw.showKey') ?? 'Show')}
          </button>
          <button
            type="button"
            className="dsm-xdpool-gw-btn"
            data-on="false"
            disabled={busy}
            onClick={() => { void write({ key: '' }) }}
          >
            {t?.('gw.rotate') ?? 'Rotate'}
          </button>
        </div>
        <p className="dsm-xdpool-gw-note">{t?.('gw.keyHint') ?? ''}</p>
      </div>
      <div className="dsm-xdpool-sec">
        <p className="dsm-xdpool-sectitle">{t?.('gw.share') ?? 'Shared models'}</p>
        <p className="dsm-xdpool-gw-note">{t?.('gw.shareHint') ?? ''}</p>
        {candidates.length === 0
          ? <p className="dsm-xdpool-gw-note">{t?.('gw.shareNone') ?? ''}</p>
          : (
            <>
              <div className="dsm-xdpool-gw-actions">
                <button
                  type="button"
                  className="dsm-xdpool-gw-btn"
                  data-on="false"
                  disabled={busy}
                  onClick={() => { setAllShared(true) }}
                >
                  {t?.('gw.shareAll') ?? 'Select all'}
                </button>
                <button
                  type="button"
                  className="dsm-xdpool-gw-btn"
                  data-on="false"
                  disabled={busy}
                  onClick={() => { setAllShared(false) }}
                >
                  {t?.('gw.shareNoneBtn') ?? 'Select none'}
                </button>
                <button
                  type="button"
                  className="dsm-xdpool-gw-btn"
                  data-on="true"
                  disabled={busy || !sharedDirty}
                  onClick={() => {
                    void write({ models: [...shared] }).then(() => { setDraftShared(undefined) })
                  }}
                >
                  {t?.('gw.shareSave') ?? 'Save'}
                </button>
              </div>
              {sharedDirty
                ? <p className="dsm-xdpool-gw-warn">{t?.('gw.shareDirty') ?? ''}</p>
                : null}
              {/* Grouped by lane, because the same model name appears under
                  several channels and a flat list of 140 rows cannot say which
                  one a tick actually enables. */}
              {[...new Set(candidates.map(row => row.source))].map(source => (
                <div className="dsm-xdpool-gw-group" key={source}>
                  <p className="dsm-xdpool-gw-group-title">{source}</p>
                  {candidates.filter(row => row.source === source).map(row => (
                    <label className="dsm-xdpool-gw-model" key={row.id}>
                      <input
                        type="checkbox"
                        checked={shared.has(row.id)}
                        disabled={busy}
                        onChange={() => { toggleShared(row.id) }}
                      />
                      {/* The display name first and the wire id second: the name
                          is how the user picks, and the id is what they then have
                          to type into the client. `qfmodel` alone would make this
                          list unreadable. */}
                      <span className="dsm-xdpool-gw-model-name">{row.name}</span>
                      {/*
                        The id is a BUTTON, not text.

                        Transcribing it by hand is how a client ends up asking for
                        `DeepSeek-V4.1-Flash` while the gateway only knows
                        `trae:deepseek-v4.1-flash` — the reported 403. The two are
                        the same model to a human and different strings to the relay,
                        and nothing on the card used to bridge that gap.

                        Only the id is copied (never the display name): the name is
                        for reading, and copying the wrong one would reproduce the
                        exact failure this fixes.
                      */}
                      <button
                        type="button"
                        className="dsm-xdpool-gw-model-id dsm-xdpool-gw-copyid"
                        data-on={copiedField === `id:${row.id}` ? 'true' : 'false'}
                        title={t?.('gw.copyModelIdHint') ?? '复制模型 id —— 客户端里要填的就是这个'}
                        onClick={(event) => {
                          // The row is a <label>: without this the click would also
                          // toggle the checkbox, unsharing the model the user just
                          // copied the id of.
                          event.preventDefault()
                          event.stopPropagation()
                          void copy(`id:${row.id}`, row.id)
                        }}
                      >
                        {copiedField === `id:${row.id}`
                          ? (t?.('gw.copied') ?? 'Copied')
                          : row.id}
                      </button>
                    </label>
                  ))}
                </div>
              ))}
            </>
          )}
      </div>
      <div className="dsm-xdpool-sec">
        <p className="dsm-xdpool-sectitle">{t?.('gw.usage') ?? 'Using it'}</p>
        <p className="dsm-xdpool-gw-note">{t?.('gw.usageHint') ?? ''}</p>
      </div>
    </div>
  )
}