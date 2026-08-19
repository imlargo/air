// Download and upload progress
//
// The biggest apparent gap against axios and ky, and it is a documentation gap rather than a
// capability one. What axios spends an option, a callback, a `total` and a rate estimate on
// is, here, a function you write once and reuse — because `fetch` is an option, so anything
// that reads a request or a response is a wrapper you already know how to write.
//
// Run: node examples/progress.mjs

import { strict as assert } from 'node:assert'
import air from '../dist/index.mjs'
import { readBody, serve } from './_server.mjs'

const PAYLOAD = 'x'.repeat(50_000)

const server = await serve(async (req, res) => {
  if (req.method === 'POST') {
    const body = await readBody(req)
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ received: body.length }))
  }
  res.writeHead(200, {
    'content-type': 'text/plain',
    'content-length': String(PAYLOAD.length),
  })
  // Spaced out, so the chunks arrive separately. Worth knowing before you build a UI on
  // this: chunk boundaries are not yours to choose. The runtime and the kernel coalesce
  // freely, and over localhost three back-to-back writes usually arrive as one — this
  // server sleeps between them precisely because otherwise progress fires once, at 100%.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  res.write(PAYLOAD.slice(0, 20_000))
  await sleep(15)
  res.write(PAYLOAD.slice(20_000, 40_000))
  await sleep(15)
  res.end(PAYLOAD.slice(40_000))
})

// --- the recipe -------------------------------------------------------------------------

// Wrapping the *response* keeps air's parsing, status and headers intact: what comes back
// from the wrapper is still a Response, so air reads it exactly as it would have.
const withDownloadProgress = (report) => async (url, init) => {
  const response = await fetch(url, init)
  if (!response.body) return response

  // `content-length` is absent on a chunked response, so total is 0 and a caller showing a
  // percentage has to handle that. Report it rather than invent a number.
  const total = Number(response.headers.get('content-length')) || 0
  let loaded = 0

  const counted = response.body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        loaded += chunk.byteLength
        report({ loaded, total })
        controller.enqueue(chunk)
      },
    }),
  )

  return new Response(counted, response)
}

// Upload needs no library involvement at all: count the bytes on the way past and hand air
// the stream. A ReadableStream body gets `duplex: 'half'` set for you.
function counted(body, report) {
  const bytes = new TextEncoder().encode(body)
  let sent = 0

  return new ReadableStream({
    start(controller) {
      for (let at = 0; at < bytes.length; at += 16_384) {
        const chunk = bytes.slice(at, at + 16_384)
        sent += chunk.byteLength
        report({ sent, total: bytes.length })
        controller.enqueue(chunk)
      }
      controller.close()
    },
  })
}

// --- what it proves ---------------------------------------------------------------------

const downloads = []
const api = air.create({ fetch: withDownloadProgress((p) => downloads.push(p)) })
const text = await api.get(`${server.url}/big.txt`)

assert.equal(text, PAYLOAD, 'the body still arrives parsed, and whole')
assert.ok(downloads.length > 1, 'progress fired per chunk')
assert.equal(downloads.at(-1).loaded, PAYLOAD.length, 'final loaded equals the payload')
assert.equal(
  downloads.at(-1).total,
  PAYLOAD.length,
  'content-length survived the wrapper',
)

// The raw client still works through it, which is the check that the wrapper did not quietly
// replace the response with something less useful.
const { response } = await api.raw.get(`${server.url}/big.txt`)
assert.equal(response.headers.get('content-type'), 'text/plain', 'headers intact')

const uploads = []
const echoed = await air.post(`${server.url}/upload`, {
  body: counted(PAYLOAD, (p) => uploads.push(p)),
})

assert.equal(echoed.received, PAYLOAD.length, 'the server got every byte')
assert.equal(uploads.at(-1).sent, PAYLOAD.length, 'upload counted the same total')

console.log(
  `progress: ok — ${downloads.length} download reports, ${uploads.length} upload reports`,
)
await server.close()
