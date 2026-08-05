import { afterEach, describe, expect, it, vi } from 'vitest'
import air, { AirError, isAirError } from '../src/index.js'
import { json, mockFetch, stall } from './mock.js'

afterEach(() => vi.unstubAllGlobals())

describe('requests', () => {
  it('parses a JSON response', async () => {
    mockFetch(() => json({ id: 1 }))
    await expect(air.get<{ id: number }>('https://api.test/users/1')).resolves.toEqual({
      id: 1,
    })
  })

  it('is callable directly', async () => {
    const requests = mockFetch()
    await air('https://api.test/users')
    expect(requests[0]!.method).toBe('GET')
  })

  it('infers the method from each shortcut', async () => {
    const requests = mockFetch()
    await air.post('https://api.test/a')
    await air.put('https://api.test/a')
    await air.patch('https://api.test/a')
    await air.delete('https://api.test/a')
    await air.head('https://api.test/a')
    await air.options('https://api.test/a')
    expect(requests.map((request) => request.method)).toEqual([
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'HEAD',
      'OPTIONS',
    ])
  })
})

describe('url', () => {
  it('joins baseURL and path without doubling slashes', async () => {
    const requests = mockFetch()
    const api = air.create({ baseURL: 'https://api.test/v1/' })
    await api.get('/users')
    expect(requests[0]!.url).toBe('https://api.test/v1/users')
  })

  it('keeps the baseURL path prefix', async () => {
    const requests = mockFetch()
    await air.get('users', { baseURL: 'https://api.test/v1' })
    expect(requests[0]!.url).toBe('https://api.test/v1/users')
  })

  it('ignores baseURL for absolute urls', async () => {
    const requests = mockFetch()
    await air.get('https://other.test/ping', { baseURL: 'https://api.test' })
    expect(requests[0]!.url).toBe('https://other.test/ping')
  })
})

describe('query', () => {
  it('preserves existing search params', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/search?q=air', { query: { page: 2 } })
    expect(requests[0]!.url).toBe('https://api.test/search?q=air&page=2')
  })

  it('drops undefined and null values', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/s', { query: { a: 1, b: undefined, c: null } })
    expect(requests[0]!.url).toBe('https://api.test/s?a=1')
  })

  it('repeats keys for arrays', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/s', { query: { tags: ['a', 'b'] } })
    expect(requests[0]!.url).toBe('https://api.test/s?tags=a&tags=b')
  })

  it('encodes values', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/s', { query: { q: 'a&b=c' } })
    expect(new URL(requests[0]!.url).searchParams.get('q')).toBe('a&b=c')
  })

  it('merges client defaults with per-request query', async () => {
    const requests = mockFetch()
    const api = air.create({ baseURL: 'https://api.test', query: { key: 'abc' } })
    await api.get('/s', { query: { page: 1 } })
    expect(requests[0]!.url).toBe('https://api.test/s?key=abc&page=1')
  })
})

describe('body', () => {
  it('serializes plain objects as JSON', async () => {
    const requests = mockFetch()
    await air.post('https://api.test/users', { body: { name: 'Ada' } })
    const request = requests[0]!
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.text()).resolves.toBe('{"name":"Ada"}')
  })

  it('serializes arrays as JSON', async () => {
    const requests = mockFetch()
    await air.post('https://api.test/users', { body: [1, 2] })
    await expect(requests[0]!.text()).resolves.toBe('[1,2]')
  })

  it('does not override an explicit content-type', async () => {
    const requests = mockFetch()
    await air.post('https://api.test/users', {
      body: { name: 'Ada' },
      headers: { 'content-type': 'application/merge-patch+json' },
    })
    expect(requests[0]!.headers.get('content-type')).toBe('application/merge-patch+json')
  })

  it('lets the runtime set the multipart boundary for FormData', async () => {
    const requests = mockFetch()
    const form = new FormData()
    form.set('name', 'Ada')
    await air.post('https://api.test/upload', { body: form })
    expect(requests[0]!.headers.get('content-type')).toMatch(
      /^multipart\/form-data; boundary=/,
    )
  })

  it('passes URLSearchParams through untouched', async () => {
    const requests = mockFetch()
    await air.post('https://api.test/token', { body: new URLSearchParams({ a: '1' }) })
    expect(requests[0]!.headers.get('content-type')).toBe(
      'application/x-www-form-urlencoded;charset=UTF-8',
    )
    await expect(requests[0]!.text()).resolves.toBe('a=1')
  })

  it('passes strings through untouched', async () => {
    const requests = mockFetch()
    await air.post('https://api.test/raw', { body: 'hello' })
    expect(requests[0]!.headers.get('content-type')).toBe('text/plain;charset=UTF-8')
    await expect(requests[0]!.text()).resolves.toBe('hello')
  })

  it('passes binary bodies through untouched', async () => {
    const requests = mockFetch()
    await air.post('https://api.test/raw', { body: new Uint8Array([1, 2, 3]) })
    expect(requests[0]!.headers.get('content-type')).toBeNull()
    await expect(requests[0]!.arrayBuffer()).resolves.toHaveProperty('byteLength', 3)
  })

  it('never sends a body on GET or HEAD', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/a', { body: { ignored: true } })
    await air.head('https://api.test/a', { body: { ignored: true } })
    expect(requests[0]!.body).toBeNull()
    expect(requests[1]!.body).toBeNull()
  })
})

