import { describe, expect, it, vi } from 'vitest'
import air, { isAirError } from '../src/index.js'
import { progress, type Progress } from '../src/progress.js'
import { json, mockFetch } from './mock.js'

const U = 'https://api.test/big'

function chunked(
  chunks: string[],
  headers: Record<string, string> = {},
  init: ResponseInit = {},
) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
    { ...init, headers: { 'content-type': 'application/json', ...headers } },
  )
}

describe('progress', () => {
  it('reports after every chunk, with the total from content-length', async () => {
    const reports: Progress[] = []
    const send = async () => chunked(['{"a":', '1', '}'], { 'content-length': '7' })
    const data = await air.get(U, {
      fetch: progress({ onProgress: (p) => reports.push(p), fetch: send }),
    })
    expect(data).toEqual({ a: 1 })
    expect(reports).toEqual([
      { loaded: 5, total: 7 },
      { loaded: 6, total: 7 },
      { loaded: 7, total: 7 },
    ])
  })

  it('leaves total undefined when content-length is missing or not a number', async () => {
    const reports: Progress[] = []
    const onProgress = (p: Progress) => reports.push(p)
    await air.get(U, {
      fetch: progress({ onProgress, fetch: async () => chunked(['{}']) }),
    })
    await air.get(U, {
      fetch: progress({
        onProgress,
        fetch: async () => chunked(['{}'], { 'content-length': 'nope' }),
      }),
    })
    expect(reports.map((p) => p.total)).toEqual([undefined, undefined])
  })

  it('preserves status, headers, url and redirected on the wrapped response', async () => {
    const original = chunked(
      ['{}'],
      { 'x-total': '9' },
      { status: 201, statusText: 'Created' },
    )
    Object.defineProperty(original, 'url', { value: 'https://api.test/final' })
    Object.defineProperty(original, 'redirected', { value: true })

    const { response } = await air.raw.get(U, {
      fetch: progress({ onProgress: vi.fn(), fetch: async () => original }),
    })

    expect(response.status).toBe(201)
    expect(response.statusText).toBe('Created')
    expect(response.headers.get('x-total')).toBe('9')
    expect(response.url).toBe('https://api.test/final')
    expect(response.redirected).toBe(true)
  })

  it('passes a body-less response through untouched', async () => {
    const original = new Response(null, { status: 204 })
    const wrapped = progress({ onProgress: vi.fn(), fetch: async () => original })
    expect(await wrapped(U, {})).toBe(original)
  })

  it('hands raw the counted stream, so reading it reports', async () => {
    const reports: Progress[] = []
    const { data, response } = await air.raw.get(U, {
      parse: 'stream',
      fetch: progress({
        onProgress: (p) => reports.push(p),
        fetch: async () => chunked(['ab', 'cd'], { 'content-length': '4' }),
      }),
    })
    expect(data).toBe(response.body)
    expect(reports).toEqual([])
    await new Response(data).text()
    expect(reports.at(-1)).toEqual({ loaded: 4, total: 4 })
  })

  it('still lets a non-2xx throw, with its body counted', async () => {
    const onProgress = vi.fn()
    const error: unknown = await air
      .get(U, {
        fetch: progress({
          onProgress,
          fetch: async () => chunked(['{"e":1}'], {}, { status: 500 }),
        }),
      })
      .catch((e: unknown) => e)
    expect(isAirError(error) && error.status).toBe(500)
    expect(isAirError(error) && error.data).toEqual({ e: 1 })
    expect(onProgress).toHaveBeenCalled()
  })

  it('uses the global fetch when none is given', async () => {
    mockFetch(() => json({ ok: 1 }))
    const onProgress = vi.fn()
    await expect(air.get(U, { fetch: progress({ onProgress }) })).resolves.toEqual({
      ok: 1,
    })
    expect(onProgress).toHaveBeenCalled()
  })
})
