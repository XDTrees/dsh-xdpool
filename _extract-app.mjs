/**
 * 从构建产物中提取 PoolShell 的渲染部分，还原成源码。
 *
 * 产物是 tsdown 编译后的 JSX 调用（jsx/jsxs），结构完整、类名完整。
 * 直接照着它写回源码，比凭记忆重写可靠 —— 上一轮就是凭记忆重写才出的错。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const BUNDLE = 'D:/dsh-home/profiles/desktop/node_modules/dsh-xdpool/lib/client.js'
const SRC = 'D:/dsh-home/_xdpool-src/src/client/shell.tsx'

const bundle = readFileSync(BUNDLE, 'utf8')
const src = readFileSync(SRC, 'utf8')

/** 抓出 `return jsxs("div", { className: "app", ... })` 那一段，数到配对的括号。 */
function extractApp() {
  const at = bundle.indexOf('className: "app"')
  if (at < 0) throw new Error('产物里没有 .app')
  // 往前找到 return 那个 jsxs(
  const start = bundle.lastIndexOf('return /* @__PURE__ */', at)
  if (start < 0) throw new Error('没有 return')
  // jsxs("div", {...}) 的 '(' 在 jsxs 之后
  let i = bundle.indexOf('jsxs(', start) + 4
  let depth = 0
  for (; i < bundle.length; i++) {
    const c = bundle[i]
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) break
    }
  }
  return bundle.slice(start, i + 1)
}

const app = extractApp()
console.log('提取到', app.length, '字符')

/**
 * 把 jsxs/jsx 调用转成可读的信息：每一层的标签与 className。
 * 这一步只用来核对结构，不直接生成源码（转换容易出语法错误）。
 */
const layers = []
for (const m of app.matchAll(/jsxs?\)?\("([a-z]+)",\s*\{[^}]*?className:\s*"([^"]*)"/g)) {
  layers.push(`${m[1]}.${m[2].split(' ')[0]}`)
}
console.log('结构层级:', layers.join(' > ').slice(0, 200))

/** 列出这段里出现的全部类名，作为重写的清单。 */
const classes = new Set()
for (const m of app.matchAll(/className:\s*"([^"]+)"/g)) classes.add(m[1])
console.log('类名清单:', [...classes].join(' | '))

writeFileSync('D:/dsh-home/_app-fragment.txt', app, 'utf8')
console.log('\n片段已存到 D:/dsh-home/_app-fragment.txt')
