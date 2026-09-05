// Server-side rendering with a per-request `fetch`.
//
// Frameworks hand each request its own `fetch`, which carries that request's cookies and
// resolves relative URLs. It exists only inside the request, so it is passed as an option.
//
// Run: node examples/ssr.ts

import { strict as assert } from 'node:assert'
import air from '@imlargo/air'
import type { Fetch } from '@imlargo/air'
import { json, serve } from './_server.ts'

interface Me {
  url: string
  cookie: string | null
}

const server = await serve((req, res) => {
  json(res, { url: req.url, cookie: req.headers.cookie ?? null })
})

// --- the recipe -------------------------------------------------------------------------

// src/lib/api.ts: shared by every route, holds no request state.
const createApi = (fetch: Fetch) => air.create({ baseURL: server.url, fetch })

// Stands in for the framework's per-request fetch: carries one request's cookies.
const frameworkFetch =
  (incoming: { cookie: string }): Fetch =>
  (url, init) => {
    const headers = new Headers(init.headers)
    headers.set('cookie', incoming.cookie)
    return fetch(url, { ...init, headers })
  }

// src/routes/+page.server.ts
async function load(event: { fetch: Fetch }) {
  const api = createApi(event.fetch)
  return { me: await api.get<Me>('/api/me') }
}

// --- what it proves ---------------------------------------------------------------------

const alice = await load({ fetch: frameworkFetch({ cookie: 'session=alice' }) })
const bob = await load({ fetch: frameworkFetch({ cookie: 'session=bob' }) })

assert.ok(alice.me && bob.me)
assert.equal(alice.me.cookie, 'session=alice')
assert.equal(bob.me.cookie, 'session=bob', 'each request carried its own session')
assert.equal(
  alice.me.url,
  '/api/me',
  'baseURL still applied on top of the injected fetch',
)

const calls: string[] = []
const instrumented = createApi((url, init) => {
  calls.push(url)
  return fetch(url, init)
})
await instrumented.create({ headers: { 'X-Scope': 'admin' } }).get('/api/me')
assert.equal(calls.length, 1, 'a derived client inherited the injected fetch')

const seen: { init?: RequestInit } = {}
await air.get(`${server.url}/x`, {
  fetch: (url, init) => {
    seen.init = init
    return fetch(url, init)
  },
})
assert.ok(seen.init)
assert.equal('fetch' in seen.init, false, 'the option is consumed, not forwarded')

console.log('ssr: ok, per-request fetch carried its own cookies, baseURL intact')
await server.close()
