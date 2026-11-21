/**
 * 把 PoolShell 的 return 换成设计稿结构（重做版）。
 *
 * .app 的直接子元素必须正好是 rail / (body>contents>list+main)，
 * 多一层包装三列 grid 就只看到一个孩子，整页塌成一块。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const path = 'D:/dsh-home/_xdpool-src/src/client/shell.tsx'
let src = readFileSync(path, 'utf8')

const divAt = src.indexOf('<div className="dsm-xdpool-frame">')
if (divAt < 0) { console.log('未找到 .frame'); process.exit(1) }
const retAt = src.lastIndexOf('return (', divAt)
const endAt = src.lastIndexOf('\n}')
if (retAt < 0 || endAt < 0) { console.log('定位失败'); process.exit(1) }

const body = `return (
    <div className="app">
      {/*
        功能页，结构照设计稿的 nav.rail：
          div.rail-brand > span.rail-logo + span > div.rail-name + button.rail-ver
          button.rail-item × N
          div.rail-foot > a.rail-item / button.rail-item
      */}
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
          <a
            className="rail-item"
            href="https://github.com/XDTrees/dsh-xdpool"
            target="_blank"
            rel="noreferrer"
            title={t?.('shell.starHint') ?? 'Open this plugin on GitHub'}
          >
            <RailIcon name="star" />
            <span>{t?.('shell.star') ?? '点 Star'}</span>
          </a>
          <button
            type="button"
            className="rail-item"
            title={t?.('shell.groupHint') ?? '扫码加入 XD 交流群'}
            onClick={() => { setGroupOpen(true) }}
          >
            <RailIcon name="group" />
            <span>{t?.('shell.group') ?? '交流群'}</span>
          </button>
          {links}
        </div>

        {updateOpen ? (
          <div className="pop" role="dialog" aria-label={t?.('update.title') ?? '检查更新'}>
            <div className="pop-head">
              <span className="pop-name">{t?.('update.title') ?? '检查更新'}</span>
              <button type="button" className="pop-close" aria-label={t?.('common.close') ?? '关闭'}
                onClick={() => { setUpdateOpen(false) }}>×</button>
            </div>
            <UpdatePanel t={t} />
          </div>
        ) : null}
      </nav>

      {/* 交流群浮层：就地打开，二维码要留在屏幕上才能扫。 */}
      {!groupOpen ? null : (
        <div className="pop" role="dialog" aria-modal="false" aria-label={t?.('shell.groupTitle') ?? 'XD 交流群'}>
          <div className="pop-head">
            <span className="pop-name">{t?.('shell.groupTitle') ?? 'XD 交流群'}</span>
            <button type="button" className="pop-close" aria-label={t?.('shell.groupClose') ?? '关闭'}
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
            {t?.('shell.groupNote')
              ?? '两个群都在；哪个方便用哪个。二维码失效了在 GitHub 提 issue 说一声，会更新。'}
          </p>
        </div>
      )}

      {/*
        条目栏与详情。调用方传进来的 children 里就是 .list 和 .main ——
        直接挂在 .app 下，中间不许再包任何东西。

        dsm-xdpool-body 这个类名是几处兼容测试的锚点（它们用它确认整页渲染出来了、
        且没有页面级的折叠控件），display:contents 让它不参与布局。
      */}
      {hero === undefined ? null : hero}
      <div className="dsm-xdpool-body" style={{ display: 'contents' }}>{children}</div>
      {footer}
    </div>
  )`

// brand 也换成设计稿结构
const brandStart = src.indexOf('  const brand = (')
const brandEnd = src.indexOf('  )\n', src.indexOf('const brand = ('))
if (brandStart > 0 && brandEnd > brandStart) {
  const newBrand = `  /** 品牌区，结构照设计稿的 .rail-brand。 */
  const brand = (
    <div className="rail-brand">
      <span className="rail-logo" style={avatar === undefined ? undefined : { backgroundImage: \`url(\${avatar})\` }} />
      <span>
        <div className="rail-name">{t?.('shell.brand') ?? 'XD Pool'}</div>
        {version === undefined || version === '' ? null : (
          <button
            type="button"
            className="rail-ver"
            title={t?.('shell.updateHint') ?? '检查更新'}
            onClick={() => { setUpdateOpen(true) }}
          >
            v{version}
          </button>
        )}
      </span>
    </div>
  )
`
  src = src.slice(0, brandStart) + newBrand + src.slice(brandEnd + 4)
}

// 加上 RailIcon 组件与 import
if (!src.includes('function RailIcon')) {
  const iconComp = `/**
 * 功能页图标。
 *
 * 设计稿的 rail-item 每行前面是一个描边 SVG。插件原来的汉字（池 / 登 / 聚…）
 * 是占位 —— 一屏七个汉字看着像标签，不像导航。
 */
function RailIcon({ name }: { name: RailIconName }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: RAIL_ICONS[name] }}
    />
  )
}

`
  const heroAt = src.indexOf('export function PageHero(')
  src = src.slice(0, heroAt) + iconComp + src.slice(heroAt)
}
if (!src.includes("from './rail-icons.ts'")) {
  const firstImport = src.search(/^import /m)
  src = src.slice(0, firstImport) + "import { RAIL_ICONS, type RailIconName } from './rail-icons.ts'\n" + src.slice(firstImport)
}

const head = src.slice(0, retAt)
const tail = src.slice(endAt)
writeFileSync(path, head + body + tail, 'utf8')
console.log('shell.tsx 已重做')
