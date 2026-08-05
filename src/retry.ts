import { isAirError, type AirError } from './error.js'

export interface RetryOptions {
  attempts?: number
  delay?: number | ((attempt: number) => number)
  when?: (error: unknown) => boolean
}

const isAbort = (error: AirError) =>
  error.cause instanceof Error && error.cause.name === 'AbortError'

export function isRetryable(error: unknown): boolean {
  if (!isAirError(error)) return false
  const { status } = error
  if (status === undefined) return !isAbort(error)
  return status === 408 || status === 429 || status >= 500
}

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { attempts = 3, delay = 0, when = isRetryable } = options

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt)
    } catch (error) {
      if (attempt >= attempts || !when(error)) throw error
      const wait = typeof delay === 'function' ? delay(attempt) : delay
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
}
