// The HTTP server, in its own process so it never competes with a client for the event loop.

import http from 'node:http'
import { PAYLOADS, PATHS, type Payload } from './payloads.ts'

const byPath = new Map(
  (Object.keys(PATHS) as Payload[]).map((size) => [PATHS[size], PAYLOADS[size]] as const),
)

const server = http.createServer((req, res) => {
  const payload = byPath.get(req.url ?? '') ?? '{}'
  res.writeHead(200, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(payload)),
  })
  res.end(payload)
})
server.keepAliveTimeout = 60_000
server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('server has no TCP address')
  console.log(JSON.stringify({ port: address.port }))
})
process.on('SIGTERM', () => server.close(() => process.exit(0)))
