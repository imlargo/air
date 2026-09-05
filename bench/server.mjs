// Latency and throughput against a local HTTP server in its own process. One fresh client
// process per library, payload and round; random order every round.

import { CLIENT_NAMES } from './clients.mjs'
import { cv, inChild, median, shuffled, table } from './lib.mjs'

export async function server({ rounds = 5, requests = 2_000, concurrency = 50 } = {}) {
  const { port, child } = await inChild('./server-process.mjs', [], { keepAlive: true })
  const origin = `http://127.0.0.1:${port}`
  const names = CLIENT_NAMES('server')
  const results = {}

  try {
    for (const config of ['defaults', 'matched']) {
      for (const payload of ['small', 'large']) {
        const runs = Object.fromEntries(names.map((n) => [n, []]))
        for (let round = 0; round < rounds; round++) {
          for (const name of shuffled(names)) {
            runs[name].push(
              await inChild('./server-child.mjs', [
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

  const baselineRps = results['defaults/small'][names[0]].map((r) => r.rps)
  const noise = cv(baselineRps)

  const ms = (v) => `${v.toFixed(3)} ms`
  const k = (v) => `${Math.round(v).toLocaleString('en-US')}`
  const sections = []
  for (const [key, runs] of Object.entries(results)) {
    const base = median(runs[names[0]].map((r) => r.rps))
    const rows = names.map((name) => {
      const rps = runs[name].map((r) => r.rps)
      const med = median(rps)
      const delta = (med - base) / base
      const withinNoise = Math.abs(delta) <= Math.max(0.1, 2 * noise)
      return [
        `\`${name}\``,
        ms(median(runs[name].map((r) => r.p50))),
        ms(median(runs[name].map((r) => r.p99))),
        `${k(med)} (${k(Math.min(...rps))} – ${k(Math.max(...rps))})`,
        withinNoise ? '≈ fetch' : `${delta > 0 ? '+' : ''}${Math.round(delta * 100)} %`,
      ]
    })
    const [config, payload] = key.split('/')
    sections.push(
      `**${config === 'defaults' ? 'Library defaults' : 'Matched features'}, ${payload} payload**\n\n` +
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
