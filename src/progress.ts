import type { Fetch } from './types.js'

export interface Progress {
  /** Bytes received so far. */
  loaded: number
  /**
   * Bytes expected, from `Content-Length`. Absent when the header is missing or not a number,
   * and not comparable to `loaded` when the response is content-encoded, since the header
   * counts compressed bytes.
   */
  total?: number
}

export interface ProgressOptions {
  /** Called after every chunk of the response body. */
  onProgress: (progress: Progress) => void
  /**
   * The function that sends the request.
   *
   * @defaultValue The global `fetch`, resolved when the request is made.
   */
  fetch?: Fetch
}

/**
 * A `fetch` that reports download progress while the body is read.
 *
 * @remarks
 * The body still arrives parsed, and `raw` still sees the status, headers and final URL.
 * Upload progress needs no wrapper: hand `body` a `ReadableStream` that counts as it is read.
 *
 * @example
 * ```ts
 * const api = air.create({ fetch: progress({ onProgress: ({ loaded, total }) => render(loaded, total) }) })
 * ```
 */
export function progress(options: ProgressOptions): Fetch {
  const { onProgress, fetch: send } = options

  return async (url, init) => {
    const response = await (send ?? fetch)(url, init)
    if (!response.body) return response

    const length = Number(response.headers.get('content-length'))
    const total =
      response.headers.has('content-length') && Number.isFinite(length)
        ? length
        : undefined
    let loaded = 0
    const counted = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          loaded += chunk.byteLength
          onProgress({ loaded, total })
          controller.enqueue(chunk)
        },
      }),
    )
    return withMetadata(new Response(counted, response), response)
  }
}

// The Response constructor cannot set these, and a `raw` caller reads `response.url`.
function withMetadata(wrapped: Response, original: Response): Response {
  for (const key of ['url', 'redirected', 'type'] as const) {
    Object.defineProperty(wrapped, key, { value: original[key] })
  }
  return wrapped
}
