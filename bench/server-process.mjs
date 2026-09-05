// The HTTP server, in its own process so it never competes with a client for the event loop.

import http from 'node:http'
import { PAYLOADS, PATHS } from './payloads.mjs'

const byPath = Object.fromEntries(
  Object.entries(PATHS).map(([size, path]) => [path, PAYLOADS[size]]),
)

const server = http.createServer((req, res) => {
  const payload = byPath[req.url] ?? '{}'
  res.writeHead(200, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(payload)),
  })
  res.end(payload)
})
server.keepAliveTimeout = 60_000
server.listen(0, '127.0.0.1', () => {
  console.log(JSON.stringify({ port: server.address().port }))
})
process.on('SIGTERM', () => server.close(() => process.exit(0)))
