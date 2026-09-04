import { vi } from 'vitest'

type Handler = (request: Request) => Response | Promise<Response>

/**
 * Stubs the global `fetch` with a double that builds the `Request` the transport would have
 * built and records it, so assertions read against a real `Request` rather than a bag of
 * arguments. Returns the recorded requests.
 *
 * The one place it does more than record: it rejects an already-aborted `signal` before
 * recording, because real `fetch` does. Added after a bug the mock had been hiding — a
 * signal shared by every request of a client looks fine when nothing enforces the check.
 * When the mock and the platform disagree, the mock is wrong.
 */
export function mockFetch(handler: Handler = () => json({})): Request[] {
  const requests: Request[] = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw init.signal.reason
      const request = new Request(new URL(url, 'https://mock.test'), init)
      requests.push(request)
      return handler(request)
    }),
  )

  return requests
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(data), { ...init, headers })
}

/** Never responds; rejects with the signal's reason when aborted, the way fetch does. */
export const stall: Handler = (request) =>
  new Promise((_, reject) => {
    const abort = () => {
      // Whatever the reason is — fetch rejects with it verbatim, and a test has to be able to
      // watch a custom `abort(reason)` come back out on `error.cause`.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      reject(request.signal.reason)
    }
    if (request.signal.aborted) abort()
    else request.signal.addEventListener('abort', abort)
  })
