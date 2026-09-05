// Time to import each library in a fresh process. Matters for serverless and edge cold starts.

import { spawnSync } from 'node:child_process'
import { LIBS, median, table } from './lib.mjs'

function importTime(name) {
  const script = `const t = performance.now(); await import('${name}'); console.log(performance.now() - t)`
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    cwd: new URL('.', import.meta.url).pathname,
  })
  return Number(out.stdout.trim())
}

export function cold(runs = 7) {
  const rows = LIBS.map((name) => {
    const samples = Array.from({ length: runs }, () => importTime(name))
    return [`\`${name}\``, `${median(samples).toFixed(1)} ms`]
  })
  return table(['Library', `Cold import, median of ${runs}`], rows)
}
