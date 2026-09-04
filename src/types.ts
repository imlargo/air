/** How a response body is read. */
export type ParseMode = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream'

export type QueryValue = string | number | boolean | null | undefined

/**
 * Query parameters, as a record, a `URLSearchParams`, or a list of `[key, value]` tuples.
 *
 * @remarks
 * - `undefined` and `null` values are dropped. `false`, `0` and `''` are kept.
 * - An array value repeats the key: `{ tags: ['a', 'b'] }` becomes `?tags=a&tags=b`.
 * - Declare a record with `type`, not `interface`. Interfaces have no implicit index signature
 *   and are not assignable here.
 */
export type Query =
  | Record<string, QueryValue | readonly QueryValue[]>
  | URLSearchParams
  | readonly (readonly [string, QueryValue])[]

/**
 * In the record form, `null` and `undefined` remove the header instead of setting it.
 *
 * @internal
 */
export type HeaderInit = HeadersInit | Record<string, string | null | undefined>

/**
 * Request headers, or a function that returns them.
 *
 * @remarks
 * A function is called on every request, so a value that changes over time, such as a bearer
 * token, is read fresh each time. It may be async. Calls are not deduplicated.
 */
export type HeaderSource = HeaderInit | (() => HeaderInit | Promise<HeaderInit>)

/**
 * An `AbortSignal`, or a function that returns one per request.
 *
 * @remarks
 * Use the function form for client defaults: a signal is single-use, so one instance shared by
 * every request of a client fails every request after the first time it fires. The signal is
 * forwarded to `fetch` unchanged; compose signals with `AbortSignal.any`.
 */
export type SignalSource = AbortSignal | (() => AbortSignal | null | undefined)

/**
 * The function that sends the request. Narrower than the global `fetch` on its parameters, so
 * the global, a framework's per-request wrapper and a test double are all assignable.
 */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>

/**
 * Options for a single request, or defaults for a client.
 *
 * @remarks
 * Fields not listed here are forwarded to `fetch` unchanged. When a request and its client set
 * the same option, the request wins, and an explicit `undefined` on the request clears the
 * client's value. `headers` and `query` are merged instead, the request winning on a shared key.
 */
export interface AirOptions extends Omit<RequestInit, 'body' | 'headers' | 'signal'> {
  /**
   * Joined to the request path as a string, so a path prefix is kept: `'https://api.test/v1'` +
   * `'/users'` is `https://api.test/v1/users`. Ignored for an absolute URL.
   */
  baseURL?: string | URL
  query?: Query
  /**
   * Plain objects and arrays are JSON-encoded and sent with `Content-Type: application/json`
   * unless one is set. Any other `BodyInit` is sent as-is. Ignored for `GET` and `HEAD`.
   */
  body?: unknown
  headers?: HeaderSource
  /** @defaultValue Inferred from the response `Content-Type`. */
  parse?: Exclude<ParseMode, 'stream'>
  signal?: SignalSource | null
  /** @defaultValue The global `fetch`, resolved when the request is made. */
  fetch?: Fetch
  /** Set automatically for a `ReadableStream` body. Declared here because `RequestInit` omits it. */
  duplex?: 'half'
}

/**
 * Options for a request whose body is returned unread, as a `ReadableStream<Uint8Array>`. The
 * call signature that accepts these has no type parameter, so
 * `api.get<User>(url, { parse: 'stream' })` does not compile.
 */
export type StreamOptions = Omit<AirOptions, 'parse'> & { parse: 'stream' }

/** @internal */
export type AnyOptions = AirOptions | StreamOptions

/** A `URL` is absolute and ignores `baseURL`. */
export type AirURL = string | URL

export interface AirRequest {
  url: string
  method: string
  /** As sent: every source resolved, plus any `Content-Type` the body added. */
  headers: Headers
  /** As merged. `headers` may be an unevaluated function. */
  options: AirOptions | StreamOptions
}

export interface AirResponse<T = unknown> {
  data: T
  /**
   * Its body has been consumed into `data`, except with `parse: 'stream'`, where `data` is
   * `response.body` itself.
   */
  response: Response
}

// The stream overload comes first: overload resolution takes the first match, and this one
// declares no type parameter for a caller to contradict.
interface Call {
  (url: AirURL, options: StreamOptions): Promise<ReadableStream<Uint8Array>>
  <T = unknown>(url: AirURL, options?: AirOptions): Promise<T>
}

interface RawCall {
  (url: AirURL, options: StreamOptions): Promise<AirResponse<ReadableStream<Uint8Array>>>
  <T = unknown>(url: AirURL, options?: AirOptions): Promise<AirResponse<T>>
}

/**
 * A client whose calls resolve to `{ data, response }` instead of the body alone. Same request,
 * same parsing and same options as the plain client. A non-2xx status still throws.
 */
export interface AirRawClient extends RawCall {
  get: RawCall
  post: RawCall
  put: RawCall
  patch: RawCall
  delete: RawCall
  head: RawCall
  options: RawCall
}

/** An HTTP client. Callable directly for a `GET`, with a shortcut per method. */
export interface AirClient extends Call {
  get: Call
  post: Call
  put: Call
  patch: Call
  delete: Call
  head: Call
  options: Call
  raw: AirRawClient
  create(options?: AirOptions): AirClient
}
