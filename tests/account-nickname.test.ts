import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 账号昵称整条链路。
 *
 * 卡片上每个账号显示的是昵称，不是 id —— 一排 `astudio`、`baizhi` 分不出谁是谁。
 * 昵称要在**登录时**写进账号记录，之后才有得显示；只声明字段不写入，卡片就只能退回 id。
 *
 * 为什么用「源码里有没有这句」而不是跑一遍登录：登录要真人扫码，测试里做不到；
 * 而这一环最容易漏 —— 类型有字段、存储能读、路由能转，唯独登录时没人赋值，
 * 静态检查一个都不会报。所以钉住那个赋值就好。
 */
const WRITERS = {
  astudio: 'src/astudio-routes.ts',
  baizhi: 'src/baizhi-routes.ts',
  monkeycode: 'src/monkeycode-routes.ts',
  autoclaw: 'src/autoclaw-routes.ts',
} as const

describe('账号昵称：登录时写入', () => {
  for (const [channel, path] of Object.entries(WRITERS)) {
    it(`${channel} 构造凭据时带上 nickname`, () => {
      const source = readFileSync(path, 'utf8')
      /*
        写法是条件展开：读得到才写，读不到就不写。

        钉这一句而不是「文件里出现过 nickname」：`strip()` 也会提它，那是读给前端，
        不是写进记录，两者混起来会让这条测试永远通过。
      */
      /*
        必须是从**登录结果**里取的那个写法：`result.nickname`、`parsed.nickname` 之类。

        不能只匹配「nickname === undefined ? {} : ...」：`strip()` 里也有一模一样的一句，
        但那是从已存的账号里读出来给前端，删掉登录时的赋值它照样让测试通过 ——
        这条测试就白写了。所以要求来源是登录才有的变量。
      */
      expect(source, `${channel} 登录时没有写 nickname`).toMatch(
        /\.\.\.\s*\(?\s*(?:result|parsed|exchanged|probe|credential)\.nickname\s*===\s*undefined\s*\?\s*\{\}\s*:\s*\{\s*nickname/u,
      )
    })
  }

  it('marvis 的昵称由 exchangeCode 带进账号', () => {
    // 这一家的昵称在会话交换里就赋好了，路由只是把整个 account 存下去。
    const session = readFileSync('src/marvis-session.ts', 'utf8')
    expect(session).toMatch(/nickname/u)
    const routes = readFileSync('src/marvis-routes.ts', 'utf8')
    expect(routes).toMatch(/await\s+exchangeCode\(/u)
    expect(routes).toMatch(/saveMarvisAccount\(\s*account\s*\)/u)
  })
})

describe('账号昵称：拿不到时不编', () => {
  /**
   * 「读不到昵称」是正常结果，不是错误。
   *
   * 编一个「XX 账号」当昵称会让列表里出现好几个一模一样的名字 —— 比显示 id 更难分辨。
   * 所以赋值必须是「有才写」，而不是给默认值。
   */
  for (const [channel, path] of Object.entries(WRITERS)) {
    it(`${channel} 不给昵称编默认值`, () => {
      const source = readFileSync(path, 'utf8')
      expect(source, `${channel} 给昵称编了默认名`).not.toMatch(
        /nickname\s*:\s*[`'"][^`'"]*账号[`'"]/u,
      )
    })
  }
})
