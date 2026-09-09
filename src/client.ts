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
} from './types.js'

// V8-only. Read through a structural type rather than a global augmentation, so the code
// neither depends on @types/node nor conflicts with it when a test runner brings it in.
interface V8ErrorConstructor {
  captureStackTrace?: (
    target: object,
    constructor?: (...args: never[]) => unknown,
  ) => void
}

// A header or signal source is either a value or a function that produces one.
const resolve = <T>(source: T | (() => T)): T =>
  typeof source === 'function' ? (source as () => T)() : source

const isThenable = (value: unknown): value is PromiseLike<HeaderInit> =>
  typeof (value as { then?: unknown } | undefined)?.then === 'function'

// Records are applied key by key: the Headers constructor would send `null` and `undefined`
// as the strings "null" and "undefined". A Headers is read directly, already combined per name.
function applyHeaders(target: Headers, source?: HeaderInit): void {
  if (!source) return

  if (source instanceof Headers || Array.isArray(source)) {
    for (const [key, value] of Array.isArray(source) ? new Headers(source) : source) {
      target.set(key, value)
    }
    return
  }

  for (const key in source) {
    const value = source[key]
    if (value === null || value === undefined) target.delete(key)
    else target.set(key, value)
  }
}

// Applies each source in turn onto one Headers. Stays synchronous until a source returns a
// promise, so a request with static headers never waits on the microtask queue for them.
function fold(
  target: Headers,
  sources: readonly HeaderSource[],
  from: number,
): Headers | Promise<Headers> {
  for (let i = from; i < sources.length; i++) {
    const value = resolve<HeaderInit | Promise<HeaderInit> | undefined>(sources[i])
    if (isThenable(value)) {
      return Promise.resolve(value).then((resolved) => {
        applyHeaders(target, resolved)
        return fold(target, sources, i + 1)
      })
    }
    applyHeaders(target, value)
  }
  return target
}

// A merged header source is a function, so nothing is resolved until a request is made, and it
// carries the flat list it was merged from, so a chain of create() calls folds into a single
// Headers at request time instead of one per level.
const SOURCES = Symbol('air.headers')

type MergedHeaders = (() => Headers | Promise<Headers>) & {
  [SOURCES]: readonly HeaderSource[]
}

const NONE: readonly HeaderSource[] = []

const sourcesOf = (source?: HeaderSource): readonly HeaderSource[] =>
  source == null ? NONE : ((source as Partial<MergedHeaders>)[SOURCES] ?? [source])

function mergeHeaders(
  base?: HeaderSource,
  extra?: HeaderSource,
): HeaderSource | undefined {
  if (!base || !extra) return base ?? extra
  const sources = [...sourcesOf(base), ...sourcesOf(extra)]
  const merged: MergedHeaders = Object.assign(() => fold(new Headers(), sources, 0), {
    [SOURCES]: sources,
  })
  return merged
}

// Folded to records first: spreading a URLSearchParams yields {}.
function mergeQuery(base?: Query, extra?: Query): Query | undefined {
  if (!base || !extra) return base ?? extra
  return { ...toQueryRecord(base), ...toQueryRecord(extra) }
}

// Every request passes through here exactly once, so request() only ever sees merged options.
function merge(base: AnyOptions, extra: AnyOptions = {}, method?: string): AnyOptions {
  const merged: AnyOptions = {
    ...base,
    ...extra,
    headers: mergeHeaders(base.headers, extra.headers),
    query: mergeQuery(base.query, extra.query),
  }
  if (method) merged.method = method
  return merged
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

async function request(
  path: AirURL,
  options: AnyOptions,
  raw: boolean,
): Promise<unknown> {
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

  const folded = fold(new Headers(), sourcesOf(headers), 0)
  const requestHeaders = folded instanceof Headers ? folded : await folded

  let payload: BodyInit | undefined
  if (verb !== 'GET' && verb !== 'HEAD') {
    const prepared = prepareBody(body)
    payload = prepared.body
    // A caller's `duplex` wins over the one a stream body needs.
    if (prepared.duplex) init.duplex ??= prepared.duplex
    if (prepared.stripContentType) {
      requestHeaders.delete('content-type')
    } else if (prepared.contentType && !requestHeaders.has('content-type')) {
      requestHeaders.set('content-type', prepared.contentType)
    }
  }

  // After the headers, so an `AbortSignal.timeout()` budget is not spent on an async header
  // function.
  const signal = resolve<AbortSignal | null | undefined>(signalSource)

  const info: AirRequest = { url, method: verb, headers: requestHeaders, options }

  let response: Response
  try {
    response = await send(url, {
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
    const data = await parseResponse(response, parse)
    return raw ? ({ data, response } satisfies AirResponse) : data
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
  const data =
    (method?: string) =>
    <T = unknown>(url: AirURL, options?: AnyOptions) =>
      request(url, merge(defaults, options, method), false) as Promise<T | null>

  const raw =
    (method?: string) =>
    <T = unknown>(url: AirURL, options?: AnyOptions) =>
      request(url, merge(defaults, options, method), true) as Promise<
        AirResponse<T | null>
      >

  return Object.assign(data(), verbs(data), {
    raw: Object.assign(raw(), verbs(raw)),
    // Both sides are AirOptions, so the result is too; merge() is typed for the wider case.
    create: (options?: AirOptions): AirClient =>
      create(merge(defaults, options) as AirOptions),
  })
}
