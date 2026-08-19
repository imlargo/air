// Runs every example against the BUILT dist/, in its own process.
//
// This is the integration lane. `test/air.test.ts` mocks `fetch`, and a mock agrees with
// whatever the person who wrote it assumed — every bug this library has shipped got through
// exactly that gap. The examples talk to a real socket, so they disagree when it matters.
//
// Each file is standalone (`node examples/retry.mjs` works on its own) and self-verifying:
// it asserts, prints one line, and exits non-zero if anything is off. A separate process per
// file so one leaked server or unhandled rejection cannot mask the next.
//
// `_server.mjs` is the shared harness, not an example. `demo.mjs` is excluded deliberately:
// it makes real network requests to third parties, so it cannot gate a build.
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
  console.error('examples: found none — did the directory move?')
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
