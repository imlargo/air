// One client, one process, against the server process. Prints JSON.

import { arg, requireArg } from './lib.ts'
import { clients, type Config } from './clients.ts'
import { PATHS, type Payload } from './payloads.ts'

const name = requireArg('client')
const config = arg('config', 'defaults') as Config
const origin = requireArg('origin')
const size = arg('payload', 'small') as Payload
const requests = Number(arg('requests', '2000'))
const levels = arg('concurrency', '50').split(',').map(Number)

const fn = clients({ origin, path: PATHS[size], config, transport: 'server' })[name]
if (!fn) throw new Error(`unknown client ${name}`)

for (let i = 0; i < 300; i++) await fn()

// Sequential: the latency distribution, and the throughput of one request at a time.
const latencies: number[] = []
const sequentialStart = performance.now()
for (let i = 0; i < requests; i++) {
  const start = performance.now()
  await fn()
  latencies.push(performance.now() - start)
}
const sequential = performance.now() - sequentialStart
latencies.sort((a, b) => a - b)

const rps: Record<number, number> = {}
for (const concurrency of levels) {
  if (concurrency === 1) {
    rps[1] = requests / (sequential / 1000)
    continue
  }
  globalThis.gc?.()
  // Scaled with the level, so the widest one is still a steady state rather than a ramp-up.
  const total = Math.max(requests * 2, concurrency * 40)
  let started = 0
  const start = performance.now()
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (started < total) {
        started++
        await fn()
      }
    }),
  )
  rps[concurrency] = total / ((performance.now() - start) / 1000)
}

console.log(
  JSON.stringify({
    p50: latencies[Math.floor(requests * 0.5)],
    p99: latencies[Math.floor(requests * 0.99)],
    rps,
  }),
)
