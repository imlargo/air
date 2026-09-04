// Server-sent events.
//
// Use the platform `EventSource` for a GET that needs no headers. For a Bearer token or a POST
// body, which `EventSource` cannot send, `text/event-stream` is returned unread as a stream.
// Parse frames with a library such as `parse-sse`; a hand-written `\n\n` split misses CRLF
// frames, which the spec allows.
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
  // CRLF on purpose: the spec allows it and a '\n\n' split finds no frames.
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

// `raw`, because the response headers describe the stream. `data` is `response.body` itself.
const { data, response } = await api.raw.get('/events')

assert.equal(response.headers.get('content-type'), 'text/event-stream')
assert.equal(data, response.body, 'one stream under two names')

// Parse frames with a library, e.g. `parse-sse`, which takes the Response from `raw`:
//
//   import { parseServerSentEvents } from 'parse-sse'
//   for await (const event of parseServerSentEvents(response)) { ... }
//
// What follows only proves the bytes arrive unbuffered and intact; it is not a parser.
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

assert.equal(raw.split('\n\n').length, 1, "a '\\n\\n' split finds no frames here at all")
assert.equal(raw.split('\r\n\r\n').length, 4, 'the spec-correct split finds them')

console.log('sse: ok — streamed unbuffered, over a connection EventSource cannot open')
await server.close()

// Reconnection: send the last id seen as `Last-Event-ID` on the next attempt.
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
