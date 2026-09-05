import { prepareBody } from './body.js'
import { AirError, type AirErrorInit } from './error.js'
import { parseResponse } from './parse.js'
import { buildURL, toQueryRecord } from './url.js'
import type {
  AirClient,
  AirOptions,
  AnyOptions,
  AirRequest,
  AirResponse,
  AirURL,
  HeaderInit,
  HeaderSource,
  Query,
  SignalSource,
} from './types.js'

// V8-only. Read through a structural type rather than a global augmentation, so the code
// neither depends on @types/node nor conflicts with it when a test runner brings it in.
interface V8ErrorConstructor {
  captureStackTrace?: (
    target: object,
    constructor?: (...args: never[]) => unknown,
  ) => void
}

const resolveHeaders = async (source?: HeaderSource): Promise<HeaderInit | undefined> =>
  typeof source === 'function' ? source() : source

const resolveSignal = (source?: SignalSource | null): AbortSignal | null | undefined =>
  typeof source === 'function' ? source() : source

// Records are applied key by key: the Headers constructor would send `null` and `undefined`
// as the strings "null" and "undefined".
function applyHeaders(target: Headers, source?: HeaderInit): void {
  if (!source) return

  if (source instanceof Headers || Array.isArray(source)) {
    new Headers(source).forEach((value, key) => {
      target.set(key, value)
    })
    return
  }

  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) target.delete(key)
    else target.set(key, value)
  }
}

// A closure, so neither source is resolved until a request is made.
function mergeHeaders(base?: HeaderSource, extra?: HeaderSource): () => Promise<Headers> {
  return async () => {
    const headers = new Headers()
    applyHeaders(headers, await resolveHeaders(base))
    applyHeaders(headers, await resolveHeaders(extra))
    return headers
  }
}

// Folded to records first: spreading a URLSearchParams yields {}.
function mergeQuery(base?: Query, extra?: Query): Query | undefined {
  if (!base || !extra) return base ?? extra
  return { ...toQueryRecord(base), ...toQueryRecord(extra) }
}

// Every request passes through here exactly once, so request() only ever sees merged options.
function merge(base: AnyOptions, extra: AnyOptions = {}): AnyOptions {
  return {
    ...base,
    ...extra,
    headers: mergeHeaders(base.headers, extra.headers),
    query: mergeQuery(base.query, extra.query),
  }
}

function reasonFor(error: unknown, fallback: string): string {
  const name = error instanceof Error ? error.name : ''
  if (name === 'TimeoutError') return 'timed out'
  if (name === 'AbortError') return 'was aborted'
  return fallback
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

function fail(message: string, info: AirRequest, init?: AirErrorInit): never {
  const error = new AirError(message, info, init)
  ;(Error as V8ErrorConstructor).captureStackTrace?.(error, request)
  throw error
}

async function request(path: AirURL, options: AnyOptions): Promise<AirResponse> {
  // Defaulted here rather than at module scope, so a `fetch` stubbed or polyfilled after
  // import is the one used.
  const {
    baseURL,
    query,
    parse,
    body,
    headers,
    method = 'GET',
    fetch: send = fetch,
    signal: signalSource,
    ...init
  } = options

  const url = buildURL(typeof path === 'string' ? path : path.href, baseURL, query)
  const verb = method.toUpperCase()

  const requestHeaders = new Headers()
  applyHeaders(requestHeaders, await resolveHeaders(headers))

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

  const info: AirRequest = { url, method: verb, headers: requestHeaders, options }

  // After the headers, so an `AbortSignal.timeout()` budget is not spent on an async header
  // function.
  const signal = resolveSignal(signalSource)

  let response: Response
  try {
    // `init` after `duplex`, so a caller's value wins.
    response = await send(url, {
      ...(duplex ? { duplex } : {}),
      ...init,
      method: verb,
      headers: requestHeaders,
      body: payload,
      signal,
    })
  } catch (error) {
    const reason = reasonFor(error, `failed: ${messageOf(error)}`)
    fail(`${verb} ${url} ${reason}`, info, { cause: error })
  }

  if (!response.ok) {
    const data = await parseResponse(response).catch(() => undefined)
    // No reason phrase over HTTP/2, so `statusText` is usually empty.
    const status = [response.status, response.statusText].filter(Boolean).join(' ')
    fail(`${verb} ${url} failed with ${status}`, info, { response, data })
  }

  try {
    return { data: await parseResponse(response, parse), response }
  } catch (error) {
    const reason = reasonFor(error, 'returned an unreadable body')
    fail(`${verb} ${url} ${reason}`, info, { response, cause: error })
  }
}

function verbs<M>(make: (method: string) => M) {
  return {
    get: make('GET'),
    post: make('POST'),
    put: make('PUT'),
    patch: make('PATCH'),
    delete: make('DELETE'),
    head: make('HEAD'),
    options: make('OPTIONS'),
  }
}

/** Creates a client with the given defaults. `air` is `create()` with none. */
export function create(defaults: AirOptions = {}): AirClient {
  const settle = (options?: AnyOptions, method?: string): AnyOptions =>
    method ? { ...merge(defaults, options), method } : merge(defaults, options)

  const raw =
    (method?: string) =>
    <T = unknown>(url: AirURL, options?: AnyOptions) =>
      request(url, settle(options, method)) as Promise<AirResponse<T | null>>

  const data = (method?: string) => {
    const send = raw(method)
    return <T = unknown>(url: AirURL, options?: AnyOptions): Promise<T | null> =>
      send<T>(url, options).then((result) => result.data)
  }

  return Object.assign(data(), verbs(data), {
    raw: Object.assign(raw(), verbs(raw)),
    // Both sides are AirOptions, so the result is too; merge() is typed for the wider case.
    create: (options?: AirOptions): AirClient =>
      create(merge(defaults, options) as AirOptions),
  })
}
