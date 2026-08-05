import type { AirRequest } from './types.js'

interface AirErrorInit<T> {
  response?: Response
  data?: T
  cause?: unknown
}

export class AirError<T = unknown> extends Error {
  override readonly name = 'AirError'
  readonly status?: number
  readonly statusText?: string
  readonly data?: T
  readonly request: AirRequest
  readonly response?: Response

  constructor(message: string, request: AirRequest, init: AirErrorInit<T> = {}) {
    super(message, { cause: init.cause })
    this.request = request
    this.response = init.response
    this.status = init.response?.status
    this.statusText = init.response?.statusText
    this.data = init.data
  }
}

export function isAirError<T = unknown>(error: unknown): error is AirError<T> {
  return error instanceof AirError
}
