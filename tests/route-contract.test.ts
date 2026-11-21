import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * The client reads fields the server actually sends.
 *
 * A field name that drifts between a route and its reader fails silently: the card shows
 * nothing, nothing errors, and the channel looks broken for no visible reason. These cases
 * compare the two SOURCES, which is the only way to catch it without a live host.
 */
const section = readFileSync(new URL('../src/client/ChannelPoolSection.tsx', import.meta.url), 'utf8')
const channelsPage = readFileSync(new URL('../src/client/ChannelsPage.tsx', import.meta.url), 'utf8')

/** The routes each card component calls, and the fields it reads from the answer. */
const contracts: readonly {
  channel: string
  sessionRoute: string
  walletRoute?: string
  /** Fields the reader destructures or reads off the parsed body. */
  sessionFields: readonly string[]
  walletFields?: readonly string[]
}[] = [
  {
    channel: 'astudio',
    sessionRoute: 'POOL_ASTUDIO_SESSION_PATH',
    walletRoute: 'POOL_ASTUDIO_WALLET_PATH',
    sessionFields: ['signedIn', 'accounts'],
    walletFields: ['signedIn', 'total'],
  },


  {
    channel: 'accio',
    sessionRoute: 'POOL_ACCIO_SESSION_PATH',
    walletRoute: 'POOL_ACCIO_QUOTA_PATH',
    sessionFields: ['signedIn', 'accounts'],
    walletFields: ['signedIn', 'buckets'],
  },
  {
    channel: 'monkeycode',
    sessionRoute: 'POOL_MONKEYCODE_CN_SESSION_PATH',
    walletRoute: 'POOL_MONKEYCODE_CN_WALLET_PATH',
    sessionFields: ['signedIn', 'accounts'],
    walletFields: ['signedIn', 'credits'],
  },
  {
    channel: 'baizhi',
    sessionRoute: 'POOL_BAIZHI_SESSION_PATH',
    walletRoute: 'POOL_BAIZHI_WALLET_PATH',
    sessionFields: ['signedIn', 'accounts'],
    walletFields: ['signedIn', 'balance', 'dailyClaimed'],
  },
  {
    channel: 'autoclaw',
    sessionRoute: 'POOL_AUTOCLAW_INTL_SESSION_PATH',
    walletRoute: 'POOL_AUTOCLAW_INTL_WALLET_PATH',
    sessionFields: ['signedIn', 'accounts'],
    walletFields: ['signedIn', 'buckets'],
  },
]

describe('the card calls the routes that exist', () => {
  for (const contract of contracts) {
    it(`${contract.channel} names its session route`, () => {
      expect(section, contract.sessionRoute).toContain(contract.sessionRoute)
    })

    if (contract.walletRoute !== undefined) {
      it(`${contract.channel} names its wallet route`, () => {
        expect(section, contract.walletRoute).toContain(contract.walletRoute)
      })
    }
  }
})

describe('the reader reads the fields the route sends', () => {
  for (const contract of contracts) {
    it(`${contract.channel} reads every session field`, () => {
      /**
       * The reader declares the answer's shape inline (`{ signedIn?: boolean; … }`). A field
       * it does not name is a field it cannot use, and the card silently shows nothing.
       */
      for (const field of contract.sessionFields) {
        expect(section, `${contract.channel} must read ${field}`).toContain(field)
      }
    })

    if (contract.walletFields !== undefined) {
      it(`${contract.channel} reads every wallet field`, () => {
        for (const field of contract.walletFields ?? []) {
          expect(section, `${contract.channel} must read ${field}`).toContain(field)
        }
      })
    }
  }
})

describe('the login page posts to every channel it offers', () => {
  const loginRoutes: readonly { channel: string; route: string }[] = [
    { channel: 'astudio', route: 'POOL_ASTUDIO_LOGIN_PATH' },
    { channel: 'accio', route: 'POOL_ACCIO_SESSION_PATH' },
    { channel: 'monkeycode', route: 'POOL_MONKEYCODE_CN_SESSION_PATH' },
    { channel: 'monkeycode-intl', route: 'POOL_MONKEYCODE_INTL_SESSION_PATH' },
    { channel: 'baizhi', route: 'POOL_BAIZHI_SESSION_PATH' },
    { channel: 'autoclaw', route: 'POOL_AUTOCLAW_INTL_SESSION_PATH' },
    { channel: 'autoclaw-cn', route: 'POOL_AUTOCLAW_CN_SESSION_PATH' },
  ]

  for (const entry of loginRoutes) {
    it(`${entry.channel} has a sign-in route`, () => {
      // Every paste channel must name its own route, or it posts one vendor's token to another.
      expect(channelsPage, entry.channel).toContain(entry.route)
    })
  }
})
