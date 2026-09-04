# air

[![CI](https://github.com/imlargo/air/actions/workflows/ci.yml/badge.svg)](https://github.com/imlargo/air/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@imlargo/air)](https://www.npmjs.com/package/@imlargo/air)

A tiny HTTP client for TypeScript, built on native `fetch`.

- Zero runtime dependencies. ESM only. The client is about 2 kB min+gzip.
- A call resolves to the parsed body. Non-2xx responses throw.
- Bring your own `fetch`, for server-side rendering and for tests.
- No timeout, retry or interceptor machinery in the client. Retry, token refresh, download
  progress and two serializers ship as separate imports that wrap `fetch`; see [Utilities](#utilities).
- Node 20+, browsers, Deno, Bun and edge runtimes, all verified in CI.

```bash
pnpm add @imlargo/air
```

## Usage

```ts
import air from '@imlargo/air'

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
declare module '@imlargo/air' {
  interface AirOptions {
    cf?: { cacheTtl?: number }
  }
}
await api.get('/users', { cf: { cacheTtl: 60 } })
```

`AirOptions` has no index signature by design, so a typo such as `parse: 'respons'` stays an error.

## Utilities

Everything that is not the client lives under its own import path, so the client never grows
and you load only what you use:

| Import                  | Exports         | Does                                                       |
| ----------------------- | --------------- | ---------------------------------------------------------- |
| `@imlargo/air/retry`    | `retry`         | A `fetch` that retries transient failures                  |
| `@imlargo/air/refresh`  | `refresh`       | A `fetch` that refreshes credentials on a 401              |
| `@imlargo/air/progress` | `progress`      | A `fetch` that reports download progress                   |
| `@imlargo/air/form`     | `toFormData`    | A flat record to `FormData`, for `body`                    |
| `@imlargo/air/query`    | `toQueryParams` | Nested objects and dates to `URLSearchParams`, for `query` |

The three wrappers take the same `fetch` option the client does, and default to the global
`fetch`. Compose them by nesting; the outer one runs first:

```ts
import { retry } from '@imlargo/air/retry'
import { progress } from '@imlargo/air/progress'

const api = air.create({
  baseURL: 'https://api.example.com',
  fetch: retry({ attempts: 3, fetch: progress({ onProgress }) }),
})
```

A wrapper sees the request and the response, which is all an interceptor sees. It does not
see air's options or its parsed body, so configure it where you create the client, and derive
a client when one endpoint needs a different configuration.

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

```ts
import { retry } from '@imlargo/air/retry'

const api = air.create({ fetch: retry({ attempts: 3 }) })
```

`retry` repeats a request on a network failure or on `408`, `425`, `429`, `500`, `502`, `503`
or `504`, up to `attempts` in total. Between attempts it waits `Retry-After` when the server
sends it, in full, and otherwise a random delay under an exponential ceiling of 200 ms, 400 ms,
800 ms, so a burst of failures does not become a burst of retries; `delay` replaces that. It
only repeats idempotent methods by default, so a `POST` is sent once unless you list it in
`methods`, and it never repeats a `ReadableStream` body, which the first attempt consumed.

A request whose signal has fired is never retried, and the wait between attempts ends the moment
the signal fires. That signal is also the only cap on `Retry-After`: without one, a server that
says to wait an hour is waited for. Give clients that talk to third parties a
`signal: () => AbortSignal.timeout(ms)` that covers the retries too.

The last response is returned as-is, so a status that is still failing throws the usual
`AirError`.

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

A header function runs before the request; it cannot see a 401. `refresh` can:

```ts
import { refresh } from '@imlargo/air/refresh'

const session = { token: getToken() }

const api = air.create({
  baseURL: 'https://api.example.com',
  headers: () => ({ Authorization: `Bearer ${session.token}` }),
  fetch: refresh({
    headers: async (fetch) => {
      const { token } = await (
        await fetch('https://api.example.com/auth/renew', {})
      ).json()
      session.token = token
      return { Authorization: `Bearer ${token}` }
    },
  }),
})
```

Your `headers` function runs once per burst, however many requests hit a 401 at the same
moment, and every one of them is re-sent with what it returns. Storing the new token for later
requests is its job too, which is why it is written as above. The retry happens exactly once,
carries the caller's signal so it shares the original deadline, and a token that is still
rejected throws the usual `AirError`. A `ReadableStream` body is not retried.

The `fetch` your function receives is the underlying one, without `refresh`. Call the renewal
endpoint with it, or with a client that does not carry `refresh`. Sent through the wrapped
client, a renewal that itself answered 401 would wait for the refresh it is part of, and hang.

Anything else an interceptor would do, such as logging, metrics or error translation, is the
same shape: a function that takes a `fetch` and returns one.

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

For nested objects and dates, `toQueryParams` states a convention and returns a
`URLSearchParams` that `query` accepts:

```ts
import { toQueryParams } from '@imlargo/air/query'

await api.get('/search', {
  query: toQueryParams({ filter: { since: new Date(), tags: ['a', 'b'] } }),
})
// /search?filter[since]=2026-09-04T...&filter[tags]=a&filter[tags]=b
```

A `Date` becomes its ISO string, a nested object becomes bracket keys, and arrays repeat the
key, or use `[]` or commas with `arrays: 'brackets' | 'comma'`.

## Body

Plain objects and arrays are JSON-encoded with `Content-Type: application/json` unless one is
set. `FormData`, `URLSearchParams`, `Blob`, `File`, `ArrayBuffer`, typed arrays, `ReadableStream`
and strings are sent as-is. `FormData` never gets a `Content-Type`, even one you set, so the
runtime can write the multipart boundary. A `ReadableStream` gets `duplex: 'half'`, which `fetch`
requires. `GET` and `HEAD` never send a body.

`toFormData` builds a `FormData` from a flat record, dropping `null` and `undefined`,
repeating a key for arrays, and keeping a `File`'s name:

```ts
import { toFormData } from '@imlargo/air/form'

await api.post('/upload', { body: toFormData({ title, tags: ['q3', 'final'], file }) })
```

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
import type { StreamOptions } from '@imlargo/air'

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
available in Safari or Firefox. For a body you want parsed rather than streamed, `progress`
reports the same numbers while air reads it:

```ts
import { progress } from '@imlargo/air/progress'

const api = air.create({
  fetch: progress({ onProgress: ({ loaded, total }) => render(loaded, total) }),
})
```

`total` comes from `Content-Length` and is absent when the header is. Upload progress needs
no wrapper: hand `body` a `ReadableStream` that counts as it is read, as in
[`examples/progress.mjs`](./examples/progress.mjs).

## Errors

Every failure throws an `AirError`: a non-2xx status, a network error, a timeout, an abort, or
an unreadable body.

```ts
import { isAirError } from '@imlargo/air'

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

## Validation

To turn the assertion into a check, parse the body with your schema library. The type comes
from the schema, `null` included or not as the schema says, and there is no `<T>` to get wrong:

```ts
const user = User.parse(await api.get('/users/1')) // zod, valibot, arktype, ...
```

Any library that implements [Standard Schema](https://standardschema.dev) works the same way,
and a one-line helper covers all of them:

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec'

async function parse<S extends StandardSchemaV1>(schema: S, value: unknown) {
  const result = await schema['~standard'].validate(value)
  if (result.issues) throw new Error(JSON.stringify(result.issues))
  return result.value as StandardSchemaV1.InferOutput<S>
}

const user = await parse(User, await api.get('/users/1'))
```

air does not take a `schema` option because this line already does the job, with the same
inference. See [Scope](#scope) for how that could change.

## Migrating from ky, ofetch or axios

| You wrote                  | ky                                | ofetch                        | axios                            | air                                                    |
| -------------------------- | --------------------------------- | ----------------------------- | -------------------------------- | ------------------------------------------------------ |
| Base URL, path prefix kept | `prefix`                          | `baseURL`                     | `baseURL`                        | `baseURL`                                              |
| Query params               | `searchParams`                    | `query`                       | `params`                         | `query`                                                |
| JSON body                  | `json: data`                      | `body: data`                  | second argument                  | `body: data`                                           |
| Read the body              | `await ky.get(url).json<T>()`     | `await $fetch<T>(url)`        | `(await axios.get<T>(url)).data` | `await api.get<T>(url)`                                |
| Body and headers together  | the `Response`                    | `$fetch.raw`                  | the response object              | `api.raw.get`                                          |
| Non-2xx                    | throws `HTTPError`                | throws `FetchError`           | throws `AxiosError`              | throws `AirError`                                      |
| Parsed error body          | `await error.response.json()`     | `error.data`                  | `error.response.data`            | `error.data`                                           |
| Timeout                    | `timeout: 5000` (10 s by default) | `timeout: 5000`               | `timeout: 5000`                  | `signal: () => AbortSignal.timeout(5000)`              |
| Retry                      | `retry` (2 by default)            | `retry` (1 on GET by default) | none                             | `fetch: retry()` from `@imlargo/air/retry`, opt-in     |
| Hooks and interceptors     | `hooks`                           | `onRequest`, `onResponse`     | `interceptors`                   | a function around `fetch`; see [Utilities](#utilities) |
| Per-request `fetch`        | `fetch`                           | `fetch`                       | adapter                          | `fetch`                                                |
| Remove an inherited header | not possible                      | not possible                  | `null`                           | `null`                                                 |
| Streams and SSE            | read the `Response` yourself      | `responseType: 'stream'`      | `responseType: 'stream'`         | detected from `Content-Type`, or `parse: 'stream'`     |

Two defaults differ on purpose. air has no default timeout: a request runs until the caller's
signal says otherwise. And air never retries unless you add `retry`, where ofetch retries a
`GET` once on its own.

## Scope

air leaves out caching, request deduplication, queuing, lifecycle hooks, a second transport,
CJS and nested query serialization in the client. Each has a written reason in
[CONTRIBUTING.md](./CONTRIBUTING.md), and the test a feature has to pass is there too: can a
caller already do it with `fetch`, `signal`, `raw` or a loop; does it need information only
the caller has; is it something userland cannot reach; does the signature still say what it does.

That list is a position, not a dogma. Two of the utilities above started as recipes in this
README and moved into the package when they showed up, in the same shape, across several
production codebases. If something is requested often and passes the test, it can be added,
in the client or as another import path. If it is requested often and fails the test, the
answer is a recipe here and a reason there. Open an issue either way.

## Examples

Each recipe above is a runnable file in [`examples/`](./examples). They start a local server,
run the built package over real `fetch`, and assert what they show. CI runs them on every
supported Node version.

| File                                        | Shows                                                    |
| ------------------------------------------- | -------------------------------------------------------- |
| [`ssr.mjs`](./examples/ssr.mjs)             | A per-request `fetch` carrying its own cookies           |
| [`refresh.mjs`](./examples/refresh.mjs)     | `refresh`: one renewal for five concurrent 401s          |
| [`retry.mjs`](./examples/retry.mjs)         | `retry`: `Retry-After`, no POST, no retry after an abort |
| [`progress.mjs`](./examples/progress.mjs)   | `progress` for downloads, a counting stream for uploads  |
| [`serialize.mjs`](./examples/serialize.mjs) | `toQueryParams` and `toFormData` against a server        |
| [`sse.mjs`](./examples/sse.mjs)             | Server-sent events, and when `EventSource` is enough     |
| [`testing.mjs`](./examples/testing.mjs)     | Faking the transport without a global stub               |
| [`platform.mjs`](./examples/platform.mjs)   | Behaviors only a real socket can confirm                 |

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
