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
  if (response.status === 204) return null

  switch (parse ?? detect(response.headers.get('content-type'))) {
    case 'stream':
      return response.body
    case 'blob':
      return response.blob()
    case 'arrayBuffer':
      return response.arrayBuffer()
    case 'text':
      return (await response.text()) || null
    default: {
      const text = await response.text()
      return text ? JSON.parse(text) : null
    }
  }
}
