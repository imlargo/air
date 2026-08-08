# air

[![CI](https://github.com/imlargo/air/actions/workflows/ci.yml/badge.svg)](https://github.com/imlargo/air/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@korastd/air)](https://www.npmjs.com/package/@korastd/air)

A tiny, modern HTTP client for TypeScript. Built on native `fetch`.

- Zero runtime dependencies
- ESM only
- Auto-parsing, auto body detection
- Non-2xx responses throw
- Bring your own `fetch` — SvelteKit's `event.fetch` and friends drop straight in
- No timeout or retry machinery — `AbortSignal` and a `for` loop already do that
- Works in Node 18+, browsers, Deno, Bun and edge runtimes

```bash
pnpm add @korastd/air
```

## Usage

```ts
import air from '@korastd/air'

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
  headers: () => ({ Authorization: `Bearer ${getToken()}` }),
})

const user = await api.get<User>('/users/1')
const page = await api.get<Page<User>>('/users', { query: { page: 2, active: true } })

const admin = api.create({ headers: { 'X-Scope': 'admin' } }) // inherits baseURL + headers
```

`headers` can be a function instead of a plain object. `air` calls it on every request, so a
long-lived client stays correct across a token refresh — see [Headers](#headers) below.

## Options

| Option    | Type                                                        | Notes                                   |
| --------- | ----------------------------------------------------------- | --------------------------------------- |
| `baseURL` | `string`                                                    | Joined with the path, no double slashes |
| `method`  | `string`                                                    | Inferred by the shortcuts               |
| `query`   | `Query`                                                     | Primitives and arrays of primitives     |
| `body`    | `unknown`                                                   | Type auto-detected                      |
| `headers` | `HeaderSource`                                              | Merged with client defaults             |
| `signal`  | `AbortSignal`                                               | Forwarded to `fetch` untouched          |
| `parse`   | `'json' \| 'text' \| 'blob' \| 'arrayBuffer' \| 'response'` | Overrides content-type detection        |
| `fetch`   | `Fetch`                                                     | Defaults to the global `fetch`          |

Anything else is forwarded to the underlying `fetch` call.

The request target itself can be a `string` or a `URL` — whatever you already have on hand:

```ts
await air.get(new URL('/users/1', 'https://api.example.com'))
```

A `URL` is already absolute, so `baseURL` is skipped for it, same as for an absolute string.

### Fetch

`air` calls the global `fetch` unless you hand it another one. The reason to hand it another
one is server-side rendering: SvelteKit, Remix, Astro and friends give each request its own
`fetch`, and it is not a detail — it carries the incoming request's cookies and headers,
resolves relative URLs against the current page, and answers a request to your own app by
invoking the route handler directly rather than making a real HTTP round-trip back to
yourself.

```ts
// src/lib/api.ts
export const createApi = (fetch: typeof globalThis.fetch) => air.create({ fetch })

// src/routes/+page.server.ts
export async function load({ fetch }) {
  const api = createApi(fetch)
  return { user: await api.get<User>('/api/me') } // relative, cookies attached, no round-trip
}
```

It merges like any other option, so a client can carry it while a single request overrides it,
and it can arrive per request instead:

```ts
await api.get('/api/me', { fetch })
```

The type is deliberately loose — anything callable as `(url, init) => Promise<Response>`
qualifies, including the global itself, a framework's wrapper, an instrumented fetch that
logs, and a test double:

```ts
const calls: string[] = []
const recorded = air.create({
  fetch: (url, init) => {
    calls.push(url)
    return globalThis.fetch(url, init)
  },
})
```

Leave the option off in the browser and on any client-side navigation — the global `fetch` is
already the right one there.

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
import air, { isAirError } from '@korastd/air'

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

### Headers

`headers` merges with the client's defaults, the request winning on a shared key — same rule
for every `HeadersInit` shape (`Headers`, a plain object, or an array of tuples).

A plain object is evaluated once, when you write it. That is a problem for anything that
changes after the client is created — a bearer token that gets refreshed, for instance:

```ts
// Wrong: the token at create() time is the token forever.
const api = air.create({ headers: { Authorization: `Bearer ${getToken()}` } })
```

Pass a function instead, and `air` calls it on every request:

```ts
const api = air.create({ headers: () => ({ Authorization: `Bearer ${getToken()}` }) })
```

It can be async too, for a refresh that needs a network round trip:

```ts
const api = air.create({
  headers: async () => ({ Authorization: `Bearer ${await getFreshToken()}` }),
})
```

The function runs once per request and `air` does not deduplicate it, so an async one that
actually hits the network will do so on every call — five concurrent requests mean five
refreshes. Deduplicating is your job, and it is the usual single-flight promise:

```ts
let inFlight: Promise<string> | null = null

const token = () => (inFlight ??= refresh().finally(() => (inFlight = null)))

const api = air.create({
  headers: async () => ({ Authorization: `Bearer ${await token()}` }),
})
```

A header function on a client and a plain object (or another function) on a request, or on a
client derived with `create()`, combine the same way static headers do — nothing is resolved,
or frozen, until the request that actually needs it.

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

Type your params with `type`, not `interface`: TypeScript gives object type aliases an
implicit index signature, and interfaces never get one, so an `interface` is not assignable
to `Query`.

### Body

Plain objects and arrays are JSON-stringified and get `Content-Type: application/json`
unless you set one yourself. `FormData`, `URLSearchParams`, `Blob`, `File`, `ArrayBuffer`,
typed arrays, `ReadableStream` and strings are passed through untouched — in particular
`FormData` never gets a `Content-Type`, even one you set yourself, so the runtime can set
the multipart boundary. `GET` and `HEAD` never send a body.

A `ReadableStream` body additionally gets `duplex: 'half'`, which `fetch` requires in order
to stream a request at all. Pass your own `duplex` to override it.

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
import { isAirError } from '@korastd/air'

try {
  await api.get('/users/1')
} catch (error) {
  if (isAirError(error)) {
    error.status // 404
    error.statusText // 'Not Found'
    error.data // parsed error body, if any
    error.request // { url, method, headers, options } — headers as actually sent
    error.response // the raw Response, for escape hatches
    error.cause // the underlying failure, for network errors and aborts
  }
}
```

`isAirError` matches on a `Symbol.for('air.error')` brand rather than `instanceof`, so it
still works when an app ends up with two copies of the package loaded.

### Types

```ts
air.get<User[]>('/users') // Promise<User[]>
air.get('/users') // Promise<unknown> — never `any`
```

## Development

```bash
pnpm build      # tsdown → dist/ (ESM + .d.ts)
pnpm test       # vitest run
pnpm lint       # eslint . --max-warnings 0
pnpm format     # prettier --write .
pnpm demo       # build, then run examples/demo.mjs against real endpoints
```

See [CHANGELOG.md](./CHANGELOG.md) for what changed in each release, and
[CONTRIBUTING.md](./CONTRIBUTING.md) for the design philosophy and the behavior rules behind
these choices.
