// Server-side rendering with a per-request `fetch`.
//
// Frameworks hand each request its own `fetch`, which carries that request's cookies and
// resolves relative URLs. It exists only inside the request, so it is passed as an option.
//
// Run: node examples/ssr.mjs

import { strict as assert } from 'node:assert'
import air from '../dist/index.mjs'
import { json, serve } from './_server.mjs'

const server = await serve((req, res) => {
  json(res, { url: req.url, cookie: req.headers.cookie ?? null })
})

// --- the recipe -------------------------------------------------------------------------

// src/lib/api.js: shared by every route, holds no request state.
const createApi = (fetch) => air.create({ baseURL: server.url, fetch })

// Stands in for the framework's per-request fetch: carries one request's cookies.
const frameworkFetch = (incoming) => (url, init) => {
  const headers = new Headers(init.headers)
  headers.set('cookie', incoming.cookie)
  return fetch(url, { ...init, headers })
}

// src/routes/+page.server.js
async function load(event) {
  const api = createApi(event.fetch)
  return { me: await api.get('/api/me') }
}

// --- what it proves ---------------------------------------------------------------------

const alice = await load({ fetch: frameworkFetch({ cookie: 'session=alice' }) })
const bob = await load({ fetch: frameworkFetch({ cookie: 'session=bob' }) })

assert.equal(alice.me.cookie, 'session=alice')
assert.equal(bob.me.cookie, 'session=bob', 'each request carried its own session')
assert.equal(
  alice.me.url,
  '/api/me',
  'baseURL still applied on top of the injected fetch',
)

const calls = []
const instrumented = createApi((url, init) => {
  calls.push(url)
  return fetch(url, init)
})
await instrumented.create({ headers: { 'X-Scope': 'admin' } }).get('/api/me')
assert.equal(calls.length, 1, 'a derived client inherited the injected fetch')

let seen
await air.get(`${server.url}/x`, {
  fetch: (url, init) => {
    seen = init
    return fetch(url, init)
  },
})
assert.equal(seen.fetch, undefined, 'the option is consumed, not forwarded')

console.log('ssr: ok — per-request fetch carried its own cookies, baseURL intact')
await server.close()
