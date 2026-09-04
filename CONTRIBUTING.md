# Contributing to air

How the library is designed, the behavior that must stay exact, and the decisions already made.
For usage, see [README.md](./README.md).

## Principles

- **Less code.** A feature that can live in userland does. A feature that needs thirty lines
  when five would do ships as five.
- **Zero runtime dependencies.** Never add one.
- **Native `fetch` only.** No XHR, no polyfill, no second transport. The `fetch` option accepts
  another fetch-shaped function; that is not a second transport.
- **Composition over options.** Anything a caller can do by wrapping a request in a function is
  not an option. Options exist for what must reach inside the request.
- **Predictable over clever.** A signature should say what it does. No conditional-type
  inference over option fields.
- **Types are the docs.** No `any` in public types. `unknown` is the fallback.
- **ESM only.** No CJS build, no dual-package exports.

**The counterweight.** "Less" can justify any omission, because the cost of what was not shipped
is invisible. On every review also ask: is there anything a user cannot do at all? `client.raw`
and the fields on `AirError` exist because that question found a dead end.

### Non-goals

Interceptor chains and lifecycle hooks. A plugin system. Retries, backoff or timeouts, as an
option or as an exported helper. Caching, deduplication or queuing. axios compatibility.
Node-only features.

## Public API

Exports: `air` (default and named), `create`, `AirError`, `isAirError`, and the types
`AirClient`, `AirRawClient`, `AirOptions`, `StreamOptions`, `AirRequest`, `AirResponse`,
`AirURL`, `Fetch`, `HeaderSource`, `SignalSource`, `Query`, `QueryValue`, `ParseMode`. Nothing
else. `AnyOptions` and `HeaderInit` are internal.

`air` is `create()` with no defaults, so there is one implementation. A client is callable
(`GET`), has one shortcut per method, a `raw` twin, and `create()`.

| Option    | Type                                          | Rule                                                          |
| --------- | --------------------------------------------- | ------------------------------------------------------------- |
| `baseURL` | `string \| URL`                               | String join; path prefix kept; skipped for an absolute target |
| `method`  | `string`                                      | Uppercased; a shortcut wins over it                           |
| `query`   | `Query`                                       | Record, `URLSearchParams` or tuples; primitive values only    |
| `body`    | `unknown`                                     | Detected; see Body                                            |
| `headers` | `HeaderSource`                                | Merged, request wins; `null` removes; may be a function       |
| `signal`  | `SignalSource`                                | Forwarded unchanged, never wrapped; may be a function         |
| `parse`   | `'json' \| 'text' \| 'blob' \| 'arrayBuffer'` | Overrides detection; `'stream'` is `StreamOptions`, per call  |
| `fetch`   | `Fetch`                                       | Replaces the global; default resolved inside `request()`      |

Unrecognized fields are forwarded to `fetch`. Adding an option requires a case userland cannot
reach: types, merge semantics, or the shape of the thrown error.

## Behavior

### Option merging

`merge()` in `client.ts` is the only place options combine, and every request passes through it
exactly once, with or without per-request options. Do not add a path that skips it.

- Scalars are last-wins. An explicit `undefined` on a request clears the client's value:
  `baseURL: undefined`, `fetch: undefined`, `parse: undefined`, `signal: null`.
- `headers` and `query` combine, request winning on a shared key.
- A shortcut's method wins over `options.method`. An unrecognized method is uppercased and sent.

### URL

- `baseURL` and path are joined as strings, not resolved: `https://api.test/v1` + `/users` is
  `https://api.test/v1/users`. `new URL()` would drop `/v1`.
- Redundant slashes at the join collapse to one. A path starting with a scheme ignores `baseURL`.
- A leading `//` is a path, not a protocol-relative URL.
- A query-only or fragment-only path (`?page=2`, `#top`) is appended to the base without a slash.
- A `URL` target or `baseURL` is normalized through `.href` and then treated as a string.

### Query

- `toQueryRecord` folds `URLSearchParams` and tuples into the record, grouping repeated keys
  into arrays. `mergeQuery` folds both sides before spreading, since a `URLSearchParams` spreads
  to `{}`.
