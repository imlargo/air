import { create } from './client.js'

export { create } from './client.js'
export { AirError, isAirError } from './error.js'
export type {
  AirClient,
  AirOptions,
  AirRawClient,
  AirRequest,
  AirResponse,
  AirURL,
  AnyOptions,
  Fetch,
  HeaderSource,
  Query,
  QueryValue,
  ParseMode,
  SignalSource,
} from './types.js'

export const air = create()

export default air
