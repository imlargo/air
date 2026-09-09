// Latency and throughput against a local HTTP server in its own process. One fresh client
// process per library, payload and round; random order every round.
//
// Throughput is swept across concurrency for the headline configuration, because one point
// cannot tell a fixed per-call cost from something that scales badly, and that is the only
// question a throughput number is asked.

import { clientNames, type Config } from './clients.ts'
import { cv, inChild, median, shuffled, spread, startServer, table } from './lib.ts'
import type { Payload } from './payloads.ts'

/** The concurrency reported in the per-payload tables, and swept around below. */
export const HEADLINE = 50
const SWEEP = [1, 10, HEADLINE, 200]

interface Run {
  p50: number
  p99: number
  rps: Record<number, number>
}
type Runs = Record<string, Run[]>

const rpsAt = (runs: readonly Run[], concurrency: number): number[] =>
  runs.map((run) => run.rps[concurrency] ?? 0)

export async function server({ rounds = 5, requests = 2_000 } = {}) {
  const { port, child } = await startServer('./server-process.ts')
  const origin = `http://127.0.0.1:${port}`
  const names = clientNames('server')
  const results: Record<string, Runs> = {}

  try {
    for (const config of ['defaults', 'matched'] as const satisfies readonly Config[]) {
      for (const payload of ['small', 'large'] as const satisfies readonly Payload[]) {
        // Swept for one configuration only: four points on every table would quadruple a run
        // that already takes an hour, and the answer does not change with the payload.
        const levels = config === 'defaults' && payload === 'small' ? SWEEP : [HEADLINE]
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
                `--concurrency=${levels.join(',')}`,
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
  const headline = results['defaults/small'] ?? {}
  const noise = cv(rpsAt(headline[baselineName] ?? [], HEADLINE))
  // A row is only called equal to fetch when it is inside twice the baseline's own variation
  // across rounds. Nothing else is rounded away: every other row shows its number.
  const threshold = 2 * noise

  const ms = (v: number) => `${v.toFixed(3)} ms`
  const k = (v: number) => Math.round(v).toLocaleString('en-US')
  const percent = (delta: number) => `${delta > 0 ? '+' : ''}${Math.round(delta * 100)} %`

  const sections: string[] = []
  for (const [key, runs] of Object.entries(results)) {
    const base = median(rpsAt(runs[baselineName] ?? [], HEADLINE))
    const rows = names.map((name) => {
      const own = runs[name] ?? []
      const rps = rpsAt(own, HEADLINE)
      const delta = base === 0 ? 0 : (median(rps) - base) / base
      return [
        `\`${name}\``,
        spread(
          own.map((run) => run.p50),
          ms,
        ),
        spread(
          own.map((run) => run.p99),
          ms,
        ),
        spread(rps, k),
        Math.abs(delta) <= threshold ? '≈ fetch' : percent(delta),
      ]
    })
    const [config, payload] = key.split('/')
    sections.push(
      `**${config === 'defaults' ? 'Library defaults' : 'Matched features'}, ${payload ?? ''} payload**\n\n` +
        table(
          [
            'Client',
            'p50: median (p25 – p75)',
            'p99: median (p25 – p75)',
            `req/s at ${HEADLINE} concurrent: median (p25 – p75)`,
            'Throughput vs fetch',
          ],
          rows,
        ),
    )
  }

  // The sweep, as percentages: whether the gap to fetch is a constant per call or grows.
  const sweep = table(
    ['Client', ...SWEEP.map((c) => `${c} concurrent`)],
    names.map((name) => [
      `\`${name}\``,
      ...SWEEP.map((concurrency) => {
        const base = median(rpsAt(headline[baselineName] ?? [], concurrency))
        const own = median(rpsAt(headline[name] ?? [], concurrency))
        const delta = base === 0 ? 0 : (own - base) / base
        return name === baselineName
          ? `${k(own)} req/s`
          : `${k(own)} (${Math.abs(delta) <= threshold ? '≈' : percent(delta)})`
      }),
    ]),
  )

  return {
    markdown: sections.join('\n\n'),
    sweep,
    noise,
    threshold,
    raw: results,
  }
}
