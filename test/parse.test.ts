import { describe, expect, it } from 'vitest'
import air, { AirError, create, isAirError } from '../src/index.js'
import type { AirOptions, StreamOptions } from '../src/index.js'
import { json, mockFetch } from './mock.js'

const respond =
  (body: BodyInit | null, contentType: string, status = 200) =>
  () =>
    new Response(body, { status, headers: { 'content-type': contentType } })

const sse =
  (frame: string, status = 200) =>
  () =>
    new Response(
      new ReadableStream({
        start: (controller) => {
          controller.enqueue(new TextEncoder().encode(frame))
        },
      }),
      { status, headers: { 'content-type': 'text/event-stream' } },
    )

describe('parsing', () => {
  it('resolves 204 to null', async () => {
    mockFetch(() => new Response(null, { status: 204 }))
    await expect(air.delete('https://api.test/users/1')).resolves.toBeNull()
  })

  it('resolves an empty body to null', async () => {
    mockFetch(respond('', 'application/json'))
    await expect(air.get('https://api.test/nothing')).resolves.toBeNull()
  })

  it('parses +json suffixes as JSON', async () => {
    mockFetch(respond('{"ok":true}', 'application/vnd.api+json'))
    await expect(air.get('https://api.test/a')).resolves.toEqual({ ok: true })
  })

  it('parses text/* as text', async () => {
    mockFetch(respond('hi', 'text/plain'))
    await expect(air.get('https://api.test/a')).resolves.toBe('hi')
  })

  it('falls back to a Blob for other content types', async () => {
    mockFetch(respond('x', 'application/octet-stream'))
    await expect(air.get('https://api.test/a')).resolves.toBeInstanceOf(Blob)
  })

  it('falls back to a Blob for a missing content type', async () => {
    mockFetch(() => new Response('x'))
    // Response gives a string body text/plain; strip it to model a header-less response.
    mockFetch(() => {
      const response = new Response('x')
      response.headers.delete('content-type')
      return response
    })
    await expect(air.get('https://api.test/a')).resolves.toBeInstanceOf(Blob)
  })

  // Media types are case-insensitive; a server that capitalises must not become a Blob.
  it('matches the content type case-insensitively', async () => {
    mockFetch(respond('{"ok":true}', 'Application/JSON; Charset=UTF-8'))
    await expect(air.get('https://api.test/a')).resolves.toEqual({ ok: true })
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

  it('hands back the body unread as a stream', async () => {
    mockFetch(() => json({ id: 1 }))

    const body = await air.get('https://api.test/a', { parse: 'stream' })

    expect(body).toBeInstanceOf(ReadableStream)
    await expect(new Response(body).json()).resolves.toEqual({ id: 1 })
  })

  // The rule this pins is a type-level one, so the assertions are the @ts-expect-error
  // comments: a mode whose type is known must not accept a caller's contradicting <T>.
  // `pnpm typecheck` covers test/, so loosening AirOptions fails the build here.
  it('refuses a generic that contradicts the stream mode', async () => {
    mockFetch(() => json({ id: 1 }))

    const body = await air.get('https://api.test/a', { parse: 'stream' })
    const stream: ReadableStream<Uint8Array> = body
    expect(stream).toBeInstanceOf(ReadableStream)

    await air.get<{ id: number }>('https://api.test/a', {
      // @ts-expect-error a stream is not a User, and `parse: 'stream'` says so
      parse: 'stream',
    })
    await air.raw.get<{ id: number }>('https://api.test/a', {
      // @ts-expect-error same rule on the raw client
      parse: 'stream',
    })
  })

  it('accepts a prebuilt StreamOptions value', async () => {
    mockFetch(() => json({ id: 1 }))
    const download: StreamOptions = { parse: 'stream' }
    await expect(air.get('https://api.test/a', download)).resolves.toBeInstanceOf(
      ReadableStream,
    )
  })

  // The options on a thrown error have to be nameable and assignable by a caller using
  // exported types only, or the narrowed AirOptions turns a public field into something you
  // can read and never hold. This was broken once, when AirOptions was first narrowed.
  it('hands back error options a caller can name with public types', async () => {
    mockFetch(() => json({}, { status: 500 }))
    const error: unknown = await air
      .get('https://api.test/a', { parse: 'text' })
      .catch((e: unknown) => e)

    expect(isAirError(error)).toBe(true)
    if (!isAirError(error)) return
    const options: AirOptions | StreamOptions = error.request.options
    expect(options.parse).toBe('text')
  })

  // A client-level `parse: 'stream'` would put the option out of reach of the call site's
  // signature, which is the one place the rule above could not hold. Rather than document
  // that hole, create() does not accept it.
  it('refuses a streaming default on a client', () => {
    // @ts-expect-error a stream is a per-call shape, not a client-wide one
    air.create({ parse: 'stream' })
    // @ts-expect-error same on the exported factory
    create({ parse: 'stream' })
  })

  it('still catches a mistyped parse mode', async () => {
    mockFetch()
    // @ts-expect-error 'respons' is not a mode
    await air.get('https://api.test/a', { parse: 'respons' })
  })

  it('resolves a body-less response to null when streaming', async () => {
    mockFetch(() => new Response(null, { status: 204 }))
    await expect(air.get('https://api.test/a', { parse: 'stream' })).resolves.toBeNull()
  })

  it('wraps an unreadable body in an AirError', async () => {
    mockFetch(respond('not json', 'application/json'))
    await expect(air.get('https://api.test/a')).rejects.toBeInstanceOf(AirError)
  })

  // The regression test for the whole change: the stream never closes, which is the
  // entire point of SSE. Under the old `text/*` rule this call read to completion and
  // the promise simply never settled — the test times out rather than fails.
  it('hands back a streaming content type unread instead of buffering it forever', async () => {
    mockFetch(sse('data: one\n\n'))

    const body = await air.get<ReadableStream<Uint8Array>>('https://api.test/events')

    expect(body).toBeInstanceOf(ReadableStream)
    const reader = body.getReader()
    const { value } = await reader.read()
    expect(new TextDecoder().decode(value)).toBe('data: one\n\n')
    await reader.cancel()
  })

  it('detects line-delimited JSON as a stream too', async () => {
    for (const type of ['application/x-ndjson', 'application/jsonl']) {
      mockFetch(respond('{"a":1}\n', type))
      await expect(air.get(`https://api.test/${type}`)).resolves.toBeInstanceOf(
        ReadableStream,
      )
    }
  })

  it('leaves a charset on a streaming content type alone', async () => {
    mockFetch(respond('data: one\n\n', 'text/event-stream; charset=utf-8'))
    await expect(air.get('https://api.test/events')).resolves.toBeInstanceOf(
      ReadableStream,
    )
  })

  it('still buffers a streaming content type when parse says so', async () => {
    mockFetch(respond('data: one\n\n', 'text/event-stream'))
    await expect(air.get('https://api.test/events', { parse: 'text' })).resolves.toBe(
      'data: one\n\n',
    )
  })

  it('does not treat application/octet-stream as a stream, despite the name', async () => {
    mockFetch(respond('x', 'application/octet-stream'))
    await expect(air.get('https://api.test/a')).resolves.toBeInstanceOf(Blob)
  })

  // Same detection runs on the error path, so the hang was there too: a non-2xx that
  // never finishes arriving used to hold the rejection open just as long.
  it('does not hang on a non-2xx with a streaming content type', async () => {
    mockFetch(sse('data: nope\n\n', 500))

    await expect(air.get('https://api.test/events')).rejects.toMatchObject({
      name: 'AirError',
      status: 500,
    })
  })
})
