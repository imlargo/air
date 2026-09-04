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

/**
 * The root client: callable, with a shortcut per method, `raw`, and `create()` for a client
 * with defaults. No defaults of its own.
 *
 * ```ts
 * const user = await air.get<User>('https://api.example.com/users/1')
 * const api = air.create({ baseURL: 'https://api.example.com' })
 * ```
 */
export const air = create()

export default air
