// Refreshing a token on a 401.
//
// A header function keeps a token fresh before a request is sent; it cannot react to a 401. A
// `fetch` wrapper can, and a single-flight promise keeps concurrent 401s to one renewal.
//
// Run: node examples/refresh.mjs

import { strict as assert } from 'node:assert'
import air from '../dist/index.mjs'
import { json, serve } from './_server.mjs'

let valid = 'token-1'
let renewals = 0
let renewalWorks = true

const server = await serve((req, res) => {
  if (req.url === '/renew') {
    renewals++
    // A broken renewal returns a token the server rejects, to prove the wrapper does not loop.
    valid = renewalWorks ? `token-${renewals + 1}` : valid
    return json(res, { token: renewalWorks ? valid : 'not-a-real-token' })
  }
  if (req.headers.authorization !== `Bearer ${valid}`) {
    return json(res, { error: 'expired' }, 401)
  }
  json(res, { ok: true, url: req.url })
})

// --- the recipe -------------------------------------------------------------------------

let access = 'stale'
let inFlight = null

// One renewal at a time. `finally` clears the slot so a later 401 starts a fresh one.
const renew = () =>
  (inFlight ??= fetch(`${server.url}/renew`)
    .then((r) => r.json())
    .then((body) => (access = body.token))
    .finally(() => (inFlight = null)))

const api = air.create({
  baseURL: server.url,
  headers: () => ({ Authorization: `Bearer ${access}` }),
  fetch: async (url, init) => {
    const response = await fetch(url, init)
    if (response.status !== 401) return response

    // The 401 body is not read; release the connection.
    response.body?.cancel()

    const token = await renew()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)

    // Retry once and return whatever comes back; a still-rejected token surfaces as an
    // AirError. `init.signal` is the caller's, so the retry shares the original budget.
    return fetch(url, { ...init, headers })
  },
})

// --- what it proves ---------------------------------------------------------------------

const results = await Promise.all([
  api.get('/a'),
  api.get('/b'),
  api.get('/c'),
  api.get('/d'),
  api.get('/e'),
])

assert.equal(results.length, 5)
assert.ok(
  results.every((r) => r.ok),
  'all five requests succeeded after the refresh',
)
assert.equal(renewals, 1, 'five concurrent 401s produced exactly one renewal')

valid = 'rotated-out-of-band'
const later = await api.get('/f')
assert.equal(later.ok, true, 'a later 401 recovered too')
assert.equal(renewals, 2, 'and started a fresh renewal rather than reusing the first')

renewalWorks = false
valid = 'rotated-again'
await assert.rejects(
  api.get('/g'),
  (error) => error.name === 'AirError' && error.status === 401,
)
assert.equal(renewals, 3, 'exactly one renewal attempt, not an unbounded chain')

console.log(
  'refresh: ok, 5 concurrent 401s produced 1 renewal; a stuck token failed without looping',
)
await server.close()
