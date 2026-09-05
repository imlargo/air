// Latency and throughput against a local HTTP server in its own process. One fresh client
// process per library, payload and round; random order every round.

import { clientNames, type Config } from './clients.ts'
import { cv, inChild, median, shuffled, startServer, table } from './lib.ts'
import type { Payload } from './payloads.ts'

interface Run {
  p50: number
  p99: number
  rps: number
}
type Runs = Record<string, Run[]>

export async function server({ rounds = 5, requests = 2_000, concurrency = 50 } = {}) {
  const { port, child } = await startServer('./server-process.ts')
  const origin = `http://127.0.0.1:${port}`
  const names = clientNames('server')
  const results: Record<string, Runs> = {}

  try {
    for (const config of ['defaults', 'matched'] as const satisfies readonly Config[]) {
      for (const payload of ['small', 'large'] as const satisfies readonly Payload[]) {
        const runs: Runs = Object.fromEntries(names.map((n) => [n, []]))
        for (let round = 0; round < rounds; round++) {
          for (const name of shuffled(names)) {
            runs[name]?.push(
              await inChild<Run>('./server-child.ts', [
                `--client=${name}`,
                `--config=${config}`,
                `--origin=${origin}`,
                `--payload=${payload}`,
                `--requests=${requests}`,
                `--concurrency=${concurrency}`,
              ]),
            )
          }
        }
        results[`${config}/${payload}`] = runs
      }
    }
  } finally {
    child.kill('SIGTERM')
  }

  const baselineName = names[0] ?? ''
  const baselineRps = (results['defaults/small']?.[baselineName] ?? []).map((r) => r.rps)
  const noise = cv(baselineRps)

  const ms = (v: number) => `${v.toFixed(3)} ms`
  const k = (v: number) => Math.round(v).toLocaleString('en-US')
  const sections: string[] = []
  for (const [key, runs] of Object.entries(results)) {
    const base = median((runs[baselineName] ?? []).map((r) => r.rps))
    const rows = names.map((name) => {
      const own = runs[name] ?? []
      const rps = own.map((r) => r.rps)
      const med = median(rps)
      const delta = base === 0 ? 0 : (med - base) / base
      const withinNoise = Math.abs(delta) <= Math.max(0.1, 2 * noise)
      return [
        `\`${name}\``,
        ms(median(own.map((r) => r.p50))),
        ms(median(own.map((r) => r.p99))),
        `${k(med)} (${k(Math.min(...rps))} – ${k(Math.max(...rps))})`,
        withinNoise ? '≈ fetch' : `${delta > 0 ? '+' : ''}${Math.round(delta * 100)} %`,
      ]
    })
    const [config, payload] = key.split('/')
    sections.push(
      `**${config === 'defaults' ? 'Library defaults' : 'Matched features'}, ${payload ?? ''} payload**\n\n` +
        table(
          [
            'Client',
            'p50',
            'p99',
            `req/s at ${concurrency} concurrent: median (min – max)`,
            'vs fetch',
          ],
          rows,
        ),
    )
  }
  return { markdown: sections.join('\n\n'), noise, raw: results }
}
