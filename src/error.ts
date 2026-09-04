import type { AirRequest } from './types.js'

// Symbol.for, not a private Symbol(): the registry is shared process-wide, so two copies of
// this package — two versions in a dependency tree, or a bundled copy next to a resolved
// one — agree on the brand where `instanceof` would see two unrelated classes.
const BRAND = Symbol.for('air.error')

/** What `request()` knows about a failure beyond its message. Internal. */
export interface AirErrorInit<T = unknown> {
  response?: Response
  data?: T
  cause?: unknown
}

/**
 * The one error a request can throw. A non-2xx status, a network failure, a timeout, an
 * abort and an unreadable body all arrive as this, so a caller needs a single `catch` shape.
 *
 * `status`, `statusText` and `response` are present for a response that arrived and failed,
 * absent for a request that never got one. `data` is the parsed error body when there is
 * one; a body that fails to parse leaves it `undefined` rather than turning a `500` into a
 * parse error. `cause` is the underlying failure for network errors and aborts.
 *
 * Check for it with {@link isAirError} rather than `instanceof`.
 */
export class AirError<T = unknown> extends Error {
  override readonly name = 'AirError'
  readonly status?: number
  readonly statusText?: string
  readonly data?: T
  /** The request as actually sent — final URL, uppercased method, resolved headers. */
  readonly request: AirRequest
  /**
   * The failed response, for its status, headers and URL. Its body has already been read
   * into `data`, so `response.bodyUsed` is `true` and reading it again throws.
   */
  readonly response?: Response

  constructor(message: string, request: AirRequest, init: AirErrorInit<T> = {}) {
    super(message, { cause: init.cause })
    this.request = request
    this.response = init.response
    this.status = init.response?.status
    this.statusText = init.response?.statusText
    this.data = init.data

    Object.defineProperty(this, BRAND, { value: true })
  }
}

/**
 * True for an {@link AirError} thrown by any copy of this package, including one bundled
 * separately from the copy you imported — which is exactly where `instanceof` fails.
 */
export function isAirError<T = unknown>(error: unknown): error is AirError<T> {
  return typeof error === 'object' && error !== null && BRAND in error
}
