import { describe, expect, it } from 'vitest'
import air, { create } from '../src/index.js'
import { json, mockFetch } from './mock.js'

describe('requests', () => {
  it('parses a JSON response', async () => {
    mockFetch(() => json({ id: 1 }))
    await expect(air.get<{ id: number }>('https://api.test/users/1')).resolves.toEqual({
      id: 1,
    })
  })

  it('is callable directly, as a GET', async () => {
    const requests = mockFetch()
    await air('https://api.test/users')
    expect(requests[0]!.method).toBe('GET')
  })

  it('infers the method from each shortcut', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/a')
    await air.post('https://api.test/a')
    await air.put('https://api.test/a')
    await air.patch('https://api.test/a')
    await air.delete('https://api.test/a')
    await air.head('https://api.test/a')
    await air.options('https://api.test/a')
    expect(requests.map((request) => request.method)).toEqual([
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'HEAD',
      'OPTIONS',
    ])
  })

  it('lets a shortcut win over a method in the options', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/a', { method: 'POST' })
    expect(requests[0]!.method).toBe('GET')
  })

  it('forwards an unrecognised method as written', async () => {
    const requests = mockFetch()
    await air('https://api.test/a', { method: 'QUERY' })
    expect(requests[0]!.method).toBe('QUERY')
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

  it('drops an inherited header when a request sets it to null', async () => {
    const requests = mockFetch()
    const api = air.create({
      headers: { Authorization: 'Bearer secret', 'X-Keep': 'yes' },
    })
    await api.get('https://api.test/public', { headers: { Authorization: null } })
    expect(requests[0]!.headers.get('authorization')).toBeNull()
    expect(requests[0]!.headers.get('x-keep')).toBe('yes')
  })

  it('lets a derived client become anonymous', async () => {
    const requests = mockFetch()
    const api = air.create({
      baseURL: 'https://api.test',
      headers: () => ({ Authorization: 'Bearer secret' }),
    })
    const anonymous = api.create({ headers: { Authorization: null } })
    await anonymous.get('/public')
    expect(requests[0]!.headers.get('authorization')).toBeNull()
    expect(requests[0]!.url).toBe('https://api.test/public')
  })

  it('honours null in defaults handed straight to create()', async () => {
    const requests = mockFetch()
    const api = create({ headers: { Authorization: null, 'X-Keep': 'yes' } })
    await api.get('https://api.test/public')
    expect(requests[0]!.headers.get('authorization')).toBeNull()
    expect(requests[0]!.headers.get('x-keep')).toBe('yes')
  })

  it('treats null on a header nobody set as a no-op', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/a', { headers: { 'X-Absent': null } })
    expect(requests[0]!.headers.get('x-absent')).toBeNull()
  })

  it('drops a header a function put there', async () => {
    const requests = mockFetch()
    const api = air.create({
      headers: () => Promise.resolve({ Authorization: 'Bearer secret' }),
    })
    await api.get('https://api.test/public', { headers: () => ({ Authorization: null }) })
    expect(requests[0]!.headers.get('authorization')).toBeNull()
  })

  it('drops rather than sends the string undefined', async () => {
    const requests = mockFetch()
    const api = air.create({ headers: { Authorization: 'Bearer secret' } })
    await api.get('https://api.test/public', { headers: { Authorization: undefined } })
    expect(requests[0]!.headers.get('authorization')).toBeNull()
  })

  it('sets a header back after a client dropped it', async () => {
    const requests = mockFetch()
    const api = air.create({ headers: { Authorization: 'Bearer one' } })
    const anonymous = api.create({ headers: { Authorization: null } })
    await anonymous
      .create({ headers: { Authorization: 'Bearer two' } })
      .get('https://api.test/a')
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer two')
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

  it('lets a request opt out of a client default with an explicit undefined', async () => {
    mockFetch(() => json({ id: 1 }))
    const api = air.create({ parse: 'text' })
    await expect(api.get('https://api.test/a', { parse: undefined })).resolves.toEqual({
      id: 1,
    })
  })

  it('forwards unknown options to fetch', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/a', { credentials: 'include', redirect: 'manual' })
    expect(requests[0]!.redirect).toBe('manual')
  })
})
