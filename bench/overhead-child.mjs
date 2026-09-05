// One client, one process: per-call cost over a stubbed fetch. Prints JSON.

import { arg } from './lib.mjs'
import { clients } from './clients.mjs'
import { PAYLOADS } from './payloads.mjs'

const name = arg('client')
const config = arg('config', 'defaults')
const iterations = Number(arg('iterations', 10_000))
const samples = Number(arg('samples', 5))

const body = PAYLOADS.small
globalThis.fetch = async () =>
  new Response(body, { headers: { 'content-type': 'application/json' } })

const fn = clients({
  origin: 'https://bench.test',
  path: '/users/1',
  config,
  transport: 'stub',
})[name]

for (let i = 0; i < 2_000; i++) await fn()
const results = []
for (let s = 0; s < samples; s++) {
  globalThis.gc?.()
  const start = performance.now()
  for (let i = 0; i < iterations; i++) await fn()
  results.push(((performance.now() - start) * 1000) / iterations)
}
console.log(JSON.stringify({ samples: results }))
