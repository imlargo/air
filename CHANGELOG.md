# Changelog

Notable changes to `@korastd/air`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html) — while the major is `0`, a minor
bump is where a breaking change would go.

Entries say what changed for someone _using_ the library. A refactor nobody can observe from
the outside does not get a line here; the git history already has it.

## [Unreleased]

### Fixed

- **A streaming endpoint no longer hangs forever.** Content-type detection sent
  `text/event-stream` to `text` and `application/x-ndjson` to `blob`, and every parse mode but
  `stream` reads the body to completion. Against a real SSE or NDJSON endpoint — one that stays
  open, which is the entire point of both — the promise never settled. Not a failure you could
  catch: the request had succeeded, the bytes were arriving, and there was no status to inspect,
  no `AirError`, nothing to log.

  ```ts
  await api.get('/events') // before: never resolves. now: a ReadableStream.
  ```

  `text/event-stream`, `application/x-ndjson` and `application/jsonl` are now detected as
  `stream` and handed back unread. `application/octet-stream` is deliberately not on the list,
  despite the name — a binary download ends, and it stays a `Blob`.

  Worth knowing if you were pointing `air` at a **finite** response with one of those types —
  the one case the old behavior actually worked for. It now arrives as a `ReadableStream` rather
  than a `String` or a `Blob`, and `parse` overrides detection in both directions:

  ```ts
  const log = await api.get<string>('/events', { parse: 'text' })
  ```

  This is not a parser and not an `EventSource`: `air` hands back the stream, and reading frames
  out of it stays in userland.

## [0.4.0] — 2026-08-17

### Added

- **`client.raw` — the parsed body _and_ the response.** Every client now carries a `raw` twin
  with the same call shape and the same seven methods, resolving to `{ data, response }`:

  ```ts
  const { data, response } = await api.raw.get<User[]>('/users')
  response.headers.get('link')
  ```

  It changes nothing else: same request, same parsing, same options, and `data` is exactly what
  the plain client would have given you. A non-2xx still throws from both — `error.response` is
  how you hold a failed response.

- **`parse: 'stream'`** hands back the body unread as a `ReadableStream`, typed, without going
  through a `Response`.

### Changed

- **Breaking: `parse: 'response'` is gone**, replaced by the two above. It was doing two unrelated
  jobs — deciding how to read the body and deciding what the call returned — and paid for it: you
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

## [0.3.1] — 2026-08-11

### Fixed

- **A per-request timeout could not be a client default.** `air` has no `timeout` option and
  points you at `AbortSignal.timeout(ms)` instead, but writing one into `air.create()` gave
  you a single signal shared by every request that client would ever make, with its clock
  started at `create()` time. Five seconds later it fired, and because a fired signal stays
  fired — and `fetch` rejects an already-aborted signal before sending anything — every
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
  client. A request-level `signal` replaces the client's rather than combining with it —
  compose them with `AbortSignal.any` in your own function if you want both. Returning
  `undefined` opts a single request out of the client's budget.

  Passing an `AbortSignal` directly is unchanged and still correct per request; only the
  client-default case was broken.

### Added

- **`SignalSource` type**, exported: `AbortSignal | (() => AbortSignal | null | undefined)`.

## [0.3.0] — 2026-08-08

### Added

- **`fetch` option** — hand `air` the function it should call instead of the global `fetch`.
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

## [0.2.0] — 2026-08-06

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
  suite could not have caught it — it mocks `fetch`, and a mock does not enforce the
  requirement. Found by sending a stream to a real server.

## [0.1.0] — 2026-08-06

Initial release. A tiny, ESM-only HTTP client over native `fetch`, with zero runtime
dependencies.

### Added

- A callable default export with `get`, `post`, `put`, `patch`, `delete`, `head` and
  `options` shortcuts, and `create()` for clients that inherit defaults without mutating the
  parent.
- `baseURL` joining that does not double slashes, and `query` serialization for primitives
  and arrays of primitives.
- Automatic body detection — `FormData`, `URLSearchParams`, `Blob`, `ArrayBuffer`, typed
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

No timeout or retry options, by design — `AbortSignal.timeout()` and a `for` loop cover both,
and the README shows how.

[Unreleased]: https://github.com/imlargo/air/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/imlargo/air/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/imlargo/air/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/imlargo/air/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/imlargo/air/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/imlargo/air/releases/tag/v0.1.0
