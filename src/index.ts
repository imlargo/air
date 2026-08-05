import { create } from './client.js'

export { create } from './client.js'
export { AirError, isAirError } from './error.js'
export type { AirClient, AirOptions, AirRequest, ParseMode } from './types.js'

export const air = create()

export default air
