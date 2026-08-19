// Server-sent events
//
// Read this fork first, because for a good half of cases the answer is not `air`:
//
//   Your endpoint is GET, and authenticates with a cookie or not at all
//     -> use the platform's EventSource. It reconnects for you, tracks Last-Event-ID for
//        you, and parses frames for you. You do not need an HTTP client for that.
//
//   Your endpoint needs a header (a Bearer token), or is a POST with a body — which is
//   every LLM streaming API there is
//     -> EventSource cannot do it. Its constructor takes a URL and `{ withCredentials }`,
//        and nothing else: no headers, no method, no body. That is the whole reason
//        `@microsoft/fetch-event-source` exists. Use what is below.
//
// Since 0.4.1 `air` needs no option for this: `text/event-stream` is detected as a stream and
// handed back unread. Buffering it would mean waiting for an endpoint designed never to close.
//
// What `air` does NOT give you, and EventSource does: reconnection, and Last-Event-ID. If you
// need those over a POST, they are a loop you write — see the end of this file.
//
// Run: node examples/sse.mjs

import { strict as assert } from 'node:assert'
import air from '../dist/index.mjs'
import { serve } from './_server.mjs'

const server = await serve((req, res) => {
  if (req.headers.authorization !== 'Bearer secret') {
    res.writeHead(401, { 'content-type': 'application/json' })
    return res.end('{"error":"EventSource could not have got this far"}')
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  // CRLF on purpose. The spec allows it, real servers send it, and a hand-written parser
  // that splits frames on '\n\n' finds zero events here while looking perfectly correct.
  res.write('id: 1\r\nevent: tick\r\ndata: one\r\n\r\n')
  res.write(': a comment, which is not an event\r\n\r\n')
  res.write('id: 2\r\ndata: line A\r\ndata: line B\r\n\r\n')
  res.end()
})

// --- the recipe -------------------------------------------------------------------------

const api = air.create({
  baseURL: server.url,
  headers: { Authorization: 'Bearer secret' },
})

// `raw`, not the plain client, because the response is what tells you how to read the
// stream — and with `parse: 'stream'` the two are one object, not two copies: `data` IS
// `response.body`. Here the content type already selects the stream, so no option is needed.
const { data, response } = await api.raw.get('/events')

assert.equal(response.headers.get('content-type'), 'text/event-stream')
assert.equal(data, response.body, 'one stream under two names')

// For real frame parsing, use a library. A version written by hand for this project looked
// right, passed against a server using '\n\n', and returned zero events against the CRLF
// server above — silently. It also joined multi-line `data:` fields without the newline the
// spec requires. `parse-sse` (zero dependencies) takes the Response that `raw` hands you:
//
//   import { parseServerSentEvents } from 'parse-sse'
//   for await (const event of parseServerSentEvents(response)) { ... }
//
// What follows is deliberately not a parser — it is the minimum needed to prove the bytes
// arrive unbuffered and intact. Do not copy it as one.
const chunks = []
const reader = data.pipeThrough(new TextDecoderStream()).getReader()
for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  chunks.push(value)
}
const raw = chunks.join('')

// --- what it proves ---------------------------------------------------------------------

assert.ok(raw.includes('data: one'), 'the first event arrived')
assert.ok(
  raw.includes('data: line A\r\ndata: line B'),
  'multi-line data kept its newline',
)
assert.ok(raw.includes('id: 2'), 'ids survive; you need them to resume')

// The trap this whole design exists to avoid: splitting CRLF frames on '\n\n'.
assert.equal(raw.split('\n\n').length, 1, "a '\\n\\n' split finds no frames here at all")
assert.equal(raw.split('\r\n\r\n').length, 4, 'the spec-correct split finds them')

console.log('sse: ok — streamed unbuffered, over a connection EventSource cannot open')
await server.close()

// Reconnection, if you need it: track the last id you saw and send it back as the
// Last-Event-ID header on the next attempt. That header is exactly what EventSource sends
// for you, and the reason a header-capable client is what makes it possible at all.
//
//   let lastId
//   for (;;) {
//     const { response } = await api.raw.get('/events', {
//       headers: lastId ? { 'Last-Event-ID': lastId } : {},
//     })
//     for await (const event of parseServerSentEvents(response)) {
//       lastId = event.lastEventId ?? lastId
//       handle(event)
//     }
//     await new Promise((r) => setTimeout(r, backoff()))
//   }
