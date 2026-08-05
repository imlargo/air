export type ParseMode = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'response'

export type QueryValue = string | number | boolean | null | undefined

export type Query = Record<string, QueryValue | readonly QueryValue[]>

export interface AirOptions extends Omit<RequestInit, 'body' | 'headers'> {
  baseURL?: string
  query?: Query
  body?: unknown
  headers?: HeadersInit
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
