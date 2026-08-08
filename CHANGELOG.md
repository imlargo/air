# Changelog

Notable changes to `@korastd/air`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html) — while the major is `0`, a minor
bump is where a breaking change would go.

Entries say what changed for someone _using_ the library. A refactor nobody can observe from
the outside does not get a line here; the git history already has it.

## [Unreleased]

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

[Unreleased]: https://github.com/imlargo/air/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/imlargo/air/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/imlargo/air/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/imlargo/air/releases/tag/v0.1.0
