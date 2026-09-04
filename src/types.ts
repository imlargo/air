/**
 * How a response body is read. Each mode answers one question — what shape should the body
 * be? — and never decides what a call resolves to; that is {@link AirClient.raw}.
 *
 * `'stream'` is the one mode whose type is fixed at compile time, so it is the one that must
 * not be paired with a caller's `<T>`. {@link AirOptions.parse} therefore excludes it, and it
 * is reachable only through {@link StreamOptions}, whose call signature has no type parameter
 * to disagree with.
 */
export type ParseMode = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream'

/**
 * A query value. Primitives only: an object or a `Date` is a compile error rather than a
 * silent `[object Object]` or a locale-dependent string. Serialise those yourself, so the
 * choice stays visible.
 */
export type QueryValue = string | number | boolean | null | undefined

/**
 * Query params in any of three spellings of the same thing: a record, a `URLSearchParams`, or
 * a list of `[key, value]` tuples. The record is the one to write; the other two are what a
 * caller already holds when the params came from elsewhere — the current URL's
 * `searchParams`, a form, another library — and handing one over keeps every value of a
 * repeated key, where converting it by hand with `Object.fromEntries` would not.
 *
 * `undefined` and `null` values are dropped; `false`, `0` and `''` are kept. An array repeats
 * the key: `{ tags: ['a', 'b'] }` is `?tags=a&tags=b`.
 *
 * Type a record with `type`, not `interface`: object type aliases get an implicit index
 * signature, interfaces never do, so an `interface` is not assignable here.
 */
export type Query =
  | Record<string, QueryValue | readonly QueryValue[]>
  | URLSearchParams
  | readonly (readonly [string, QueryValue])[]

/**
 * Any `HeadersInit`, or a record whose values may also be `null` or `undefined`.
 *
 * In the record form, `null` removes a header a client default put there — the only shape
 * that can say so, since `''` sends an empty header and a function only ever adds.
 * `undefined` does the same, because `{ Authorization: signedIn ? token : undefined }` is how
 * that gets written. A `Headers` instance or a tuple list can only set.
 *
 * Internal: {@link HeaderSource} is the type callers write.
 */
export type HeaderInit = HeadersInit | Record<string, string | null | undefined>

/**
 * Headers, or a function (sync or async) that returns them.
 *
 * A plain value is evaluated once, when written. A function is called on every request, so a
 * long-lived client stays correct when the value changes after the client was created — a
 * bearer token that gets refreshed, for instance. It is not deduplicated: an async function
 * that hits the network does so per request, and single-flighting it is the caller's job.
 */
export type HeaderSource = HeaderInit | (() => HeaderInit | Promise<HeaderInit>)

/**
 * An `AbortSignal`, or a function that returns one per request.
 *
 * The function form exists for client defaults. A signal written into `air.create()` is one
 * instance shared by every request that client will ever make, and a fired signal stays
 * fired — so `air.create({ signal: AbortSignal.timeout(5000) })` works for five seconds and
 * is then permanently broken. `signal: () => AbortSignal.timeout(5000)` gives each request
 * its own. Returning `undefined` opts one request out of the client's signal.
 *
 * Whichever form, the signal reaches `fetch` untouched: never wrapped, never combined with
 * another. Compose signals yourself with `AbortSignal.any`.
 */
export type SignalSource = AbortSignal | (() => AbortSignal | null | undefined)

/**
 * The transport. Narrower than the global `fetch` on its parameters — air only ever calls it
 * with a URL string and a full init — which is what makes it wide on implementations: the
 * global itself, a framework's per-request wrapper (SvelteKit's `event.fetch`), an
 * instrumented fetch that logs or retries, and a test double all qualify.
 */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>

/**
 * Options for a request, or defaults for a client. Every field is optional. Anything not
 * listed here is forwarded to `fetch` untouched (`credentials`, `cache`, `redirect`, ...).
 *
 * Scalars merge last-wins, so an explicit `undefined` on a request opts out of the client's
 * default. `headers` and `query` combine instead, the request winning on a shared key.
 */
