export interface PreparedBody {
  body: BodyInit | undefined
  contentType?: string
  stripContentType?: boolean
  duplex?: 'half'
}

export function prepareBody(body: unknown): PreparedBody {
  if (body === undefined || body === null) return { body: undefined }

  // The runtime writes the multipart boundary; any caller-set Content-Type would be wrong.
  if (body instanceof FormData) return { body, stripContentType: true }

  // fetch refuses to send a stream body without `duplex: 'half'`.
  if (body instanceof ReadableStream) return { body, duplex: 'half' }

  if (
    typeof body === 'string' ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  ) {
    return { body: body as BodyInit }
  }

  return { body: JSON.stringify(body), contentType: 'application/json' }
}
