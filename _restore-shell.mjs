/**
 * 从 ui30 产物还原 shell.tsx 的渲染部分。
 *
 * 依据是产物里的 jsxs 调用 —— 它保留完整结构、类名、属性名。
 * 上一轮凭记忆重写导致整页崩，这次照产物写。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const FRAG = 'D:/dsh-home/_app-fragment.txt'
const SRC = 'D:/dsh-home/_xdpool-src/src/client/shell.tsx'

const frag = readFileSync(FRAG, 'utf8')
let src = readFileSync(SRC, 'utf8')

/**
 * 产物片段是 `jsxs("nav", {...})` 这种形式。这里手写成等价的 JSX，
 * 依据是同一份片段里的 tag / className / 属性名顺序。
 */
const body = `return (
    <div className="app">
      <nav className="rail" aria-label={t?.('shell.tabs') ?? 'Pages'} ref={railRef} onKeyDown={onKeyDown}>
        {brand}
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active}
            className="rail-item"
            onClick={() => { onSelect(tab.id) }}
          >
            {RAIL_ICONS[tab.id as RailIconName] === undefined ? null : (
              <RailIcon name={tab.id as RailIconName} />
            )}
            <span>{tab.label}</span>
          </button>
        ))}
        <div className="rail-foot">
          <a className="rail-item" href="https://github.com/XDTrees/dsh-xdpool" target="_blank" rel="noreferrer"
            title={t?.('shell.starHint') ?? 'Open this plugin on GitHub'}>
            <RailIcon name="star" />
            <span>{t?.('shell.star') ?? '点 Star'}</span>
          </a>
          <button type="button" className="rail-item"
            title={t?.('shell.groupHint') ?? '扫码加入 XD 交流群'}
            onClick={() => { setGroupOpen(true) }}>
            <RailIcon name="group" />
            <span>{t?.('shell.group') ?? '交流群'}</span>
          </button>
          {links}
        </div>
        {updateOpen ? (
          <div className="pop" role="dialog" aria-label={t?.('update.title') ?? '检查更新'}>
            <div className="pop-head">
              <span className="pop-name">{t?.('update.title') ?? '检查更新'}</span>
              <button type="button" className="pop-close"
                aria-label={t?.('common.close') ?? '关闭'}
                onClick={() => { setUpdateOpen(false) }}>×</button>
            </div>
            <UpdatePanel t={t} />
          </div>
        ) : null}
      </nav>

      {!groupOpen ? null : (
        <div className="pop" role="dialog" aria-modal="false"
          aria-label={t?.('shell.groupTitle') ?? 'XD 交流群'}>
          <div className="pop-head">
            <span className="pop-name">{t?.('shell.groupTitle') ?? 'XD 交流群'}</span>
            <button type="button" className="pop-close"
              aria-label={t?.('shell.groupClose') ?? '关闭'}
              onClick={() => { setGroupOpen(false) }}>×</button>
          </div>
          <div className="qr-grid">
            <div className="qr-item">
              <div className="qr" />
              <span className="qr-label">{t?.('shell.groupWx') ?? '微信群'}</span>
              <span className="qr-step">{t?.('shell.groupWxStep') ?? '扫码添加机器人后发送「XD」拉你进群'}</span>
            </div>
            <div className="qr-item">
              <div className="qr" />
              <span className="qr-label">{t?.('shell.groupQq') ?? 'QQ 群'}</span>
              <span className="qr-step">{t?.('shell.groupQqStep') ?? '直接扫码即可加入'}</span>
            </div>
          </div>
          <p className="note">
            {t?.('shell.groupNote') ?? '两个群都在；哪个方便用哪个。'}
          </p>
        </div>
      )}

      {/*
        .app 的直接子元素必须正好是 rail / list / main。这一层 display:contents
        不参与布局，只承载 dsm-xdpool-body 这个测试锚点。
      */}
      {hero === undefined ? null : hero}
      <div className="dsm-xdpool-body" style={{ display: 'contents' }}>{children}</div>
      {footer}
    </div>
  )`

const fnAt = src.indexOf('export function PoolShell')
if (fnAt < 0) { console.log('没找到 PoolShell'); process.exit(1) }
const retAt = src.indexOf('  return (', fnAt)
const endAt = src.lastIndexOf('\n}')
if (retAt < 0 || endAt < 0) { console.log('定位失败'); process.exit(1) }

console.log('retAt=', retAt, 'endAt=', endAt)
console.log('尾部预览:', JSON.stringify(src.slice(endAt, endAt + 80)))
writeFileSync(SRC, src.slice(0, retAt) + body + src.slice(endAt), 'utf8')
console.log('shell.tsx 渲染部分已按产物还原')
