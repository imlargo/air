// Per-call overhead over a stubbed fetch, one fresh process per client and round, clients in
// a different random order every round.

import { clientNames, type Config } from './clients.ts'
import { inChild, median, quantile, shuffled, table } from './lib.ts'

type Pooled = Record<string, number[]>

export async function overhead({ rounds = 5 } = {}) {
  const names = clientNames('stub')
  const results = {} as Record<Config, Pooled>
  for (const config of ['defaults', 'matched'] as const) {
    const pooled: Pooled = Object.fromEntries(names.map((n) => [n, []]))
    for (let round = 0; round < rounds; round++) {
      for (const name of shuffled(names)) {
        const { samples } = await inChild<{ samples: number[] }>('./overhead-child.ts', [
          `--client=${name}`,
          `--config=${config}`,
        ])
        pooled[name]?.push(...samples)
      }
    }
    results[config] = pooled
  }

  const us = (v: number) => `${v.toFixed(2)} µs`
  const baseline = median(results.defaults[names[0] ?? ''] ?? [0])
  const rows = names.map((name) => {
    const d = results.defaults[name] ?? []
    const m = results.matched[name] ?? []
    return [
      `\`${name}\``,
      `${us(median(d))} (${us(quantile(d, 0.25))} – ${us(quantile(d, 0.75))})`,
      `+${us(median(d) - baseline)}`,
      us(median(m)),
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
