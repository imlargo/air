import { prepareBody } from './body.js'
import { AirError } from './error.js'
import { parseResponse } from './parse.js'
import { buildURL } from './url.js'
import type {
  AirClient,
  AirOptions,
  AirRequest,
  AirResponse,
  AirURL,
  HeaderSource,
  SignalSource,
} from './types.js'

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

function resolveSignal(source?: SignalSource | null): AbortSignal | null | undefined {
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

// Always resolves to both halves; the two clients differ only in which one they
// hand back. That keeps `raw` a second projection of one result rather than a
// second code path through the request.
async function request(path: AirURL, options: AirOptions): Promise<AirResponse<unknown>> {
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
    signal: signalSource,
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

  // Resolved last, immediately before the send. A signal source that mints an
  // AbortSignal.timeout(ms) should spend that budget on the request, not share it
  // with an async header function that had to refresh a token first.
  const signal = resolveSignal(signalSource)

  let response: Response
  try {
    response = await send(url, {
      ...(duplex ? { duplex } : {}),
      ...init,
      method: verb,
      headers: requestHeaders,
      body: payload,
      signal,
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
    return { data: await parseResponse(response, parse), response }
  } catch (error) {
    const reason = reasonFor(error, 'returned an unreadable body')
    fail(`${verb} ${url} ${reason}`, info, { response, cause: error })
  }
}

// Listed once, so a verb can never be added to one client and forgotten in the
// other. `make` stays generic through the inference, which is what keeps the
// per-call <T> on every shortcut it builds.
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

export function create(defaults: AirOptions = {}): AirClient {
  const settle = (options?: AirOptions, method?: string): AirOptions =>
    method ? { ...merge(defaults, options), method } : merge(defaults, options)

  const call = <T = unknown>(url: AirURL, options?: AirOptions): Promise<T> =>
    request(url, settle(options)).then((result) => result.data as T)

  const shortcut =
    (method: string) =>
    <T = unknown>(url: AirURL, options?: AirOptions): Promise<T> =>
      request(url, settle(options, method)).then((result) => result.data as T)

  const rawCall = <T = unknown>(
    url: AirURL,
    options?: AirOptions,
  ): Promise<AirResponse<T>> => request(url, settle(options)) as Promise<AirResponse<T>>

  const rawShortcut =
    (method: string) =>
    <T = unknown>(url: AirURL, options?: AirOptions): Promise<AirResponse<T>> =>
      request(url, settle(options, method)) as Promise<AirResponse<T>>

  return Object.assign(call, verbs(shortcut), {
    raw: Object.assign(rawCall, verbs(rawShortcut)),
    create: (options?: AirOptions): AirClient => create(merge(defaults, options)),
  })
}
