// Per-call overhead over a stubbed fetch, so the network is out of the picture.

import air from '@imlargo/air'
import ky from 'ky'
import { ofetch } from 'ofetch'
import axios from 'axios'
import { median, table } from './lib.mjs'

const BODY = JSON.stringify({ id: 1, name: 'Ada', tags: ['a', 'b'] })

async function measure(fn, iterations, samples) {
  const results = []
  for (let s = 0; s < samples; s++) {
    for (let i = 0; i < 500; i++) await fn()
    const start = performance.now()
    for (let i = 0; i < iterations; i++) await fn()
    results.push(((performance.now() - start) * 1000) / iterations)
  }
  return median(results)
}

export async function overhead({ iterations = 20_000, samples = 5 } = {}) {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(BODY, { headers: { 'content-type': 'application/json' } })

  const base = 'https://bench.test'
  const clients = {
    'fetch + response.json()': async () => (await fetch(`${base}/users/1`)).json(),
    '@imlargo/air': (() => {
      const c = air.create({ baseURL: base, headers: { 'X-Client': 'bench' } })
      return () => c.get('/users/1')
    })(),
    ky: (() => {
      const c = ky.create({ prefix: base, headers: { 'X-Client': 'bench' } })
      return () => c.get('users/1').json()
    })(),
    ofetch: (() => {
      const c = ofetch.create({ baseURL: base, headers: { 'X-Client': 'bench' } })
      return () => c('/users/1')
    })(),
    'axios (fetch adapter)': (() => {
      const c = axios.create({
        baseURL: base,
        headers: { 'X-Client': 'bench' },
        adapter: 'fetch',
      })
      return () => c.get('/users/1')
    })(),
  }

  try {
    const rows = []
    let baseline
    for (const [name, fn] of Object.entries(clients)) {
      const us = await measure(fn, iterations, samples)
      baseline ??= us
      rows.push([
        `\`${name}\``,
        `${us.toFixed(2)} µs`,
        `+${(us - baseline).toFixed(2)} µs`,
      ])
    }
    return table(['Client', 'Per call', 'Over fetch'], rows)
  } finally {
    globalThis.fetch = original
  }
}
