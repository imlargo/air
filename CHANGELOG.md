# Changelog

Notable changes to `@imlargo/air`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html). Since 1.0.0 a breaking change
means a major bump; before it, while the major was `0`, a minor bump carried them.

Entries say what changed for someone _using_ the library. A refactor nobody can observe from
the outside does not get a line here; the git history already has it.

## [Unreleased]

### Changed

- **`engines.node` is now `>=22`**, up from `>=20`. Node 20 reached end of life in April 2026,
  and the CI matrix now runs 22 and 24. Not a breaking change under this project's policy: the
  library itself is unchanged and runs wherever it did.
- **Examples and scripts are TypeScript**, run directly by Node's type stripping (22.18+). The
  examples import `@imlargo/air` by name and are type-checked against the built package, so a
  recipe in the README cannot drift from the types it shows. `node examples/retry.ts` replaces
  `node examples/retry.mjs`.

## [2.1.0] - 2026-09-04

Five utilities, each under its own import path. The client is unchanged and its root export
list does not grow; import a utility and you load exactly one small file.

### Added

- **`retry` from `@imlargo/air/retry`.** A `fetch` that retries transient failures: network
  errors and `408`, `425`, `429`, `500`, `502`, `503`, `504`, up to `attempts` in total,
  honouring `Retry-After` and otherwise waiting a jittered exponential delay. Idempotent
  methods only by default, never a `ReadableStream` body, and never once the caller's signal
  has fired, which also ends the wait between attempts. Replaces the hand-written loop the
  README used to show.
- **`refresh` from `@imlargo/air/refresh`.** A `fetch` that, on a `401`, runs your `headers`
  function once per burst of concurrent failures and re-sends each request once with the
  result. The function receives the underlying `fetch` to call the renewal endpoint with, so a
  renewal cannot wait on the refresh it belongs to. Replaces the README recipe, single-flight
  included.
- **`progress` from `@imlargo/air/progress`.** A `fetch` that reports `{ loaded, total }` after
  every chunk while air reads the body. Status, headers, `url` and `redirected` survive, so
  `raw` sees the same response.
- **`toFormData` from `@imlargo/air/form`.** A flat record to `FormData`: nullish dropped,
  arrays repeated, a `File` keeps its name. Nested objects are a compile error.
- **`toQueryParams` from `@imlargo/air/query`.** Nested objects and dates to a
  `URLSearchParams` for `query`, with the convention stated: ISO dates, bracket keys, and
  arrays as repeated keys, `[]` or commas.
- **README:** a validation recipe with Standard Schema, a migration table from ky, ofetch and
  axios, and a Scope section that says what is left out, why, and what would change that.

## [2.0.0] - 2026-09-04

Three entries under Changed break 1.x: the package name, and two defaults that now tell the
truth.

### Changed

- **Breaking: the package is `@imlargo/air`.** 1.x was published as `@korastd/air`, which
  stays at 1.0.0 and is deprecated. Change the import specifier; nothing else moves.

  ```ts
  import air from '@imlargo/air'
  ```

- **Breaking: every call resolves to `T | null`.** A `204` or an empty body has always resolved
  to `null`; 1.x typed it as `T` anyway. `api.get<User>('/u')` is now `Promise<User | null>`,
  `raw` is `Promise<AirResponse<User | null>>`, and `parse: 'stream'` is
  `Promise<ReadableStream<Uint8Array> | null>`. Where an endpoint always answers with a body,
  narrow at the call site with a null check.
- **Breaking: more content types are detected as streams.** `multipart/x-mixed-replace`,
  `application/ndjson`, `application/x-jsonlines`, `application/json-seq`,
  `application/stream+json` and `application/x-json-stream` join `text/event-stream`,
  `application/x-ndjson` and `application/jsonl`. A finite response with one of the new types
  used to arrive as a `Blob`, a `string` or, for `stream+json`, parsed JSON; it now arrives as a
  `ReadableStream`. `parse` still overrides detection in either direction.
- **`exports` declares `types` explicitly**, for tooling that reads the condition rather than
  looking for a sibling `.d.mts`.
- **Every request merges its options through one path.** Defaults given to the exported
  `create()` used to reach a request without normalization. Not observable through the public
  API.
- **TSDoc on the public surface.** Options, types and error fields show their documentation on
  hover.

### Fixed

- **The existing search string is no longer re-encoded when `query` appends to it.**
  `air.get('/s?msg=hola%20mundo', { query: { page: 2 } })` used to produce `?msg=hola+mundo&page=2`.
  New params are now appended after the existing string, and a query with nothing to append
  leaves the URL untouched.
