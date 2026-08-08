import { prepareBody } from './body.js'
import { AirError } from './error.js'
import { parseResponse } from './parse.js'
import { buildURL } from './url.js'
import type { AirClient, AirOptions, AirRequest, AirURL, HeaderSource } from './types.js'

// V8-only (Node, Chrome, Edge); guarded at the call site. Declared locally
// instead of pulling in @types/node, which would leak Node-only ambient globals
// into a codebase that targets the browser and edge runtimes just as much.
declare global {
  interface ErrorConstructor {
    captureStackTrace?(
      targetObject: object,
      constructorOpt?: (...args: never[]) => unknown,
    ): void
  }
}

async function resolveHeaders(source?: HeaderSource): Promise<HeadersInit | undefined> {
  return typeof source === 'function' ? source() : source
}

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
    // undefined (not {}) when neither side has one: buildURL treats a query of {}
    // as "process the URL's search string," which re-encodes it (%20 -> +) even
    // when no merge was actually requested.
    query: base.query || extra.query ? { ...base.query, ...extra.query } : undefined,
  }
}

function reasonFor(error: unknown, fallback: string): string {
  const name = error instanceof Error ? error.name : ''
  if (name === 'TimeoutError') return 'timed out'
  if (name === 'AbortError') return 'was aborted'
  return fallback
}

// Throws with request()'s own frame trimmed from the stack, so it starts at the
// caller's call site instead of inside air.
function fail(
  message: string,
  info: AirRequest,
  init?: ConstructorParameters<typeof AirError>[2],
): never {
  const error = new AirError(message, info, init)
  Error.captureStackTrace?.(error, request)
  throw error
}

async function request<T>(path: AirURL, options: AirOptions): Promise<T> {
  // `send` defaults inside the call, not at module load, so it picks up whatever
  // fetch the environment has at request time — a polyfill installed later, or a
  // test stubbing the global.
  const {
    baseURL,
    query,
    parse,
    body,
    headers,
    method = 'GET',
    fetch: send = fetch,
    ...init
  } = options

  const url = buildURL(typeof path === 'string' ? path : path.href, baseURL, query)
  const verb = method.toUpperCase()

  const requestHeaders = new Headers(await resolveHeaders(headers))
  let payload: BodyInit | undefined
  let duplex: 'half' | undefined
  if (verb !== 'GET' && verb !== 'HEAD') {
    const prepared = prepareBody(body)
    payload = prepared.body
    duplex = prepared.duplex
    if (prepared.stripContentType) {
      requestHeaders.delete('content-type')
    } else if (prepared.contentType && !requestHeaders.has('content-type')) {
      requestHeaders.set('content-type', prepared.contentType)
    }
  }

  // Built after the headers are resolved and the body has had its say, so an
  // error reports what was actually sent. options.headers may be a function,
  // which is useless when you are looking at a 401 and want to see the token.
  const info = { url, method: verb, headers: requestHeaders, options }

  let response: Response
  try {
    response = await send(url, {
      ...(duplex ? { duplex } : {}),
      ...init,
      method: verb,
      headers: requestHeaders,
      body: payload,
    })
  } catch (error) {
    const reason = reasonFor(
      error,
      `failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    fail(`${verb} ${url} ${reason}`, info, { cause: error })
  }

  if (!response.ok) {
    const data = await parseResponse(response).catch(() => undefined)
    fail(`${verb} ${url} failed with ${response.status} ${response.statusText}`, info, {
      response,
      data,
    })
  }

  try {
    return (await parseResponse(response, parse)) as T
  } catch (error) {
    const reason = reasonFor(error, 'returned an unreadable body')
    fail(`${verb} ${url} ${reason}`, info, { response, cause: error })
  }
}

export function create(defaults: AirOptions = {}): AirClient {
  const call = <T = unknown>(url: AirURL, options?: AirOptions): Promise<T> =>
    request<T>(url, merge(defaults, options))

  const shortcut =
    (method: string) =>
    <T = unknown>(url: AirURL, options?: AirOptions): Promise<T> =>
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
