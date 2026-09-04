import { describe, expect, it, vi } from 'vitest'
import air from '../src/index.js'
import type { Fetch } from '../src/index.js'
import { json, mockFetch } from './mock.js'

function spyFetch(response: () => Response = () => json({})) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = vi.fn((url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve(response())
  })
  return { fetch, calls }
}

describe('fetch', () => {
  it('uses an injected fetch instead of the global one', async () => {
    const globalRequests = mockFetch()
    const local = spyFetch(() => json({ id: 1 }))

    await expect(
      air.get<{ id: number }>('https://api.test/users/1', { fetch: local.fetch }),
    ).resolves.toEqual({ id: 1 })

    expect(local.calls[0]!.url).toBe('https://api.test/users/1')
    expect(globalRequests).toHaveLength(0)
  })

  it('binds a fetch to a client, for a whole request-scoped service', async () => {
    mockFetch()
    const local = spyFetch()
    const api = air.create({ baseURL: 'https://api.test', fetch: local.fetch })

    await api.get('/users')
    await api.post('/users', { body: { name: 'Ada' } })

    expect(local.calls.map((call) => call.url)).toEqual([
      'https://api.test/users',
      'https://api.test/users',
    ])
    expect(local.calls[1]!.init.method).toBe('POST')
  })

  it('inherits through a chain of create() calls', async () => {
    mockFetch()
    const local = spyFetch()
    const api = air.create({ fetch: local.fetch })
    const admin = api.create({ headers: { 'X-Scope': 'admin' } })

    await admin.get('https://api.test/me')

    expect(local.calls).toHaveLength(1)
    expect(new Headers(local.calls[0]!.init.headers).get('x-scope')).toBe('admin')
  })

  it('lets a request override the client fetch', async () => {
    mockFetch()
    const client = spyFetch()
    const once = spyFetch()
    const api = air.create({ fetch: client.fetch })

    await api.get('https://api.test/a', { fetch: once.fetch })

    expect(once.calls).toHaveLength(1)
    expect(client.calls).toHaveLength(0)
  })

  it('lets a request fall back to the global fetch with an explicit undefined', async () => {
    const globalRequests = mockFetch()
    const client = spyFetch()
    const api = air.create({ fetch: client.fetch })

    await api.get('https://api.test/a', { fetch: undefined })

    expect(client.calls).toHaveLength(0)
    expect(globalRequests).toHaveLength(1)
  })

  it('passes a relative url through untouched', async () => {
    const local = spyFetch()

    await air.get('/api/users', { fetch: local.fetch, query: { page: 2 } })

    expect(local.calls[0]!.url).toBe('/api/users?page=2')
  })

  it('accepts anything shaped like the global fetch', async () => {
    const requests = mockFetch()
    const framework: Fetch = globalThis.fetch

    await air.get('https://api.test/a', { fetch: framework })

    expect(requests).toHaveLength(1)
  })

  it('does not leak the option into the init it hands to fetch', async () => {
    const local = spyFetch()

    await air.get('https://api.test/a', { fetch: local.fetch })

    expect(local.calls[0]!.init).not.toHaveProperty('fetch')
  })

  it('reports a failing injected fetch like any other transport error', async () => {
    const local = spyFetch()
    local.fetch.mockRejectedValueOnce(new Error('socket hang up'))

    await expect(
      air.get('https://api.test/a', { fetch: local.fetch }),
    ).rejects.toMatchObject({
      name: 'AirError',
      message: 'GET https://api.test/a failed: socket hang up',
    })
  })

  it('throws on a non-2xx from an injected fetch', async () => {
    const local = spyFetch(() => json({ error: 'nope' }, { status: 403 }))

    await expect(
      air.get('https://api.test/a', { fetch: local.fetch }),
    ).rejects.toMatchObject({ status: 403, data: { error: 'nope' } })
  })
})
