import { describe, expect, it } from 'vitest'
import air from '../src/index.js'
import { mockFetch } from './mock.js'

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

  it('returns the baseURL itself for an empty path', async () => {
    const requests = mockFetch()
    await air.get('', { baseURL: 'https://api.test/v1' })
    expect(requests[0]!.url).toBe('https://api.test/v1')
  })

  it('appends a query-only path to the baseURL without inserting a slash', async () => {
    const requests = mockFetch()
    await air.get('?q=1', { baseURL: 'https://api.test/v1' })
    expect(requests[0]!.url).toBe('https://api.test/v1?q=1')
  })

  it('appends a fragment-only path the same way', async () => {
    const requests = mockFetch()
    await air.get('#top', { baseURL: 'https://api.test/page' })
    expect(requests[0]!.url).toBe('https://api.test/page#top')
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

  it('accepts a URL instance as the baseURL', async () => {
    const requests = mockFetch()
    const api = air.create({ baseURL: new URL('https://api.test/v1/') })
    await api.get('/users')
    expect(requests[0]!.url).toBe('https://api.test/v1/users')
  })

  it('keeps the path prefix of a URL baseURL, same as a string one', async () => {
    const requests = mockFetch()
    await air.get('users', { baseURL: new URL('https://api.test/v1') })
    expect(requests[0]!.url).toBe('https://api.test/v1/users')
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

  it('keeps the hash at the end when a search string already exists', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/s?q=1#results', { query: { page: 2 } })
    expect(requests[0]!.url).toBe('https://api.test/s?q=1&page=2#results')
  })

  it('accepts a URLSearchParams', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/s', {
      query: new URLSearchParams({ page: '2', q: 'air' }),
    })
    expect(requests[0]!.url).toBe('https://api.test/s?page=2&q=air')
  })

  it('accepts an array of tuples', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/s', {
      query: [
        ['page', 2],
        ['active', true],
      ],
    })
    expect(requests[0]!.url).toBe('https://api.test/s?page=2&active=true')
  })

  it('keeps every value of a repeated key in a URLSearchParams', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/s', {
      query: new URLSearchParams('tag=a&tag=b&tag=c'),
    })
    expect(requests[0]!.url).toBe('https://api.test/s?tag=a&tag=b&tag=c')
  })

  it('keeps every value of a repeated key in a tuple list', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/s', {
      query: [
        ['tag', 'a'],
        ['tag', 'b'],
      ],
    })
    expect(requests[0]!.url).toBe('https://api.test/s?tag=a&tag=b')
  })

  it('merges a URLSearchParams request query onto a client record default', async () => {
    const requests = mockFetch()
    const api = air.create({ baseURL: 'https://api.test', query: { key: 'abc' } })
    await api.get('/s', { query: new URLSearchParams({ page: '2' }) })
    expect(requests[0]!.url).toBe('https://api.test/s?key=abc&page=2')
  })

  it('carries a URLSearchParams client default into a request that passes none', async () => {
    const requests = mockFetch()
    const api = air.create({
      baseURL: 'https://api.test',
      query: new URLSearchParams('tag=a&tag=b'),
    })
    await api.get('/s')
    expect(requests[0]!.url).toBe('https://api.test/s?tag=a&tag=b')
  })

  it('lets a request override a URLSearchParams client default by key', async () => {
    const requests = mockFetch()
    const api = air.create({
      baseURL: 'https://api.test',
      query: new URLSearchParams('page=1&key=abc'),
    })
    await api.get('/s', { query: { page: 9 } })
    expect(requests[0]!.url).toBe('https://api.test/s?page=9&key=abc')
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
      // @ts-expect-error a Date has no obvious serialization; pass an ISO string
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
    await air.get('https://api.test/s?msg=hola%20mundo', { headers: { 'X-Test': '1' } })
    expect(requests[0]!.url).toBe('https://api.test/s?msg=hola%20mundo')
  })

  it('leaves an existing search string byte-for-byte alone when appending to it', async () => {
    const requests = mockFetch()
    await air.get('https://api.test/s?msg=hola%20mundo', { query: { page: 2 } })
    expect(requests[0]!.url).toBe('https://api.test/s?msg=hola%20mundo&page=2')
  })

  it('leaves the url untouched when the query has nothing to append', async () => {
    const requests = mockFetch()
    const url = 'https://api.test/s?msg=hola%20mundo'
    await air.get(url, { query: {} })
    await air.get(url, { query: new URLSearchParams() })
    await air.get(url, { query: { skip: undefined, also: null, none: [] } })
    expect(requests.map((request) => request.url)).toEqual([url, url, url])
  })
})
