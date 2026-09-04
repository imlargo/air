import { describe, expect, it } from 'vitest'
import air, { isAirError } from '../src/index.js'
import { json, mockFetch } from './mock.js'

describe('raw', () => {
  it('resolves to the parsed body and the response', async () => {
    mockFetch(() => json({ id: 1 }, { headers: { link: '<next>; rel="next"' } }))

    const { data, response } = await air.raw.get<{ id: number }>('https://api.test/a')

    expect(data).toEqual({ id: 1 })
    expect(response).toBeInstanceOf(Response)
    expect(response.headers.get('link')).toBe('<next>; rel="next"')
    expect(response.status).toBe(200)
  })

  it('parses exactly like the plain client', async () => {
    mockFetch(() => json({ id: 1 }))
    await expect(
      air.raw.get('https://api.test/a', { parse: 'text' }),
    ).resolves.toMatchObject({ data: '{"id":1}' })

    mockFetch(() => new Response(null, { status: 204 }))
    await expect(air.raw.get('https://api.test/a')).resolves.toMatchObject({ data: null })
  })

  it('is callable directly and carries every verb', async () => {
    const requests = mockFetch()

    await air.raw('https://api.test/a')
    await air.raw.post('https://api.test/a')
    await air.raw.put('https://api.test/a')
    await air.raw.patch('https://api.test/a')
    await air.raw.delete('https://api.test/a')
    await air.raw.head('https://api.test/a')
    await air.raw.options('https://api.test/a')

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

  it('applies client defaults', async () => {
    const requests = mockFetch(() => json({ id: 1 }))
    const api = air.create({
      baseURL: 'https://api.test',
      headers: { 'X-Client': 'air' },
    })

    const { response } = await api.raw.get('/a', { query: { page: 2 } })

    expect(requests[0]!.url).toBe('https://api.test/a?page=2')
    expect(requests[0]!.headers.get('x-client')).toBe('air')
    expect(response.ok).toBe(true)
  })

  // The status check runs before parsing, so a failed request never resolves —
  // whichever client asked for it. error.response is the raw response, and it is
  // the only way to reach one.
  it('still throws on a non-2xx', async () => {
    mockFetch(() => json({ message: 'nope' }, { status: 404 }))

    const error: unknown = await air.raw
      .get('https://api.test/a')
      .catch((e: unknown) => e)

    expect(isAirError(error) && error.status).toBe(404)
    expect(isAirError(error) && error.data).toEqual({ message: 'nope' })
  })

  // The pairing raw and stream exist to serve together: a header that describes
  // the stream. data is response.body itself — one body, consumed once, from
  // whichever name the caller reaches for.
  it('hands back an unread stream alongside the response', async () => {
    mockFetch(() => json({ id: 1 }, { headers: { 'content-length': '9' } }))

    const { data, response } = await air.raw.get('https://api.test/a', {
      parse: 'stream',
    })

    expect(response.headers.get('content-length')).toBe('9')
    expect(data).toBe(response.body)
    expect(response.bodyUsed).toBe(false)
    await expect(new Response(data).json()).resolves.toEqual({ id: 1 })
    expect(response.bodyUsed).toBe(true)
  })

  // Not a limitation of air's: a body is read once, and data is that read.
  it('hands back a spent response when it read the body', async () => {
    mockFetch(() => json({ id: 1 }))

    const { data, response } = await air.raw.get('https://api.test/a')

    expect(data).toEqual({ id: 1 })
    expect(response.bodyUsed).toBe(true)
  })
})
