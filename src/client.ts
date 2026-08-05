import { prepareBody } from './body.js'
import { AirError, isAirError } from './error.js'
import { parseResponse } from './parse.js'
import { buildURL } from './url.js'
import type { AirClient, AirOptions } from './types.js'

const TIMEOUT = Symbol('timeout')

function mergeHeaders(base?: HeadersInit, extra?: HeadersInit): Headers {
  const headers = new Headers(base)
  new Headers(extra).forEach((value, key) => headers.set(key, value))
  return headers
}

function merge(base: AirOptions, extra?: AirOptions): AirOptions {
  if (!extra) return base
  return {
    ...base,
    ...extra,
    headers: mergeHeaders(base.headers, extra.headers),
    query: base.query || extra.query ? { ...base.query, ...extra.query } : undefined,
  }
}

function isRetryable(error: unknown): boolean {
  if (!isAirError(error)) return false
  const { status } = error
  return status === undefined || status >= 500 || status === 408 || status === 429
}

async function request<T>(path: string, options: AirOptions): Promise<T> {
  const {
    baseURL,
    query,
    timeout,
    retry = 0,
    parse,
    body,
    headers,
    signal,
    method = 'GET',
    ...init
  } = options

  const url = buildURL(path, baseURL, query)
  const verb = method.toUpperCase()
  const info = { url, options }

  const requestHeaders = new Headers(headers)
  let payload: BodyInit | undefined
  if (verb !== 'GET' && verb !== 'HEAD') {
    const prepared = prepareBody(body)
    payload = prepared.body
    if (prepared.contentType && !requestHeaders.has('content-type')) {
      requestHeaders.set('content-type', prepared.contentType)
    }
  }

  const send = async (): Promise<T> => {
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort)
    const timer =
      timeout === undefined
        ? undefined
        : setTimeout(() => controller.abort(TIMEOUT), timeout)

    let response: Response
    try {
      response = await fetch(url, {
        ...init,
        method: verb,
        headers: requestHeaders,
        body: payload,
        signal: controller.signal,
      })
    } catch (error) {
      const reason =
        controller.signal.reason === TIMEOUT
          ? `timed out after ${timeout}ms`
          : controller.signal.aborted
            ? 'was aborted'
            : `failed: ${error instanceof Error ? error.message : String(error)}`
      throw new AirError(`${verb} ${url} ${reason}`, info, { cause: error })
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }

    if (!response.ok) {
      const data = await parseResponse(response).catch(() => undefined)
      throw new AirError(
        `${verb} ${url} failed with ${response.status} ${response.statusText}`,
        info,
        { response, data },
      )
    }

    try {
      return (await parseResponse(response, parse)) as T
    } catch (error) {
      throw new AirError(`${verb} ${url} returned an unreadable body`, info, {
        response,
        cause: error,
      })
    }
  }

  for (let attempt = 0; ; attempt++) {
    try {
      return await send()
    } catch (error) {
      if (attempt >= retry || signal?.aborted || !isRetryable(error)) throw error
    }
  }
}

export function create(defaults: AirOptions = {}): AirClient {
  const call = <T = unknown>(url: string, options?: AirOptions): Promise<T> =>
    request<T>(url, merge(defaults, options))

  const shortcut =
    (method: string) =>
    <T = unknown>(url: string, options?: AirOptions): Promise<T> =>
      request<T>(url, { ...merge(defaults, options), method })

  return Object.assign(call, {
    get: shortcut('GET'),
    post: shortcut('POST'),
    put: shortcut('PUT'),
    patch: shortcut('PATCH'),
    delete: shortcut('DELETE'),
    head: shortcut('HEAD'),
    options: shortcut('OPTIONS'),
    create: (options?: AirOptions): AirClient => create(merge(defaults, options)),
  })
}
