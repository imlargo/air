export interface PreparedBody {
  body: BodyInit | undefined
  contentType?: string
}

export function prepareBody(body: unknown): PreparedBody {
  if (body === undefined || body === null) return { body: undefined }

  // FormData is deliberately not given a Content-Type: only the runtime knows
  // the multipart boundary it generated.
  if (
    typeof body === 'string' ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    body instanceof ReadableStream ||
    ArrayBuffer.isView(body)
  ) {
    return { body: body as BodyInit }
  }

  return { body: JSON.stringify(body), contentType: 'application/json' }
}
