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

  it('treats a leading double slash as a path, not as a host', async () => {
    const requests = mockFetch()
    await air.get('//assets/logo.png', { baseURL: 'https://api.test' })
    expect(requests[0]!.url).toBe('https://api.test/assets/logo.png')
  })

  it('joins a bare path to a bare baseURL', async () => {
    const requests = mockFetch()
    await air.get('users', { baseURL: 'https://api.test' })
    expect(requests[0]!.url).toBe('https://api.test/users')
  })

  it('collapses slashes from both sides', async () => {
    const requests = mockFetch()
    await air.get('///users', { baseURL: 'https://api.test///' })
    expect(requests[0]!.url).toBe('https://api.test/users')
  })

  it('lets a request override the client baseURL', async () => {
    const requests = mockFetch()
    const api = air.create({ baseURL: 'https://api.test' })
    await api.get('/ping', { baseURL: 'https://other.test' })
    expect(requests[0]!.url).toBe('https://other.test/ping')
  })

  it('accepts a URL instance as the request target', async () => {
    const requests = mockFetch()
    await air.get(new URL('https://api.test/users/1'))
    expect(requests[0]!.url).toBe('https://api.test/users/1')
  })

  it('merges query onto a URL instance', async () => {
    const requests = mockFetch()
    await air.get(new URL('https://api.test/s?existing=1'), { query: { page: 2 } })
    expect(requests[0]!.url).toBe('https://api.test/s?existing=1&page=2')
  })

  it('ignores baseURL when the target is a URL instance', async () => {
    const requests = mockFetch()
    await air.get(new URL('https://other.test/ping'), { baseURL: 'https://api.test' })
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

  it('keeps falsy values that are not null or undefined', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/s', { query: { active: false, count: 0, q: '' } })
    expect(requests[0]!.url).toBe('https://api.test/s?active=false&count=0&q=')
  })

  it('drops empty arrays', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/s', { query: { tags: [], page: 1 } })
    expect(requests[0]!.url).toBe('https://api.test/s?page=1')
  })

  it('appends to an existing key instead of replacing it', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/s?tags=a', { query: { tags: 'b' } })
    expect(requests[0]!.url).toBe('https://api.test/s?tags=a&tags=b')
  })

  it('keeps the hash at the end', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/s#results', { query: { page: 2 } })
    expect(requests[0]!.url).toBe('https://api.test/s?page=2#results')
  })

  it('lets a request override a client default with the same key', async () => {
    const requests = mockFetch()
    const api = air.create({ query: { page: 1, key: 'abc' } })
    await api.get('https://api.test/s', { query: { page: 9 } })
    expect(requests[0]!.url).toBe('https://api.test/s?page=9&key=abc')
  })

  it('rejects values it cannot serialize meaningfully', async () => {
    mockFetch()
    await air.get('https://api.test/s', {
      // @ts-expect-error a Date has no obvious serialization — pass an ISO string
      query: { when: new Date(0) },
    })
  })

  it('merges client defaults with per-request query', async () => {
    const requests = mockFetch()
    const api = air.create({ baseURL: 'https://api.test', query: { key: 'abc' } })
    await api.get('/s', { query: { page: 1 } })
    expect(requests[0]!.url).toBe('https://api.test/s?key=abc&page=1')
  })

  it('leaves an existing search string byte-for-byte alone when no query is involved', async () => {
    const requests = mockFetch()
    // Re-parsing and re-serializing through URLSearchParams would turn %20 into +,
    // even with nothing to actually merge — this must not happen just because
    // `options` was passed for an unrelated reason (headers, here).
    await air.get('https://api.test/s?msg=hola%20mundo', { headers: { 'X-Test': '1' } })
    expect(requests[0]!.url).toBe('https://api.test/s?msg=hola%20mundo')
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

  it('discards a caller-supplied content-type for FormData', async () => {
    const requests = mockFetch()
    const form = new FormData()
    form.set('name', 'Ada')
    await air.post('https://api.test/upload', {
      body: form,
      headers: { 'content-type': 'multipart/form-data' },
    })
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

  it('marks a streaming body half-duplex, which fetch requires', async () => {
    let seen: RequestInit | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        seen = init
        return json({})
      }),
    )
    const stream = new ReadableStream({
      start: (c) => {
        c.close()
      },
    })

    await air.post('https://api.test/upload', { body: stream })

    expect(seen).toHaveProperty('duplex', 'half')
  })

  it('lets the caller override duplex', async () => {
    let seen: RequestInit | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        seen = init
        return json({})
      }),
    )
    const stream = new ReadableStream({
      start: (c) => {
        c.close()
      },
    })

    await air.post('https://api.test/upload', { body: stream, duplex: 'half' })

    expect(seen).toHaveProperty('duplex', 'half')
  })

  it('does not set duplex for ordinary bodies', async () => {
    let seen: RequestInit | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        seen = init
        return json({})
      }),
    )

    await air.post('https://api.test/a', { body: { a: 1 } })

    expect(seen).not.toHaveProperty('duplex')
  })

  it('sends no body for null or undefined', async () => {
    const requests = mockFetch()
    await air.post('https://api.test/a', { body: null })
    await air.post('https://api.test/a', { body: undefined })
    expect(requests[0]!.body).toBeNull()
    expect(requests[1]!.body).toBeNull()
    expect(requests[0]!.headers.get('content-type')).toBeNull()
  })

  it('uppercases the method', async () => {
    const requests = mockFetch()
    await air('https://api.test/a', { method: 'post', body: { a: 1 } })
    expect(requests[0]!.method).toBe('POST')
    await expect(requests[0]!.text()).resolves.toBe('{"a":1}')
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

  it('resolves an empty body to null whatever the content type', async () => {
    mockFetch(() => new Response(null, { status: 200 }))
    await expect(air.get('https://api.test/a')).resolves.toBeNull()
  })

  it('parses as a Blob on request', async () => {
    mockFetch(() => json({ id: 1 }))
    const blob = await air.get<Blob>('https://api.test/a', { parse: 'blob' })
    expect(blob).toBeInstanceOf(Blob)
    await expect(blob.text()).resolves.toBe('{"id":1}')
  })

  it('parses as an ArrayBuffer on request', async () => {
    mockFetch(() => new Response(new Uint8Array([1, 2, 3])))
    const buffer = await air.get<ArrayBuffer>('https://api.test/a', {
      parse: 'arrayBuffer',
    })
    expect(buffer).toBeInstanceOf(ArrayBuffer)
    expect(buffer.byteLength).toBe(3)
  })

  it('resolves an empty body to null for blob and arrayBuffer too', async () => {
    mockFetch(() => new Response(null, { status: 200 }))
    await expect(air.get('https://api.test/a', { parse: 'blob' })).resolves.toBeNull()
    await expect(
      air.get('https://api.test/a', { parse: 'arrayBuffer' }),
    ).resolves.toBeNull()
  })

  it('hands back the Response even on 204', async () => {
    mockFetch(() => new Response(null, { status: 204 }))
    const response = await air.get<Response>('https://api.test/a', { parse: 'response' })
    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(204)
  })

  it('hands back the raw Response when asked', async () => {
    mockFetch(() => json({ id: 1 }, { headers: { 'x-total': '42' } }))

    const response = await air.get<Response>('https://api.test/a', { parse: 'response' })

    expect(response).toBeInstanceOf(Response)
    expect(response.headers.get('x-total')).toBe('42')
    await expect(response.json()).resolves.toEqual({ id: 1 })
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

  it('trims its own internal frame from the stack trace', async () => {
    mockFetch(() => json({}, { status: 500 }))
    const error = await air.get('https://api.test/a').catch((e: unknown) => e)
    if (Error.captureStackTrace) {
      expect((error as AirError).stack).not.toMatch(/\bat request\b/)
    }
  })

  it('still throws when the error body cannot be parsed', async () => {
    mockFetch(
      () =>
        new Response('<html>oops</html>', {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
    )

    const error = await air.get('https://api.test/a').catch((e: unknown) => e)

    expect(isAirError(error)).toBe(true)
    expect((error as AirError).status).toBe(500)
    expect((error as AirError).data).toBeUndefined()
  })

  it('reports the final url, query string included', async () => {
    mockFetch(() => json({}, { status: 400 }))
    const api = air.create({ baseURL: 'https://api.test' })

    const error = await api.get('/s', { query: { page: 2 } }).catch((e: unknown) => e)

    expect((error as AirError).request.url).toBe('https://api.test/s?page=2')
    expect((error as AirError).message).toContain('https://api.test/s?page=2')
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
      .get('https://api.test/slow', { signal: AbortSignal.timeout(10) })
      .catch((e: unknown) => e)
    expect(isAirError(error)).toBe(true)
    expect((error as AirError).message).toContain('timed out')
  })

  it('surfaces aborts as AirError', async () => {
    mockFetch(stall)
    const controller = new AbortController()
    const pending = air.get('https://api.test/slow', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow(/was aborted/)
  })

  it('recognises errors from another copy of the package', () => {
    expect(isAirError({ [Symbol.for('air.error')]: true })).toBe(true)
    expect(isAirError(new Error('boom'))).toBe(false)
    expect(isAirError(null)).toBe(false)
  })
})

describe('signals', () => {
  it('hands the signal to fetch untouched', async () => {
    const controller = new AbortController()
    let seen: RequestInit | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        seen = init
        return json({})
      }),
    )

    await air.get('https://api.test/a', { signal: controller.signal })

    expect(seen?.signal).toBe(controller.signal)
  })

  it('aborts a slow body read', async () => {
    const controller = new AbortController()
    mockFetch(
      (request) =>
        new Response(
          new ReadableStream({
            start: (stream) => {
              stream.enqueue(new TextEncoder().encode('{"a":'))
              request.signal.addEventListener('abort', () =>
                stream.error(request.signal.reason),
              )
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    )

    const pending = air.get('https://api.test/slow', { signal: controller.signal })
    setTimeout(() => controller.abort(), 10)

    await expect(pending).rejects.toThrow(/was aborted/)
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

  it('merges every HeadersInit shape', async () => {
    const requests = mockFetch()
    const api = air.create({ headers: new Headers({ 'X-Client': 'air' }) })

    await api.get('https://api.test/a', { headers: [['X-Scope', 'admin']] })

    expect(requests[0]!.headers.get('x-client')).toBe('air')
    expect(requests[0]!.headers.get('x-scope')).toBe('admin')
  })

  it('re-evaluates a header function on every request', async () => {
    const requests = mockFetch()
    let token = 'first'
    const api = air.create({ headers: () => ({ Authorization: `Bearer ${token}` }) })

    await api.get('https://api.test/a')
    token = 'second'
    await api.get('https://api.test/a')

    expect(requests[0]!.headers.get('authorization')).toBe('Bearer first')
    expect(requests[1]!.headers.get('authorization')).toBe('Bearer second')
  })

  it('awaits an async header function', async () => {
    const requests = mockFetch()
    const api = air.create({
      headers: async () => {
        await Promise.resolve()
        return { Authorization: 'Bearer async-token' }
      },
    })

    await api.get('https://api.test/a')

    expect(requests[0]!.headers.get('authorization')).toBe('Bearer async-token')
  })

  it('combines a client header function with a static request header', async () => {
    const requests = mockFetch()
    let token = 'first'
    const api = air.create({ headers: () => ({ Authorization: `Bearer ${token}` }) })

    await api.get('https://api.test/a', { headers: { 'X-Client': 'air' } })
    token = 'second'
    await api.get('https://api.test/a', { headers: { 'X-Client': 'air' } })

    expect(requests[0]!.headers.get('authorization')).toBe('Bearer first')
    expect(requests[0]!.headers.get('x-client')).toBe('air')
    expect(requests[1]!.headers.get('authorization')).toBe('Bearer second')
  })

  it('keeps every header source lazy through a chain of create() calls', async () => {
    const requests = mockFetch()
    let token = 'first'
    const base = air.create({ headers: () => ({ Authorization: `Bearer ${token}` }) })
    const admin = base.create({ headers: () => ({ 'X-Scope': 'admin' }) })

    await admin.get('https://api.test/a')
    token = 'second'
    await admin.get('https://api.test/a')

    expect(requests[0]!.headers.get('authorization')).toBe('Bearer first')
    expect(requests[0]!.headers.get('x-scope')).toBe('admin')
    expect(requests[1]!.headers.get('authorization')).toBe('Bearer second')
  })

  it('creates an empty client', async () => {
    const requests = mockFetch()
    const api = air.create()
    await api.get('https://api.test/a')
    expect(requests[0]!.url).toBe('https://api.test/a')
  })

  it('leaves the parent client untouched when deriving', async () => {
    const requests = mockFetch()
    const api = air.create({
      baseURL: 'https://api.test',
      headers: { 'X-Client': 'air' },
    })
    api.create({ baseURL: 'https://other.test', headers: { 'X-Client': 'derived' } })

    await api.get('/a')

    expect(requests[0]!.url).toBe('https://api.test/a')
    expect(requests[0]!.headers.get('x-client')).toBe('air')
  })

  it('carries client defaults into a parse override', async () => {
    mockFetch(() => json({ id: 1 }))
    const api = air.create({ parse: 'text' })
    await expect(api.get('https://api.test/a')).resolves.toBe('{"id":1}')
  })

  it('forwards unknown options to fetch', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/a', { credentials: 'include', redirect: 'manual' })
    expect(requests[0]!.redirect).toBe('manual')
  })
})
