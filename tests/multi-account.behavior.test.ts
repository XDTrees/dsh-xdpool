import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 添加账号不能挤掉已有的 —— 行为测试。
 *
 * 这一组不读源码，直接把存储模块指向临时目录，存两个账号再读回来数。
 * 上一版测试是 grep 源码，改回旧实现它照样通过（`accessToken` 在文件别处也出现），
 * 等于白写。真正的判据只能是「存两个，读出来还是两个」。
 *
 * 隔离方式：存储都走 `pluginDataDir()` → `dshHome(env)`，而 `dshHome` 每次调用
 * 都重新读 `process.env`，所以在临时目录里改环境变量是有效的。
 */
const homes: string[] = []

function useTempHome(tag: string): string {
  const home = mkdtempSync(join(tmpdir(), `xdpool-${tag}-`))
  homes.push(home)
  process.env['DSH_HOME'] = home
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  delete process.env['DSH_HOME']
})

describe('同区域/同站点可以存多个账号', () => {
  it('accio：同区两个账号都留得住', async () => {
    useTempHome('accio')
    const store = await import('../src/accio-store.ts')
    const a = { region: 'global' as const, accessToken: 'token-A' }
    const b = { region: 'global' as const, accessToken: 'token-B' }
    await store.saveAccioCredential(a)
    await store.saveAccioCredential(b)
    const all = await store.readAccioCredentials()
    const tokens = all.map(entry => entry.accessToken)
    expect(tokens, `读到 ${String(all.length)} 条：${tokens.join(',')}`).toContain('token-A')
    expect(tokens, `读到 ${String(all.length)} 条：${tokens.join(',')}`).toContain('token-B')
  })

  it('accio：同一个 token 再存一次只留一条（刷新而不是新增）', async () => {
    useTempHome('accio2')
    const store = await import('../src/accio-store.ts')
    await store.saveAccioCredential({ region: 'global', accessToken: 'same', refreshToken: 'r1' })
    await store.saveAccioCredential({ region: 'global', accessToken: 'same', refreshToken: 'r2' })
    const all = await store.readAccioCredentials()
    const mine = all.filter(entry => entry.accessToken === 'same')
    expect(mine.length, '同一个 token 不该出现两条').toBe(1)
    expect(mine[0]?.refreshToken, '应当是后写的那条').toBe('r2')
  })

  it('autoclaw：同站两个账号都留得住', async () => {
    useTempHome('autoclaw')
    const store = await import('../src/autoclaw-store.ts')
    await store.saveAutoclawCredential({ site: 'autoclaw', accessToken: 'token-A' })
    await store.saveAutoclawCredential({ site: 'autoclaw', accessToken: 'token-B' })
    const all = await store.readAutoclawCredentials()
    const tokens = all.map(entry => entry.accessToken)
    expect(tokens).toContain('token-A')
    expect(tokens).toContain('token-B')
  })
})