- **A query-only or fragment-only path is appended to `baseURL` without a slash.**
  `'https://api.test/v1'` + `'?page=2'` is `https://api.test/v1?page=2`, not `/v1/?page=2`.
- **`Content-Type` is matched case-insensitively.** `Application/JSON` parsed as a `Blob`.
- **Error messages no longer end in a space over HTTP/2**, where there is no reason phrase:
  `GET /x failed with 500`, not `failed with 500 `.

## [1.0.0] - 2026-08-19

The API is stable from here: no breaking change without a 2.0. What that covers is the export
list in [CONTRIBUTING.md](./CONTRIBUTING.md) (`air`, `create`, `AirError`, `isAirError` and
the exported types) plus the behaviour the README documents. `engines` moving forward as Node
versions reach end of life is not a breaking change, and neither is a new optional field.

Two entries below break 0.5.0, which is why this is 1.0.0 rather than 0.6.0.

### Added

- **`examples/`: every recipe in the README, runnable and asserted.** Seven files that start
  a local server, exercise the built package over real `fetch`, and check what they claim:
  SSR with an injected `fetch`, refreshing a token on a 401, retry with `Retry-After`,
  download and upload progress, server-sent events, faking the transport in tests, and the
  platform behaviours a mock cannot model. `pnpm examples` runs them; CI runs them on every
  supported Node.

  Not documentation polish: it is the gap all three shipped bugs came through. `duplex` in
  0.2.0, the shared signal in 0.3.1 and the stringified `null` header in 0.5.0 each survived a
  green test run, because the suite mocks `fetch` and a mock agrees with whatever its author
  assumed. All three are now pinned against a real socket.

### Changed

- **`StreamOptions` replaces `AnyOptions` in the export list.** 0.5.0 exported `AnyOptions`
  because narrowing `AirOptions` had left `error.request.options` unnameable, and it was the
  fastest way to close that. The name did not explain itself, and a third options type is one
  more thing to learn for no gain. `AirRequest.options` is now `AirOptions | StreamOptions`,
  written out, and `StreamOptions`, the streaming shape with `parse` required, is exported in its
  place. It is also useful on its own, for building the options as a value:

  ```ts
  import type { StreamOptions } from '@korastd/air'

  const download: StreamOptions = { parse: 'stream' }
  await api.get('/big.zip', download)
  ```

  If you referenced `AnyOptions`, write `AirOptions | StreamOptions`; it is the same type.

- **`parse: 'stream'` is no longer accepted as a client default.**
  `air.create({ parse: 'stream' })` is a compile error. It was the one case where the option sat
  out of reach of the call site's signature, so `create({ parse: 'stream' }).get<User>('/x')`
  compiled and lied. It was the last documented hole in `parse`, now closed rather than described. A
  client sends requests to many endpoints, and "every response here is an unread stream" is not
  a thing to mean; pass it per call.

## [0.5.0] - 2026-08-19

### Added

- **`null` removes an inherited header.** Every option could already be opted out of per
  request (`baseURL: undefined`, `query: { key: undefined }`, `signal: null`,
  `fetch: undefined`) except headers, which had no way at all: `''` sends an empty header,
  which is not the same as absent, and a function only ever adds. An authenticated client with
  one public endpoint meant abandoning `create()` and re-specifying everything on a fresh client.

  ```ts
  const api = air.create({ headers: { Authorization: `Bearer ${token}` } })

  await api.get('/public', { headers: { Authorization: null } })
  const anonymous = api.create({ headers: { Authorization: null } })
  ```

  `undefined` does the same, so `{ Authorization: signedIn ? token : undefined }` works as
  written instead of sending the string `"undefined"`. Removal is for the plain-object form
  only, since a `Headers` instance cannot represent "delete", so setting a header stays uniform
  across every shape and removing one is record-only.

- **`query` accepts a `URLSearchParams` or an array of `[key, value]` tuples**, not just the
  record. Both are what you already hold when the params came from somewhere else, such as the
  current URL, a form or another library, and handing one over beats converting it, because
  `Object.fromEntries` keeps only the last of a repeated key and turns `?tag=a&tag=b` into
  `?tag=b`. All three merge with a client's default `query` identically.

  ```ts
  await api.get('/search', { query: new URL(location.href).searchParams })
  ```

  Values stay primitives-only in every shape. A different convention for dates or nested
  objects is still yours to write, and now its output plugs straight into `query`.

- **`baseURL` accepts a `URL`**, matching the request target, which has taken one since 0.1.0.

