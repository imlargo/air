// Refreshing a token on a 401
//
// A header function keeps a token fresh *before* a request goes out. It cannot react to one
// that comes back rejected — by then the request has already been sent. `air` has no response
// hook for that and does not need one: a wrapper around `fetch` sees the response, so the
// whole pattern is an ordinary function.
//
// The part that is easy to get wrong is concurrency. Five requests in flight all get a 401 at
// the same moment, and without a single-flight promise that is five renewals racing, with the
// last one to land winning. This file proves the deduplication rather than asserting it.
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
    // When renewal is broken, it hands back a token the server will not accept — the case
    // that proves the wrapper re-sends once and gives up, instead of spinning.
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

// One renewal at a time, however many requests hit a 401 at once. `finally` clears the slot
// so the *next* 401, later, starts a fresh one.
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

    // The 401 body goes unread, so release the connection rather than leaving it pinned.
    response.body?.cancel()

    const token = await renew()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)

    // Send once more and return whatever comes back. A token that is still rejected surfaces
    // as a normal AirError instead of spinning — never loop here.
    //
    // `init` still carries the caller's signal, so the retry is covered by it and spends the
    // *same* budget: a client-wide `signal: () => AbortSignal.timeout(5000)` gives the
    // original request, the renewal and the retry five seconds between them, not five each.
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

// A later 401 renews again — the single-flight slot is per burst, not once for the process.
valid = 'rotated-out-of-band'
const later = await api.get('/f')
assert.equal(later.ok, true, 'a later 401 recovered too')
assert.equal(renewals, 2, 'and started a fresh renewal rather than reusing the first')

// The one that matters most: when the renewed token is still rejected, the call surfaces as
// an ordinary AirError. One retry, never a loop.
renewalWorks = false
valid = 'rotated-again'
await assert.rejects(
  api.get('/g'),
  (error) => error.name === 'AirError' && error.status === 401,
)
assert.equal(renewals, 3, 'exactly one renewal attempt, not an unbounded chain')

console.log(
  'refresh: ok — 5 concurrent 401s produced 1 renewal; a stuck token failed without looping',
)
await server.close()
