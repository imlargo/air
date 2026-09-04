import type { Query, QueryValue } from './types.js'

type QueryRecord = Record<string, QueryValue | readonly QueryValue[]>

// The scheme is required, so a leading "//" is a path, not a protocol-relative URL: stray
// double slashes from string building are far more common than an intentional
// protocol-relative URL, and those are deprecated anyway.
const ABSOLUTE = /^[a-z][a-z\d+\-.]*:\/\//i

// A path that is only a query string or a fragment extends the base URL instead of
// descending from it, so no slash goes between them.
const EXTENDS_BASE = /^[?#]/

/**
 * Folds every {@link Query} shape into the record form.
 *
 * A `URLSearchParams` and a tuple list spell a repeated key as repeated entries; the record
 * spells it as an array. Grouping rather than overwriting is the point — `Object.fromEntries`
 * keeps only the last `?tag=`, which is how `?tag=a&tag=b` silently becomes `?tag=b`.
 */
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

/**
 * Joins a base URL and a path as strings, never as URL resolution: `https://api.test/v1` +
 * `/users` keeps the `/v1`, which `new URL()` would drop. Redundant slashes on either side of
 * the join collapse to one. An absolute path ignores the base entirely.
 */
export function joinURL(baseURL: string | URL | undefined, path: string): string {
  if (!baseURL || ABSOLUTE.test(path)) return path
  const base = typeof baseURL === 'string' ? baseURL : baseURL.href
  if (!path) return base
  if (EXTENDS_BASE.test(path)) return base + path
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

/**
 * The final URL: base and path joined, then `query` appended to whatever search string is
 * already there. `undefined` and `null` values are dropped, arrays repeat the key, and the
 * fragment stays last.
 *
 * The existing search string is left byte-for-byte alone. Re-serialising it through
 * `URLSearchParams` would turn `%20` into `+` on params the caller never asked air to touch,
 * so new params are appended after it, and a query with nothing to append returns the URL
 * untouched.
 */
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

  const hashAt = url.indexOf('#')
  const address = hashAt === -1 ? url : url.slice(0, hashAt)
  const hash = hashAt === -1 ? '' : url.slice(hashAt)
  const separator = !address.includes('?') ? '?' : /[?&]$/.test(address) ? '' : '&'
  return `${address}${separator}${search}${hash}`
}
