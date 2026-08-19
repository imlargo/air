// What a mock cannot tell you
//
// This file is not a recipe. It is the regression lane: every behaviour here depends on what
// real `fetch` and a real socket actually do, and every one of them is something a hand-
// written double will happily agree with you about while production disagrees.
//
// The three bugs this library has shipped all came through that gap:
//
//   0.2.0  a ReadableStream body threw, because fetch requires duplex: 'half' and a mock
//          does not enforce it. Documented as supported; never worked.
//   0.3.1  a client-default AbortSignal was one instance shared by every request, which
//          looks fine until something rejects an already-fired signal. Real fetch does.
//          The first regression test passed *before* the fix.
//   0.5.0  a null header went out as the string "null" on one code path, because the
//          Headers constructor stringifies rather than deletes.
//
// The rule that came out of it: when the mock and the platform disagree, the mock is wrong.
// This file is how we find out which is which.
//
// Run: node examples/platform.mjs

import { strict as assert } from 'node:assert'
import air, { create } from '../dist/index.mjs'
import { json, readBody, serve } from './_server.mjs'

const server = await serve(async (req, res) => {
  if (req.url === '/slow') {
    // Headers immediately, body never. Anything that only covers the fetch() promise and
    // not the body read will hang here rather than abort.
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.write('start')
    return
  }
  if (req.url === '/redirect') {
    res.writeHead(302, { location: '/landed' })
    return res.end()
  }
  if (req.url === '/empty') {
    res.writeHead(404, { 'content-type': 'application/json' })
    return res.end()
  }
  if (req.url === '/garbled') {
    res.writeHead(500, { 'content-type': 'application/json' })
    return res.end('<html>a proxy answered instead</html>')
  }
  const body = await readBody(req)
  json(res, {
    url: req.url,
    method: req.method,
    contentType: req.headers['content-type'] ?? null,
    auth: req.headers.authorization ?? null,
    body,
  })
})

// --- a streaming body actually reaches the wire -----------------------------------------
// fetch refuses a ReadableStream body without duplex: 'half'. air sets it; a mock never had
// to care. This is the 0.2.0 bug, and it can only fail against a real transport.

const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode('streamed body'))
    controller.close()
  },
})
const streamed = await air.post(`${server.url}/upload`, { body: stream })
assert.equal(streamed.body, 'streamed body', 'a ReadableStream body was sent')

// --- FormData gets a runtime-generated boundary -----------------------------------------
// No literal a caller could write is ever a valid multipart Content-Type, so air deletes
// theirs. Whether the runtime then supplies a working one is not something a mock decides.

const form = new FormData()
form.set('name', 'Ada')
const uploaded = await air.post(`${server.url}/form`, {
  body: form,
  headers: { 'content-type': 'text/plain' },
})
assert.match(
  uploaded.contentType,
  /^multipart\/form-data; boundary=/,
  'the runtime set the boundary, and the caller-supplied type was dropped',
)
assert.ok(uploaded.body.includes('name="name"'), 'the parts arrived')

// --- an already-fired signal is rejected before sending ---------------------------------
// The 0.3.1 bug. A signal in client defaults is one instance for every request it will ever
// make; once it fires, the client is permanently broken. Only a real transport enforces it.

const budget = create({ baseURL: server.url, signal: () => AbortSignal.timeout(50) })
assert.deepEqual((await budget.get('/a')).method, 'GET')
await new Promise((r) => setTimeout(r, 80))
assert.equal((await budget.get('/b')).method, 'GET', 'a fresh signal per request')

const shared = AbortSignal.timeout(1)
await new Promise((r) => setTimeout(r, 20))
await assert.rejects(
  air.get(`${server.url}/a`, { signal: shared }),
  (e) => e.name === 'AirError',
  'a fired signal still rejects, rather than being ignored',
)

// --- abort covers the body download, not just the headers -------------------------------

await assert.rejects(
  air.get(`${server.url}/slow`, { signal: AbortSignal.timeout(120) }),
  (e) => e.name === 'AirError' && /aborted|timed out/.test(e.message),
  'aborted mid-body rather than hanging',
)

// --- a null header is absent on the wire, not the string "null" -------------------------
// The 0.5.0 bug, on the one path that skips the merge: defaults handed straight to create().

const authed = create({
  baseURL: server.url,
  headers: { Authorization: 'Bearer secret', 'X-Keep': 'yes' },
})
assert.equal((await authed.get('/private')).auth, 'Bearer secret')
assert.equal(
  (await authed.get('/public', { headers: { Authorization: null } })).auth,
  null,
  'removed, not stringified',
)
assert.equal(
  (await create({ headers: { Authorization: null } }).get(`${server.url}/x`)).auth,
  null,
)

// --- redirects are followed, and the final url is visible -------------------------------

const { response } = await air.raw.get(`${server.url}/redirect`)
assert.equal(response.url, `${server.url}/landed`, 'response.url is the final one')
assert.equal(response.redirected, true)

// --- a non-2xx with no body still throws with a status ----------------------------------

const empty = await air.get(`${server.url}/empty`).catch((e) => e)
assert.equal(empty.status, 404)
// null, not undefined: an empty body resolves to null in every parse mode. `undefined` is
// reserved for a body that failed to parse — a 500 never becomes a parse error.
assert.equal(empty.data, null, 'an empty error body is null')

const garbled = await air.get(`${server.url}/garbled`).catch((e) => e)
assert.equal(
  garbled.status,
  500,
  'a body that fails to parse still throws with its status',
)
assert.equal(garbled.data, undefined, 'and leaves data undefined rather than throwing')

// --- query shapes survive real URL serialization ----------------------------------------

const q = await air.get(`${server.url}/s`, { query: new URLSearchParams('tag=a&tag=b') })
assert.equal(q.url, '/s?tag=a&tag=b', 'a repeated key survived')
const base = await air.get('s', { baseURL: new URL(`${server.url}/v1/`) })
assert.equal(base.url, '/v1/s', 'a URL baseURL kept its path prefix')

console.log('platform: ok — every check here is one a mock would have let through')
await server.close()
