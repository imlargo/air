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
  Fetch,
  HeaderSource,
  Query,
  QueryValue,
  ParseMode,
  SignalSource,
  StreamOptions,
} from './types.js'

/** The default client, with no defaults of its own. */
export const air = create()

export default air
