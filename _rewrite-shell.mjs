/**
 * 把 PoolShell 的 return 整段换成设计稿的结构。
 *
 * 设计稿（xdpool-design/lib.mjs 的 page 函数）里 .app 的直接子元素正好三个：
 *   nav.rail  /  aside.list  /  main.main
 *
 * 多一层包装，三列 grid 就只看到一个孩子，整页塌成一块 ——
 * 这是前面十几次失败的统一原因。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const path = 'D:/dsh-home/_xdpool-src/src/client/shell.tsx'
let src = readFileSync(path, 'utf8')

const divAt = src.indexOf('<div className="app dsm-xdpool-frame">')
if (divAt < 0) {
  console.log('未找到 .app 那个 div')
  process.exit(1)
}
const retAt = src.lastIndexOf('return (', divAt)
if (retAt < 0) {
  console.log('未找到 return')
  process.exit(1)
}
// PoolShell 的收尾：文件里最后一个 "\n}" 之前
const endAt = src.lastIndexOf('\n}')
if (endAt < 0) {
  console.log('未找到结尾')
  process.exit(1)
}

const head = src.slice(0, retAt)
const tail = src.slice(endAt)

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

      {/*
        条目栏与详情。调用方传进来的 children 里就是 .list 和 .main ——
        直接挂在 .app 下，中间不许再包任何东西。
      */}
      {hero === undefined ? null : hero}
      {children}
      {footer}
    </div>
  )`

writeFileSync(path, head + body + tail, 'utf8')
console.log('PoolShell 已按设计稿重写')
