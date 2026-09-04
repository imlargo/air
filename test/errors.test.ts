import { describe, expect, it } from 'vitest'
import air, { AirError, isAirError } from '../src/index.js'
import { json, mockFetch, stall } from './mock.js'

async function rejection(pending: Promise<unknown>): Promise<AirError> {
  const error: unknown = await pending.then(
    () => undefined,
    (e: unknown) => e,
  )
  if (!isAirError(error)) throw new Error('expected an AirError')
  return error
}

describe('errors', () => {
  it('throws on non-2xx responses', async () => {
    mockFetch(() => json({ message: 'nope' }, { status: 404, statusText: 'Not Found' }))

    const error = await rejection(air.get('https://api.test/users/1'))

    expect(error).toBeInstanceOf(AirError)
    expect(error.name).toBe('AirError')
    expect(error.message).toBe('GET https://api.test/users/1 failed with 404 Not Found')
    expect(error.status).toBe(404)
    expect(error.statusText).toBe('Not Found')
    expect(error.data).toEqual({ message: 'nope' })
    expect(error.response).toBeInstanceOf(Response)
    expect(error.request.url).toBe('https://api.test/users/1')
  })

  it('hands back a response whose body is already read into data', async () => {
    mockFetch(() => json({ message: 'nope' }, { status: 422 }))
    const error = await rejection(air.get('https://api.test/a'))
    expect(error.response?.bodyUsed).toBe(true)
  })

  it('reports the headers as actually sent, not the source that produced them', async () => {
    mockFetch(() => json({}, { status: 401 }))
    const api = air.create({ headers: () => ({ Authorization: 'Bearer resolved' }) })

    const { request } = await rejection(
      api.post('https://api.test/a', { body: { a: 1 } }),
    )

    expect(typeof request.options.headers).toBe('function')
    expect(request.headers.get('authorization')).toBe('Bearer resolved')
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(request.method).toBe('POST')
  })

  it('trims its own internal frame from the stack trace', async () => {
    mockFetch(() => json({}, { status: 500 }))
    const error = await rejection(air.get('https://api.test/a'))
    if (Error.captureStackTrace) {
      expect(error.stack).not.toMatch(/\bat request\b/)
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

    const error = await rejection(air.get('https://api.test/a'))

    expect(error.status).toBe(500)
    expect(error.data).toBeUndefined()
  })

  it('reports the final url, query string included', async () => {
    mockFetch(() => json({}, { status: 400 }))
    const api = air.create({ baseURL: 'https://api.test' })

    const error = await rejection(api.get('/s', { query: { page: 2 } }))

    expect(error.request.url).toBe('https://api.test/s?page=2')
    expect(error.message).toBe('GET https://api.test/s?page=2 failed with 400')
  })

  it('surfaces network failures as AirError', async () => {
    mockFetch(() => Promise.reject(new TypeError('fetch failed')))
    const error = await rejection(air.get('https://api.test/a'))
    expect(error.status).toBeUndefined()
    expect(error.response).toBeUndefined()
    expect(error.cause).toBeInstanceOf(TypeError)
    expect(error.message).toBe('GET https://api.test/a failed: fetch failed')
  })

  it('surfaces timeouts as AirError', async () => {
    mockFetch(stall)
    const error = await rejection(
      air.get('https://api.test/slow', { signal: AbortSignal.timeout(10) }),
    )
    expect(error.message).toBe('GET https://api.test/slow timed out')
    expect(error.cause).toMatchObject({ name: 'TimeoutError' })
  })

  it('surfaces aborts as AirError', async () => {
    mockFetch(stall)
    const controller = new AbortController()
    const pending = air.get('https://api.test/slow', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow(/was aborted/)
  })

  it('reports a custom abort reason as the failure it describes', async () => {
    mockFetch(stall)
    const controller = new AbortController()
    const pending = air.get('https://api.test/slow', { signal: controller.signal })
    const reason = new Error('user navigated away')
    controller.abort(reason)

    const error = await rejection(pending)

    expect(error.message).toBe('GET https://api.test/slow failed: user navigated away')
    expect(error.cause).toBe(reason)
  })

  it('recognises errors from another copy of the package', () => {
    expect(isAirError({ [Symbol.for('air.error')]: true })).toBe(true)
    expect(isAirError(new Error('boom'))).toBe(false)
    expect(isAirError(null)).toBe(false)
  })
})
