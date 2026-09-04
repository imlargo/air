// Runs every example in its own process against the built `dist/`. Skips `_*.mjs` (shared
// helpers) and `demo.mjs` (third-party network).
//
// Run: pnpm examples

import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = fileURLToPath(new URL('../examples/', import.meta.url))

const files = readdirSync(dir)
  .filter((name) => name.endsWith('.mjs'))
  .filter((name) => !name.startsWith('_') && name !== 'demo.mjs')
  .sort()

if (files.length === 0) {
  console.error('examples: found none. Did the directory move?')
  process.exit(1)
}

let failed = 0
for (const file of files) {
  const { status } = spawnSync(process.execPath, [path.join(dir, file)], {
    stdio: 'inherit',
  })
  if (status !== 0) {
    console.error(`examples: ${file} exited with ${status}`)
    failed++
  }
}

if (failed > 0) {
  console.error(`\nexamples: ${failed} of ${files.length} failed`)
  process.exit(1)
}

console.log(`\nexamples: ${files.length} passed on Node ${process.version}`)
