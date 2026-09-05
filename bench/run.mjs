// Runs every benchmark and prints one markdown report; also writes report.json with the raw
// samples. In CI the markdown becomes the run summary and both files are uploaded.
//
// Method, so the report can be read critically:
// - Every measured client runs in a fresh Node process, in a different random order each
//   round, so no client inherits another's JIT or heap state.
// - The HTTP server runs in its own process and never shares an event loop with a client.
// - Two configurations: library defaults (what a user gets) and matched features (ky's retry
//   and timeout off, ofetch's retry off), so the same work is compared.
// - Two payload sizes, since parsing dominates differently at 200 B and at 30 kB.
// - Medians with interquartile ranges, never a single iteration. The baseline's own variation
//   across rounds is measured and reported; anything within it is marked as noise.
//
// Run: pnpm bench   (BENCH_ROUNDS=3 for a quicker pass)

import { writeFileSync } from 'node:fs'
import { LIBS, versionOf } from './lib.mjs'
import { environment } from './env.mjs'
import { sizes } from './sizes.mjs'
import { cold } from './cold.mjs'
import { overhead } from './overhead.mjs'
import { server } from './server.mjs'
import { behavior } from './behavior.mjs'

const rounds = Number(process.env.BENCH_ROUNDS ?? 5)
const env = environment()
const versions = LIBS.map((name) => {
  const { version, dependencies } = versionOf(name)
  return `\`${name}@${version}\` (${dependencies} runtime ${dependencies === 1 ? 'dependency' : 'dependencies'})`
})

const started = performance.now()
const sizeReport = await sizes()
const coldReport = cold()
const overheadReport = await overhead({ rounds })
const serverReport = await server({ rounds })
const behaviorReport = await behavior()
const minutes = ((performance.now() - started) / 60_000).toFixed(1)

const noisePct = Math.round(serverReport.noise * 100)
const noisy = serverReport.noise > 0.15
const lines = [
  '# air benchmark',
  '',
  noisy
    ? `> **Noisy environment.** The baseline \`fetch\` throughput varied ${noisePct} % across rounds. Only differences well above that are meaningful; read the rest of this report as indicative.`
    : `> Baseline \`fetch\` throughput varied ${noisePct} % across rounds. Rows within twice that of the baseline are marked ≈ and should be read as equal.`,
  '',
  '## Environment',
  '',
  `- Versions: ${versions.join(', ')}. esbuild ${env.esbuild}.`,
  `- Runtime: ${env.runtime}, ${env.platform}.`,
  `- Machine: ${env.cpu}. Load average before the run: ${env.loadBefore}. ${env.ci}.`,
  `- ${env.date}. ${rounds} rounds per measurement, one fresh process per client and round, random order. Total ${minutes} min.`,
  '',
  '## Bundle size',
  '',
  sizeReport,
  '',
  '## Cold import',
  '',
  coldReport.markdown,
  '',
  '## Per-call overhead over a stubbed fetch',
  '',
  "No network. `matched` turns off ky's default retry and timeout and ofetch's default retry.",
  '',
  overheadReport.markdown,
  '',
  '## Local HTTP server, keep-alive',
  '',
  'Server in a separate process. Sequential requests for latency, then fixed concurrency for throughput.',
  '',
  serverReport.markdown,
  '',
  '## Behavior',
  '',
  'The same request through each library, recorded by a fetch stub. Deterministic.',
  '',
  behaviorReport,
  '',
  '## Method',
  '',
  'Bundles: esbuild `--bundle --minify --format=esm` from an entry that re-exports the whole package, then gzip level 9. Cold import: a fresh process per sample, libraries interleaved. Overhead: a stubbed `fetch` returning a fresh `Response` of the small payload; 2,000 warm-up calls, then 5 samples of 10,000 calls per process, forced GC between samples; pooled across rounds. Server: 300 warm-up requests, 2,000 sequential for p50 and p99, then 4,000 at 50 concurrent for throughput; per process. Every client and configuration is reported; nothing is dropped. What this does not measure: real network latency, HTTP/2, TLS, browsers.',
]
const markdown = lines.join('\n')
console.log(markdown)
writeFileSync(new URL('./report.md', import.meta.url), markdown + '\n')
writeFileSync(
  new URL('./report.json', import.meta.url),
  JSON.stringify(
    {
      environment: env,
      rounds,
      cold: coldReport.raw,
      overhead: overheadReport.raw,
      server: serverReport.raw,
      noise: serverReport.noise,
    },
    null,
    2,
  ),
)
