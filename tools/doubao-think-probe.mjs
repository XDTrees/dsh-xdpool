import { readFileSync } from 'node:fs'

const raw = readFileSync(process.argv[2] ?? '_think-raw.txt', 'utf8')

// The thinking block is `block_type: 10040` with a `thinking_block` payload. Its text can
// arrive under several keys, so all of them are collected.
const keys = new Map()
for (const match of raw.matchAll(/"thinking_block":\{([^}]*)\}/g)) {
  const body = match[1]
  for (const pair of body.matchAll(/"([A-Za-z_]+)":"((?:[^"\\]|\\.)*)"/g)) {
    const [, key, value] = pair
    if (!keys.has(key)) keys.set(key, [])
    keys.get(key).push(value)
  }
}
console.log('thinking_block 出现的字段:')
for (const [key, values] of keys) {
  console.log(`  ${key}: ${String(values.length)} 次`)
  const longest = values.reduce((a, b) => (b.length > a.length ? b : a), '')
  if (longest.length > 4) console.log(`      最长: ${longest.slice(0, 300)}`)
}

// The other block type, for completeness: 10091 is the elapsed timer, 10000 the answer.
const types = new Map()
for (const match of raw.matchAll(/"block_type":(\d+)/g)) {
  types.set(match[1], (types.get(match[1]) ?? 0) + 1)
}
console.log('\nblock_type 统计:')
for (const [type, count] of [...types].sort()) console.log(`  ${type}: ${count}`)

// Whether the reasoning TEXT itself is present, or only a summary.
console.log('\n含 cot_ui_style:', (raw.match(/"cot_ui_style":"([^"]*)"/) ?? [])[1])
console.log('含 hide_skip_think:', (raw.match(/"hide_skip_think":"?(\d)"?/) ?? [])[0])
const thinkText = raw.match(/"(?:think_content|reasoning_content|think)":"((?:[^"\\]|\\.){40,})"/)
console.log('有思维链正文:', thinkText !== null)
if (thinkText !== null) console.log('  正文:', thinkText[1].slice(0, 300))
