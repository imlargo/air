// Latency and throughput against a local HTTP server with keep-alive. Real sockets, no network.

import http from 'node:http'
import air from '@imlargo/air'
import ky from 'ky'
import { ofetch } from 'ofetch'
import axios from 'axios'
import { median, table } from './lib.mjs'

const PAYLOAD = JSON.stringify({
  id: 1,
  name: 'Ada',
  tags: ['a', 'b'],
  nested: { ok: true },
})

async function sequential(fn, n) {
  for (let i = 0; i < 200; i++) await fn()
  const latencies = []
  for (let i = 0; i < n; i++) {
    const start = performance.now()
    await fn()
    latencies.push(performance.now() - start)
  }
  latencies.sort((a, b) => a - b)
  return { p50: latencies[Math.floor(n * 0.5)], p99: latencies[Math.floor(n * 0.99)] }
}

async function concurrent(fn, total, concurrency) {
  let started = 0
  const start = performance.now()
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (started < total) {
        started++
        await fn()
      }
    }),
  )
  return total / ((performance.now() - start) / 1000)
}

export async function server({ requests = 2000, concurrency = 50, rounds = 3 } = {}) {
  const httpServer = http.createServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(PAYLOAD)),
    })
    res.end(PAYLOAD)
  })
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${httpServer.address().port}`

  const clients = {
    'fetch + response.json()': async () => (await fetch(`${origin}/users/1`)).json(),
    '@imlargo/air': (() => {
      const c = air.create({ baseURL: origin })
      return () => c.get('/users/1')
    })(),
    ky: (() => {
      const c = ky.create({ prefix: origin })
      return () => c.get('users/1').json()
    })(),
    ofetch: (() => {
      const c = ofetch.create({ baseURL: origin })
      return () => c('/users/1')
    })(),
    'axios (fetch adapter)': (() => {
      const c = axios.create({ baseURL: origin, adapter: 'fetch' })
      return () => c.get('/users/1')
    })(),
    'axios (http adapter)': (() => {
      const c = axios.create({ baseURL: origin })
      return () => c.get('/users/1')
    })(),
  }

  try {
    const rows = []
    for (const [name, fn] of Object.entries(clients)) {
      const seq = await sequential(fn, requests)
      const throughputs = []
      for (let round = 0; round < rounds; round++) {
        throughputs.push(await concurrent(fn, requests * 2, concurrency))
      }
      const rps = median(throughputs)
      rows.push([
        `\`${name}\``,
        `${seq.p50.toFixed(3)} ms`,
        `${seq.p99.toFixed(3)} ms`,
        `${Math.round(rps).toLocaleString('en-US')} req/s`,
      ])
    }
    return table(
      ['Client', 'p50', 'p99', `Throughput at ${concurrency} concurrent`],
      rows,
    )
  } finally {
    httpServer.close()
  }
}
