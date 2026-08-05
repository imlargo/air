# air

A tiny, modern HTTP client for TypeScript. Built on native `fetch`.

- Zero runtime dependencies
- Auto-parsing, auto body detection
- Non-2xx responses throw
- Works in Node 18+, browsers, Deno, Bun and edge runtimes

```bash
pnpm add air
```

## Usage

```ts
import air from 'air'

// Callable directly
const data = await air<User>('https://api.example.com/users/1')

// Method shortcuts: get, post, put, patch, delete, head, options
const users = await air.get<User[]>('https://api.example.com/users')
const created = await air.post<User>('https://api.example.com/users', {
  body: { name: 'Ada' },
})
```

### Clients

`air.create()` returns something with the same shape as `air` itself — callable, with the
same shortcuts, and its own `create()` for deriving further clients.

```ts
const api = air.create({
  baseURL: 'https://api.example.com',
  headers: { Authorization: `Bearer ${token}` },
})

const user = await api.get<User>('/users/1')
const page = await api.get<Page<User>>('/users', { query: { page: 2, active: true } })

const admin = api.create({ headers: { 'X-Scope': 'admin' } }) // inherits baseURL + headers
```

## Options

| Option    | Type                                                      | Notes                                   |
| --------- | --------------------------------------------------------- | --------------------------------------- |
| `baseURL` | `string`                                                  | Joined with the path, no double slashes |
| `method`  | `string`                                                  | Inferred by the shortcuts               |
| `query`   | `Record<string, unknown>`                                 | Serialized into the search params       |
| `body`    | `unknown`                                                 | Type auto-detected                      |
| `headers` | `HeadersInit`                                             | Merged with client defaults             |
| `signal`  | `AbortSignal`                                             | Passed through to `fetch`               |
| `timeout` | `number`                                                  | Milliseconds                            |
| `retry`   | `number`                                                  | Retry count for transient failures      |
| `parse`   | `'json' \| 'text' \| 'blob' \| 'arrayBuffer' \| 'stream'` | Overrides content-type detection        |

Anything else is forwarded to the underlying `fetch` call.

### Query

Existing search params are preserved, `undefined` and `null` are dropped, and arrays
produce repeated keys.

```ts
air.get('/search?q=air', { query: { tags: ['a', 'b'], page: 2, cursor: null } })
// /search?q=air&tags=a&tags=b&page=2
```

### Body

Plain objects and arrays are JSON-stringified and get `Content-Type: application/json`
unless you set one yourself. `FormData`, `URLSearchParams`, `Blob`, `File`, `ArrayBuffer`,
typed arrays, `ReadableStream` and strings are passed through untouched — in particular
`FormData` never gets a `Content-Type`, so the runtime can set the multipart boundary.
`GET` and `HEAD` never send a body.

### Response

Parsed from the response `Content-Type`: JSON for `application/json` and `+json` suffixes,
text for `text/*`, a `Blob` otherwise. `204` and empty bodies resolve to `null`. Use
`parse` to override.

### Errors

Non-2xx responses, network failures and timeouts all throw an `AirError`.

```ts
import { isAirError } from 'air'

try {
  await api.get('/users/1')
} catch (error) {
  if (isAirError(error)) {
    error.status // 404
    error.statusText // 'Not Found'
    error.data // parsed error body, if any
    error.request // { url, options }
    error.response // the raw Response, for escape hatches
  }
}
```

`retry` re-sends the request on network errors, timeouts, `408`, `429` and `5xx`. It never
retries after an abort.

### Types

```ts
air.get<User[]>('/users') // Promise<User[]>
air.get('/users') // Promise<unknown> — never `any`
```

## CommonJS

The source is ESM-first; CJS is emitted for compatibility.

```js
const { air } = require('air')
```

## Development

```bash
pnpm build      # tsdown → dist/ (ESM + CJS + .d.ts)
pnpm test       # vitest run
pnpm lint       # eslint . --max-warnings 0
pnpm format     # prettier --write .
```
