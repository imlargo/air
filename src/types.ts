// Every member answers one question — what shape should the body be? — so the
// option means exactly one thing. Where the *response* rather than the body is
// what you need, that is `client.raw`, not a mode here.
export type ParseMode = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream'

export type QueryValue = string | number | boolean | null | undefined

// Three spellings of the same thing. The record is the one to reach for; the other
// two are what a caller already holds when the params came from somewhere else — the
// current URL's `searchParams`, a form, another library. Converting one of those into
// the record by hand is a grouping loop rather than a one-liner, because
// Object.fromEntries keeps only the last of a repeated key and `?tag=a&tag=b`
// collapses to `?tag=b`. Same argument as `URL` for the request target: the option
// was narrower than the primitive it wraps.
export type Query =
  | Record<string, QueryValue | readonly QueryValue[]>
  | URLSearchParams
  | readonly (readonly [string, QueryValue])[]

// `null` as a value removes a header a client default put there. Nothing else can
// say that: '' sends an empty header, which is not the same as absent, and a function
// only ever adds. It is the idiom `signal: null` already uses for "explicitly absent",
// one level deeper. `undefined` does the same, because `query` already drops both and
// splitting them here would be an inconsistency with no argument behind it — and
// because `{ Authorization: enabled ? token : undefined }` is how this gets written.
//
// It works for the record form only — a Headers instance has no way to represent
// "delete" — so the merge rule is uniform across every HeadersInit shape for *setting*
// a header and record-only for *removing* one. That asymmetry is the price of the
// sentinel and it is deliberate; the alternative was a function of the inherited
// headers, which is one argument away from the beforeRequest hook the non-goals forbid.
//
// Deliberately not re-exported from index.ts: it names a shape the implementation
// needs, and `HeaderSource` is the one callers write.
export type HeaderInit = HeadersInit | Record<string, string | null | undefined>

// A function so a long-lived client (`air.create({ headers })`) can hand back a
// fresh value — e.g. the current bearer token — on every request instead of the
// one captured when the client was created.
export type HeaderSource = HeaderInit | (() => HeaderInit | Promise<HeaderInit>)

// Same reason as HeaderSource, and a sharper failure: an AbortSignal written into
// a client's defaults is one instance shared by every request it will ever make,
// so `air.create({ signal: AbortSignal.timeout(5000) })` starts its clock at
// create() time and, five seconds later, fails every subsequent request
// instantly — a fired signal stays fired. A function is called per request, so
// each one gets its own.
export type SignalSource = AbortSignal | (() => AbortSignal | null | undefined)

// Narrower than the global fetch, because air only ever calls it one way: a URL
// string and a full init. Narrow on the parameters means wide on what qualifies,
// so the global itself, a framework's per-request wrapper, and a test double all
// satisfy it.
export type Fetch = (input: string, init: RequestInit) => Promise<Response>

export interface AirOptions extends Omit<RequestInit, 'body' | 'headers' | 'signal'> {
  // `URL` for the same reason the request target takes one: a caller holding a parsed
  // URL should not have to write `.href` to hand it over.
  baseURL?: string | URL
  query?: Query
  body?: unknown
  headers?: HeaderSource
  parse?: ParseMode
  // Still forwarded to fetch untouched — never wrapped, never composed with
  // another signal. The function form only decides *which* signal that is.
  signal?: SignalSource | null
  // The global fetch unless given one. A server framework hands out a wrapper
  // that only exists for the duration of one incoming request — SvelteKit's
  // `event.fetch` forwards that request's cookies, resolves relative URLs
  // against it, and answers a same-app route by calling its handler instead of
  // going back out over HTTP — so it has to arrive as an option; there is
  // nothing ambient for air to reach for.
  fetch?: Fetch
  // Declared here because the DOM lib's RequestInit still omits it, so callers
  // could not pass it even though fetch requires it for a streaming body. air
  // sets it automatically for a ReadableStream; this is the manual override.
  duplex?: 'half'
}

export interface AirRequest {
  url: string
  method: string
  // The headers as actually sent, already resolved and with any Content-Type the
  // body added. `options.headers` may still be an unevaluated function.
  headers: Headers
  options: AirOptions
}

// A URL is already absolute, so it needs no baseURL — the same string a caller
// would get from url.toString(), just without having to write that themselves.
export type AirURL = string | URL

// What a successful call discards once the body is parsed. `data` is the exact
// value the plain client resolves to — the raw client adds the response, it does
// not change the parsing.
export interface AirResponse<T = unknown> {
  data: T
  response: Response
}

// The same seven verbs, resolving to both halves. A separate client rather than
// a `raw: true` option because an option that rewrites the return type has to be
// read back out with a conditional type, which is the inference the explicit
// <T> exists to avoid.
export interface AirRawClient {
  <T = unknown>(url: AirURL, options?: AirOptions): Promise<AirResponse<T>>
  get<T = unknown>(url: AirURL, options?: AirOptions): Promise<AirResponse<T>>
  post<T = unknown>(url: AirURL, options?: AirOptions): Promise<AirResponse<T>>
  put<T = unknown>(url: AirURL, options?: AirOptions): Promise<AirResponse<T>>
  patch<T = unknown>(url: AirURL, options?: AirOptions): Promise<AirResponse<T>>
  delete<T = unknown>(url: AirURL, options?: AirOptions): Promise<AirResponse<T>>
  head<T = unknown>(url: AirURL, options?: AirOptions): Promise<AirResponse<T>>
  options<T = unknown>(url: AirURL, options?: AirOptions): Promise<AirResponse<T>>
}

export interface AirClient {
  <T = unknown>(url: AirURL, options?: AirOptions): Promise<T>
  get<T = unknown>(url: AirURL, options?: AirOptions): Promise<T>
  post<T = unknown>(url: AirURL, options?: AirOptions): Promise<T>
  put<T = unknown>(url: AirURL, options?: AirOptions): Promise<T>
  patch<T = unknown>(url: AirURL, options?: AirOptions): Promise<T>
  delete<T = unknown>(url: AirURL, options?: AirOptions): Promise<T>
  head<T = unknown>(url: AirURL, options?: AirOptions): Promise<T>
  options<T = unknown>(url: AirURL, options?: AirOptions): Promise<T>
  raw: AirRawClient
  create(options?: AirOptions): AirClient
}
