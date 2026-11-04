#!/usr/bin/env node
/**
 * Fails the build if anything that looks like a real API key ended up in the published site.
 * The app never ships a key: every visitor enters their own, in their own browser.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const DIR = process.argv[2] ?? 'dist'
const PATTERNS = [
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['Hugging Face token', /\bhf_[A-Za-z0-9]{30,}\b/],
]
const TEXT = /\.(html|js|mjs|css|json|map|txt|svg)$/i

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (TEXT.test(e.name)) yield p
  }
}

let found = 0
for await (const file of walk(DIR)) {
  const text = await readFile(file, 'utf8')
  for (const [label, re] of PATTERNS) {
    const m = text.match(re)
    if (m) {
      found++
      console.error(`✗ ${label} in ${file}: ${m[0].slice(0, 12)}…`)
    }
  }
}
if (found) {
  console.error(`\n${found} secret(s) found in ${DIR}. Remove them before publishing.`)
  process.exit(1)
}
console.log(`✓ No API keys in ${DIR}`)
