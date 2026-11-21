/**
 * 把 ChannelDetailPage 的渲染外壳换成设计稿的结构。
 *
 * 设计稿（xdpool-design/pool.html 的 main 区）：
 *   <main class="main">
 *     <header class="mhead">
 *       <div class="mhead-title"><span class="mhead-name">…</span><span class="mhead-org">…</span><span class="pill">…</span></div>
 *       <div class="mhead-actions">…</div>
 *     </header>
 *     <div class="mbody">
 *       <p class="note">…</p>
 *       <div class="kpis">…</div>
 *       <div class="policies">…</div>
 *       <section class="sec">…</section>
 *     </div>
 *   </main>
 *
 * 一次性把外壳与类名换掉，内部的 Stats / AccountCard / model 行在后续步骤逐个替换。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const path = 'D:/dsh-home/_xdpool-src/src/client/ChannelDetailPage.tsx'
let src = readFileSync(path, 'utf8')

// —— 1. 外壳：div.page → main.main，pagehead → mhead ——
src = src.replace(
`    <div className="dsm-xdpool-page">
      <header className="dsm-xdpool-pagehead">
        <div className="dsm-xdpool-pagetitles">
          <h2 className="dsm-xdpool-pagename">{name}</h2>
          <span className="dsm-xdpool-pageorg">{org}</span>
          <span className="dsm-xdpool-pagestate" data-state={state}>{stateLabel}</span>
        </div>
        {actions === undefined ? null : <div className="dsm-xdpool-pageactions">{actions}</div>}
      </header>
      {note === undefined ? null : <p className="dsm-xdpool-pagenote">{note}</p>}
      {notice === undefined ? null : notice}

      <Stats stats={stats} t={t} />`,
`    <main className="main">
      <header className="mhead">
        <div className="mhead-title">
          <span className="mhead-name">{name}</span>
          <span className="mhead-org">{org}</span>
          <span className="pill" data-tone={state === 'ok' ? 'ok' : 'off'}>{stateLabel}</span>
        </div>
        {actions === undefined ? null : <div className="mhead-actions">{actions}</div>}
      </header>

      <div className="mbody">
      {note === undefined ? null : <p className="note">{note}</p>}
      {notice === undefined ? null : notice}

      <Stats stats={stats} t={t} />`)

// —— 2. 策略区 → .policies / .policy / .policy-k ——
src = src.replace(
`        <div className="dsm-xdpool-policies">
          {usage === undefined ? null : (
            <div className="dsm-xdpool-policy">
              <span className="dsm-xdpool-policytitle">
                {t?.('channelpool.usageTitle') ?? '账号使用方式'}
              </span>
              {usage}
            </div>
          )}
          {automation === undefined ? null : (
            <div className="dsm-xdpool-policy">
              <span className="dsm-xdpool-policytitle">
                {t?.('channelpool.autoTitle') ?? '积分自动化'}
              </span>
              {automation}
            </div>
          )}
        </div>`,
`        <div className="policies">
          {usage === undefined ? null : (
            <div className="policy">
              <span className="policy-k">
                {t?.('channelpool.usageTitle') ?? '账号使用方式'}
              </span>
              {usage}
            </div>
          )}
          {automation === undefined ? null : (
            <div className="policy">
              <span className="policy-k">
                {t?.('channelpool.autoTitle') ?? '积分自动化'}
              </span>
              {automation}
            </div>
          )}
        </div>`)

// —— 3. 账号卡网格 → .accts ——
src = src.replace('<div className="dsm-xdpool-acctcards">', '<div className="accts">')

// —— 4. 收尾：补 .mbody 的闭合 ——
// 原来的 </div> 是 page 的收尾；现在是 main，且多了一层 mbody。
const tailAnchor = `    </div>
  )
}`
const lastTail = src.lastIndexOf(tailAnchor)
if (lastTail > 0) {
  src = src.slice(0, lastTail) + `      </div>
    </main>
  )
}` + src.slice(lastTail + tailAnchor.length)
}

writeFileSync(path, src, 'utf8')
console.log('ChannelDetailPage 外壳已换')
