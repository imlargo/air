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
// - Throughput is swept across concurrency, so a fixed per-call cost can be told apart from
//   something that scales badly.
// - Medians with quartiles, never a single iteration. The baseline's own variation across
//   rounds is measured, reported, and is the only thing allowed to round a row to "equal".
// - Behaviour first: microseconds rarely decide anything, a 204 that throws does.
//
// Run: pnpm bench   (BENCH_ROUNDS=3 for a quicker pass)

import { writeFileSync } from 'node:fs'
import { LIBS, versionOf } from './lib.ts'
import { environment } from './env.ts'
import { sizes } from './sizes.ts'
import { cold } from './cold.ts'
import { overhead } from './overhead.ts'
import { server, HEADLINE } from './server.ts'
import { behavior } from './behavior.ts'

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

// Three ways a run can be untrustworthy, each stated at the top rather than left for the
// reader to notice: too few rounds to estimate noise, a machine that was already busy, and a
// baseline that would not hold still.
const pct = (fraction: number) => `${(fraction * 100).toFixed(1)} %`
const warnings: string[] = []
if (rounds < 3) {
  warnings.push(
    `**${rounds} round${rounds === 1 ? '' : 's'} only.** Noise cannot be estimated from fewer than 3 rounds; the percentages below are single measurements, not results. Use this run to check that the benchmark works, not to quote from.`,
  )
}
if (env.loadBefore > env.threads) {
  warnings.push(
    `**Busy machine.** Load average was ${env.loadBefore} on ${env.threads} threads before the run started. Something else was competing for the CPU; the figures below are not comparable to a quiet run.`,
  )
}
if (rounds >= 3 && serverReport.noise > 0.15) {
  warnings.push(
    `**Noisy environment.** The baseline \`fetch\` throughput varied ${pct(serverReport.noise)} across rounds. Only differences well above that are meaningful.`,
  )
}

const lines = [
  '# air benchmark',
  '',
  'A request to a real server costs tens of milliseconds. What follows is what each library adds on top of that, and what each one does when a response is unusual. The second part is what changes the code you have to write; read the microseconds as a CPU budget under load, not as latency anyone would notice.',
  '',
  ...(warnings.length
    ? warnings.map((w) => `> ${w}`)
    : [
        `> Baseline \`fetch\` throughput varied ${pct(serverReport.noise)} across rounds, measured on library defaults and the small payload. A row is marked ≈ only when it is within ${pct(serverReport.threshold)} of \`fetch\`, twice that variation, and the same threshold is used in every table. Every other row shows its number, however small.`,
      ]),
  '',
  '## Environment',
  '',
  `- Versions: ${versions.join(', ')}. esbuild ${env.esbuild}.`,
  `- Runtime: ${env.runtime}, ${env.platform}.`,
  `- Machine: ${env.cpu}. Load average before the run: ${env.loadBefore}. ${env.ci}.`,
  `- ${env.date}. ${rounds} round${rounds === 1 ? '' : 's'} per measurement, one fresh process per client and round, random order. Total ${minutes} min.`,
  '',
  '## Behavior',
  '',
  'The same request through each library, recorded by a `fetch` stub. Deterministic, and every row links to the code that produced it.',
  '',
  behaviorReport,
  '',
  '## Bundle size',
  '',
  "air's root entry is the client alone: retry, refresh, progress, form and query are separate entry points a bundler only includes when they are imported. `ky` ships retry, timeouts and hooks from its root, so the first row is not the same product; the two rows under it are the comparable ones.",
  '',
  sizeReport,
  '',
  '## Cold import',
  '',
  'Time to `import` the library in a fresh process, and the number of modules the ESM loader had to resolve to get there. What is being timed is resolving, reading and compiling that graph — its file count and its total source, not the minified size in the table above. A bundler collapses the graph, so this is what an unbundled import costs: a serverless cold start, a CLI, a test run.',
  '',
  coldReport.markdown,
  '',
  '## Per-call overhead over a stubbed fetch',
  '',
  "No network. `matched` turns off ky's default retry and timeout and ofetch's default retry. The stub ignores the `init` it is handed, so this measures what a client costs before `fetch`, not what it costs `fetch`; the server tables below include both.",
  '',
  overheadReport.markdown,
  '',
  '## Local HTTP server, keep-alive',
  '',
  'Server in a separate process. Sequential requests for latency, then fixed concurrency for throughput.',
  '',
  'Every client here runs on undici except the last, and their p50s land within a few percent of each other: that column is dominated by the turns of the event loop `fetch` takes per request, not by the library. `axios (http adapter)` is the one client on `node:http`, which is why it has by far the lowest sequential latency and, once concurrency rises, less throughput than undici — that row compares transports, not libraries.',
  '',
  serverReport.markdown,
  '',
  `**Throughput across concurrency** (library defaults, small payload). A gap that stays flat across the row is a fixed cost per call; one that widens is a client that scales worse than \`fetch\`. Percentages are against \`fetch\` at the same concurrency.`,
  '',
  serverReport.sweep,
  '',
  '## Method',
  '',
  `Bundles: esbuild \`--bundle --minify --format=esm\` from an entry that re-exports every listed specifier, then gzip level 9. Cold import: a fresh process per sample, libraries interleaved; the module count is measured in its own process, since the loader hook that counts would otherwise be inside the timing. Overhead: a stubbed \`fetch\` returning a fresh \`Response\` of the small payload; 2,000 warm-up calls, then 5 samples of 10,000 calls per process, forced GC between samples; pooled across rounds. Server: 300 warm-up requests, then 2,000 sequential ones for p50, p99 and the 1-concurrent rate, then a closed loop at each further concurrency with at least 4,000 requests; per process. Statistics: every figure is a median with its p25–p75 across ${rounds} round${rounds === 1 ? '' : 's'}, and \`report.json\` carries the raw samples. Every client and configuration is reported; nothing is dropped. What this does not measure: real network latency, HTTP/2, TLS, browsers.`,
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
      concurrency: HEADLINE,
      cold: coldReport.raw,
      overhead: overheadReport.raw,
      server: serverReport.raw,
      noise: serverReport.noise,
      threshold: serverReport.threshold,
    },
    null,
    2,
  ),
)
