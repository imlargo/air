type Primitive = string | number | boolean | Date | null | undefined

/** A value {@link toQueryParams} can serialize: primitives, dates, arrays of those, and nested objects of the same. */
export type QueryParamValue =
  Primitive | readonly Primitive[] | { readonly [key: string]: QueryParamValue }

export interface QueryParamsOptions {
  /**
   * How an array is written: `?tag=a&tag=b`, `?tag[]=a&tag[]=b`, or `?tag=a,b`.
   *
   * @defaultValue `'repeat'`
   */
  arrays?: 'repeat' | 'brackets' | 'comma'
}

/**
 * Serializes nested objects and dates into a `URLSearchParams`, for the `query` option.
 *
 * @remarks
 * The `query` option itself takes primitives only, on purpose. This is the escape hatch, with
 * its convention stated: a `Date` becomes its ISO string, a nested object becomes bracket keys
 * (`filter[since]=...`), and `undefined` and `null` are dropped at any depth.
 *
 * @example
 * ```ts
 * await api.get('/search', { query: toQueryParams({ filter: { since: new Date() }, tags: ['a', 'b'] }) })
 * ```
 */
export function toQueryParams(
  value: Record<string, QueryParamValue>,
  options: QueryParamsOptions = {},
): URLSearchParams {
  const { arrays = 'repeat' } = options
  const params = new URLSearchParams()

  const add = (key: string, item: QueryParamValue): void => {
    if (item === undefined || item === null) return
    if (Array.isArray(item)) {
      const items = (item as readonly Primitive[]).filter(
        (x) => x !== undefined && x !== null,
      )
      if (arrays === 'comma') {
        if (items.length) params.append(key, items.map(text).join(','))
      } else {
        for (const x of items) add(arrays === 'brackets' ? `${key}[]` : key, x)
      }
      return
    }
    if (typeof item === 'object' && !(item instanceof Date)) {
      for (const [inner, nested] of Object.entries(item)) add(`${key}[${inner}]`, nested)
      return
    }
    params.append(key, text(item))
  }

  for (const [key, item] of Object.entries(value)) add(key, item)
  return params
}

const text = (item: Primitive): string =>
  item instanceof Date ? item.toISOString() : String(item)
