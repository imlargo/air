// One client, one process: per-call cost over a stubbed fetch. Prints JSON.

import { arg, requireArg } from './lib.ts'
import { clients, type Config } from './clients.ts'
import { PAYLOADS } from './payloads.ts'

const name = requireArg('client')
const config = arg('config', 'defaults') as Config
const iterations = Number(arg('iterations', '10000'))
const samples = Number(arg('samples', '5'))

const body = PAYLOADS.small
globalThis.fetch = () =>
  Promise.resolve(new Response(body, { headers: { 'content-type': 'application/json' } }))

const fn = clients({
  origin: 'https://bench.test',
  path: '/users/1',
  config,
  transport: 'stub',
})[name]
if (!fn) throw new Error(`unknown client ${name}`)

for (let i = 0; i < 2_000; i++) await fn()
const results: number[] = []
for (let s = 0; s < samples; s++) {
  globalThis.gc?.()
  const start = performance.now()
  for (let i = 0; i < iterations; i++) await fn()
  results.push(((performance.now() - start) * 1000) / iterations)
}
console.log(JSON.stringify({ samples: results }))
