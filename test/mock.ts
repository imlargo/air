import { vi } from 'vitest'

type Handler = (request: Request) => Response | Promise<Response>

// Like the real fetch, rejects an already-aborted signal before recording anything.
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

export const stall: Handler = (request) =>
  new Promise((_, reject) => {
    const abort = () => {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- matches fetch
      reject(request.signal.reason)
    }
    if (request.signal.aborted) abort()
    else request.signal.addEventListener('abort', abort)
  })