export interface AirOptions extends Omit<RequestInit, 'body' | 'headers' | 'signal'> {
  /**
   * Joined with the request path as strings, so a path prefix survives: `https://api.test/v1`
   * + `/users` is `https://api.test/v1/users`. Skipped for an absolute URL.
   */
  baseURL?: string | URL
  /** Appended to the URL's existing search params, which are left byte-for-byte alone. */
  query?: Query
  /**
   * Plain objects and arrays are JSON-stringified with `Content-Type: application/json`
   * unless one is set. `FormData`, `URLSearchParams`, `Blob`, `ArrayBuffer`, typed arrays,
   * `ReadableStream` and strings pass through untouched. Never sent on `GET` or `HEAD`.
   */
  body?: unknown
  /** Merged onto the client's; see {@link HeaderSource} for the function form and `null`. */
  headers?: HeaderSource
  /**
   * Overrides detection from the response `Content-Type`. `'stream'` is a per-call shape
   * with its own signature — see {@link StreamOptions} — and not a client default.
   */
  parse?: Exclude<ParseMode, 'stream'>
  /** Forwarded to `fetch` untouched; see {@link SignalSource} for the function form. */
  signal?: SignalSource | null
  /**
   * The function to call instead of the global `fetch`. For server-side rendering, where the
   * framework hands each incoming request its own — carrying its cookies, resolving relative
   * URLs, short-circuiting same-app routes — and nothing ambient can stand in for it.
   * Resolved at request time when unset, so a polyfill installed after import still applies.
   */
  fetch?: Fetch
  /**
   * Required by `fetch` for a `ReadableStream` body, and set automatically for one. The DOM
   * lib's `RequestInit` omits it, so this is where a caller can override it.
   */
  duplex?: 'half'
}

/**
 * The options of a call that wants the body unread, as a `ReadableStream<Uint8Array>`. The
 * call signature that takes these has no `<T>`, because the type is already known — so
 * `api.get<User>('/x', { parse: 'stream' })` is a compile error, not a stream wearing a
 * `User`'s name.
 */
export type StreamOptions = Omit<AirOptions, 'parse'> & { parse: 'stream' }

/**
 * Either options shape, for the implementation: `request()` takes both. Never exported —
 * where a caller meets the union, on {@link AirRequest.options}, it is written out.
 */
export type AnyOptions = AirOptions | StreamOptions

/** The request target: a string, or a `URL` — which is already absolute and skips `baseURL`. */
export type AirURL = string | URL

/** The request as it was sent, attached to every {@link AirError}. */
export interface AirRequest {
  /** The final URL, query string included. */
  url: string
  /** Uppercased. */
  method: string
  /**
   * The headers as actually sent: every source resolved, plus any `Content-Type` the body
   * added. `options.headers` may still be an unevaluated function, which is no use when you
   * are holding a `401` and want to see the token.
   */
  headers: Headers
  /** The merged options the request was made with. */
  options: AirOptions | StreamOptions
}

/** What {@link AirClient.raw} resolves to: the parsed body and the response it came from. */
export interface AirResponse<T = unknown> {
  /** Exactly what the plain client would have resolved to. */
  data: T
  /**
   * For headers, status and URL. Its body has been read into `data` in every mode that
   * reads the body — except `parse: 'stream'`, where `data` *is* `response.body`: one stream
   * under two names, consumed once from either.
   */
  response: Response
}

// Declared once and reused by the callable form and all seven verbs, so a signature cannot
// be added to one and forgotten in another. The stream overload comes first because
// resolution takes the first match, and it carries no <T>: with `parse: 'stream'` there is
// nothing for a caller to assert and nothing to assert wrongly.
interface Call {
  (url: AirURL, options: StreamOptions): Promise<ReadableStream<Uint8Array>>
  <T = unknown>(url: AirURL, options?: AirOptions): Promise<T>
}

interface RawCall {
  (url: AirURL, options: StreamOptions): Promise<AirResponse<ReadableStream<Uint8Array>>>
  <T = unknown>(url: AirURL, options?: AirOptions): Promise<AirResponse<T>>
}

/**
 * The same client, resolving to `{ data, response }` instead of the body alone. Same request,
 * same parsing, same options; it only adds the response. A non-2xx still throws.
 *
 * A separate client rather than a `raw: true` option, because an option that rewrites the
 * return type has to be read back out with a conditional type — the inference the explicit
 * `<T>` exists to avoid.
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

/**
 * An HTTP client. Callable directly (`api('/users')`, a `GET`), with a shortcut per method,
 * a {@link AirClient.raw} twin, and `create()` for deriving a client that inherits these
 * defaults without mutating them. The root export `air` is one of these with empty defaults.
 */
export interface AirClient extends Call {
  get: Call
  post: Call
  put: Call
  patch: Call
  delete: Call
  head: Call
  options: Call
  /** Resolves to both the parsed body and the response. */
  raw: AirRawClient
  /** A client with these defaults merged over the current ones. */
  create(options?: AirOptions): AirClient
}