- New params are appended after the existing search string, which is never re-encoded. A query
  with nothing to append leaves the URL untouched. The fragment stays last.
- `undefined` and `null` are dropped; `false`, `0` and `''` are kept. Arrays repeat the key;
  an empty array adds nothing. Values are URL-encoded.
- Only primitives and arrays of primitives compile. Objects and `Date` are rejected at compile
  time rather than stringified.

### Headers

- Every `HeadersInit` shape merges the same way for setting. Removal (`null` or `undefined`) is
  record-only, because a `Headers` instance cannot express it.
- `applyHeaders` is the only code that writes into a `Headers`. Records never go through the
  `Headers` constructor, which would send `null` as the string `"null"`.
- `mergeHeaders` always returns a closure. Nothing is resolved until `request()` runs, including
  through a chain of `create()` calls.
- A header function runs once per request and is not deduplicated.

### Body

- Plain objects and arrays: `JSON.stringify`, `Content-Type: application/json` unless set.
- `FormData`: sent as-is, and any `Content-Type`, including the caller's, is removed so the
  runtime writes the boundary. The only header air overrides.
- `URLSearchParams`, `Blob`, `File`, `ArrayBuffer`, typed arrays, `string`: sent as-is.
- `ReadableStream`: sent as-is with `duplex: 'half'`, which `fetch` requires. A caller's `duplex`
  wins.
- `undefined` and `null`: no body. `GET` and `HEAD` never send one.

### Response parsing

- Detected from `Content-Type`, matched case-insensitively and ignoring parameters: JSON for
  `application/json` and `+json`; text for `text/*`; `stream` for `text/event-stream`,
  `application/x-ndjson` and `application/jsonl`, checked before `text/*`; `Blob` otherwise,
  including a missing header. `arrayBuffer` is never detected.
- The streaming list contains only types that never end. `application/octet-stream` is not one.
  Adding a type changes what its callers receive and needs the same bar as any default.
- Detection is the same on the error path. `error.data` for a streaming type is the unread
  stream.
- `204` and empty bodies resolve to `null` in every mode that reads the body. `stream` returns
  `response.body`, which is `null` for a body-less response.
- `AirOptions.parse` excludes `'stream'`. `StreamOptions` requires it and is accepted only by
  the overload with no type parameter, so `<T>` cannot contradict it. `create()` does not accept
  it, because a client default is out of reach of the call-site signature.
- `Call` and `RawCall` are declared once and reused by the callable form and every shortcut.

### The raw client

- `data` is exactly what the plain client resolves to. `raw` adds the response; it changes
  nothing else.
- `response.bodyUsed` is `true` in every mode that reads the body. With `parse: 'stream'`, `data`
  is `response.body`.
- Both clients are projections of one `request()`.

### Errors

- Non-2xx, network failure, timeout, abort and unreadable body all throw `AirError`.
- `status`, `statusText`, `response` are set when a response arrived. `data` is the parsed error
  body, `undefined` if it failed to parse. `request` is the request as sent, with resolved
  headers. `cause` is the underlying error.
- `error.response` arrives with its body consumed into `data`.
- `isAirError` checks a `Symbol.for('air.error')` brand, not `instanceof`.
- Every throw goes through `fail()`, which trims `request()`'s frame with
  `Error.captureStackTrace` where available.
- The message names `timed out` and `was aborted` for the platform's own abort reasons. A custom
  `abort(reason)` is `failed: <reason>`.

### Types

`<T>` defaults to `unknown`, never `any`. A `204` resolves to `null` while the signature says `T`;
modeling that as `T | null` would tax every caller for the rare case. Documented and kept.

## Decisions

Settled. Reopen only with new information.