- **`AnyOptions` is exported**, the type of `error.request.options` and of what `create`
  accepts: both option shapes at once, `parse: 'stream'` included. `AirOptions` is still the one
  you write at a call site.

### Fixed

- **`parse: 'stream'` no longer accepts a type argument that contradicts it.** This compiled,
  and handed back a `ReadableStream` wearing a `User`'s name:

  ```ts
  const user = await api.get<User>('/u', { parse: 'stream' }) // now a compile error
  user.id // ...which used to typecheck, on a ReadableStream
  ```

  It is the same hole 0.4.0 closed by removing `parse: 'response'`, reopened by its
  replacement, and the one defect that could corrupt a program rather than annoy a developer.
  `'stream'` is the one mode whose type air already knows, so it is the one where a caller has
  nothing to assert:

  ```ts
  const body = await api.get('/download', { parse: 'stream' }) // ReadableStream<Uint8Array>
  ```

  Every other mode is unchanged and still takes the `<T>` you assert, since only you know what
  the endpoint returns. A mistyped mode (`parse: 'respons'`) is still caught. If you were
  writing the redundant generic, drop it. That is the only source change this needs.

  One case no signature can reach, now documented: a client-level
  `air.create({ parse: 'stream' })` puts the option nowhere near the call site, so `<T>` there
  still lies.

### Changed

- **`engines.node` is now `>=20`**, up from `>=18`. The README told users to compose signals
  with `AbortSignal.any`, which needs 20.3, so on the version we claimed to support our own
  documentation handed you a `TypeError`. Node 18 has been end-of-life since April 2025, and
  the CI matrix now runs 20, 22 and 24.

## [0.4.1] - 2026-08-18

### Fixed

- **A streaming endpoint no longer hangs forever.** Content-type detection sent
  `text/event-stream` to `text` and `application/x-ndjson` to `blob`, and every parse mode but
  `stream` reads the body to completion. Against a real SSE or NDJSON endpoint, one that stays
  open because that is the entire point of both, the promise never settled. Not a failure you could
  catch: the request had succeeded, the bytes were arriving, and there was no status to inspect,
  no `AirError`, nothing to log.

  ```ts
  await api.get('/events') // before: never resolves. now: a ReadableStream.
  ```

  `text/event-stream`, `application/x-ndjson` and `application/jsonl` are now detected as
  `stream` and handed back unread. `application/octet-stream` is deliberately not on the list,
  despite the name: a binary download ends, and it stays a `Blob`.

  Worth knowing if you were pointing `air` at a **finite** response with one of those types,
  the one case the old behavior actually worked for. It now arrives as a `ReadableStream` rather
  than a `String` or a `Blob`, and `parse` overrides detection in both directions:

  ```ts
  const log = await api.get<string>('/events', { parse: 'text' })
  ```

  This is not a parser and not an `EventSource`: `air` hands back the stream, and reading frames
  out of it stays in userland.

## [0.4.0] - 2026-08-17

### Added

- **`client.raw`: the parsed body _and_ the response.** Every client now carries a `raw` twin
  with the same call shape and the same seven methods, resolving to `{ data, response }`:

  ```ts
  const { data, response } = await api.raw.get<User[]>('/users')
  response.headers.get('link')
  ```

  It changes nothing else: same request, same parsing, same options, and `data` is exactly what
  the plain client would have given you. A non-2xx still throws from both; `error.response` is
  how you hold a failed response.

- **`parse: 'stream'`** hands back the body unread as a `ReadableStream`, typed, without going
  through a `Response`.

### Changed

- **Breaking: `parse: 'response'` is gone**, replaced by the two above. It was doing two unrelated
  jobs, deciding how to read the body and deciding what the call returned, and paid for it: you
  could have the body or the headers but never both, and `<T>` had to be kept in sync with the
  option by hand, so `api.get<User>('/u', { parse: 'response' })` compiled and handed you a
  `Response` typed as a `User`. `parse` now only ever describes the body's shape.

  ```ts
  // before
  const response = await api.get<Response>('/users', { parse: 'response' })
  response.headers.get('link') // and re-parse the body yourself

  // after
  const { data, response } = await api.raw.get<User[]>('/users')
  const body = await api.get<ReadableStream>('/download', { parse: 'stream' }) // unread body
  ```

## [0.3.1] - 2026-08-11

### Fixed

