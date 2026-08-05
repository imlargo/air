import { prepareBody } from './body.js'
import { AirError } from './error.js'
import { parseResponse } from './parse.js'
import { buildURL } from './url.js'
import type { AirClient, AirOptions, HeaderSource } from './types.js'

const resolveHeaders = async (source?: HeaderSource): Promise<HeadersInit | undefined> =>
  typeof source === 'function' ? source() : source

// Stays a function even when both sides are static, so a header source is never
// resolved until the request that actually needs it — including through a chain
// of create() calls, each adding its own source on top of the last.
function mergeHeaders(base?: HeaderSource, extra?: HeaderSource): () => Promise<Headers> {
  return async () => {
    const headers = new Headers(await resolveHeaders(base))
    new Headers(await resolveHeaders(extra)).forEach((value, key) =>
      headers.set(key, value),
    )
    return headers
  }
}

function merge(base: AirOptions, extra?: AirOptions): AirOptions {
  if (!extra) return base
  return {
    ...base,
    ...extra,
    headers: mergeHeaders(base.headers, extra.headers),
    query: base.query || extra.query ? { ...base.query, ...extra.query } : undefined,
  }
}

function describe(error: unknown, fallback: string): string {
  const name = error instanceof Error ? error.name : ''
  if (name === 'TimeoutError') return 'timed out'
  if (name === 'AbortError') return 'was aborted'
  return fallback
}

async function request<T>(path: string, options: AirOptions): Promise<T> {
  const { baseURL, query, parse, body, headers, method = 'GET', ...init } = options

  const url = buildURL(path, baseURL, query)
  const verb = method.toUpperCase()
  const info = { url, options }

  const requestHeaders = new Headers(await resolveHeaders(headers))
  let payload: BodyInit | undefined
  if (verb !== 'GET' && verb !== 'HEAD') {
    const prepared = prepareBody(body)
    payload = prepared.body
    if (prepared.stripContentType) {
      requestHeaders.delete('content-type')
    } else if (prepared.contentType && !requestHeaders.has('content-type')) {
      requestHeaders.set('content-type', prepared.contentType)
    }
  }

  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      method: verb,
      headers: requestHeaders,
      body: payload,
    })
  } catch (error) {
    const reason = describe(
      error,
      `failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    throw new AirError(`${verb} ${url} ${reason}`, info, { cause: error })
  }

  if (!response.ok) {
    const data = await parseResponse(response).catch(() => undefined)
    throw new AirError(
      `${verb} ${url} failed with ${response.status} ${response.statusText}`,
      info,
      { response, data },
    )
  }

  try {
    return (await parseResponse(response, parse)) as T
  } catch (error) {
    const reason = describe(error, 'returned an unreadable body')
    throw new AirError(`${verb} ${url} ${reason}`, info, { response, cause: error })
  }
}

export function create(defaults: AirOptions = {}): AirClient {
  const call = <T = unknown>(url: string, options?: AirOptions): Promise<T> =>
    request<T>(url, merge(defaults, options))

  const shortcut =
    (method: string) =>
    <T = unknown>(url: string, options?: AirOptions): Promise<T> =>
      request<T>(url, { ...merge(defaults, options), method })

  return Object.assign(call, {
    get: shortcut('GET'),
    post: shortcut('POST'),
    put: shortcut('PUT'),
    patch: shortcut('PATCH'),
    delete: shortcut('DELETE'),
    head: shortcut('HEAD'),
    options: shortcut('OPTIONS'),
    create: (options?: AirOptions): AirClient => create(merge(defaults, options)),
  })
}
