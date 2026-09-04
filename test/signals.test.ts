import { describe, expect, it, vi } from 'vitest'
import air from '../src/index.js'
import { json, mockFetch, stall } from './mock.js'

// Collects the signal handed to fetch on each call, which is the whole subject of most
// tests here: one instance per request, or one shared by all of them.
function signalSpy() {
  const seen: (AbortSignal | null | undefined)[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      seen.push(init?.signal)
      return Promise.resolve(json({}))
    }),
  )
  return seen
}

describe('signals', () => {
  it('hands the signal to fetch untouched', async () => {
    const controller = new AbortController()
    const seen = signalSpy()

    await air.get('https://api.test/a', { signal: controller.signal })

    expect(seen[0]).toBe(controller.signal)
  })

  it('aborts a slow body read', async () => {
    const controller = new AbortController()
    mockFetch(
      (request) =>
        new Response(
          new ReadableStream({
            start: (stream) => {
              stream.enqueue(new TextEncoder().encode('{"a":'))
              request.signal.addEventListener('abort', () => {
                stream.error(request.signal.reason)
              })
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    )

    const pending = air.get('https://api.test/slow', { signal: controller.signal })
    setTimeout(() => {
      controller.abort()
    }, 10)

    await expect(pending).rejects.toThrow(/was aborted/)
  })

  it('resolves a signal function on every request', async () => {
    const seen = signalSpy()
    const api = air.create({ signal: () => AbortSignal.timeout(1000) })

    await api.get('https://api.test/a')
    await api.get('https://api.test/b')

    expect(seen).toHaveLength(2)
    expect(seen[0]).toBeInstanceOf(AbortSignal)
    expect(seen[1]).toBeInstanceOf(AbortSignal)
    expect(seen[0]).not.toBe(seen[1])
  })

  // The bug this option exists for: a bare AbortSignal.timeout() in a client's
  // defaults is one instance shared by every request, so once it fires the client
  // is dead — every later request rejects instantly, without being sent.
  it('gives each request its own timeout, so a fired one does not poison the next', async () => {
    mockFetch((request) =>
      request.url.endsWith('/slow') ? stall(request) : json({ ok: 1 }),
    )
    const api = air.create({ signal: () => AbortSignal.timeout(20) })

    await expect(api.get('https://api.test/slow')).rejects.toThrow(/timed out/)
    await expect(api.get<{ ok: number }>('https://api.test/fast')).resolves.toEqual({
      ok: 1,
    })
  })

  it('lets a request override the client signal', async () => {
    const seen = signalSpy()
    const controller = new AbortController()
    const api = air.create({ signal: () => AbortSignal.timeout(1000) })

    await api.get('https://api.test/a', { signal: controller.signal })

    expect(seen[0]).toBe(controller.signal)
  })

  it('sends no signal when the function returns nothing', async () => {
    const seen = signalSpy()

    await air.get('https://api.test/a', { signal: () => undefined })

    expect(seen[0]).toBeUndefined()
  })

  it('lets a request opt out of the client signal with null', async () => {
    const seen = signalSpy()
    const api = air.create({ signal: () => AbortSignal.timeout(1000) })

    await api.get('https://api.test/a', { signal: null })

    expect(seen[0]).toBeNull()
  })

  it('stays lazy through a chain of create() calls', async () => {
    const seen = signalSpy()
    const source = vi.fn(() => AbortSignal.timeout(1000))
    const base = air.create({ signal: source })
    const admin = base.create({ headers: { 'X-Scope': 'admin' } })

    expect(source).not.toHaveBeenCalled()

    await admin.get('https://api.test/a')
    await admin.get('https://api.test/b')

    expect(source).toHaveBeenCalledTimes(2)
    expect(seen[0]).not.toBe(seen[1])
  })

  // A timeout budget should cover the request, not the token refresh that ran
  // before it, so the signal is resolved after the headers are.
  it('resolves the signal after an async header function', async () => {
    const order: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        order.push('fetch')
        return Promise.resolve(json({}))
      }),
    )

    await air.get('https://api.test/a', {
      headers: async () => {
        await Promise.resolve()
        order.push('headers')
        return {}
      },
      signal: () => {
        order.push('signal')
        return AbortSignal.timeout(1000)
      },
    })

    expect(order).toEqual(['headers', 'signal', 'fetch'])
  })
})
