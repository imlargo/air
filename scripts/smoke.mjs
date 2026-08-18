// Smoke-tests the BUILT artifact in dist/, which the vitest suite never touches —
// it imports from src/. This catches a broken build (bad bundling, missing export)
// that a green test run would happily hide.
//
// Deliberately plain Node with no test runner and no syntax past Node 18, because
// it doubles as the check that `engines: node >=18` is true rather than aspirational.
//
// Run: pnpm build && node scripts/smoke.mjs

import { strict as assert } from 'node:assert'
import air, { AirError, create, isAirError } from '../dist/index.mjs'

const json = (data, init) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init && init.headers) },
  })

let seen
const stub = (handler) => {
  globalThis.fetch = async (url, init) => {
    seen = { url, init, request: new Request(url, init) }
    return handler(url, init)
  }
}

// Exports are intact
assert.equal(typeof air, 'function', 'default export is callable')
assert.equal(typeof air.get, 'function', 'method shortcuts exist')
assert.equal(typeof create, 'function', 'create is exported')
assert.equal(typeof isAirError, 'function', 'isAirError is exported')
assert.equal(typeof AirError, 'function', 'AirError is exported')

// Parses JSON
stub(() => json({ id: 1 }))
assert.deepEqual(await air.get('https://x.test/a'), { id: 1 }, 'parses a JSON body')

// baseURL + query + default headers
stub(() => json({}))
const api = create({ baseURL: 'https://x.test', headers: { 'X-Smoke': 'yes' } })
await api.get('/s', { query: { page: 2, skip: null } })
assert.equal(seen.url, 'https://x.test/s?page=2', 'builds url, drops null query values')
assert.equal(seen.request.headers.get('x-smoke'), 'yes', 'applies client headers')

// JSON body gets a content-type
stub(() => json({}))
await air.post('https://x.test/a', { body: { name: 'Ada' } })
assert.equal(
  seen.request.headers.get('content-type'),
  'application/json',
  'sets json content-type',
)
assert.equal(await seen.request.text(), '{"name":"Ada"}', 'serializes the body')

// Lazy header function
stub(() => json({}))
let token = 'first'
const auth = create({ headers: () => ({ Authorization: `Bearer ${token}` }) })
await auth.get('https://x.test/a')
assert.equal(seen.request.headers.get('authorization'), 'Bearer first', 'reads the token')
token = 'second'
await auth.get('https://x.test/a')
assert.equal(
  seen.request.headers.get('authorization'),
  'Bearer second',
  'header function re-runs per request',
)

// 204 resolves to null
stub(() => new Response(null, { status: 204 }))
assert.equal(await air.delete('https://x.test/a'), null, '204 resolves to null')

// The raw client hands back the body and the response
stub(() => json({ ok: true }, { headers: { 'x-total': '7' } }))
const { data, response } = await air.raw.get('https://x.test/a')
assert.deepEqual(data, { ok: true }, 'raw still parses the body')
assert.equal(response.headers.get('x-total'), '7', 'exposes response headers')

// parse: 'stream' hands back the body unread, and it is the response's own body —
// one stream under two names. Checked here rather than only in the test suite
// because this runs on the oldest Node `engines` claims, against that version's
// own fetch implementation.
stub(() => json({ ok: true }))
const streamed = await air.raw.get('https://x.test/a', { parse: 'stream' })
assert.ok(streamed.data instanceof ReadableStream, 'stream mode returns a ReadableStream')
assert.equal(streamed.data, streamed.response.body, 'the stream is the response body')
assert.equal(streamed.response.bodyUsed, false, 'the body is handed back unread')
assert.deepEqual(
  await new Response(streamed.data).json(),
  { ok: true },
  'the stream carries the body',
)

// An injected fetch replaces the global one, the way a server framework's
// per-request fetch does
stub(() => {
  throw new Error('the global fetch should not have been called')
})
let injected
const scoped = create({
  fetch: (url, init) => {
    injected = { url, init }
    return json({ scoped: true })
  },
})
assert.deepEqual(
  await scoped.get('/relative/path'),
  { scoped: true },
  'uses the injected fetch',
)
assert.equal(injected.url, '/relative/path', 'passes a relative url through untouched')
assert.equal(injected.init.fetch, undefined, 'does not leak the option into the init')

// A signal function is resolved per request, so a client default is a budget per
// request rather than one shared signal that dies for good the first time it fires
stub(() => json({}))
const timed = create({ signal: () => AbortSignal.timeout(1000) })
await timed.get('https://x.test/a')
const first = seen.init.signal
await timed.get('https://x.test/b')
assert.ok(first instanceof AbortSignal, 'resolves the signal function')
assert.notEqual(first, seen.init.signal, 'mints a fresh signal per request')

// Non-2xx throws a recognizable AirError
stub(() => json({ message: 'nope' }, { status: 404, statusText: 'Not Found' }))
const error = await air.get('https://x.test/missing').catch((e) => e)
assert.ok(isAirError(error), 'throws an AirError')
assert.equal(error.status, 404, 'carries the status')
assert.deepEqual(error.data, { message: 'nope' }, 'carries the parsed error body')

console.log(`smoke: all checks passed on Node ${process.version}`)
