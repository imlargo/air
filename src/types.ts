export type ParseMode = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'response'

export type QueryValue = string | number | boolean | null | undefined

export type Query = Record<string, QueryValue | readonly QueryValue[]>

// A function so a long-lived client (`air.create({ headers })`) can hand back a
// fresh value — e.g. the current bearer token — on every request instead of the
// one captured when the client was created.
export type HeaderSource = HeadersInit | (() => HeadersInit | Promise<HeadersInit>)

export interface AirOptions extends Omit<RequestInit, 'body' | 'headers'> {
  baseURL?: string
  query?: Query
  body?: unknown
  headers?: HeaderSource
  parse?: ParseMode
}

export interface AirRequest {
  url: string
  options: AirOptions
}

export interface AirClient {
  <T = unknown>(url: string, options?: AirOptions): Promise<T>
  get<T = unknown>(url: string, options?: AirOptions): Promise<T>
  post<T = unknown>(url: string, options?: AirOptions): Promise<T>
  put<T = unknown>(url: string, options?: AirOptions): Promise<T>
  patch<T = unknown>(url: string, options?: AirOptions): Promise<T>
  delete<T = unknown>(url: string, options?: AirOptions): Promise<T>
  head<T = unknown>(url: string, options?: AirOptions): Promise<T>
  options<T = unknown>(url: string, options?: AirOptions): Promise<T>
  create(options?: AirOptions): AirClient
}
