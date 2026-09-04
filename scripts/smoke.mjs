// Smoke-tests the built `dist/` on plain Node, with no test runner and no syntax newer than
// Node 20, so it doubles as the check that `engines` is accurate.
//
// Run: pnpm build && node scripts/smoke.mjs

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import air, { AirError, create, isAirError } from '../dist/index.mjs'
import { retry } from '../dist/retry.mjs'
import { refresh } from '../dist/refresh.mjs'
import { progress } from '../dist/progress.mjs'
import { toFormData } from '../dist/form.mjs'
import { toQueryParams } from '../dist/query.mjs'

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

// parse: 'stream' returns the response's own body unread.
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

// An injected fetch replaces the global one
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

// A signal function is resolved per request
stub(() => json({}))
const timed = create({ signal: () => AbortSignal.timeout(1000) })
await timed.get('https://x.test/a')
const first = seen.init.signal
await timed.get('https://x.test/b')
assert.ok(first instanceof AbortSignal, 'resolves the signal function')
assert.notEqual(first, seen.init.signal, 'mints a fresh signal per request')

// A null header removes an inherited one
stub(() => json({}))
const authed = create({ headers: { Authorization: 'Bearer t', 'X-Keep': 'yes' } })
await authed.get('https://x.test/public', { headers: { Authorization: null } })
assert.equal(seen.request.headers.get('authorization'), null, 'null drops the header')
assert.equal(seen.request.headers.get('x-keep'), 'yes', 'and leaves the others alone')

// query accepts URLSearchParams and tuples, repeated keys intact
stub(() => json({}))
await air.get('https://x.test/s', { query: new URLSearchParams('tag=a&tag=b') })
assert.equal(seen.url, 'https://x.test/s?tag=a&tag=b', 'accepts a URLSearchParams')
stub(() => json({}))
await air.get('https://x.test/s', {
  query: [['page', 2]],
  baseURL: new URL('https://y.test'),
})
assert.equal(seen.url, 'https://x.test/s?page=2', 'accepts tuples; absolute path wins')

// Non-2xx throws a recognizable AirError
stub(() => json({ message: 'nope' }, { status: 404, statusText: 'Not Found' }))
const error = await air.get('https://x.test/missing').catch((e) => e)
assert.ok(isAirError(error), 'throws an AirError')
assert.equal(error.status, 404, 'carries the status')
assert.deepEqual(error.data, { message: 'nope' }, 'carries the parsed error body')

const runtime = globalThis.navigator?.userAgent ?? `Node.js/${process.version}`
// The root entry is the client and nothing else: no utility code, and a size that does not
// creep. Each utility ships self-contained, so importing one loads exactly one file.
const dist = (name) =>
  readFileSync(new URL(`../dist/${name}.mjs`, import.meta.url), 'utf8')
assert.ok(gzipSync(dist('index')).length < 3500, 'root entry stays under 3.5 kB gzip')
for (const name of ['index', 'retry', 'refresh', 'progress', 'form', 'query']) {
  assert.ok(!/^import /m.test(dist(name)), `${name}.mjs has no runtime imports`)
}

// Utilities: one representative behaviour each, through the built files
let attempts = 0
stub(() => (++attempts === 1 ? new Response(null, { status: 503 }) : json({ ok: 1 })))
assert.deepEqual(
  await air.get('https://x.test/a', { fetch: retry({ delay: () => 0 }) }),
  { ok: 1 },
)
assert.equal(attempts, 2, 'retry re-sent a 503')

attempts = 0
stub(() => (++attempts === 1 ? new Response(null, { status: 401 }) : json({ ok: 1 })))
await air.get('https://x.test/a', {
  fetch: refresh({ headers: () => ({ Authorization: 'Bearer new' }) }),
})
assert.equal(
  seen.request.headers.get('authorization'),
  'Bearer new',
  'refresh retried with new headers',
)

const reports = []
stub(
  () =>
    new Response('{"ok":1}', {
      headers: { 'content-type': 'application/json', 'content-length': '8' },
    }),
)
await air.get('https://x.test/a', {
  fetch: progress({ onProgress: (p) => reports.push(p) }),
})
assert.deepEqual(reports.at(-1), { loaded: 8, total: 8 }, 'progress counted the body')

stub(() => json({}))
await air.post('https://x.test/u', {
  body: toFormData({ name: 'Ada', tags: ['a', 'b'] }),
})
assert.match(
  seen.request.headers.get('content-type'),
  /^multipart\/form-data; boundary=/,
  'toFormData body is multipart',
)

stub(() => json({}))
await air.get('https://x.test/s', {
  query: toQueryParams({ filter: { since: new Date(0) } }),
})
assert.equal(
  decodeURIComponent(seen.url),
  'https://x.test/s?filter[since]=1970-01-01T00:00:00.000Z',
  'toQueryParams feeds query',
)

console.log(`smoke: all checks passed on ${runtime}`)
