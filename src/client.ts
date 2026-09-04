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

// V8-only (Node, Chrome, Edge); guarded at the call site. Declared here rather than through
// @types/node, which would leak Node-only globals into a codebase that targets the browser
// and edge runtimes just as much.
declare global {
  interface ErrorConstructor {
    captureStackTrace?(
      targetObject: object,
      constructorOpt?: (...args: never[]) => unknown,
    ): void
  }
}

const resolveHeaders = async (source?: HeaderSource): Promise<HeaderInit | undefined> =>
  typeof source === 'function' ? source() : source

const resolveSignal = (source?: SignalSource | null): AbortSignal | null | undefined =>
  typeof source === 'function' ? source() : source

// The record form is the one shape that can say "remove": `null` and `undefined` delete the
// key instead of being sent as the strings "null" and "undefined", which is what the Headers
// constructor would do with them. A Headers instance or a tuple list can only set.
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

// Always a closure, never a resolved Headers: each source is evaluated on the request that
// needs it, not when a client is created or derived. Resolving here would freeze a token at
// create() time — the bug the function form exists to fix — one layer removed. A chain of
// create() calls nests these without ever evaluating one early.
function mergeHeaders(base?: HeaderSource, extra?: HeaderSource): () => Promise<Headers> {
  return async () => {
    const headers = new Headers()
    applyHeaders(headers, await resolveHeaders(base))
    applyHeaders(headers, await resolveHeaders(extra))
    return headers
  }
}

// Request wins on a shared key. Both sides are folded to the record first, because a
// URLSearchParams spreads to nothing.
function mergeQuery(base?: Query, extra?: Query): Query | undefined {
  if (!base || !extra) return base ?? extra
  return { ...toQueryRecord(base), ...toQueryRecord(extra) }
}

// Scalars are last-wins, so an explicit `undefined` on the request opts out of a client
// default (`baseURL: undefined`, `fetch: undefined`, `parse: undefined`); headers and query
// combine instead of replacing. Every request passes through here exactly once, with or
// without per-request options, so nothing reaches request() un-normalised — a `null` header
// written straight into create()'s defaults included.
function merge(base: AnyOptions, extra: AnyOptions = {}): AnyOptions {
  return {
    ...base,
    ...extra,
    headers: mergeHeaders(base.headers, extra.headers),
    query: mergeQuery(base.query, extra.query),
  }
}

// `abort(reason)` lets a caller pass anything, so only the two platform-issued reasons are
// named; a custom one is reported as the failure it describes.
function reasonFor(error: unknown, fallback: string): string {
  const name = error instanceof Error ? error.name : ''
  if (name === 'TimeoutError') return 'timed out'
  if (name === 'AbortError') return 'was aborted'
  return fallback
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// Every throw goes through here, so the stack is trimmed of request()'s own frame and starts
// at the caller's call site rather than inside air.
function fail(message: string, info: AirRequest, init?: AirErrorInit): never {
  const error = new AirError(message, info, init)
  Error.captureStackTrace?.(error, request)
  throw error
}

// Always resolves to both halves; the two clients differ only in which one they hand back.
// One code path through a request, so `raw` cannot drift from the plain client.
async function request(path: AirURL, options: AnyOptions): Promise<AirResponse> {
  // `send` defaults inside the call, not at module load, so a polyfill installed after
  // import — or a test stubbing the global — is what gets called.
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

  // Built after the headers are resolved and the body has had its say, so an error reports
  // what was actually sent — `options.headers` may still be an unevaluated function.
  const info: AirRequest = { url, method: verb, headers: requestHeaders, options }

  // Resolved last, immediately before the send, so a source that mints
  // `AbortSignal.timeout(ms)` spends that budget on the request rather than on an async
  // header function that had to refresh a token first.
  const signal = resolveSignal(signalSource)

  let response: Response
  try {
    // air's duplex first, so a caller-supplied one in `init` wins.
    response = await send(url, {
      ...(duplex ? { duplex } : {}),
      ...init,
      method: verb,
      headers: requestHeaders,
      body: payload,
      signal,
    })
  } catch (error) {
    const reason = reasonFor(error, `failed: ${describe(error)}`)
    fail(`${verb} ${url} ${reason}`, info, { cause: error })
  }

  if (!response.ok) {
    // Same detection as the success path. An error body that fails to parse leaves `data`
    // undefined; it never turns a 500 into a parse error.
    const data = await parseResponse(response).catch(() => undefined)
    fail(`${verb} ${url} failed with ${response.status} ${response.statusText}`, info, {
      response,
      data,
    })
  }

  try {
    return { data: await parseResponse(response, parse), response }
  } catch (error) {
    const reason = reasonFor(error, 'returned an unreadable body')
    fail(`${verb} ${url} ${reason}`, info, { response, cause: error })
  }
}

// Listed once, so a verb cannot be added to one client and forgotten in the other. `make`
// stays generic through the inference, which keeps the per-call <T> on every shortcut.
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

/**
 * A client with these defaults. The root export `air` is `create()` with none, so there is
 * exactly one implementation; `air.create()` and `client.create()` are this function with
 * the parent's defaults merged in.
 */
export function create(defaults: AirOptions = {}): AirClient {
  const settle = (options?: AnyOptions, method?: string): AnyOptions =>
    method ? { ...merge(defaults, options), method } : merge(defaults, options)

  // Two projections of one request(): `raw` keeps both halves, the plain client keeps the
  // body. A shortcut pins the method; the callable form leaves it to the options.
  const raw =
    (method?: string) =>
    <T = unknown>(url: AirURL, options?: AnyOptions) =>
      request(url, settle(options, method)) as Promise<AirResponse<T>>

  const data = (method?: string) => {
    const send = raw(method)
    return <T = unknown>(url: AirURL, options?: AnyOptions): Promise<T> =>
      send<T>(url, options).then((result) => result.data)
  }

  return Object.assign(data(), verbs(data), {
    raw: Object.assign(raw(), verbs(raw)),
    // Both sides are AirOptions here, so the merge is one too. merge() is typed for the
    // looser case it also serves: a per-request `parse: 'stream'`.
    create: (options?: AirOptions): AirClient =>
      create(merge(defaults, options) as AirOptions),
  })
}
