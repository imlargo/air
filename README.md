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
- Works in Node 20+, browsers, Deno, Bun and edge runtimes

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

| Option    | Type                                                      | Notes                                   |
| --------- | --------------------------------------------------------- | --------------------------------------- |
| `baseURL` | `string \| URL`                                           | Joined with the path, no double slashes |
| `method`  | `string`                                                  | Inferred by the shortcuts               |
| `query`   | `Query`                                                   | Record, `URLSearchParams`, or tuples    |
| `body`    | `unknown`                                                 | Type auto-detected                      |
| `headers` | `HeaderSource`                                            | Merged with defaults; `null` removes    |
| `signal`  | `SignalSource`                                            | Forwarded to `fetch` untouched          |
| `parse`   | `'json' \| 'text' \| 'blob' \| 'arrayBuffer' \| 'stream'` | Overrides content-type detection        |
| `fetch`   | `Fetch`                                                   | Defaults to the global `fetch`          |

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

To combine a timeout with your own cancellation, compose the signals with `AbortSignal.any`
(Node 20.3+, so every version in the supported range but the first three patches of 20):

```ts
await api.get('/users', {
  signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
})
```

`air` forwards `signal` to `fetch` untouched, so the abort covers the whole request,
including a slow body download.

To give every request on a client the same budget, pass a **function**. `air` calls it once
per request, so each one gets its own signal:

```ts
const api = air.create({ signal: () => AbortSignal.timeout(5000) })
```

Do not write the signal itself into a client's defaults. It is a single instance shared by
every request that client will ever make, and its clock starts at `create()` time:

```ts
// Wrong: five seconds after this line, every request fails instantly without being sent.
const api = air.create({ signal: AbortSignal.timeout(5000) })
```

A fired signal stays fired, and `fetch` rejects an already-aborted one before it sends
anything — so the client works for five seconds and is then permanently broken. This is the
same trap as a static `Authorization` header, and it has the same fix: a function.

A request-level `signal` replaces the client's rather than combining with it, so compose the
two yourself when you want both:

```ts
await api.get('/users', {
  signal: () => AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
})
```

Returning `undefined` from the function opts a single request out of the client's budget —
for one endpoint that is legitimately slow, say.

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

To _remove_ an inherited header rather than replace it, set it to `null`:

```ts
const api = air.create({ headers: { Authorization: `Bearer ${token}` } })

await api.get('/public', { headers: { Authorization: null } }) // sent without it
const anonymous = api.create({ headers: { Authorization: null } }) // and so is every call on this
```

`''` is not the same thing — it sends an empty header — and a function can only ever add, so
`null` is the only way to say it. `undefined` does the same, so
`{ Authorization: signedIn ? token : undefined }` works as written.

This is the one place the shapes are not uniform: removal is for the plain-object form only,
because a `Headers` instance has no way to represent "delete". Setting a header behaves the
same across all three.

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

### Refreshing on a 401

