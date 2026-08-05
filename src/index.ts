import { create } from './client.js'

export { create } from './client.js'
export { AirError, isAirError } from './error.js'
export { retry, isRetryable } from './retry.js'
export type { RetryOptions } from './retry.js'
export type {
  AirClient,
  AirOptions,
  AirRequest,
  Query,
  QueryValue,
  ParseMode,
} from './types.js'

export const air = create()

export default air
