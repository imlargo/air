import type { ParseMode } from './types.js'

// Content types that are streams by definition: reading one to completion means waiting for
// an endpoint designed never to close, so they are handed back unread. Keep the list to
// exactly that — `application/octet-stream` is not on it, despite the name, because a binary
// download ends. Adding a type here changes what its callers receive today.
const STREAMING = ['text/event-stream', 'application/x-ndjson', 'application/jsonl']

function detect(contentType: string | null): ParseMode {
  // Media types are case-insensitive, and parameters (`; charset=utf-8`) do not decide it.
  const type = contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  // Checked before the `text/*` rule: `text/event-stream` is the one text type that is not
  // a document.
  if (STREAMING.includes(type)) return 'stream'
  if (type === 'application/json' || type.endsWith('+json')) return 'json'
  if (type.startsWith('text/')) return 'text'
  return 'blob'
}

/**
 * Reads the body in the given mode, or in the one the `Content-Type` implies. A `204` and an
 * empty body resolve to `null` in every mode that reads the body — never a zero-length value,
 * never a parse error.
 */
export async function parseResponse(
  response: Response,
  parse?: ParseMode,
): Promise<unknown> {
  if (response.status === 204) return null

  switch (parse ?? detect(response.headers.get('content-type'))) {
    // The one mode that cannot honour "empty resolves to null" in full: finding out would
    // mean consuming the stream the caller asked for. A body-less response is still `null`,
    // because that is what fetch itself puts in `response.body`.
    case 'stream':
      return response.body
    case 'blob': {
      const blob = await response.blob()
      return blob.size ? blob : null
    }
    case 'arrayBuffer': {
      const buffer = await response.arrayBuffer()
      return buffer.byteLength ? buffer : null
    }
    case 'text':
      return (await response.text()) || null
    case 'json': {
      const text = await response.text()
      return text ? JSON.parse(text) : null
    }
  }
}
