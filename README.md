# air

A tiny, modern HTTP client for TypeScript. Built on native `fetch`.

- Zero runtime dependencies
- Auto-parsing, auto body detection
- Non-2xx responses throw
- No timeout or retry machinery — `AbortSignal` and a `for` loop already do that
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

| Option    | Type                                                        | Notes                                   |
| --------- | ----------------------------------------------------------- | --------------------------------------- |
| `baseURL` | `string`                                                    | Joined with the path, no double slashes |
| `method`  | `string`                                                    | Inferred by the shortcuts               |
| `query`   | `Query`                                                     | Primitives and arrays of primitives     |
| `body`    | `unknown`                                                   | Type auto-detected                      |
| `headers` | `HeadersInit`                                               | Merged with client defaults             |
| `signal`  | `AbortSignal`                                               | Forwarded to `fetch` untouched          |
| `parse`   | `'json' \| 'text' \| 'blob' \| 'arrayBuffer' \| 'response'` | Overrides content-type detection        |

Anything else is forwarded to the underlying `fetch` call.

### Timeouts

There is no `timeout` option, because the platform already has one:

```ts
await api.get('/users', { signal: AbortSignal.timeout(5000) })
```

To combine a timeout with your own cancellation, compose the signals — `AbortSignal.any`
needs Node 20+:

```ts
await api.get('/users', {
  signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
})
```

`air` forwards `signal` to `fetch` untouched, so the abort covers the whole request,
including a slow body download.

### Retries

`air` ships no retry helper. A loop in your own code is shorter than any API we could offer
for it, and it has something a generic helper cannot have: your `AbortSignal` in scope, so
it can tell a transient failure apart from a request you cancelled on purpose.

```ts
import air, { isAirError } from 'air'

const transient = (error: unknown) =>
  isAirError(error) && (error.status === undefined || error.status >= 500)

async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= attempts || signal.aborted || !transient(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 100))
    }
  }
}
```

Build the request inside the callback so each attempt gets a fresh signal — a signal that has
already fired stays fired:

```ts
await withRetry(() => api.get('/slow', { signal: AbortSignal.timeout(2000) }), signal)
```

### Query

Existing search params are preserved, `undefined` and `null` are dropped, and arrays produce
repeated keys.

```ts
air.get('/search?q=air', { query: { tags: ['a', 'b'], page: 2, cursor: null } })
// /search?q=air&tags=a&tags=b&page=2
```

Only primitives and arrays of primitives are allowed. Objects and `Date`s are a compile
error rather than a silent `[object Object]` — serialize them yourself
(`{ since: date.toISOString() }`).

### Body

Plain objects and arrays are JSON-stringified and get `Content-Type: application/json`
unless you set one yourself. `FormData`, `URLSearchParams`, `Blob`, `File`, `ArrayBuffer`,
typed arrays, `ReadableStream` and strings are passed through untouched — in particular
`FormData` never gets a `Content-Type`, so the runtime can set the multipart boundary.
`GET` and `HEAD` never send a body.

### Response

Parsed from the response `Content-Type`: JSON for `application/json` and `+json` suffixes,
text for `text/*`, a `Blob` otherwise. `204` and empty bodies resolve to `null`.

Use `parse: 'response'` when you need the response itself — headers on a successful call,
or the raw stream:

```ts
const response = await api.get<Response>('/users', { parse: 'response' })
response.headers.get('link')
```

### Errors

Non-2xx responses, network failures, timeouts and aborts all throw an `AirError`.

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
    error.cause // the underlying failure, for network errors and aborts
  }
}
```

`isAirError` matches on a `Symbol.for('air.error')` brand rather than `instanceof`, so it
still works when an app ends up with both the ESM and the CJS copy of the package loaded.

### Types

```ts
air.get<User[]>('/users') // Promise<User[]>
air.get('/users') // Promise<unknown> — never `any`
```

## CommonJS

The source is ESM-first; CJS is emitted for compatibility.

```js
const { air, retry } = require('air')
```

## Development

```bash
pnpm build      # tsdown → dist/ (ESM + CJS + .d.ts)
pnpm test       # vitest run
pnpm lint       # eslint . --max-warnings 0
pnpm format     # prettier --write .
```
