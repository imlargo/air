// Faking the transport in your tests
//
// `fetch` is an option, so a test double is an argument rather than a global stub: nothing
// to install, nothing to restore, and two tests can run concurrently with different doubles
// because neither touched anything shared.
//
// The `Fetch` type is deliberately looser than the global — `(input: string, init:
// RequestInit) => Promise<Response>` — which is what makes a hand-written double assignable
// to it. Narrow on the parameters means wide on what qualifies.
//
// Run: node examples/testing.mjs

import { strict as assert } from 'node:assert'
import air, { isAirError } from '../dist/index.mjs'

// --- the recipe -------------------------------------------------------------------------

// Records what would have been sent, by building the Request the transport would have built.
// Assertions then read against a real Request rather than against a bag of arguments.
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

// A unit under test that takes a client, so the test supplies one and the app supplies the
// real one. This is the shape worth copying.
const listUsers = (api, page) => api.get('/users', { query: { page } })

const users = fake(() => ok([{ id: 1, name: 'Ada' }]))
const api = air.create({ baseURL: 'https://api.test', fetch: users.transport })

const result = await listUsers(api, 2)

assert.deepEqual(result, [{ id: 1, name: 'Ada' }])
assert.equal(users.requests[0].url, 'https://api.test/users?page=2')
assert.equal(users.requests[0].method, 'GET')

// Error paths need no special machinery either — return the failure you want to test.
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

// Two doubles at once, which a global stub could not do.
// Absolute URLs here because the double builds a real `Request`, and that constructor
// needs one. A double that only records the string it was handed does not.
const [a, b] = await Promise.all([
  air.get('https://a.test/x', { fetch: fake(() => ok({ from: 'a' })).transport }),
  air.get('https://b.test/x', { fetch: fake(() => ok({ from: 'b' })).transport }),
])
assert.deepEqual([a.from, b.from], ['a', 'b'], 'no shared state between them')

// One caveat worth knowing, and the reason this project keeps an examples lane at all: a
// double agrees with whatever you assume. Real `fetch` rejects an already-aborted signal
// before sending, requires `duplex: 'half'` for a stream body, and generates its own
// multipart boundary — none of which a handler like the one above enforces. Every bug this
// library has shipped got through exactly that gap. Test behaviour with doubles; test the
// platform against the platform.

console.log('testing: ok — doubles as arguments, no global stub, two at once')
