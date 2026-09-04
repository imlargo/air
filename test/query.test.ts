import { describe, expect, it } from 'vitest'
import air from '../src/index.js'
import { toQueryParams } from '../src/query.js'
import { mockFetch } from './mock.js'

const text = (params: URLSearchParams) => decodeURIComponent(params.toString())

describe('toQueryParams', () => {
  it('serializes primitives, dates and nested objects', () => {
    const params = toQueryParams({
      q: 'air',
      page: 2,
      active: false,
      since: new Date(0),
      filter: { status: 'open', owner: { id: 7 } },
    })
    expect(text(params)).toBe(
      'q=air&page=2&active=false&since=1970-01-01T00:00:00.000Z&filter[status]=open&filter[owner][id]=7',
    )
  })

  it('writes arrays in the chosen convention', () => {
    const value = { tags: ['a', 'b'], when: [new Date(0)] }
    expect(text(toQueryParams(value))).toBe('tags=a&tags=b&when=1970-01-01T00:00:00.000Z')
    expect(text(toQueryParams(value, { arrays: 'brackets' }))).toBe(
      'tags[]=a&tags[]=b&when[]=1970-01-01T00:00:00.000Z',
    )
    expect(text(toQueryParams(value, { arrays: 'comma' }))).toBe(
      'tags=a,b&when=1970-01-01T00:00:00.000Z',
    )
  })

  it('drops undefined and null at any depth, and empty containers', () => {
    const params = toQueryParams({
      a: null,
      b: undefined,
      tags: [null, undefined],
      filter: { x: null, y: { z: undefined } },
      empty: [],
      none: {},
      keep: 0,
    })
    expect(text(params)).toBe('keep=0')
  })

  it('returns a URLSearchParams that merges with a client default query', async () => {
    const requests = mockFetch()
    const api = air.create({ baseURL: 'https://api.test', query: { key: 'k' } })
    await api.get('/s', { query: toQueryParams({ filter: { since: new Date(0) } }) })
    expect(decodeURIComponent(requests[0]!.url)).toBe(
      'https://api.test/s?key=k&filter[since]=1970-01-01T00:00:00.000Z',
    )
  })

  it('rejects values it cannot serialize', () => {
    // @ts-expect-error a function has no query representation
    toQueryParams({ fn: () => 1 })
  })
})
