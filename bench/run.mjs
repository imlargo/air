// Runs every benchmark and prints one markdown report. In CI the report becomes the run summary.
//
// Numbers are only comparable within one run: the machine, the runtime and the moment differ
// between runs, and shared CI runners are noisy. Read differences smaller than ~20 % as noise.
//
// Run: pnpm bench

import { LIBS, versionOf } from './lib.mjs'
import { sizes } from './sizes.mjs'
import { cold } from './cold.mjs'
import { overhead } from './overhead.mjs'
import { server } from './server.mjs'
import { behavior } from './behavior.mjs'

const runtime = globalThis.navigator?.userAgent ?? `Node.js ${process.version}`
const versions = LIBS.map((name) => {
  const { version, dependencies } = versionOf(name)
  return `\`${name}@${version}\` (${dependencies} runtime ${dependencies === 1 ? 'dependency' : 'dependencies'})`
})

const sections = [
  [
    'Versions',
    `${versions.join(', ')}. Runtime: ${runtime}, ${process.platform} ${process.arch}, ${new Date().toISOString().slice(0, 10)}.`,
  ],
  ['Bundle size', await sizes()],
  ['Cold import', cold()],
  ['Per-call overhead, stubbed fetch', await overhead()],
  ['Local HTTP server, keep-alive', await server()],
  ['Behavior', await behavior()],
]

console.log('# air benchmark\n')
for (const [title, body] of sections) console.log(`## ${title}\n\n${body}\n`)
console.log(
  'Method: bundles with esbuild (bundle, minify, ESM) and gzip level 9. Overhead against a stubbed `fetch` that returns a fresh `Response`, median of 5 samples. Server figures against a local Node HTTP server with keep-alive, p50 and p99 over sequential requests, throughput as the median of 3 rounds at fixed concurrency. Behavior recorded by a `fetch` stub that captures the exact request each library sends. Differences under roughly 20 % are noise.',
)
