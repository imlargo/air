// Retry with `Retry-After`.
//
// `retry` from `@imlargo/air/retry` wraps `fetch`. It repeats only idempotent methods, never a
// stream body, honours `Retry-After`, and stops the moment the caller's signal fires.
//
// Run: node examples/retry.mjs

import { strict as assert } from 'node:assert'
import air, { isAirError } from '../dist/index.mjs'
import { retry } from '../dist/retry.mjs'
import { json, serve } from './_server.mjs'

let attempts = 0
const server = await serve((req, res) => {
  attempts++
  if (req.url === '/cancelled') return
  if (attempts === 1) {
    res.writeHead(429, { 'retry-after': '0', 'content-type': 'application/json' })
    return res.end('{"error":"slow down"}')
  }
  if (attempts === 2) return json(res, { error: 'boom' }, 503)
  json(res, { ok: true, attempts })
})

// --- the recipe -------------------------------------------------------------------------

const api = air.create({
  baseURL: server.url,
  fetch: retry({ attempts: 3, delay: (attempt) => 50 * attempt }),
})

const result = await api.get('/flaky')

// --- what it proves ---------------------------------------------------------------------

assert.deepEqual(result, { ok: true, attempts: 3 })
assert.equal(attempts, 3, 'retried the 429 and the 503, then succeeded')

// A POST is not retried by default: repeating a non-idempotent request is the caller's call.
attempts = 0
await assert.rejects(
  api.post('/once', { body: { a: 1 } }),
  (e) => isAirError(e) && e.status === 429,
)
assert.equal(attempts, 1, 'a POST was sent once')

// A cancellation stops everything, including the wait between attempts.
attempts = 0
const controller = new AbortController()
setTimeout(() => controller.abort(), 30)
await assert.rejects(api.get('/cancelled', { signal: controller.signal }), (e) =>
  isAirError(e),
)
assert.equal(attempts, 1, 'an aborted request was not retried')

console.log(
  'retry: ok, honoured Retry-After, skipped a POST, and did not retry a cancellation',
)
await server.close()
