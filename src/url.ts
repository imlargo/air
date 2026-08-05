import type { Query } from './types.js'

// The scheme is optional so that protocol-relative paths ("//cdn.example.com/x") count as
// absolute too. Joining one to a baseURL would silently point at the wrong host.
const ABSOLUTE = /^([a-z][a-z\d+\-.]*:)?\/\//i

export function joinURL(baseURL: string | undefined, path: string): string {
  if (!baseURL || ABSOLUTE.test(path)) return path
  if (!path) return baseURL
  return `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export function buildURL(path: string, baseURL?: string, query?: Query): string {
  const url = joinURL(baseURL, path)
  if (!query) return url

  const hashAt = url.indexOf('#')
  const hash = hashAt === -1 ? '' : url.slice(hashAt)
  const address = hashAt === -1 ? url : url.slice(0, hashAt)
  const queryAt = address.indexOf('?')
  const base = queryAt === -1 ? address : address.slice(0, queryAt)
  const params = new URLSearchParams(queryAt === -1 ? '' : address.slice(queryAt + 1))

  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== null) params.append(key, String(item))
    }
  }

  const search = params.toString()
  return `${base}${search ? `?${search}` : ''}${hash}`
}
