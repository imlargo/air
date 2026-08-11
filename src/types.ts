export type ParseMode = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'response'

export type QueryValue = string | number | boolean | null | undefined

export type Query = Record<string, QueryValue | readonly QueryValue[]>

// A function so a long-lived client (`air.create({ headers })`) can hand back a
// fresh value — e.g. the current bearer token — on every request instead of the
// one captured when the client was created.
export type HeaderSource = HeadersInit | (() => HeadersInit | Promise<HeadersInit>)

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
  baseURL?: string
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

export interface AirClient {
  <T = unknown>(url: AirURL, options?: AirOptions): Promise<T>
  get<T = unknown>(url: AirURL, options?: AirOptions): Promise<T>
  post<T = unknown>(url: AirURL, options?: AirOptions): Promise<T>
  put<T = unknown>(url: AirURL, options?: AirOptions): Promise<T>
  patch<T = unknown>(url: AirURL, options?: AirOptions): Promise<T>
  delete<T = unknown>(url: AirURL, options?: AirOptions): Promise<T>
  head<T = unknown>(url: AirURL, options?: AirOptions): Promise<T>
  options<T = unknown>(url: AirURL, options?: AirOptions): Promise<T>
  create(options?: AirOptions): AirClient
}
