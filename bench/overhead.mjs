// Per-call overhead over a stubbed fetch, one fresh process per client and round, clients in
// a different random order every round.

import { CLIENT_NAMES } from './clients.mjs'
import { inChild, median, quantile, shuffled, table } from './lib.mjs'

export async function overhead({ rounds = 5 } = {}) {
  const names = CLIENT_NAMES('stub')
  const results = {}
  for (const config of ['defaults', 'matched']) {
    const pooled = Object.fromEntries(names.map((n) => [n, []]))
    for (let round = 0; round < rounds; round++) {
      for (const name of shuffled(names)) {
        const { samples } = await inChild('./overhead-child.mjs', [
          `--client=${name}`,
          `--config=${config}`,
        ])
        pooled[name].push(...samples)
      }
    }
    results[config] = pooled
  }

  const us = (v) => `${v.toFixed(2)} µs`
  const rows = names.map((name) => {
    const d = results.defaults[name]
    const m = results.matched[name]
    const base = median(results.defaults[names[0]])
    return [
      `\`${name}\``,
      `${us(median(d))} (${us(quantile(d, 0.25))} – ${us(quantile(d, 0.75))})`,
      `+${us(median(d) - base)}`,
      `${us(median(m))}`,
    ]
  })
  return {
    markdown: table(
      [
        'Client',
        'Defaults: median (p25 – p75)',
        'Over fetch',
        'Matched features: median',
      ],
      rows,
    ),
    raw: results,
  }
}
