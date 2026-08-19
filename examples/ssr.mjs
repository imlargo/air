// Server-side rendering: bring your own fetch
//
// This is the one option in `air` that is not a request detail — it replaces the transport,
// and it earns its place because on the server the global `fetch` is the *wrong* function.
// SvelteKit's `event.fetch` (Remix, Astro and Nuxt have equivalents) forwards the incoming
// request's cookies and headers, resolves a relative URL against the current page, and
// answers a request to your own app by calling the route handler directly instead of making
// a real HTTP round-trip back to the same process.
//
// It exists only inside a request, so nothing ambient can be reached for. A shared service
// module can only get it if the client accepts one — which is the whole argument for the
// option.
//
// Run: node examples/ssr.mjs

import { strict as assert } from 'node:assert'
import air from '../dist/index.mjs'
import { json, serve } from './_server.mjs'

const server = await serve((req, res) => {
  json(res, { url: req.url, cookie: req.headers.cookie ?? null })
})

// --- the recipe -------------------------------------------------------------------------

// src/lib/api.js — shared by every route, holds no request state of its own.
const createApi = (fetch) => air.create({ baseURL: server.url, fetch })

// The framework hands you a per-request fetch. This stands in for it: it carries one
// incoming request's cookies, and it is a different function on every request.
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

// It merges like every other option: a client carries one, a single call can override it,
// and a derived client inherits it.
const calls = []
const instrumented = createApi((url, init) => {
  calls.push(url)
  return fetch(url, init)
})
await instrumented.create({ headers: { 'X-Scope': 'admin' } }).get('/api/me')
assert.equal(calls.length, 1, 'a derived client inherited the injected fetch')

// And it never leaks into the init handed to the transport.
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
