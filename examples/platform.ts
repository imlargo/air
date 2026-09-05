// Behaviors only a real transport can confirm.
//
// Not a recipe. Each check here is something a hand-written `fetch` double would not enforce:
// `duplex` for a stream body, rejection of an already-fired signal, the multipart boundary,
// a `null` header on the wire, redirects, and abort during a slow body.
//
// Run: node examples/platform.ts

import { strict as assert } from 'node:assert'
import air, { create, isAirError } from '@imlargo/air'
import { json, readBody, serve } from './_server.ts'

interface Echo {
  url: string
  method: string
  contentType: string | null
  auth: string | null
  body: string
}

const server = await serve(async (req, res) => {
  if (req.url === '/slow') {
    // Headers now, body never: an abort that only covers the fetch() promise hangs here.
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.write('start')
    return
  }
  if (req.url === '/redirect') {
    res.writeHead(302, { location: '/landed' })
    res.end()
    return
  }
  if (req.url === '/empty') {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end()
    return
  }
  if (req.url === '/garbled') {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end('<html>a proxy answered instead</html>')
    return
  }
  const body = await readBody(req)
  json(res, {
    url: req.url ?? '',
    method: req.method ?? '',
    contentType: req.headers['content-type'] ?? null,
    auth: req.headers.authorization ?? null,
    body,
  } satisfies Echo)
})

const failure = async (pending: Promise<unknown>) => {
  const error: unknown = await pending.catch((e: unknown) => e)
  if (!isAirError(error)) throw new Error('expected an AirError')
  return error
}

// --- a streaming body reaches the wire (fetch requires duplex: 'half') --------------------

const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode('streamed body'))
    controller.close()
  },
})
const streamed = await air.post<Echo>(`${server.url}/upload`, { body: stream })
assert.equal(streamed?.body, 'streamed body', 'a ReadableStream body was sent')

// --- FormData gets a runtime-generated boundary -----------------------------------------

const form = new FormData()
form.set('name', 'Ada')
const uploaded = await air.post<Echo>(`${server.url}/form`, {
  body: form,
  headers: { 'content-type': 'text/plain' },
})
assert.match(
  uploaded?.contentType ?? '',
  /^multipart\/form-data; boundary=/,
  'the runtime set the boundary, and the caller-supplied type was dropped',
)
assert.ok(uploaded?.body.includes('name="name"'), 'the parts arrived')

// --- an already-fired signal is rejected before sending ---------------------------------

const budget = create({ baseURL: server.url, signal: () => AbortSignal.timeout(50) })
assert.equal((await budget.get<Echo>('/a'))?.method, 'GET')
await new Promise((r) => setTimeout(r, 80))
assert.equal((await budget.get<Echo>('/b'))?.method, 'GET', 'a fresh signal per request')

const shared = AbortSignal.timeout(1)
await new Promise((r) => setTimeout(r, 20))
await assert.rejects(
  air.get(`${server.url}/a`, { signal: shared }),
  (e) => isAirError(e),
  'a fired signal still rejects, rather than being ignored',
)

// --- abort covers the body download, not just the headers -------------------------------

await assert.rejects(
  air.get(`${server.url}/slow`, { signal: AbortSignal.timeout(120) }),
  (e) => isAirError(e) && /aborted|timed out/.test(e.message),
  'aborted mid-body rather than hanging',
)

// --- a null header is absent on the wire, not the string "null" -------------------------

const authed = create({
  baseURL: server.url,
  headers: { Authorization: 'Bearer secret', 'X-Keep': 'yes' },
})
assert.equal((await authed.get<Echo>('/private'))?.auth, 'Bearer secret')
assert.equal(
  (await authed.get<Echo>('/public', { headers: { Authorization: null } }))?.auth,
  null,
  'removed, not stringified',
)
assert.equal(
  (await create({ headers: { Authorization: null } }).get<Echo>(`${server.url}/x`))?.auth,
  null,
)

// --- redirects are followed, and the final url is visible -------------------------------

const { response } = await air.raw.get(`${server.url}/redirect`)
assert.equal(response.url, `${server.url}/landed`, 'response.url is the final one')
assert.equal(response.redirected, true)

// --- a non-2xx with no body still throws with a status ----------------------------------

const empty = await failure(air.get(`${server.url}/empty`))
assert.equal(empty.status, 404)
// null for an empty body; undefined is reserved for a body that failed to parse.
assert.equal(empty.data, null, 'an empty error body is null')

const garbled = await failure(air.get(`${server.url}/garbled`))
assert.equal(
  garbled.status,
  500,
  'a body that fails to parse still throws with its status',
)
assert.equal(garbled.data, undefined, 'and leaves data undefined rather than throwing')

// --- query shapes survive real URL serialization ----------------------------------------

const q = await air.get<Echo>(`${server.url}/s`, {
  query: new URLSearchParams('tag=a&tag=b'),
})
assert.equal(q?.url, '/s?tag=a&tag=b', 'a repeated key survived')
const base = await air.get<Echo>('s', { baseURL: new URL(`${server.url}/v1/`) })
assert.equal(base?.url, '/v1/s', 'a URL baseURL kept its path prefix')

console.log('platform: ok, every check here is one a mock would have let through')
await server.close()