| Decision                                               | Reason                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `timeout` option                                    | Bridging a timeout with the caller's signal needs an `AbortController` torn down at the right moment; the obvious moment leaves the body download uncovered. Forwarding `signal` unchanged has no such moment.                                                                              |
| `signal` may be a function                             | A signal in client defaults is one instance for every request; once fired, the client is dead. The function only chooses the signal; forwarding stays unchanged.                                                                                                                            |
| No retry option or helper                              | A retry loop must tell a cancellation from a transient failure, and only the caller's signal can. Name-sniffing `AbortError` misclassifies `abort(reason)`.                                                                                                                                 |
| `headers` may be a function                            | A plain object is frozen at `create()`; a refreshed token is the common case.                                                                                                                                                                                                               |
| `null` removes a header, record-only                   | The alternative, a function of the inherited headers, is one step from a `beforeRequest` hook.                                                                                                                                                                                              |
| `fetch` is an option                                   | On the server the global `fetch` is the wrong function, and the right one exists only inside a request.                                                                                                                                                                                     |
| `Fetch` is narrower than the global on parameters      | Narrow parameters make the type wide on implementations. `typeof fetch` and a string-only double both assign.                                                                                                                                                                               |
| `client.raw`, not `raw: true`                          | An option that changes the return type needs a conditional type to read it back.                                                                                                                                                                                                            |
| `parse` describes the body only                        | `parse: 'response'` did two jobs and let `<T>` lie. Replaced by `raw` and `parse: 'stream'`.                                                                                                                                                                                                |
| No `MappedResponseType`                                | Conditional-type inference over an options field produces the compiler errors "predictable over clever" exists to avoid.                                                                                                                                                                    |
| `Query` accepts `type`, rejects `interface`            | A mapped type inferred per call fixes it only when the caller omits `<T>`; TypeScript has no partial inference. Compiled and confirmed.                                                                                                                                                     |
| No index signature on `AirOptions`                     | It would disable excess-property checking. Runtime fields are reached via a global `RequestInit` augmentation or a module augmentation of `AirOptions`; both compiled against `dist/`. Passing a variable instead of a literal does not work unless it shares a property with `AirOptions`. |
| `error.response` body is consumed                      | `response.clone()` would buffer every error body twice for a rare need. A `fetch` wrapper sees the raw response.                                                                                                                                                                            |
| No `Request` object as input                           | A caller holding a `Request` already has `fetch(request)`; `URL` covers the common case.                                                                                                                                                                                                    |
| No `ignoreResponseError`                               | `catch` + `isAirError` + `error.response` already reaches the same data.                                                                                                                                                                                                                    |
| No custom parser option                                | `parse: 'text'` plus your own `JSON.parse` is one line.                                                                                                                                                                                                                                     |
| No nested query serialization                          | Implicit `[object Object]` or JSON encoding is the magic the primitive-only type prevents. Build the params yourself and pass them.                                                                                                                                                         |
| No `dispatcher` / `agent` typed fields                 | Node-only. Still forwarded when passed.                                                                                                                                                                                                                                                     |
| No schema validation                                   | `Schema.parse(await api.get(...))` is one line, and an adapter surface is a plugin system.                                                                                                                                                                                                  |
| No progress callbacks                                  | A `fetch` wrapper with a `TransformStream` does it; see `examples/progress.mjs`.                                                                                                                                                                                                            |
| Errors expose `request` and `response` as plain fields | Redaction before logging is the app's job.                                                                                                                                                                                                                                                  |
| Published as `@korastd/air`                            | `air` was taken on npm.                                                                                                                                                                                                                                                                     |

## Code conventions

- Closures and factory functions, not classes. `AirError` is the one class because it must extend
  `Error`.
- Named exports; the default export is `air`. `src/index.ts` is the only barrel. Keep `src/` flat.
- **Comments.** None by default. A comment exists only for what the code cannot say: a
  platform behavior being worked around, an ordering that matters, a cast that needs
  justifying. One or two lines, no history, no version numbers, no pointers to tests. Public
  exports get TSDoc only where the name and type do not already say it, because it ships in the
  `.d.ts`: `@remarks` for a rule a caller must know, `@defaultValue`, `@internal`. A test's name
  is its documentation; do not restate it above the test.
