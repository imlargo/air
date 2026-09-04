// Download and upload progress.
//
// Download: wrap `fetch` and count bytes through a `TransformStream`; air still parses the
// result. Upload: hand air a counting `ReadableStream` as the body.
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
  // Spaced out so the chunks arrive separately; over localhost, back-to-back writes coalesce.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  res.write(PAYLOAD.slice(0, 20_000))
  await sleep(15)
  res.write(PAYLOAD.slice(20_000, 40_000))
  await sleep(15)
  res.end(PAYLOAD.slice(40_000))
})

// --- the recipe -------------------------------------------------------------------------

const withDownloadProgress = (report) => async (url, init) => {
  const response = await fetch(url, init)
  if (!response.body) return response

  // `content-length` is absent on a chunked response; report 0 rather than invent a total.
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

const { response } = await api.raw.get(`${server.url}/big.txt`)
assert.equal(response.headers.get('content-type'), 'text/plain', 'headers intact')

const uploads = []
const echoed = await air.post(`${server.url}/upload`, {
  body: counted(PAYLOAD, (p) => uploads.push(p)),
})

assert.equal(echoed.received, PAYLOAD.length, 'the server got every byte')
assert.equal(uploads.at(-1).sent, PAYLOAD.length, 'upload counted the same total')

console.log(
  `progress: ok, ${downloads.length} download reports, ${uploads.length} upload reports`,
)
await server.close()
