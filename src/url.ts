import type { Query, QueryValue } from './types.js'

type QueryRecord = Record<string, QueryValue | readonly QueryValue[]>

// The scheme is required, so a leading "//" is a path, not a protocol-relative URL. Stray
// double slashes from string building are far more common than an intentional
// protocol-relative URL, and those are deprecated anyway.
const ABSOLUTE = /^[a-z][a-z\d+\-.]*:\/\//i

// URLSearchParams and a tuple list spell a repeated key as repeated entries, the record
// spells it as an array. Grouping rather than overwriting is the whole point: this is
// where Object.fromEntries would silently drop every ?tag= but the last.
export function toQueryRecord(query: Query): QueryRecord {
  if (!(query instanceof URLSearchParams) && !Array.isArray(query)) {
    return query as QueryRecord
  }

  const record: Record<string, QueryValue | QueryValue[]> = {}
  for (const [key, value] of query as Iterable<readonly [string, QueryValue]>) {
    const seen = record[key]
    if (!(key in record)) record[key] = value
    else if (Array.isArray(seen)) seen.push(value)
    else record[key] = [seen as QueryValue, value]
  }
  return record
}

export function joinURL(baseURL: string | URL | undefined, path: string): string {
  if (!baseURL || ABSOLUTE.test(path)) return path
  const base = typeof baseURL === 'string' ? baseURL : baseURL.href
  if (!path) return base
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export function buildURL(path: string, baseURL?: string | URL, query?: Query): string {
  const url = joinURL(baseURL, path)
  if (!query) return url

  const hashAt = url.indexOf('#')
  const hash = hashAt === -1 ? '' : url.slice(hashAt)
  const address = hashAt === -1 ? url : url.slice(0, hashAt)
  const queryAt = address.indexOf('?')
  const base = queryAt === -1 ? address : address.slice(0, queryAt)
  const params = new URLSearchParams(queryAt === -1 ? '' : address.slice(queryAt + 1))

  for (const [key, value] of Object.entries(toQueryRecord(query))) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== null) params.append(key, String(item))
    }
  }

  const search = params.toString()
  return `${base}${search ? `?${search}` : ''}${hash}`
}
