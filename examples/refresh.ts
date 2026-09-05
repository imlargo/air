// Refreshing a token on a 401.
//
// `refresh` from `@imlargo/air/refresh` wraps `fetch`. On a 401 it calls your `headers`
// function once, however many requests failed at the same time, and re-sends each of them with
// the result. A credential that is still rejected surfaces as a normal error.
//
// Run: node examples/refresh.ts

import { strict as assert } from 'node:assert'
import air, { isAirError } from '@imlargo/air'
import { refresh } from '@imlargo/air/refresh'
import { json, serve } from './_server.ts'

interface Ok {
  ok: boolean
  url: string
}

let valid = 'token-1'
let renewals = 0
let renewalWorks = true

const server = await serve((req, res) => {
  if (req.url === '/renew') {
    renewals++
    valid = renewalWorks ? `token-${renewals + 1}` : valid
    json(res, { token: renewalWorks ? valid : 'not-a-real-token' })
    return
  }
  if (req.headers.authorization !== `Bearer ${valid}`) {
    json(res, { error: 'expired' }, 401)
    return
  }
  json(res, { ok: true, url: req.url ?? '' } satisfies Ok)
})

// --- the recipe -------------------------------------------------------------------------

const session = { token: 'stale' }

const api = air.create({
  baseURL: server.url,
  headers: () => ({ Authorization: `Bearer ${session.token}` }),
  fetch: refresh({
    // `fetch` here is the underlying one, without this wrapper: a renewal that answered 401
    // through the wrapped client would wait for its own refresh. Store the new token for later
    // requests, and return the headers for the retry.
    headers: async (fetch) => {
      const { token } = (await (await fetch(`${server.url}/renew`, {})).json()) as {
        token: string
      }
      session.token = token
      return { Authorization: `Bearer ${token}` }
    },
  }),
})

// --- what it proves ---------------------------------------------------------------------

const results = await Promise.all([
  api.get<Ok>('/a'),
  api.get<Ok>('/b'),
  api.get<Ok>('/c'),
  api.get<Ok>('/d'),
  api.get<Ok>('/e'),
])
assert.ok(
  results.every((r) => r?.ok),
  'all five requests succeeded after the refresh',
)
assert.equal(renewals, 1, 'five concurrent 401s produced exactly one renewal')

valid = 'rotated-out-of-band'
assert.equal((await api.get<Ok>('/f'))?.ok, true, 'a later 401 recovered too')
assert.equal(renewals, 2, 'and started a fresh renewal')

renewalWorks = false
valid = 'rotated-again'
await assert.rejects(api.get('/g'), (e) => isAirError(e) && e.status === 401)
assert.equal(renewals, 3, 'one renewal attempt, then the 401 surfaced')

console.log(
  'refresh: ok, 5 concurrent 401s produced 1 renewal; a stuck token failed without looping',
)
await server.close()
