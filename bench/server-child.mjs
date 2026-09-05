// One client, one process, against the server process. Prints JSON.

import { arg } from './lib.mjs'
import { clients } from './clients.mjs'
import { PATHS } from './payloads.mjs'

const name = arg('client')
const config = arg('config', 'defaults')
const origin = arg('origin')
const size = arg('payload', 'small')
const requests = Number(arg('requests', 2_000))
const concurrency = Number(arg('concurrency', 50))

const fn = clients({ origin, path: PATHS[size], config, transport: 'server' })[name]

for (let i = 0; i < 300; i++) await fn()

const latencies = []
for (let i = 0; i < requests; i++) {
  const start = performance.now()
  await fn()
  latencies.push(performance.now() - start)
}
latencies.sort((a, b) => a - b)

globalThis.gc?.()
let started = 0
const total = requests * 2
const start = performance.now()
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (started < total) {
      started++
      await fn()
    }
  }),
)
const rps = total / ((performance.now() - start) / 1000)

console.log(
  JSON.stringify({
    p50: latencies[Math.floor(requests * 0.5)],
    p99: latencies[Math.floor(requests * 0.99)],
    rps,
  }),
)
