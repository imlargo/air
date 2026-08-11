import { vi } from 'vitest'

type Handler = (request: Request) => Response | Promise<Response>

export function mockFetch(handler: Handler = () => json({})) {
  const requests: Request[] = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      // Real fetch rejects an already-fired signal before it sends anything, and a
      // mock that skips this check cannot see a whole class of bug — a signal shared
      // by every request of a long-lived client looks fine here and fails in
      // production the moment it fires. Verified against Node's fetch: a settled
      // AbortSignal.timeout rejects with its own TimeoutError, no connection made.
      if (init?.signal?.aborted) throw init.signal.reason
      const request = new Request(new URL(url, 'https://mock.test'), init)
      requests.push(request)
      return handler(request)
    }),
  )

  return requests
}

export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
}

export const stall: Handler = (request) =>
  new Promise((_, reject) => {
    if (request.signal.aborted) return reject(request.signal.reason)
    request.signal.addEventListener('abort', () => reject(request.signal.reason))
  })
