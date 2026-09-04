import type { Query, QueryValue } from './types.js'

type QueryRecord = Record<string, QueryValue | readonly QueryValue[]>

// Requires a scheme, so `//host/path` is a path: protocol-relative URLs are deprecated, and a
// doubled slash from string concatenation is the far more common input.
const ABSOLUTE = /^[a-z][a-z\d+\-.]*:\/\//i

const EXTENDS_BASE = /^[?#]/

export function toQueryRecord(query: Query): QueryRecord {
  if (!(query instanceof URLSearchParams) && !Array.isArray(query)) {
    return query as QueryRecord
  }

  const record: Record<string, QueryValue | QueryValue[]> = {}
  for (const [key, value] of query as Iterable<readonly [string, QueryValue]>) {
    const seen = record[key]
    if (!(key in record)) record[key] = value
    else if (Array.isArray(seen)) seen.push(value)
    else record[key] = [seen, value]
  }
  return record
}

// String join rather than `new URL(path, base)`, which would drop a path prefix on the base.
export function joinURL(baseURL: string | URL | undefined, path: string): string {
  if (!baseURL || ABSOLUTE.test(path)) return path
  const base = typeof baseURL === 'string' ? baseURL : baseURL.href
  if (!path) return base
  if (EXTENDS_BASE.test(path)) return base + path
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export function buildURL(path: string, baseURL?: string | URL, query?: Query): string {
  const url = joinURL(baseURL, path)
  if (!query) return url

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(toQueryRecord(query))) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== null) params.append(key, String(item))
    }
  }
  const search = params.toString()
  if (!search) return url

  // Appended to the existing search string rather than merged through URLSearchParams, which
  // would re-encode it (`%20` becomes `+`).
  const hashAt = url.indexOf('#')
  const address = hashAt === -1 ? url : url.slice(0, hashAt)
  const hash = hashAt === -1 ? '' : url.slice(hashAt)
  const separator = !address.includes('?') ? '?' : /[?&]$/.test(address) ? '' : '&'
  return `${address}${separator}${search}${hash}`
}
