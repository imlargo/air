import type { ParseMode } from './types.js'

function detect(contentType: string | null): ParseMode {
  const type = (contentType ?? '').split(';')[0]?.trim() ?? ''
  if (type === 'application/json' || type.endsWith('+json')) return 'json'
  if (type.startsWith('text/')) return 'text'
  return 'blob'
}

export async function parseResponse(
  response: Response,
  parse?: ParseMode,
): Promise<unknown> {
  if (parse === 'response') return response
  if (response.status === 204) return null

  switch (parse ?? detect(response.headers.get('content-type'))) {
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
