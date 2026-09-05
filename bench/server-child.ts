// One client, one process, against the server process. Prints JSON.

import { arg, requireArg } from './lib.ts'
import { clients, type Config } from './clients.ts'
import { PATHS, type Payload } from './payloads.ts'

const name = requireArg('client')
const config = arg('config', 'defaults') as Config
const origin = requireArg('origin')
const size = arg('payload', 'small') as Payload
const requests = Number(arg('requests', '2000'))
const concurrency = Number(arg('concurrency', '50'))

const fn = clients({ origin, path: PATHS[size], config, transport: 'server' })[name]
if (!fn) throw new Error(`unknown client ${name}`)

for (let i = 0; i < 300; i++) await fn()

const latencies: number[] = []
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
