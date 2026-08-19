// Retry, including the case that actually happens: 429 with Retry-After
//
// `air` ships no retry helper, because a loop in your own code is shorter than any option
// we could offer and it has something a generic helper cannot have — your `AbortSignal` in
// scope, so it can tell a transient failure apart from a request you cancelled on purpose.
//
// The header is the part worth copying. A server that answers 429 usually says when to come
// back, and guessing an exponential delay when it told you the number is how you stay rate
// limited for longer than necessary. Retry-After is either seconds or an HTTP date.
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

// No status at all means the request never got an answer — a DNS failure, a dropped
// connection. Those are worth retrying; a 400 is not, and neither is a 404.
const transient = (error) =>
  isAirError(error) && (error.status === undefined || RETRIABLE.has(error.status))

// Seconds, or an HTTP date. Anything else, including a date in the past, falls through to
// the caller's backoff rather than becoming a NaN delay.
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
      // signal.aborted is the whole reason this loop lives in your code and not in ours:
      // a cancelled request must not be retried, and only you hold the signal.
      if (attempt >= attempts || signal.aborted || !transient(error)) throw error

      const wait = retryAfter(error) ?? 2 ** attempt * 100
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
}

const controller = new AbortController()

// Build the request inside the callback so every attempt gets a fresh signal — one that has
// already fired stays fired, and `fetch` rejects an aborted signal before sending anything.
const result = await withRetry(
  () => air.get(`${server.url}/flaky`, { signal: controller.signal }),
  controller.signal,
)

// --- what it proves ---------------------------------------------------------------------

assert.deepEqual(result, { ok: true, attempts: 3 })
assert.equal(attempts, 3, 'retried the 429 and the 503, then succeeded')

// A deliberate cancellation is not a transient failure, however much the error looks like one.
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

console.log('retry: ok — honoured Retry-After, and did not retry a cancellation')
await server.close()
