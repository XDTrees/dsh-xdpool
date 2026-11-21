/**
 * The relay panel's contract with the user.
 *
 * The card is the only place a person reads this feature from, so most of what
 * follows is about what it is allowed to claim rather than about how it looks:
 * a key that survives a restart, an address that starts on loopback, and a
 * failed bind that is never reported as "off".
 *
 * The card cannot be rendered here — the client bundle is CommonJS and the host
 * dialog has no DOM in this suite — so the assertions are on the source, with
 * the numeric behaviour covered by `tests/relay.test.ts` against the real
 * listener. That split is deliberate: source assertions catch the shape of a
 * claim, listener tests catch whether the claim is true.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const read = (relative: string): string =>
  readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8').replaceAll(/\r\n/gu, '\n')
const card = read('src/client/GatewayPage.tsx')
const shell = read('src/client/shell.tsx')
const styles = read('src/client/styles.ts')
/** 设计稿的 CSS —— 网关页已按它重写，类名不再带 dsm-xdpool- 前缀。 */
const DESIGN_CSS = read('src/client/design-css.ts')
const server = read('src/relay.ts')
const index = read('src/index.ts')
const paths = read('src/status-paths.ts')
const locales = read('src/client/locales.ts')
const poolCard = read('src/client/PoolCard.tsx')
/** Strip comments so an assertion about forbidden code is not satisfied by prose. */
const readCode = (relative: string): string =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter(line => !line.trimStart().startsWith('//'))
    .join('\n')
