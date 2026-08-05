import { vi } from 'vitest'

type Handler = (request: Request) => Response | Promise<Response>

export function mockFetch(handler: Handler = () => json({})) {
  const requests: Request[] = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
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
    request.signal.addEventListener('abort', () => reject(request.signal.reason))
  })
