// Download and upload progress.
//
// Download: `progress` from `@imlargo/air/progress` wraps `fetch` and reports after every chunk;
// the body still arrives parsed. Upload: hand `body` a `ReadableStream` that counts as it is
// read. No wrapper is involved, and Firefox and Safari cannot stream uploads anyway.
//
// Run: node examples/progress.ts

import { strict as assert } from 'node:assert'
import air from '@imlargo/air'
import { progress } from '@imlargo/air/progress'
import type { Progress } from '@imlargo/air/progress'
import { readBody, serve } from './_server.ts'

const PAYLOAD = 'x'.repeat(50_000)

const server = await serve(async (req, res) => {
  if (req.method === 'POST') {
    const body = await readBody(req)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ received: body.length }))
    return
  }
  res.writeHead(200, {
    'content-type': 'text/plain',
    'content-length': String(PAYLOAD.length),
  })
  // Spaced out so the chunks arrive separately; over localhost, back-to-back writes coalesce.
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  res.write(PAYLOAD.slice(0, 20_000))
  await sleep(15)
  res.write(PAYLOAD.slice(20_000, 40_000))
  await sleep(15)
  res.end(PAYLOAD.slice(40_000))
})

// --- the recipe -------------------------------------------------------------------------

const downloads: Progress[] = []
const api = air.create({
  baseURL: server.url,
  fetch: progress({ onProgress: (p) => downloads.push(p) }),
})

interface Upload {
  sent: number
  total: number
}

function counted(body: string, report: (upload: Upload) => void) {
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

const text = await api.get<string>('/big.txt')
assert.equal(text, PAYLOAD, 'the body still arrives parsed, and whole')
assert.ok(downloads.length > 1, 'progress fired per chunk')
assert.deepEqual(downloads.at(-1), { loaded: PAYLOAD.length, total: PAYLOAD.length })

const { response } = await api.raw.get('/big.txt')
assert.equal(
  response.headers.get('content-type'),
  'text/plain',
  'headers intact through the wrapper',
)
assert.equal(response.url, `${server.url}/big.txt`, 'and so is the final url')

const uploads: Upload[] = []
const echoed = await api.post<{ received: number }>('/upload', {
  body: counted(PAYLOAD, (p) => uploads.push(p)),
})
assert.equal(echoed?.received, PAYLOAD.length, 'the server got every byte')
assert.equal(uploads.at(-1)?.sent, PAYLOAD.length, 'upload counted the same total')

console.log(
  `progress: ok, ${downloads.length} download reports, ${uploads.length} upload reports`,
)
await server.close()
