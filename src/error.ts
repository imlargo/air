import type { AirRequest } from './types.js'

// A registered symbol is shared process-wide, so two copies of this package recognize each
// other's errors where `instanceof` would not.
const BRAND = Symbol.for('air.error')

/** @internal */
export interface AirErrorInit<T = unknown> {
  response?: Response
  data?: T
  cause?: unknown
}

/**
 * The error thrown for every failed request: a non-2xx status, a network failure, a timeout, an
 * abort, or an unreadable body. Detect it with {@link isAirError}, not `instanceof`.
 */
export class AirError<T = unknown> extends Error {
  override readonly name = 'AirError'
  /** Absent when no response arrived. */
  readonly status?: number
  readonly statusText?: string
  /** The parsed error body. `undefined` when there was none or it could not be parsed. */
  readonly data?: T
  readonly request: AirRequest
  /** The failed response. Its body has already been read into `data`. */
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

/** Also matches an {@link AirError} thrown by another copy of this package. */
export function isAirError<T = unknown>(error: unknown): error is AirError<T> {
  return typeof error === 'object' && error !== null && BRAND in error
}
