// Time to import each library in a fresh process, libraries interleaved on every run, next to
// the module graph the loader had to walk to get there. The second column is there because the
// first one is mostly resolving, reading and compiling that graph rather than work the library
// does, and a reader deserves to see the shape of it. A bundler collapses the graph, so these
// figures describe an unbundled import — a serverless cold start, a CLI, a test run.

import { spawnSync } from 'node:child_process'
import { LIBS, shuffled, spread, table, type Lib } from './lib.ts'

const HERE = new URL('.', import.meta.url).pathname

function node(script: string): string {
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    cwd: HERE,
  })
  if (out.status !== 0) throw new Error(`node -e failed: ${out.stderr}`)
  return out.stdout.trim()
}

const importTime = (name: string): number =>
  Number(
    node(
      `const t = performance.now(); await import('${name}'); console.log(performance.now() - t)`,
    ),
  )

// Counted in its own process: the hook itself costs time, so it must not be in the timed one.
const moduleCount = (name: string): number =>
  Number(
    node(`import { registerHooks } from 'node:module'
let modules = 0
registerHooks({
  load(url, context, next) {
    if (!url.startsWith('node:')) modules++
    return next(url, context)
  },
})
await import('${name}')
console.log(modules)`),
  )

export function cold({ runs = 11 } = {}) {
  const samples = Object.fromEntries(LIBS.map((n) => [n, [] as number[]])) as Record<
    Lib,
    number[]
  >
  for (let i = 0; i < runs; i++) {
    for (const name of shuffled(LIBS)) samples[name].push(importTime(name))
  }
  const modules = Object.fromEntries(LIBS.map((n) => [n, moduleCount(n)])) as Record<
    Lib,
    number
  >

  // Two decimals: at these times one is coarse enough to print a real spread as a single value.
  const ms = (v: number) => `${v.toFixed(2)} ms`
  const rows = LIBS.map((name) => [
    `\`${name}\``,
    spread(samples[name], ms),
    String(modules[name]),
  ])
  return {
    markdown: table(
      ['Library', `Cold import: median (p25 – p75) of ${runs}`, 'Modules loaded'],
      rows,
    ),
    raw: { samples, modules },
  }
}