A header function keeps a token fresh _before_ a request goes out. It cannot react to one that
comes back rejected — by then the request has already been sent. `air` has no response hook for
that, and does not need one: a wrapper around [`fetch`](#fetch) sees the response, so the whole
pattern is an ordinary function.

```ts
let access = getToken()
let inFlight: Promise<string> | null = null

// One renewal at a time, however many requests hit a 401 at once.
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

    response.body?.cancel() // the 401 body goes unread; release the connection
    const token = await renew()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    return fetch(url, { ...init, headers })
  },
})
```

Four details worth getting right:

- **Deduplicate the renewal.** Five concurrent requests each get a 401 and each call `renew` —
  without the `inFlight` promise that is five renewals racing, and the last one to land wins.
  Same problem and same fix as an async header function, above.
- **Re-send once, never loop.** The wrapper sends the request again and returns whatever comes
  back, so a token that is still rejected surfaces as a normal `AirError` instead of spinning.
- **The signal rides along.** `init` already carries the caller's `signal`, so the retry is
  covered by it — and spends the _same_ budget. `signal: () => AbortSignal.timeout(5000)` gives
  the original request, the renewal and the retry five seconds between them, not five each; a
  renewal slower than what is left aborts the retry, which is the point of a deadline.
- **A `ReadableStream` body cannot be replayed.** It was consumed by the first attempt, so the
  retry fails at the transport. Strings, `FormData`, `URLSearchParams` and `Blob`s are all
  re-readable and retry fine — a streaming upload has to handle its own 401.

The same shape covers the rest of what a response hook would be for: logging, metrics, a
translated error. It is one function you already know how to write, and it composes — the
wrapper can wrap another wrapper.

### Query

Existing search params are preserved, `undefined` and `null` are dropped, and arrays produce
repeated keys.

```ts
air.get('/search?q=air', { query: { tags: ['a', 'b'], page: 2, cursor: null } })
// /search?q=air&tags=a&tags=b&page=2
```

`query` also takes a `URLSearchParams` or an array of `[key, value]` tuples, for when the
params came from somewhere else and you already hold one:

```ts
await api.get('/search', { query: new URL(location.href).searchParams })
await api.get('/search', {
  query: [
    ['tag', 'a'],
    ['tag', 'b'],
  ],
})
```

All three merge with a client's default `query` the same way. Repeated keys survive the
conversion — `?tag=a&tag=b` stays both — which is the reason to hand the `URLSearchParams`
over rather than convert it yourself: `Object.fromEntries` keeps only the last one.

Only primitives and arrays of primitives are allowed. Objects and `Date`s are a compile
error rather than a silent `[object Object]` — serialize them yourself
(`{ since: date.toISOString() }`). If you want a different convention for those — bracket
notation, JSON-encoded values — write the serializer and hand `air` its output as tuples or
a `URLSearchParams`; it merges like any other query.

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

Three content types are handed back **unread**, as a `ReadableStream`, because they are
streams by definition and reading one to completion means waiting for an endpoint that is
designed never to close:

| Content type                                | Resolves to      |
| ------------------------------------------- | ---------------- |
| `text/event-stream` (server-sent events)    | `ReadableStream` |
| `application/x-ndjson`, `application/jsonl` | `ReadableStream` |

`application/octet-stream` is **not** one of them, despite the name — it is a `Blob` like
any other binary payload.

`parse` overrides the detection — `'json'`, `'text'`, `'blob'`, `'arrayBuffer'`, or
`'stream'` for the body unread as a `ReadableStream`:

```ts
const csv = await api.get<string>('/export', { parse: 'text' })
const body = await api.get<ReadableStream>('/download', { parse: 'stream' })
```

It overrides in both directions, so a finite SSE response can still be buffered:

```ts
const log = await api.get<string>('/events', { parse: 'text' })
```

### Raw

A call resolves to the body, which is the point — but a `Link` header, an `ETag`, a rate
limit or a `201` vs `200` lives on the response, not in it. `client.raw` is the same client,
resolving to both halves:

```ts
const { data, response } = await api.raw.get<User[]>('/users')

data[0].name
response.headers.get('link')
response.status
```

`raw` carries every shortcut, is callable directly, and parses exactly like the plain
client — `parse` and every other option behave the same. It only adds the response; it
never changes the body.

Which is also why `response` is there for its headers, status and URL, not for its body: a
body can be read once, and `data` is that read. `response.json()` on what you get back
throws, because `response.bodyUsed` is already `true`.

Unless you asked for the body unread, in which case `data` **is** `response.body` — the same
stream under two names, not two copies. Reading either one consumes the other. Pairing them
is the point: the header tells you how to read the stream.

```ts
const { data, response } = await api.raw.get<ReadableStream>('/big.zip', {
  parse: 'stream',
})

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

`getReader()` rather than `for await (const chunk of data)`: async iteration over a
`ReadableStream` works in Node and Chrome, and throws in Safari and Firefox. A reader loop
works everywhere `air` claims to.

A non-2xx still throws, from both clients. The failed response is `error.response`.

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
air.raw.get<User[]>('/users') // Promise<AirResponse<User[]>> — { data, response }
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
