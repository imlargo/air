// Retry with `Retry-After`.
//
// The loop lives in your code so it can see your `AbortSignal` and never retry a deliberate
// cancellation. `Retry-After` is seconds or an HTTP date; anything else falls back to backoff.
//
// Run: node examples/retry.mjs

import { strict as assert } from 'node:assert'
import air, { isAirError } from '../dist/index.mjs'
import { json, serve } from './_server.mjs'

let attempts = 0
const server = await serve((req, res) => {
  attempts++
  if (attempts === 1) {
    res.writeHead(429, { 'retry-after': '0', 'content-type': 'application/json' })
    return res.end('{"error":"slow down"}')
  }
  if (attempts === 2) return json(res, { error: 'boom' }, 503)
  json(res, { ok: true, attempts })
})

// --- the recipe -------------------------------------------------------------------------

const RETRIABLE = new Set([408, 429, 500, 502, 503, 504])

// No status means no answer arrived (DNS, dropped connection), which is worth retrying.
const transient = (error) =>
  isAirError(error) && (error.status === undefined || RETRIABLE.has(error.status))

function retryAfter(error) {
  const header = error.response?.headers.get('retry-after')
  if (!header) return undefined

  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)

  const date = Date.parse(header)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

async function withRetry(fn, signal, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      // A cancelled request is never retried; only the caller holds the signal.
      if (attempt >= attempts || signal.aborted || !transient(error)) throw error

      const wait = retryAfter(error) ?? 2 ** attempt * 100
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
}

const controller = new AbortController()

// Build the request inside the callback so each attempt gets a fresh signal.
const result = await withRetry(
  () => air.get(`${server.url}/flaky`, { signal: controller.signal }),
  controller.signal,
)

// --- what it proves ---------------------------------------------------------------------

assert.deepEqual(result, { ok: true, attempts: 3 })
assert.equal(attempts, 3, 'retried the 429 and the 503, then succeeded')

const cancelled = new AbortController()
cancelled.abort()
let tries = 0
await assert.rejects(
  withRetry(() => {
    tries++
    return air.get(`${server.url}/x`, { signal: cancelled.signal })
  }, cancelled.signal),
)
assert.equal(tries, 1, 'an aborted signal stops the loop instead of feeding it')

console.log('retry: ok, honoured Retry-After, and did not retry a cancellation')
await server.close()
