import type { Fetch } from './types.js'

export interface RefreshOptions {
  /**
   * Produces the headers the retry is sent with, typically a renewed `Authorization`. Called
   * once per burst of failures, however many requests fail at the same time; the result is
   * shared by all of them. Storing the new credential for later requests is this function's
   * job too.
   */
  headers: () => HeadersInit | Promise<HeadersInit>
  /**
   * Statuses that trigger a refresh.
   *
   * @defaultValue `[401]`
   */
  statuses?: readonly number[]
  /**
   * The function that sends the request and its retry.
   *
   * @defaultValue The global `fetch`, resolved when the request is made.
   */
  fetch?: Fetch
}

/**
 * A `fetch` that refreshes credentials on a `401` and sends the request once more.
 *
 * @remarks
 * The retry is sent exactly once, so a credential that is still rejected surfaces as a normal
 * error rather than a loop. It carries the original `signal`, so it shares the original
 * deadline. A `ReadableStream` body is consumed by the first attempt and is not retried.
 *
 * @example
 * ```ts
 * const api = air.create({
 *   headers: () => ({ Authorization: `Bearer ${session.token}` }),
 *   fetch: refresh({
 *     headers: async () => {
 *       session.token = await renewToken()
 *       return { Authorization: `Bearer ${session.token}` }
 *     },
 *   }),
 * })
 * ```
 */
export function refresh(options: RefreshOptions): Fetch {
  const { headers: renew, statuses = [401], fetch: send } = options
  let inFlight: Promise<HeadersInit> | null = null
  const once = () =>
    (inFlight ??= Promise.resolve()
      .then(renew)
      .finally(() => {
        inFlight = null
      }))

  return async (url, init) => {
    const next = send ?? fetch
    const response = await next(url, init)
    if (!statuses.includes(response.status) || init.body instanceof ReadableStream) {
      return response
    }

    await response.body?.cancel()
    const fresh = await once()
    const headers = new Headers(init.headers)
    new Headers(fresh).forEach((value, key) => {
      headers.set(key, value)
    })
    return next(url, { ...init, headers })
  }
}