const cardCode = readCode('src/client/GatewayPage.tsx')
describe('gateway panel', () => {
  it('is wired as a seventh shell tab and dispatched by the pool card', () => {
    expect(shell).toContain('PoolShell')
    expect(poolCard).toContain("import { GatewayPage } from './GatewayPage.tsx'")
    expect(poolCard).toContain("id: 'gateway'")
    expect(poolCard).toContain("page === 'gateway' ? <GatewayPage t={t} />")
  })
  it('reads and writes exactly one route, with GET for reading and POST for writing', () => {
    expect(card).toContain("import { POOL_RELAY_PATH, type PoolWebRelayStatus } from '../status-paths.ts'")
    expect(card).toContain(`from '../status-paths.ts'`)
    expect((card.match(/fetch\(POOL_RELAY_PATH/gu) ?? []).length).toBe(2)
    expect(cardCode).toContain("method: 'GET'")
    expect(cardCode).toContain("method: 'POST'")
    // Nothing else may mutate the relay from the client. A network-visible
    // switch that also answered PUT or DELETE would be a second door.
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect(cardCode).not.toContain(`method: '${method}'`)
    }
    expect(paths).toContain("POOL_RELAY_PATH = '/plugins/dsh-xdpool/relay'")
  })
  it('starts on loopback and offers exactly the addresses the listener accepts', () => {
    // The card and the listener keep separate copies of the address list. The
    // server module imports node:http, so the card cannot import it, which makes
    // this drift check the only thing standing between the two lists.
    const cardHosts = [...card.matchAll(/value: '([^']+)'/gu)].map(match => match[1])
    const serverHosts = [...server.matchAll(/RELAY_HOSTS:[^=]*=\s*\[([^\]]+)\]/gu)]
      .flatMap(match => [...match[1]!.matchAll(/'([^']+)'/gu)].map(entry => entry[1]))
    expect(cardHosts).toEqual(['127.0.0.1', '0.0.0.0'])
    expect(cardHosts).toEqual(serverHosts)
    // Loopback first, and the card's own initial state is loopback too: the
    // network-visible choice has to be the one the user makes, not the default.
    expect(card).toContain("useState<string>('127.0.0.1')")
    // A fresh install should show the port the listener will actually pick, not
    // a number that only exists in the card.
    const cardPort = card.match(/const \[port, setPort\] = useState<string>\('(\d+)'\)/u)?.[1]
    const serverPort = server.match(/RELAY_DEFAULT_PORT = (\d+)/u)?.[1]
    expect(cardPort).toBeDefined()
    expect(cardPort).toBe(serverPort)
  })
  it('never claims the key dies with the process, and never prints it unmasked', () => {
    // The whole point of minting our own relay key is that it outlives a
    // restart; copy that says otherwise would send people to reconfigure their
    // devices for no reason.
    expect(locales).toContain("'gw.keyHint': 'This key survives a DSH restart.")
    expect(locales).toContain('这把密钥在 DSH 重启后仍然有效')
    // And it must not be pre-rendered: the default render path is masked.
    expect(cardCode).toContain('revealed ? key : maskOf(key)')
    expect(cardCode).toContain('function maskOf')
    const mask = card.match(/function maskOf[\s\S]*?\n\}/u)?.[0] ?? ''
    // 先确认 key 是字符串（后端写成对象时 .slice 会抛错、整页白掉），再截取
    expect(mask).toContain("typeof key === 'string' ? key : ''")
    expect(mask).toContain('text.slice(0, 4)')
    expect(mask).toContain('text.slice(-4)')
  })
  it('keeps "on" and "listening" as two separate visible facts', () => {
    // Collapsing them would tell a user whose bind failed to switch on something
    // that is already on.
    expect(card).toContain("const enabled = status?.enabled === true")
    expect(card).toContain("const listening = status?.listening === true")
    expect(card).toContain("data-tone={listening ? 'ok' : enabled ? 'warn' : 'off'}")
    expect(card).toContain("t?.('gw.notListening')")
    expect(locales).toContain("'gw.notListening': '已开但没监听'")
  })
  it('adopts the server host and port only on the first read', () => {
    // A poll landing mid-edit must not replace a half-typed port with the
    // stored one — the user would be fighting the panel.
    expect(card).toContain('if (!seeded.current) {')
    expect(card).toContain('seeded.current = true')
    const loadBody = cardCode.slice(cardCode.indexOf('const load ='), cardCode.indexOf('const write ='))
    expect(loadBody).toContain('seeded.current')
    expect((loadBody.match(/setHost\(/gu) ?? []).length).toBe(1)
  })
  it('treats the write response as the state, not the local edit', () => {
    // A refused port, a minted key and a failed bind all come back from the
    // server; trusting the optimistic edit would show a relay that is not there.
    const writeBody = cardCode.slice(cardCode.indexOf('const write ='))
    expect(writeBody).toContain('const next = value as PoolWebRelayStatus')
    expect(writeBody).toContain('setStatus(next)')
    expect(writeBody).toContain('setRevealed(false)')
  })
  it('refuses an out-of-range port in the card instead of sending it', () => {
    expect(card).toContain('Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535')
    expect(card).toContain('disabled={busy || !portUsable}')
    expect(cardCode).toContain('void write({ host, port: parsedPort })')
  })
  it('mints a key by sending an empty string, not by omitting the field', () => {
    // The server reads an empty key as "rotate"; omitting it would leave the
    // current key in place, which is the opposite of what the button says.
    expect(cardCode).toContain("void write({ key: '' })")
    expect(index).toContain("patch.key === '' ? newRelayKey() : patch.key")
  })
  it('gives every class the page owns a rule, and borrows the rest from the shell', () => {
    /*
    这一页已按设计稿重写（.kv / .card / .sec / .btn），不再有 gw- 前缀的类名。
    改成抓所有 className 里的词。
  */
    const owned = [...card.matchAll(/className="([^"]+)"/gu)]
      .flatMap(match => (match[1] ?? '').split(/\s+/u))
      .filter(name => name !== '' && !name.includes('{'))
    expect(owned.length).toBeGreaterThan(0)
    /*
      每个类名都要有对应的样式规则。

      这一页现在用设计稿的类名（row / card / sec / field …），
      规则在 design-css.ts 里，不在 styles.ts 里 —— 所以查设计稿那份。
    */
    for (const name of new Set(owned)) {
      expect(DESIGN_CSS, `设计稿 CSS 里没有 .${name}`).toContain(`.${name}`)
    }
    expect(styles).toContain('export const GATEWAY_CARD_CSS')
  })
  it('ships every key it reads in both languages', () => {
    const used = [...new Set([...card.matchAll(/'(gw\.[a-zA-Z]+|shell\.tab[A-Za-z]+)'/gu)].map(match => match[1]!))]
    expect(used.length).toBeGreaterThan(20)
    for (const key of used) {
      // Twice: the English block and the Chinese block. The zh object is typed
      // against the en key set, so a missing key would fail the client
      // typecheck — but a key present only in en would still read as English to
      // a Chinese user, and that is what the count is for.
      expect((locales.match(new RegExp(`'${key.replace('.', '\\.')}':`, 'gu')) ?? []).length).toBe(2)
    }
  })
  it('never ships a relay that outlives the pool it forwards to', () => {
    // The relay must be torn down before the shim, or a device can hold a
    // socket to a listener that has already gone.
    expect(index).toContain('relay.close()')
    const cleanup = index.slice(index.indexOf('relay.close()'))
    expect(cleanup.indexOf('relay.close()')).toBeLessThan(cleanup.indexOf('shims.cn.close()'))
    expect(index).toContain('void relay.ready.catch(')
  })
})