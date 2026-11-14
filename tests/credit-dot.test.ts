/**
 * The composer dot is a single colour, so the two ways it can lie are the only things
 * worth testing:
 *
 *   - GREEN means "the channel serving this model can still pay". It must not be shown
 *     on missing data — a green dot over an unread pool tells the user to start a long
 *     task they cannot finish;
 *   - GREY means "out", which must trigger on a genuinely empty total.
 *
 * The channel split behind the panel comes from the credential ORIGIN, not from a label:
 * a real pool holds accounts on several origins at once, and folding them together hides
 * the split the panel exists to show.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const dot = readFileSync(new URL('../src/client/CreditDot.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8')

describe('the credit dot', () => {
  it('injects its OWN stylesheet, because the composer has no settings page CSS', () => {
    // Reported: the panel rendered as bare text with no dot and no card. The CSS had
    // been parked in `GATEWAY_CARD_CSS`, which is injected only inside the settings
    // shell — a page the composer never loads. The stylesheet must travel with the
    // component.
    expect(dot).toContain('<style>{CREDIT_DOT_CSS}</style>')
    expect(dot).toContain("from './styles.ts'")
    // And the constant must be its own export, not a member of a page block.
    expect(styles).toContain('export const CREDIT_DOT_CSS')
    const cssAt = styles.indexOf('export const CREDIT_DOT_CSS')
    const gatewayAt = styles.indexOf('export const GATEWAY_CARD_CSS')
    expect(cssAt).toBeGreaterThan(gatewayAt)
  })

  it('is the pool glyph, not a plain circle', () => {
    // A circle says "some status"; the plugin's own glyph says whose number it is.
    expect(dot).toContain('POOL_NAV_ICON_MASK_URL')
    expect(dot).toContain('dsm-xdpool-dot-glyph')
    // The colour comes from `currentColor` so one state attribute drives both the dot
    // and the icon, with no second asset.
    expect(styles).toContain('-webkit-mask-image')
    expect(styles).toContain('background-color:currentColor')
  })

  it('no longer reads the composer DOM to name a model', () => {
    // The panel used to carry a `Model` row, fed by scraping the composer's own caption
    // (`<model> · x<rate>`) — a MutationObserver on `document.body` existed only to keep
    // that row current. The row is gone, so the machinery went with it: polling the whole
    // document to label a line nobody asked for is the expensive version of nothing.
    expect(dot).not.toContain('readSelectedModel')
    expect(dot).not.toContain('data-composer-seat')
    expect(dot).not.toContain('MutationObserver')
    expect(dot).not.toContain('requestAnimationFrame')
    // And the trap the old reader existed to avoid is still not reintroduced: the ENABLED
    // list in picker order is not the current choice.
    expect(dot).not.toMatch(/selection\??\.\[?['"]?enabledModelIds/iu)
  })

  it('prices token samples itself, from the shared rate table', () => {
    // `credits.ts` is Node-free precisely so the browser can price tokens with the same
    // arithmetic the host uses — a second copy of the rate table is how the two halves
    // start disagreeing about the same money.
    expect(dot).toContain("from '../credits.ts'")
    expect(dot).toContain('creditsOf(')
    expect(dot).toContain('ratesFor(')
    expect(dot).not.toContain('RATE_TABLE')
  })

  it('shows only channels that actually served today', () => {
    // A row with a balance but no traffic is not "in use". Listing it beside the channel
    // being spent looked like the panel was reporting the wrong pool.
    expect(dot).toContain('usedChannels')
    expect(dot).toContain('activeChannels')
  })

  it('shows credits only, no request count', () => {
    // Requested: "don't show the call count, just today's credits." It stays in the
    // payload for the settings panel, but the popover shows the figure people act on.
    const start = dot.indexOf('dot.spentToday')
    const body = dot.slice(start, start + 400)
    expect(body).not.toContain('requestsToday')
  })

  it('draws a bar whose fill is the share LEFT, and captions both numbers', () => {
    // It used to fill with the share SPENT, computed as `spentToday / (total + spentToday)`
    // — and `spentToday` came from a ledger that on some packs is empty on every request,
    // so the numerator was always zero and the bar drew a bare track forever. The pack's
    // package list carries `size` and `remain`, which is a real measurement, so the bar now
    // reports headroom and shrinks as it is burned.
    expect(dot).toContain('dsm-xdpool-dotbar-fill')
    expect(dot).toContain('(1 - bar.share) * 100')
    expect(dot).not.toContain('baseline')
    // Both numbers under the bar: a length alone leaves the scale to be guessed.
    expect(dot).toContain('dsm-xdpool-dotbarwrap-cap')
    expect(dot).toContain('dot.barLeft')
    // Amber past 90% used: the point at which a long task becomes a gamble.
    expect(styles).toContain("[data-low='true']")
    expect(dot).toContain("data-low={bar.share >= 0.9")
  })

  it('is green only when the serving channel actually has credits', () => {
    // `total > 0` is the whole test: the pool's own gate already refuses an account at
    // its reserved floor, so a non-zero total is genuinely spendable.
    const start = dot.indexOf('const alive =')
    expect(start).toBeGreaterThan(-1)
    const body = dot.slice(start, start + 200)
    expect(body).toContain('total > 0')
    // Missing data is NOT alive.
    expect(body).toContain('snapshot.channel !== undefined')
  })

  it('renders a colour per state rather than a colour per label', () => {
    // Two states, two attributes — a styled span would leave the colour to the stylesheet
    // and the state to the text, which is how a grey dot ends up saying "available".
    expect(dot).toContain("data-state={alive ? 'alive' : 'empty'}")
  })

  it('opens the panel on click and closes on outside click or Escape', () => {
    // The same dismissal contract every popover on this host uses.
    expect(dot).toContain("event.key === 'Escape'")
    expect(dot).toContain('mousedown')
    expect(dot).toContain('panelRef.current?.contains(target)')
  })

  it('measures its position instead of assuming there is room below', () => {
    // The composer sits at the bottom of the viewport, so a panel opened downward would
    // be clipped; the height is consulted and it flips when there is no room above.
    expect(dot).toContain('getBoundingClientRect()')
    expect(dot).toContain('panelRef.current?.offsetHeight')
    expect(dot).toContain('above >= margin')
  })

  it('separates accounts by credential origin', () => {
    // Not by label, and not by a single hard-coded guess: `www.codebuddy.cn`,
    // `www.workbuddy.cn` and `www.workbuddy.ai` are three different pools.
    expect(dot).toContain('workbuddy.ai')
    expect(dot).toContain('workbuddy.cn')
    expect(dot).toContain('codebuddy.cn')
  })

  it('never counts an unread account as a zero balance', () => {
    // Folding it in as 0 understates the one figure the panel conveys.
    const start = dot.indexOf('function channelsOf')
    const body = dot.slice(start, start + 900)
    expect(body).toContain('!Number.isFinite(total)')
    expect(body).toContain('continue')
  })

  it('groups by REGION, so one pool card is one number', () => {
    // Reported: the dot said 13,990 while the card said 14,089. The dot was keyed off the
    // credential DOMAIN, splitting one lane into `www.codebuddy.cn` (13,990) and
    // `www.workbuddy.cn` (99). The card is right: a pool is a set of accounts serving the
    // same lane, and signing in through CodeBuddy's endpoint only changes which origin
    // issued the credential, not which pool the account belongs to.
    expect(dot).toContain('regionOfDomain')
    expect(dot).toContain("includes('workbuddy.ai') ? 'global' : 'cn'")
    // The domain string must not be used as the grouping key any more.
    expect(dot).not.toContain('__unknown')
    expect(dot).not.toContain("nameOfOrigin")
  })

  it('shows the TOTAL across channels, so it cannot disagree with the pool card', () => {
    // Reported: the composer dot said 13,990 while the account-pool card said 14,089 —
    // a difference of the 99 sitting on a second credential origin. The dot was naming
    // the LARGEST channel, not the sum. Two screens in one plugin disagreeing about the
    // same quantity is a bug the reader cannot resolve.
    const start = dot.indexOf('dsm-xdpool-dotpanel-head')
    const body = dot.slice(start, start + 800)
    expect(body).toContain('snapshot.all.reduce')
    // And the per-channel split is shown so the total is reconcilable.
    expect(dot).toContain('snapshot.all.map')
  })

  it('names the channel in the header, not a status word', () => {
    // "还有积分" was a chip restating what the green dot already says, and it pushed the
    // one fact worth reading — which pool, how much — onto a separate row. The header
    // now carries it, so the rows below are only today's spend and the model.
    expect(dot).toContain('dsm-xdpool-dotpanel-channel')
    expect(dot).toContain('dot.channelUnknown')
    // The restated chip is gone...
    expect(dot).not.toContain('dsm-xdpool-dotpanel-chip')
    // ...and the channel row with it, since the header holds the same value.
    expect(dot).not.toContain("'dot.channel'")
  })

  it('never presents an estimate as a measurement', () => {
    // Two sources answer "what did today cost" and they are not interchangeable: cost-meter
    // OBSERVES the balances fall, while pricing this process's own token samples only knows
    // what it saw since it started. The measured figure is a plain number; the estimate is
    // prefixed `≈` and explained in a tooltip. Drawing them the same way is how a restart
    // gets read as a day with no spending.
    expect(dot).toContain("'dot.spentToday'")
    expect(dot).toContain('dot.estimatedHint')
    expect(dot).toContain('dot.measuredHint')
    expect(dot).toContain("`≈ ${creditCount(snapshot.spentToday)}`")
    // And it says so, rather than showing a zero, when nothing recorded the day.
    expect(dot).toContain('dot.noSpend')
  })

  it('measures from the recorded day before it prices anything', () => {
    // Order matters: the measured total must win, and the estimate may only run when the
    // measured route answered `available: false`.
    const measuredAt = dot.indexOf('POOL_CREDITS_TODAY_PATH')
    const estimatedAt = dot.indexOf('creditsToday(usageEntries)')
    expect(measuredAt).toBeGreaterThan(-1)
    expect(estimatedAt).toBeGreaterThan(measuredAt)
    expect(dot).toContain('spentMeasured = true')
    expect(dot).toContain('spentEstimated = true')
  })
})