- **A per-request timeout could not be a client default.** `air` has no `timeout` option and
  points you at `AbortSignal.timeout(ms)` instead, but writing one into `air.create()` gave
  you a single signal shared by every request that client would ever make, with its clock
  started at `create()` time. Five seconds later it fired, and because a fired signal stays
  fired, and `fetch` rejects an already-aborted signal before sending anything, every
  request after that failed instantly, without leaving the process:

  ```ts
  const api = air.create({ signal: AbortSignal.timeout(5000) }) // broken after 5s
  ```

  `signal` now accepts a **function** as well, called once per request, so each request gets
  its own:

  ```ts
  const api = air.create({ signal: () => AbortSignal.timeout(5000) })
  ```

  Same fix as lazy `headers`, and it changes nothing about how the signal is treated: still
  forwarded to `fetch` untouched, still no `AbortController` or signal composition inside the
  client. A request-level `signal` replaces the client's rather than combining with it;
  compose them with `AbortSignal.any` in your own function if you want both. Returning
  `undefined` opts a single request out of the client's budget.

  Passing an `AbortSignal` directly is unchanged and still correct per request; only the
  client-default case was broken.

### Added

- **`SignalSource` type**, exported: `AbortSignal | (() => AbortSignal | null | undefined)`.

## [0.3.0] - 2026-08-08

### Added

- **`fetch` option**: hand `air` the function it should call instead of the global `fetch`.
  This is for server-side rendering: SvelteKit's `event.fetch` and the equivalents in Remix,
  Astro and Nuxt forward the incoming request's cookies and headers, resolve a relative URL
  against the current page, and answer a request to your own app by invoking the route
  handler directly rather than making a real HTTP round-trip back to the same process. That
  function only exists inside a request, so a shared service module could not reach it while
  `air` always called the global one.

  ```ts
  export async function load({ fetch }) {
    const api = air.create({ fetch, baseURL: '/api' })
    return { user: await api.get<User>('/me') }
  }
  ```

  It merges like every other option: set it on a client, override it per request, inherit it
  through a chain of `create()` calls. Left unset, the global `fetch` is resolved at request
  time, so a polyfill installed after import still applies.

- **`Fetch` type**, exported. Deliberately looser than the global `fetch`
  (`(input: string, init: RequestInit) => Promise<Response>`), so a framework wrapper typed
  as `typeof fetch` and a hand-written test double are both assignable.

## [0.2.0] - 2026-08-06

### Added

- **`AirError.request` now carries the headers as actually sent**, plus the resolved method.
  Since `headers` went lazy it may be an unevaluated function on `request.options`, which is
  useless at the moment you are staring at a `401`. The resolved `Headers` is built after the
  body has had its say, so any `Content-Type` `air` added is included.
- **`duplex` option**, because the DOM lib's `RequestInit` still omits it and callers had no
  way to pass it. `air` sets it for you on a `ReadableStream`; this is the manual override.

### Fixed

- **Streaming request bodies threw at runtime.** `fetch` refuses a `ReadableStream` body
  unless told `duplex: 'half'`, so an upload documented as supported did not work. The test
  suite could not have caught it: it mocks `fetch`, and a mock does not enforce the
  requirement. Found by sending a stream to a real server.

## [0.1.0] - 2026-08-06

Initial release. A tiny, ESM-only HTTP client over native `fetch`, with zero runtime
dependencies.

### Added

- A callable default export with `get`, `post`, `put`, `patch`, `delete`, `head` and
  `options` shortcuts, and `create()` for clients that inherit defaults without mutating the
  parent.
- `baseURL` joining that does not double slashes, and `query` serialization for primitives
  and arrays of primitives.
- Automatic body detection: `FormData`, `URLSearchParams`, `Blob`, `ArrayBuffer`, typed
  arrays and streams pass through untouched; anything else is JSON, with the `Content-Type`
  set for you.
- Response parsing inferred from `Content-Type`, overridable with `parse`, including
  `parse: 'response'` for the raw `Response`.
- Non-2xx responses throw an `AirError` carrying `status`, `statusText`, the parsed `data`,
  the `request` and the `response`, with `isAirError()` for a check that survives two copies
  of the package in one app.
- Lazy `headers`: a function is re-evaluated on every request, so a long-lived client stays
  correct across a token refresh.
- `string | URL` as the request target.

No timeout or retry options, by design. `AbortSignal.timeout()` and a `for` loop cover both,
and the README shows how.

[Unreleased]: https://github.com/imlargo/air/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/imlargo/air/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/imlargo/air/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/imlargo/air/compare/v0.5.0...v1.0.0
[0.5.0]: https://github.com/imlargo/air/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/imlargo/air/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/imlargo/air/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/imlargo/air/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/imlargo/air/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/imlargo/air/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/imlargo/air/releases/tag/v0.1.0