- Lint is `typescript-eslint` `strictTypeChecked` and `stylisticTypeChecked`, type-aware, with
  zero warnings. Relax a rule only per directory, with a comment saying why. Currently:
  `no-non-null-assertion` in `test/`.

## Testing

- Vitest, in `test/`, one file per concern: `url`, `body`, `parse`, `raw`, `errors`, `signals`,
  `clients`, `fetch`. `test/setup.ts` restores the global `fetch` after each test. `test/mock.ts`
  is the shared double.
- Test through the public API only. Tests import from `src/index.ts` and nothing else in `src/`.
- The mock builds a real `Request` and records it. It rejects an already-aborted signal, as
  `fetch` does. When the mock and the platform disagree, the mock is wrong: verify against real
  `fetch` and fix the mock.
- Type-level rules get `@ts-expect-error` tests. `pnpm typecheck` covers `test/`.
- Verify a type-level claim by compiling it against the built `dist/` from a consumer project,
  not by reasoning about it.
- `scripts/smoke.mjs` imports the built `dist/` on plain Node with no syntax newer than Node 20,
  and CI runs it on the oldest supported version.
- `examples/` is the integration lane. Each file starts a local server, runs the built `dist/`
  over real `fetch`, and asserts. Recipe above a `--- the recipe ---` marker, assertions below
  `--- what it proves ---`. `_server.mjs` is the shared harness; `demo.mjs` hits third parties
  and is excluded from the runner.

## Commands

```bash
pnpm check         # format:check, lint, typecheck, test, build
pnpm build         # tsdown → dist/ (ESM + .d.ts)
pnpm test          # vitest run
pnpm test:watch    # vitest
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint . --max-warnings 0
pnpm format        # prettier --write .
pnpm format:check  # prettier --check .
pnpm smoke         # build, then run scripts/smoke.mjs
pnpm examples      # build, then run every examples/*.mjs
pnpm demo          # build, then run examples/demo.mjs against real endpoints
```

A husky pre-commit hook runs `lint-staged` (prettier, then `eslint --fix`) on staged files. It is
a convenience; `pnpm format:check` in CI is the enforcement. `prepare` is `husky || true` so
installing from a git URL without devDependencies does not fail. CI sets `HUSKY: 0`.

## CI and releases

`ci.yml` runs on pushes to `main` and on pull requests:

- `check`: format, lint, typecheck, tests, build, on Node 24.
- `compat`: builds on Node 24 (tsdown needs 22.18+), then runs `scripts/smoke.mjs` and
  `scripts/examples.mjs` on Node 20, 22 and 24, so `engines` is verified rather than claimed.

`release.yml` runs on a `v*` tag. It refuses to publish if the tag disagrees with `package.json`
or `CHANGELOG.md` has no section for it, runs lint, typecheck and tests, publishes with npm
trusted publishing (OIDC, no `NPM_TOKEN`), and creates a GitHub release from the changelog
entry. The trusted publisher on npmjs.com must name this repository and this workflow filename.

To release: move `Unreleased` entries under a version heading, bump `version`, commit, then
`git tag vX.Y.Z && git push origin vX.Y.Z`.

Since 1.0.0 a breaking change to the export list or to documented behavior is a major bump.
Raising `engines` as a Node version reaches end of life is not breaking; a new optional field is
not breaking.

### Changelog

Hand-written, [Keep a Changelog](https://keepachangelog.com/) order. Add entries under
`Unreleased` as work lands. Two rules:

- Only what is observable from outside. Refactors, tests and docs fixes do not get a line.
- Say why, not just what.

Commit-message generators are not used: commits track how work was built, a changelog tracks
what changed. `changesets` would fit but is not worth a file per change for one maintainer;
revisit when releases involve more than one contributor.

## Working agreements

- Never add a runtime dependency.
- One concern per change.
- Before adding a feature: would most users need it? Can it be fewer lines? Is it typed without
  `any`? Does it work in the browser, Node and on the edge? Can a caller already do it with
  `fetch`, `signal`, a loop or `raw`? If so, the deliverable is a documented recipe.
- Before removing one: does this leave anything a user cannot do at all?
- When a change is reverted, record why in this file.
