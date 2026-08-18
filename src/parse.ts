import type { ParseMode } from './types.js'

// Every mode but `stream` reads the body to completion, so a content type that is
// a live stream by definition has to be detected before the general rules — an SSE
// endpoint stays open, and buffering it means a promise that never settles at all:
// no status, no error, nothing to log. Keep this list to types that are streams by
// definition; `application/octet-stream` is not one, despite the name.
const STREAMING = ['text/event-stream', 'application/x-ndjson', 'application/jsonl']

function detect(contentType: string | null): ParseMode {
  const type = (contentType ?? '').split(';')[0]?.trim() ?? ''
  if (STREAMING.includes(type)) return 'stream'
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
    // The one mode that hands back the body unread, so it is also the one that
    // cannot honour "empty body resolves to null" — finding out would mean
    // consuming the stream the caller asked for. `null` still comes back for a
    // body-less response, because that is what fetch itself puts there.
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
    default: {
      const text = await response.text()
      return text ? JSON.parse(text) : null
    }
  }
}
