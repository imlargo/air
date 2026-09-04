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

  it('types every call as possibly null', async () => {
    mockFetch(() => json({ id: 1 }))
    const user = await air.get<{ id: number }>('https://api.test/a')
    // @ts-expect-error a 204 or an empty body resolves to null, and the type says so
    expect(user.id).toBe(1)

    const { data } = await air.raw.get<{ id: number }>('https://api.test/a')
    // @ts-expect-error same on the raw client
    expect(data.id).toBe(1)
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
    // `new Response(string)` sets text/plain; remove it to model a missing header.
    mockFetch(() => {
      const response = new Response('x')
      response.headers.delete('content-type')
      return response
    })
    await expect(air.get('https://api.test/a')).resolves.toBeInstanceOf(Blob)
  })

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
    await expect(blob!.text()).resolves.toBe('{"id":1}')
  })

  it('parses as an ArrayBuffer on request', async () => {
    mockFetch(() => new Response(new Uint8Array([1, 2, 3])))
    const buffer = await air.get<ArrayBuffer>('https://api.test/a', {
      parse: 'arrayBuffer',
    })
    expect(buffer).toBeInstanceOf(ArrayBuffer)
    expect(buffer!.byteLength).toBe(3)
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

  it('refuses a generic that contradicts the stream mode', async () => {
    mockFetch(() => json({ id: 1 }))

    const body = await air.get('https://api.test/a', { parse: 'stream' })
    const stream: ReadableStream<Uint8Array> | null = body
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

  // The stream never closes; buffering it would make this test time out.
  it('hands back a streaming content type unread instead of buffering it forever', async () => {
    mockFetch(sse('data: one\n\n'))

    const body = await air.get<ReadableStream<Uint8Array>>('https://api.test/events')

    expect(body).toBeInstanceOf(ReadableStream)
    const reader = body!.getReader()
    const { value } = await reader.read()
    expect(new TextDecoder().decode(value)).toBe('data: one\n\n')
    await reader.cancel()
  })

  it('detects record-stream and open-ended content types as streams', async () => {
    const types = [
      'multipart/x-mixed-replace; boundary=frame',
      'application/x-ndjson',
      'application/ndjson',
      'application/jsonl',
      'application/x-jsonlines',
      'application/json-seq',
      'application/stream+json',
      'application/x-json-stream',
    ]
    for (const type of types) {
      mockFetch(respond('{"a":1}\n', type))
      await expect(air.get(`https://api.test/${type}`)).resolves.toBeInstanceOf(
        ReadableStream,
      )
    }
  })

  it('still parses a plain +json suffix as JSON', async () => {
    mockFetch(respond('{"ok":true}', 'application/problem+json'))
    await expect(air.get('https://api.test/a')).resolves.toEqual({ ok: true })
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

  it('does not hang on a non-2xx with a streaming content type', async () => {
    mockFetch(sse('data: nope\n\n', 500))

    await expect(air.get('https://api.test/events')).rejects.toMatchObject({
      name: 'AirError',
      status: 500,
    })
  })
})
