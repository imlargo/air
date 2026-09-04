import { describe, expect, it, vi } from 'vitest'
import air from '../src/index.js'
import { json, mockFetch } from './mock.js'

// Captures the init handed to fetch, for the fields a `Request` does not expose.
function initSpy() {
  let seen: RequestInit | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      seen = init
      return Promise.resolve(json({}))
    }),
  )
  return () => seen
}

const emptyStream = () =>
  new ReadableStream({
    start: (controller) => {
      controller.close()
    },
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

  // The one header air overrides rather than defers to: no literal a caller could write is
  // ever a valid multipart Content-Type, because the boundary is generated at send time.
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

  // fetch refuses a ReadableStream body without it. A mock does not enforce that, which is
  // how this shipped broken once; examples/platform.mjs pins it against a real socket.
  it('marks a streaming body half-duplex, which fetch requires', async () => {
    const seen = initSpy()
    await air.post('https://api.test/upload', { body: emptyStream() })
    expect(seen()).toHaveProperty('duplex', 'half')
  })

  it('lets the caller override duplex', async () => {
    const seen = initSpy()
    await air.post('https://api.test/upload', { body: emptyStream(), duplex: 'half' })
    expect(seen()).toHaveProperty('duplex', 'half')
  })

  it('does not set duplex for ordinary bodies', async () => {
    const seen = initSpy()
    await air.post('https://api.test/a', { body: { a: 1 } })
    expect(seen()).not.toHaveProperty('duplex')
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
