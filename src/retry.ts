import type { Fetch } from './types.js'

export interface RetryOptions {
  /**
   * Total attempts, the first one included.
   *
   * @defaultValue 3
   */
  attempts?: number
  /**
   * Methods that may be retried.
   *
   * @defaultValue The idempotent ones: `GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE`.
   */
  methods?: readonly string[]
  /**
   * Response statuses that trigger a retry. A network failure always does.
   *
   * @defaultValue `[408, 425, 429, 500, 502, 503, 504]`
   */
  statuses?: readonly number[]
  /**
   * Milliseconds to wait after failed attempt `attempt`, counting from 1. Not consulted when
   * the response carries a `Retry-After` header, which wins and is honoured in full; the
   * caller's `signal` is what caps a long one.
   *
   * @defaultValue Full jitter over an exponential ceiling: a random wait up to 200 ms, then
   * up to 400 ms, 800 ms, ...
   */
  delay?: (attempt: number) => number
  /**
   * The function that sends each attempt.
   *
   * @defaultValue The global `fetch`, resolved when the request is made.
   */
  fetch?: Fetch
}

const IDEMPOTENT = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']
const TRANSIENT = [408, 425, 429, 500, 502, 503, 504]

// Full jitter: a synchronized burst of failures does not become a synchronized burst of retries.
const exponential = (attempt: number): number => Math.random() * 100 * 2 ** attempt

/**
 * A `fetch` that retries transient failures.
 *
 * @remarks
 * A request is retried only if its method is in `methods` and its body is not a
 * `ReadableStream`, which the first attempt consumes. A request whose `signal` has fired is
 * never retried, whatever the error says, and the wait between attempts ends early when the
 * signal fires. The last response is returned as-is, so a still-failing status surfaces as a
 * normal error.
 *
 * @example
 * ```ts
 * const api = air.create({ fetch: retry({ attempts: 5 }) })
 * ```
 */
export function retry(options: RetryOptions = {}): Fetch {
  const {
    attempts = 3,
    methods = IDEMPOTENT,
    statuses = TRANSIENT,
    delay = exponential,
    fetch: send,
  } = options

  return async (url, init) => {
    const next = send ?? fetch
    const method = (init.method ?? 'GET').toUpperCase()
    const retriable = methods.includes(method) && !(init.body instanceof ReadableStream)

    for (let attempt = 1; ; attempt++) {
      const last = !retriable || attempt >= attempts
      let response: Response
      try {
        response = await next(url, init)
      } catch (error) {
        if (last || init.signal?.aborted) throw error
        await sleep(delay(attempt), init.signal)
        continue
      }
      if (last || !statuses.includes(response.status)) return response
      await response.body?.cancel()
      await sleep(retryAfter(response) ?? delay(attempt), init.signal)
    }
  }
}

// Seconds or an HTTP date; anything else defers to `delay`.
function retryAfter(response: Response): number | undefined {
  const header = response.headers.get('retry-after')
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(header)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

// Resolves after `ms`, or rejects with the signal's reason the moment it fires.
function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancel = () => {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the signal's reason, as fetch rejects with
      reject(signal?.reason)
    }
    if (signal?.aborted) {
      cancel()
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    const abort = () => {
      clearTimeout(timer)
      cancel()
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}
