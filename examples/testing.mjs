// Faking the transport in tests.
//
// `fetch` is an option, so a test double is an argument rather than a global stub, and two
// tests can use different doubles at once.
//
// Run: node examples/testing.mjs

import { strict as assert } from 'node:assert'
import air, { isAirError } from '../dist/index.mjs'

// --- the recipe -------------------------------------------------------------------------

function fake(handler) {
  const requests = []
  const transport = async (url, init) => {
    requests.push(new Request(url, init))
    return handler(new Request(url, init))
  }
  return { transport, requests }
}

const ok = (data, init) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })

// --- what it proves ---------------------------------------------------------------------

// The unit under test takes the client as a parameter.
const listUsers = (api, page) => api.get('/users', { query: { page } })

const users = fake(() => ok([{ id: 1, name: 'Ada' }]))
const api = air.create({ baseURL: 'https://api.test', fetch: users.transport })

const result = await listUsers(api, 2)

assert.deepEqual(result, [{ id: 1, name: 'Ada' }])
assert.equal(users.requests[0].url, 'https://api.test/users?page=2')
assert.equal(users.requests[0].method, 'GET')

const failing = fake(() =>
  ok({ message: 'nope' }, { status: 404, statusText: 'Not Found' }),
)
const broken = air.create({ baseURL: 'https://api.test', fetch: failing.transport })

const error = await broken.get('/users/9').catch((e) => e)
assert.ok(isAirError(error))
assert.equal(error.status, 404)
assert.deepEqual(
  error.data,
  { message: 'nope' },
  'the parsed error body is on error.data',
)
assert.equal(error.request.headers.get('accept'), null, 'headers as actually sent')

// Two doubles at once. Absolute URLs, because `new Request()` requires one.
const [a, b] = await Promise.all([
  air.get('https://a.test/x', { fetch: fake(() => ok({ from: 'a' })).transport }),
  air.get('https://b.test/x', { fetch: fake(() => ok({ from: 'b' })).transport }),
])
assert.deepEqual([a.from, b.from], ['a', 'b'], 'no shared state between them')

// A double does not enforce what the platform does: an aborted signal, `duplex` for a stream
// body, the multipart boundary. Test behavior with doubles and the platform with the platform.

console.log('testing: ok, doubles as arguments, no global stub, two at once')
