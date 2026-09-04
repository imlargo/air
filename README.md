# air

[![CI](https://github.com/imlargo/air/actions/workflows/ci.yml/badge.svg)](https://github.com/imlargo/air/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@korastd/air)](https://www.npmjs.com/package/@korastd/air)

A tiny HTTP client for TypeScript, built on native `fetch`.

- Zero runtime dependencies. ESM only. About 2.5 kB min+gzip.
- A call resolves to the parsed body. Non-2xx responses throw.
- Bring your own `fetch`, for server-side rendering and for tests.
- No timeout, retry or interceptor machinery. `AbortSignal` and a function you write cover them.
- Node 20+, browsers, Deno, Bun and edge runtimes.

```bash
pnpm add @korastd/air
```

## Usage

```ts
import air from '@korastd/air'

const user = await air<User>('https://api.example.com/users/1') // GET
const users = await air.get<User[]>('https://api.example.com/users')
const created = await air.post<User>('https://api.example.com/users', {
  body: { name: 'Ada' },
})
```

Shortcuts: `get`, `post`, `put`, `patch`, `delete`, `head`, `options`.

## Clients

`air.create(defaults)` returns a client with the same shape as `air`. Its own `create()` derives
a further client that inherits these defaults.

```ts
const api = air.create({
  baseURL: 'https://api.example.com',
  headers: () => ({ Authorization: `Bearer ${getToken()}` }),
})

const user = await api.get<User>('/users/1')
const page = await api.get<Page<User>>('/users', { query: { page: 2, active: true } })

const admin = api.create({ headers: { 'X-Scope': 'admin' } })
```

## Options

| Option    | Type                                          | Notes                                                       |
| --------- | --------------------------------------------- | ----------------------------------------------------------- |
| `baseURL` | `string \| URL`                               | Joined with the path as strings; the path prefix is kept    |
| `method`  | `string`                                      | Set by the shortcuts                                        |
| `query`   | `Query`                                       | Record, `URLSearchParams` or `[key, value]` tuples          |
| `body`    | `unknown`                                     | Type detected; see [Body](#body)                            |
| `headers` | `HeaderSource`                                | Merged over the client's; `null` removes; may be a function |
| `signal`  | `SignalSource`                                | Forwarded to `fetch` unchanged; may be a function           |
| `parse`   | `'json' \| 'text' \| 'blob' \| 'arrayBuffer'` | Overrides detection; `'stream'` has its own shape           |
| `fetch`   | `Fetch`                                       | Replaces the global `fetch`                                 |

Any other field is forwarded to `fetch` unchanged. A request's option wins over the client's, and
an explicit `undefined` on the request clears the client's value. `headers` and `query` merge
instead, the request winning on a shared key.

The request target is a `string` or a `URL`. A `URL` is absolute, so `baseURL` is ignored for it.

### Runtime-specific options

Next.js (`next`), Cloudflare Workers (`cf`) and undici (`dispatcher`) extend `RequestInit` with
their own fields. `air` forwards them, but an object literal carrying an undeclared field does not
compile. Two ways through:

```ts
// 1. The runtime augments RequestInit globally. Next.js does, so this compiles in a Next app:
await api.get('/users', { next: { revalidate: 60 } })

// 2. Augment AirOptions once, in any .d.ts of your project:
declare module '@korastd/air' {
  interface AirOptions {
    cf?: { cacheTtl?: number }
  }
}
await api.get('/users', { cf: { cacheTtl: 60 } })
```

`AirOptions` has no index signature by design, so a typo such as `parse: 'respons'` stays an error.

## Fetch

On the server, frameworks hand each incoming request its own `fetch`. It carries that request's
cookies, resolves relative URLs against the current page, and calls same-app routes directly.
Pass it as an option; it merges like any other.

```ts
// src/lib/api.ts
export const createApi = (fetch: typeof globalThis.fetch) => air.create({ fetch })

// src/routes/+page.server.ts
export async function load({ fetch }) {
  const api = createApi(fetch)
  return { user: await api.get<User>('/api/me') }
}
```

`Fetch` is `(url: string, init: RequestInit) => Promise<Response>`, so the global, a framework
wrapper, an instrumented fetch and a test double are all assignable:

```ts
const api = air.create({
  fetch: (url, init) => {
    console.log(init.method, url)
    return fetch(url, init)
  },
})
```

## Timeouts

Use the platform's:

```ts
await api.get('/users', { signal: AbortSignal.timeout(5000) })
```

Combine with your own cancellation via `AbortSignal.any` (Node 20.3+):

```ts
await api.get('/users', {
  signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
})
```

For a client-wide budget, pass a function. It runs once per request, so each request gets its
own signal:

```ts
const api = air.create({ signal: () => AbortSignal.timeout(5000) })
```

Do not write a signal instance into a client's defaults. A signal is single-use, so a shared
`AbortSignal.timeout(5000)` fails every request after its first five seconds. A request-level
`signal` replaces the client's; returning `undefined` from the function opts one request out.

## Retries

Write the loop. It is shorter than any option, and it can see your `AbortSignal`, which is how
a cancellation is told apart from a transient failure.

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

await withRetry(() => api.get('/slow', { signal: AbortSignal.timeout(2000) }), signal)
```

Build the request inside the callback so each attempt gets a fresh signal. See
[`examples/retry.mjs`](./examples/retry.mjs) for `429` and `Retry-After`.

## Headers

Headers merge over the client's, the request winning on a shared key, for every `HeadersInit`
shape. In the record form, `null` or `undefined` removes an inherited header:

```ts
const api = air.create({ headers: { Authorization: `Bearer ${token}` } })

await api.get('/public', { headers: { Authorization: null } })
const anonymous = api.create({ headers: { Authorization: null } })
```

A plain object is evaluated once. For a value that changes, such as a refreshed token, pass a
function. It runs on every request and may be async:

```ts
const api = air.create({ headers: () => ({ Authorization: `Bearer ${getToken()}` }) })
```

```ts
const api = air.create({
  headers: async () => ({ Authorization: `Bearer ${await getFreshToken()}` }),
})
```

An async header function is not deduplicated. Single-flight it yourself if it hits the network:

```ts
let inFlight: Promise<string> | null = null
const token = () => (inFlight ??= refresh().finally(() => (inFlight = null)))
```

## Refreshing a token on a 401

A header function runs before the request; it cannot see a 401. A `fetch` wrapper can:

```ts
let access = getToken()
let inFlight: Promise<string> | null = null

const renew = () =>
  (inFlight ??= refreshToken()
    .then((token) => (access = token))
    .finally(() => (inFlight = null)))

const api = air.create({
  baseURL: 'https://api.example.com',
  headers: () => ({ Authorization: `Bearer ${access}` }),
  fetch: async (url, init) => {
    const response = await fetch(url, init)
    if (response.status !== 401) return response

    response.body?.cancel()
    const token = await renew()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    return fetch(url, { ...init, headers })
  },
})
```

- Deduplicate the renewal, or concurrent 401s race and the last one wins.
- Retry once. A token that is still rejected surfaces as an `AirError`.
- `init.signal` is the caller's, so the retry shares the original deadline.
- A `ReadableStream` body cannot be replayed. Other body types retry fine.

The same shape covers logging, metrics and error translation. Wrappers compose.

## Query

```ts
air.get('/search?q=air', { query: { tags: ['a', 'b'], page: 2, cursor: null } })
// /search?q=air&tags=a&tags=b&page=2
```

- The existing search string is kept unchanged; new params are appended after it.
- `undefined` and `null` are dropped. `false`, `0` and `''` are kept.
- An array repeats the key. An empty array adds nothing.
- Objects and `Date` are compile errors. Serialize them yourself: `{ since: date.toISOString() }`.
- Declare a record's type with `type`, not `interface`.

`query` also takes a `URLSearchParams` or a tuple list, keeping every value of a repeated key:

```ts
await api.get('/search', { query: new URL(location.href).searchParams })
await api.get('/search', {
  query: [
    ['tag', 'a'],
    ['tag', 'b'],
  ],
})
```

For a different serialization convention, build the params yourself and pass the result.

## Body

Plain objects and arrays are JSON-encoded with `Content-Type: application/json` unless one is
set. `FormData`, `URLSearchParams`, `Blob`, `File`, `ArrayBuffer`, typed arrays, `ReadableStream`
and strings are sent as-is. `FormData` never gets a `Content-Type`, even one you set, so the
runtime can write the multipart boundary. A `ReadableStream` gets `duplex: 'half'`, which `fetch`
requires. `GET` and `HEAD` never send a body.

## Response

The body is parsed from the response `Content-Type`:

| Content type                                                                                 | Resolves to      |
| -------------------------------------------------------------------------------------------- | ---------------- |
| `application/json`, `*+json`                                                                 | parsed JSON      |
| `text/*`                                                                                     | `string`         |
| `text/event-stream`, `multipart/x-mixed-replace`                                             | `ReadableStream` |
| `application/x-ndjson`, `application/ndjson`, `application/jsonl`, `application/x-jsonlines` | `ReadableStream` |
| `application/json-seq`, `application/stream+json`, `application/x-json-stream`               | `ReadableStream` |
| anything else                                                                                | `Blob`           |

A `204` or an empty body resolves to `null`, and the return type says so: every call is
`Promise<T | null>`. Record-stream and open-ended formats are returned unread because they are
meant to be consumed as they arrive. `application/octet-stream` is a `Blob`.

`parse` overrides detection:

```ts
const csv = await api.get<string>('/export', { parse: 'text' })
const body = await api.get('/download', { parse: 'stream' }) // ReadableStream<Uint8Array>
```

`parse: 'stream'` takes no type argument, since the type is known, and is not accepted as a client
default. To build the options as a value, use `StreamOptions`:

```ts
import type { StreamOptions } from '@korastd/air'

const download: StreamOptions = { parse: 'stream' }
```

## Raw

`client.raw` resolves to the body and the response, for headers, status and the final URL:

```ts
const { data, response } = await api.raw.get<User[]>('/users')

response.headers.get('link')
response.status
```

`raw` has every shortcut and parses exactly like the plain client. The response's body has been
read into `data`, so `response.bodyUsed` is `true`. With `parse: 'stream'`, `data` is
`response.body` itself, which pairs the stream with the headers that describe it:

```ts
const { data, response } = await api.raw.get('/big.zip', { parse: 'stream' })

const total = Number(response.headers.get('content-length'))
const reader = data.getReader()
let loaded = 0

for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  loaded += value.length
  onProgress(loaded / total)
}
```

Use `getReader()` rather than `for await`: async iteration over a `ReadableStream` is not
available in Safari or Firefox.

## Errors

Every failure throws an `AirError`: a non-2xx status, a network error, a timeout, an abort, or
an unreadable body.

```ts
import { isAirError } from '@korastd/air'

try {
  await api.get('/users/1')
} catch (error) {
  if (isAirError(error)) {
    error.status // 404; undefined when no response arrived
    error.statusText
    error.data // parsed error body, if any
    error.request // { url, method, headers, options }, headers as sent
    error.response // the Response; its body is already read into data
    error.cause // the underlying failure, for network errors and aborts
  }
}
```

The message ends in `timed out` for `AbortSignal.timeout`, `was aborted` for `abort()`, and
`failed: <reason>` for `abort(reason)` or a network error.

`isAirError` checks a `Symbol.for('air.error')` brand, so it works across two copies of the
package where `instanceof` would not.

`error.request.headers` holds the headers as sent, `Authorization` included. Redact before
logging an `AirError` whole.

## Types

```ts
air.get<User[]>('/users') // Promise<User[] | null>
air.get('/users') // Promise<unknown>
air.raw.get<User[]>('/users') // Promise<AirResponse<User[] | null>>
air.get('/download', { parse: 'stream' }) // Promise<ReadableStream<Uint8Array> | null>
```

`<T>` is your assertion about the body when there is one; it is not validated. `null` is what a
`204` or an empty body resolves to, so the type includes it. When an endpoint always answers with
a body, narrow at the call site:

```ts
const user = await api.get<User>('/users/1')
if (!user) throw new Error('expected a body')
```

## Examples

Each recipe above is a runnable file in [`examples/`](./examples). They start a local server,
run the built package over real `fetch`, and assert what they show. CI runs them on every
supported Node version.

| File                                      | Shows                                                 |
| ----------------------------------------- | ----------------------------------------------------- |
| [`ssr.mjs`](./examples/ssr.mjs)           | A per-request `fetch` carrying its own cookies        |
| [`refresh.mjs`](./examples/refresh.mjs)   | Refreshing a token on a 401, single-flighted          |
| [`retry.mjs`](./examples/retry.mjs)       | Retry honoring `Retry-After`, never on a cancellation |
| [`progress.mjs`](./examples/progress.mjs) | Download and upload progress                          |
| [`sse.mjs`](./examples/sse.mjs)           | Server-sent events, and when `EventSource` is enough  |
| [`testing.mjs`](./examples/testing.mjs)   | Faking the transport without a global stub            |
| [`platform.mjs`](./examples/platform.mjs) | Behaviors only a real socket can confirm              |

```bash
pnpm examples
node examples/retry.mjs
```

## Development

```bash
pnpm check      # format check, lint, typecheck, tests, build
pnpm test:watch
pnpm examples   # build, then run examples/ against a local server
pnpm demo       # build, then run examples/demo.mjs against real endpoints
```

See [CHANGELOG.md](./CHANGELOG.md) for releases and [CONTRIBUTING.md](./CONTRIBUTING.md) for
the design rules.