describe('parsing', () => {
  it('resolves 204 to null', async () => {
    mockFetch(() => new Response(null, { status: 204 }))
    await expect(air.delete('https://api.test/users/1')).resolves.toBeNull()
  })

  it('resolves an empty body to null', async () => {
    mockFetch(() => new Response('', { headers: { 'content-type': 'application/json' } }))
    await expect(air.get('https://api.test/nothing')).resolves.toBeNull()
  })

  it('parses +json suffixes as JSON', async () => {
    mockFetch(
      () =>
        new Response('{"ok":true}', {
          headers: { 'content-type': 'application/vnd.api+json' },
        }),
    )
    await expect(air.get('https://api.test/a')).resolves.toEqual({ ok: true })
  })

  it('parses text/* as text', async () => {
    mockFetch(() => new Response('hi', { headers: { 'content-type': 'text/plain' } }))
    await expect(air.get('https://api.test/a')).resolves.toBe('hi')
  })

  it('falls back to a Blob for other content types', async () => {
    mockFetch(
      () =>
        new Response('x', { headers: { 'content-type': 'application/octet-stream' } }),
    )
    await expect(air.get('https://api.test/a')).resolves.toBeInstanceOf(Blob)
  })

  it('honours the parse override', async () => {
    mockFetch(() => json({ id: 1 }))
    await expect(air.get('https://api.test/a', { parse: 'text' })).resolves.toBe(
      '{"id":1}',
    )
  })

  it('wraps an unreadable body in an AirError', async () => {
    mockFetch(
      () => new Response('not json', { headers: { 'content-type': 'application/json' } }),
    )
    await expect(air.get('https://api.test/a')).rejects.toBeInstanceOf(AirError)
  })
})

describe('errors', () => {
  it('throws on non-2xx responses', async () => {
    mockFetch(() => json({ message: 'nope' }, { status: 404, statusText: 'Not Found' }))

    const error = await air.get('https://api.test/users/1').catch((e: unknown) => e)

    expect(isAirError(error)).toBe(true)
    const failure = error as AirError<{ message: string }>
    expect(failure.status).toBe(404)
    expect(failure.statusText).toBe('Not Found')
    expect(failure.data).toEqual({ message: 'nope' })
    expect(failure.response).toBeInstanceOf(Response)
    expect(failure.request.url).toBe('https://api.test/users/1')
  })

  it('surfaces network failures as AirError', async () => {
    mockFetch(() => Promise.reject(new TypeError('fetch failed')))
    const error = await air.get('https://api.test/a').catch((e: unknown) => e)
    expect(isAirError(error)).toBe(true)
    expect((error as AirError).status).toBeUndefined()
    expect((error as AirError).cause).toBeInstanceOf(TypeError)
  })

  it('surfaces timeouts as AirError', async () => {
    mockFetch(stall)
    const error = await air
      .get('https://api.test/slow', { timeout: 10 })
      .catch((e: unknown) => e)
    expect(isAirError(error)).toBe(true)
    expect((error as AirError).message).toContain('timed out')
  })

  it('surfaces aborts as AirError', async () => {
    mockFetch(stall)
    const controller = new AbortController()
    const pending = air.get('https://api.test/slow', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(AirError)
  })
})

describe('retry', () => {
  it('retries transient failures up to the given count', async () => {
    let attempts = 0
    const requests = mockFetch(() => {
      attempts++
      return attempts < 3 ? json({}, { status: 503 }) : json({ ok: true })
    })

    await expect(air.get('https://api.test/a', { retry: 2 })).resolves.toEqual({
      ok: true,
    })
    expect(requests).toHaveLength(3)
  })

  it('does not retry client errors', async () => {
    const requests = mockFetch(() => json({}, { status: 404 }))
    await expect(air.get('https://api.test/a', { retry: 2 })).rejects.toBeInstanceOf(
      AirError,
    )
    expect(requests).toHaveLength(1)
  })

  it('does not retry after an abort', async () => {
    const requests = mockFetch(stall)
    const controller = new AbortController()
    const pending = air.get('https://api.test/a', { signal: controller.signal, retry: 2 })
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(AirError)
    expect(requests).toHaveLength(1)
  })
})

describe('clients', () => {
  it('merges headers, with the request winning', async () => {
    const requests = mockFetch()
    const api = air.create({
      baseURL: 'https://api.test',
      headers: { Authorization: 'Bearer 1', 'X-Client': 'air' },
    })

    await api.get('/me', { headers: { Authorization: 'Bearer 2' } })

    expect(requests[0]!.headers.get('authorization')).toBe('Bearer 2')
    expect(requests[0]!.headers.get('x-client')).toBe('air')
  })

  it('inherits defaults when derived from another client', async () => {
    const requests = mockFetch()
    const api = air.create({
      baseURL: 'https://api.test',
      headers: { 'X-Client': 'air' },
    })
    const admin = api.create({ headers: { 'X-Scope': 'admin' } })

    await admin.get('/me')

    expect(requests[0]!.url).toBe('https://api.test/me')
    expect(requests[0]!.headers.get('x-client')).toBe('air')
    expect(requests[0]!.headers.get('x-scope')).toBe('admin')
  })

  it('forwards unknown options to fetch', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/a', { credentials: 'include', redirect: 'manual' })
    expect(requests[0]!.redirect).toBe('manual')
  })
})
