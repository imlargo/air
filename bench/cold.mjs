// Time to import each library in a fresh process, libraries interleaved on every run.

import { spawnSync } from 'node:child_process'
import { LIBS, median, shuffled, table } from './lib.mjs'

function importTime(name) {
  const script = `const t = performance.now(); await import('${name}'); console.log(performance.now() - t)`
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    cwd: new URL('.', import.meta.url).pathname,
  })
  return Number(out.stdout.trim())
}

export function cold({ runs = 11 } = {}) {
  const samples = Object.fromEntries(LIBS.map((n) => [n, []]))
  for (let run = 0; run < runs; run++) {
    for (const name of shuffled(LIBS)) samples[name].push(importTime(name))
  }
  const ms = (v) => `${v.toFixed(1)} ms`
  const rows = LIBS.map((name) => [
    `\`${name}\``,
    `${ms(median(samples[name]))} (${ms(Math.min(...samples[name]))} – ${ms(Math.max(...samples[name]))})`,
  ])
  return {
    markdown: table(['Library', `Cold import: median (min – max) of ${runs}`], rows),
    raw: samples,
  }
}
