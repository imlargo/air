import type { ParseMode } from './types.js'

// Formats meant to be consumed record by record or held open indefinitely, so their bodies are
// returned unread. `application/octet-stream` is deliberately absent: a binary download is a
// single finite value.
const STREAMING = new Set([
  'text/event-stream',
  'multipart/x-mixed-replace',
  'application/x-ndjson',
  'application/ndjson',
  'application/jsonl',
  'application/x-jsonlines',
  'application/json-seq',
  'application/stream+json',
  'application/x-json-stream',
])

function detect(contentType: string | null): ParseMode {
  const type = contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  // Before `text/*`: `text/event-stream` is a stream, not a document.
  if (STREAMING.has(type)) return 'stream'
  if (type === 'application/json' || type.endsWith('+json')) return 'json'
  if (type.startsWith('text/')) return 'text'
  return 'blob'
}

export async function parseResponse(
  response: Response,
  parse?: ParseMode,
): Promise<unknown> {
  if (response.status === 204) return null

  switch (parse ?? detect(response.headers.get('content-type'))) {
    // An empty stream cannot be detected without consuming it; `response.body` is already
    // `null` for a body-less response.
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
