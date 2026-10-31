/**
 * Render `PoolShell` and prove the group button opens the code.
 *
 * Why this exists at all: every other client test in this repo asserts on source
 * TEXT, which cannot tell "the button is wired" from "the button renders a
 * handler that does nothing". A prop typo, a hook after an early return, or a
 * component that throws on first render all pass a textual check and fail in the
 * browser — and this button's whole job is to be clicked.
 *
 * No react-dom and no DOM: neither is a dependency here (the host supplies the
 * renderer), and none is needed. `PoolShell` uses exactly four hooks, so this
 * file implements those four against React's own `createElement` output, runs
 * the component, walks the element tree, clicks the group button, and renders
 * again — which is the same sequence React performs on a click.
 *
 * Run: node tools/probe-card-render.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const ROOT = join(import.meta.dirname, '..')
const require_ = createRequire(join(ROOT, 'package.json'))
const TMP = join(ROOT, '.probe-shell')

// The component is TypeScript. Compile it with the repo's own tsc into a temp
// directory instead of re-implementing a transpiler: a probe that fakes the
// compiler can drift from what ships.
rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })
const built = spawnSync(process.execPath, [
  join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
  join(ROOT, 'src', 'client', 'shell.tsx'),
  '--ignoreConfig',
  '--outDir', TMP,
  '--module', 'es2022',
  '--target', 'es2022',
  '--moduleResolution', 'bundler',
  '--jsx', 'react-jsx',
  '--allowImportingTsExtensions',
  '--rewriteRelativeImportExtensions',
  '--skipLibCheck',
], { encoding: 'utf8' })
if (built.status !== 0) {
  console.error(built.stdout)
  console.error(built.stderr)
  throw new Error('tsc could not compile shell.tsx')
}
// tsc emits with `.js` extensions relative to the source tree; rewrite them so
// the temp module graph resolves.
const emitted = readFileSync(join(TMP, 'shell.js'), 'utf8')
writeFileSync(join(TMP, 'shell.js'), emitted)

const { PoolShell } = await import(`file://${join(TMP, 'shell.js').replaceAll('\\', '/')}`)
const { createElement: h } = require_('react')

/**
 * A hook harness good enough for `PoolShell`.
 *
 * State lives in a plain slot array keyed by call order, which is exactly React's
 * contract for a component that never branches around a hook. `setState` marks
 * the tree dirty and schedules ONE re-render, the way React batches.
 */
function createHarness() {
  const slots = []
  let index = 0
  let dirty = false
  const harness = {
    reset() { index = 0 },
    take(init) {
      const at = index++
      if (at >= slots.length) slots[at] = init()
      return [slots[at], next => { slots[at] = typeof next === 'function' ? next(slots[at]) : next; dirty = true }]
    },
    useState(init) { return harness.take(() => (typeof init === 'function' ? init() : init)) },
    useRef(init) { return harness.take(() => ({ current: init })) },
    useCallback(fn) { return harness.take(() => fn)[0] },
    useMemo(fn) { return harness.take(fn)[0] },
    useLayoutEffect() { index += 1 },
    useEffect() { index += 1 },
    useId() { return harness.take(() => `probe-${String(index + 1)}`)[0] },
    get dirty() { return dirty },
    clear() { dirty = false },
  }
  return harness
}

const harness = createHarness()
// Point React's internal dispatcher at the harness. `react` exports
// `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED` for exactly this kind of
// host integration, and it is the documented hook into the hook dispatcher.
const internals = require_('react').__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
const dispatcher = internals.ReactCurrentDispatcher
if (dispatcher === undefined) throw new Error('React has no current dispatcher; cannot drive hooks')

const base = {
  tabs: [{ id: 'pool', label: 'Account pool' }, { id: 'channels', label: 'Login channels' }],
  active: 'pool',
  avatar: 'data:image/png;base64,iVBORw0KGgo=',
  version: '9.9.9',
  children: h('div', null, 'body'),
}

function render() {
  harness.reset()
  const previous = dispatcher.current
  dispatcher.current = {
    useState: harness.useState,
    useRef: harness.useRef,
    useCallback: harness.useCallback,
    useMemo: harness.useMemo,
    useLayoutEffect: harness.useLayoutEffect,
    useEffect: harness.useEffect,
    useId: harness.useId,
    useContext: () => undefined,
    useDebugValue: () => undefined,
  }
  try {
    return PoolShell(base)
  } finally {
    dispatcher.current = previous
  }
}

/** Every element in a rendered tree. */
function walk(node, out = []) {
  if (Array.isArray(node)) { for (const child of node) walk(child, out); return out }
  if (node === null || typeof node !== 'object') return out
  if (node.props !== undefined) out.push(node)
  const props = node.props ?? {}
  for (const value of Object.values(props)) {
    if (Array.isArray(value)) walk(value, out)
    else if (typeof value === 'object' && value !== null && value.props !== undefined) walk(value, out)
  }
  return out
}

const classOf = element => String(element.props?.className ?? '')

let tree = render()
let all = walk(tree)

const group = all.find(el => classOf(el).includes('dsm-xdpool-group'))
if (group === undefined) throw new Error('the group button is not in the rendered tree')
if (group.type !== 'button') throw new Error(`the group control is a <${String(group.type)}>, expected <button>`)
if (typeof group.props.onClick !== 'function') throw new Error('the group button has no click handler')
const star = all.find(el => el.type === 'a' && classOf(el).includes('dsm-xdpool-star'))
if (star === undefined) throw new Error('the star button disappeared')
if (all.some(el => classOf(el).includes('dsm-xdpool-groupmask'))) {
  throw new Error('the dialog rendered before it was opened')
}
console.log('closed: group button + star present, dialog absent')

// Click it, exactly as React would: invoke the handler, then re-render.
group.props.onClick()
if (!harness.dirty) throw new Error('clicking the group button scheduled no re-render')
harness.clear()
tree = render()
all = walk(tree)

const mask = all.find(el => classOf(el).includes('dsm-xdpool-groupmask'))
if (mask === undefined) throw new Error('clicking the group button did not open the dialog')
if (mask.props.role !== 'dialog') throw new Error('the dialog does not declare role="dialog"')
if (mask.props['aria-modal'] !== 'true') throw new Error('the dialog is not marked modal')

const image = all.find(el => classOf(el).includes('dsm-xdpool-groupqr'))
if (image === undefined) throw new Error('the dialog contains no QR image')
const src = String(image.props.src ?? '')
if (!src.startsWith('data:image/png;base64,')) throw new Error('the QR image is not an inline data URI')
if (src.length < 2000) throw new Error('the QR data URI is suspiciously short')
if (image.props.width !== 260 || image.props.height !== 260) throw new Error('the QR image is not square at 260px')
if (String(image.props.alt ?? '').trim() === '') throw new Error('the QR image has no alt text')

const closers = all.filter(el => typeof el.props?.onClick === 'function'
  && (classOf(el).includes('dsm-xdpool-groupclose') || classOf(el).includes('dsm-xdpool-groupmask')))
if (closers.length < 2) throw new Error('the dialog has no close control besides Escape')
console.log(`open: dialog rendered, QR ${String(src.length)} chars, ${String(closers.length)} closers`)

// Close from the backdrop and confirm it goes away.
mask.props.onClick({ stopPropagation() {} })
harness.clear()
all = walk(render())
if (all.some(el => classOf(el).includes('dsm-xdpool-groupmask'))) {
  throw new Error('the dialog did not close')
}
console.log('closed again from the backdrop')

rmSync(TMP, { recursive: true, force: true })
console.log('OK')
