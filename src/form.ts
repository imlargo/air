export type FormValue = string | number | boolean | Blob | null | undefined

/**
 * A flat record for {@link toFormData}. Nested objects are a compile error: multipart has no
 * convention for them.
 */
export type FormRecord = Record<string, FormValue | readonly FormValue[]>

/**
 * Builds a `FormData` from a flat record, for the `body` option.
 *
 * @remarks
 * `undefined` and `null` values are dropped. Numbers and booleans are stringified. An array
 * appends the key once per item. A `File` keeps its name; a `Blob` is sent as `blob`.
 *
 * @example
 * ```ts
 * await api.post('/upload', { body: toFormData({ title, tags: ['a', 'b'], file }) })
 * ```
 */
export function toFormData(record: FormRecord): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries(record)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null) continue
      if (item instanceof Blob) form.append(key, item)
      else form.append(key, String(item))
    }
  }
  return form
}
