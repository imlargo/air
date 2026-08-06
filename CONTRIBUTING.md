# Contributing to air

This document is for anyone changing the source: the philosophy behind the design, the
behavior rules that must stay exact, and decisions already settled. For how to _use_ the
library, see [README.md](./README.md).

---

## Philosophy

**Less code is better.** This is the single most important rule. Every line has to earn its place. If a feature can be expressed in five lines instead of thirty, it ships as five. If a feature can live in userland, it lives in userland.

Concretely:

- **Zero runtime dependencies.** Never add one. If something needs a dependency, it doesn't belong in `air`.
- **Native `fetch` only.** No XHR, no polyfills, no `node-fetch` fallback. Node 18+, browsers, Deno, Bun, edge runtimes.
- **Predictable over clever.** A reader should be able to guess what a function does from its signature.
- **Small surface area.** Fewer options, better defaults. Every new option is a permanent maintenance cost and a permanent thing users have to learn.
- **Types are the docs.** Full generics, no `any` in public types. `unknown` is the fallback, never `any`.
- **ESM only.** No CJS build, no dual-package `exports` map, no interop shims. The source is ESM and so is everything shipped.
- **Composition over options.** If a concern can be a standalone function the caller wraps around a request, it is not an option on the request — and if the caller can write that function in a few lines, we do not ship it either. Options are for things that must reach inside the request; everything else stays outside, in userland.

**The counterweight.** "Less is better" can justify any omission, because the cost of what you did not ship is invisible. So the reduction question — _what can we remove?_ — has to be paired with its opposite: **what can a user not do at all?** Both `parse: 'response'` and the escape hatches on `AirError` exist because minimalism had produced a genuine dead end — no way to read response headers on a successful call — and no amount of asking "what can we cut?" would have surfaced it. Ask the second question on every review.

### Non-goals

Do not build these. If a task drifts toward one of them, stop and flag it:

- Interceptor chains with many lifecycle stages
- A plugin system
- Retries, backoff or timeouts, in any form — not as an option, and not as a helper we export (see below)
- Caching, deduplication, or request queuing
- Full axios API compatibility
- Node-specific features that break in the browser or on the edge

---

## Public API

The default export is callable and also carries method shortcuts:

```ts
import air from '@korastd/air'

// Callable directly
const data = await air<User>('https://api.example.com/users/1')

// Method shortcuts
const users = await air.get<User[]>('https://api.example.com/users')
const created = await air.post<User>('https://api.example.com/users', {
  body: { name: 'Ada' },
})

// Client instances
const api = air.create({
  baseURL: 'https://api.example.com',
  headers: () => ({ Authorization: `Bearer ${getToken()}` }),
})

const user = await api.get<User>('/users/1')
const results = await api.get<Page<User>>('/users', {
  query: { page: 2, active: true },
})
```

Methods: `get`, `post`, `put`, `patch`, `delete`, `head`, `options`.

The whole export list is `air` (default and named), `create`, `AirError`, `isAirError`, and the
types `AirClient`, `AirOptions`, `AirRequest`, `AirURL`, `HeaderSource`, `Query`, `QueryValue`,
`ParseMode`. Nothing else.

The request target (`url` in every signature above) is `AirURL` — `string | URL`. A `URL`
instance is already absolute, so it behaves exactly like an absolute string: `baseURL` is
skipped, and `query` still merges onto whatever search params it already has.

A client from `air.create()` has the same shape as `air` itself — callable, same shortcuts, and its
own `create()` that inherits the parent's defaults without mutating it. The root `air` **is** a
client created with empty defaults, so there is exactly one implementation. Keep it that way: a
second code path for the root export is how the two drift apart.

### Options

Keep this list short. Adding to it requires justification.

| Option    | Type                                                        | Notes                                                        |
| --------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| `baseURL` | `string`                                                    | Joined with the path, no double slashes                      |
| `method`  | `string`                                                    | Inferred by the shortcuts, uppercased before sending         |
| `query`   | `Query`                                                     | Primitives and arrays of primitives only                     |
| `body`    | `unknown`                                                   | Type auto-detected (see below)                               |
| `headers` | `HeaderSource`                                              | Merged with client defaults, request wins; may be a function |
| `signal`  | `AbortSignal`                                               | Forwarded to `fetch` untouched — never wrapped or bridged    |
| `parse`   | `'json' \| 'text' \| 'blob' \| 'arrayBuffer' \| 'response'` | Overrides content-type detection                             |

Anything not recognized is forwarded to the underlying `fetch` call.

### No timeouts, no retries

Neither exists in this package — not as an option, not as an exported helper. Both were tried and
both were removed, for reasons worth keeping:

**Timeouts.** `AbortSignal.timeout(ms)` is native, and composing it with a caller's own signal is
`AbortSignal.any([...])` (Node 20.3+). A `timeout` option would mean building an `AbortController`
inside the client to bridge both signals, and the bridge is where the bugs live: it has to be torn
down at exactly the right moment, and the obvious moment — when `fetch` resolves — is too early,
because it leaves the body download uncovered. That was a real bug here, verified against a server
that drips its response body: the request hung forever despite both a timeout and an explicit
abort. Forwarding `signal` untouched has no such moment, so `signal` goes straight to `fetch` and is
never wrapped.

**Retries.** A retry loop has to distinguish a transient failure from a request the caller cancelled
on purpose. The only reliable source for that is the `AbortSignal` itself: `abort(reason)` lets the
caller supply any reason, so sniffing the error's `name` misclassifies a deliberate cancellation as
a transient failure — which is exactly what our `retry` helper did, retrying cancelled requests
three times. A loop written by the caller does not have this problem, because the signal is already
in its scope. A generic helper never has it in scope, and paying for it means growing the error type
just to smuggle the signal back out. The loop is five lines in userland; the README shows it.

The lesson generalizes: **moving a decision out of the client only works if the information behind
it moves out too.** Before extracting anything into a helper, check which of the two it needs.

### Lazy headers

`headers` accepts a function (`() => HeadersInit | Promise<HeadersInit>`), not just a plain
`HeadersInit`, so a long-lived client stays correct when the value changes after it was
created — the concrete case is a bearer token that gets refreshed. A plain object baked into
`air.create()`'s defaults is evaluated once, at `create()` time, and frozen in the closure from
then on; every request after the token rotates sends the stale one. This is the same class of
dead end the counterweight principle calls out at the top of this document: no amount of
minimalism was going to surface it by asking "what can we remove?" — it took a user asking "my
client outlives the token, now what?"

The fix stays inside the existing `headers` option instead of growing a new one, and resolves
lazily rather than at merge time: `mergeHeaders` in `client.ts` always returns a closure, never
a `Headers` instance, so combining a client's header source with a request's — or with another
client's, through a chain of `create()` calls — defers every side's evaluation until the request
that actually needs it. Resolving eagerly at merge time would silently reintroduce the frozen
token, just one layer removed; that is exactly the bug being fixed, so watch for it if this code
changes. It does **not** generalize to a `beforeRequest` hook or any other option: the fix is
narrowly "this one option may be a function," not a new lifecycle stage.

---

## Behavior rules

These are the details that make the library feel good. Get them exactly right.

### URL building

- `baseURL` and the path are joined as **strings**, not resolved as URLs. `https://api.test/v1` +
  `/users` → `https://api.test/v1/users`. `new URL()` resolution would drop the `/v1` prefix, which
  surprises everyone who mounts an API under a path.
- Redundant slashes on either side of the join collapse to one.
- A path that starts with a scheme (`https://…`) ignores `baseURL` entirely.
- A leading `//` is a **path**, not a protocol-relative URL. Stray double slashes from string
  building are far more common than intentional protocol-relative URLs, which are deprecated
  anyway; `ofetch` requires the scheme for the same reason. This was changed once and reverted when
  a test showed `///users` resolving to `https://users/`.
- The fragment stays at the end when query params are added.

### Query serialization

- `query` is merged into the URL's search params.
- Existing search params in the URL are preserved, not overwritten. A repeated key appends.
- `undefined` and `null` values are dropped entirely — but `false`, `0` and `''` are kept. Dropping
  falsy values instead of nullish ones is a classic bug; there is a test pinning it.
- Arrays produce repeated keys: `{ tags: ['a', 'b'] }` → `?tags=a&tags=b`. An empty array produces
  nothing.
- Values are URL-encoded.
- Only primitives and arrays of primitives are accepted, and the type enforces it. Objects and
  `Date`s are rejected at compile time rather than silently stringified into `[object Object]` or a
  locale-dependent date. Callers serialize those themselves, so the choice stays visible.
- Note for callers: TypeScript gives object type aliases an implicit index signature but never gives
  interfaces one, so `query` accepts a `type` and rejects an `interface`. Documented in the README;
  not worth making `AirOptions` generic to work around.
- `merge()` in `client.ts` produces `query: undefined` when neither side has one — never an
  unconditional `{ ...base.query, ...extra.query }`. Passing an empty object through to `buildURL`
  is not equivalent to passing nothing: `buildURL` treats any truthy `query` as "re-parse and
  rebuild the search string," which round-trips it through `URLSearchParams` and turns
  `?msg=hola%20mundo` into `?msg=hola+mundo` — a visible change nobody asked for, triggered just by
  `options` being present for an unrelated reason (headers, say). There is a test pinning this.

### Headers

- `headers` merges with the client's defaults, request wins on a shared key, for every
  `HeadersInit` shape — a plain object, a `Headers` instance, or an array of tuples.
- `headers` may also be a function (sync or async) returning one of the above; see Lazy headers.
- Merging two header sources — client defaults and a request, or a client and a client it was
  derived from — never resolves either side. `mergeHeaders` always returns a new closure; only
  `request()` calls it, right before building the `Headers` object that goes to `fetch`. A chain
  of `create()` calls nests closures without ever evaluating one early.

### Body detection

Auto-detect the body type. Never re-serialize something that is already a valid `fetch` body:

- **Plain objects and arrays** → `JSON.stringify`, and set `Content-Type: application/json` (only if the user hasn't set one).
- **`FormData`** → pass through untouched, and **never set `Content-Type`** — not even one the
  caller set explicitly. The runtime generates the multipart boundary at send time, so no literal
  value the caller could write is ever correct; a caller-supplied `Content-Type` is deleted rather
  than kept, which is the one header this library overrides instead of deferring to. This is the
  most common bug in wrappers like this one — get it right.
- **`URLSearchParams`, `Blob`, `File`, `ArrayBuffer`, typed arrays, `ReadableStream`, `string`** → pass through untouched, no `Content-Type` added.
- **`undefined` and `null`** → no body sent. `null` matches `fetch`'s own meaning for `body: null`.
- Never send a body on `GET` or `HEAD`.

### Response parsing

- Parse based on the response `Content-Type` by default: JSON for `application/json` and `+json`
  suffixes, text for `text/*`, a `Blob` for anything else, including a missing header. `arrayBuffer`
  is never chosen automatically — it is only reachable through `parse`.
- `204 No Content` and empty bodies resolve to `null`, not a parse error. This holds for every parse
  mode, including `blob` and `arrayBuffer` — an empty body is never a zero-length value.
- The `parse` option overrides detection.
- `parse: 'response'` returns the raw `Response`, before the 204 check, and never reads the body.
  Without it there is no way to read response headers on a successful call (`Link`, `ETag`, rate
  limits), which is a real dead end; it costs one union member and replaces a separate `stream`
  mode, since `response.body` is right there.

### Errors

This is the main reason people wrap `fetch`: **non-2xx responses throw.**

Throw an `AirError` that extends `Error` and carries:

- `status`, `statusText`
- `data` — the parsed error body, when there is one. An error body that fails to parse leaves `data`
  undefined; it never turns a 500 into a parse error.
- `request` — the final URL (query string included) and the options used
- `response` — the raw `Response`, for escape hatches
- `cause` — the underlying failure for network errors, timeouts and aborts

Network failures, timeouts, aborts and unreadable bodies also surface as `AirError` so callers only need one `catch` shape. Include a type guard, e.g. `isAirError(err)`.

`isAirError` must not rely on `instanceof`. An app can end up with two copies of the package loaded —
two versions in the dependency tree, or a bundled copy alongside a resolved one — and each copy has
its own `AirError` class, so `instanceof` returns `false` across them. Detect a
`Symbol.for('air.error')` brand instead: the registry is global, so every copy agrees on it.

Every throw goes through `fail()` in `client.ts`, not a bare `throw new AirError(...)`. It calls
`Error.captureStackTrace(error, request)` where available (V8: Node, Chrome, Edge), which trims
`request()`'s own frame from the stack so it starts at the caller's call site instead of inside
`air`. Guarded with `Error.captureStackTrace?.(...)`, since the method doesn't exist on other
engines — and declared locally as an ambient global rather than pulling in `@types/node`, which
would leak Node-only globals into a codebase that targets the browser and edge just as much.

### Type conventions

```ts
air.get<User[]>('/users') // Promise<User[]>
air.get('/users') // Promise<unknown> — never `any`
```

Generics default to `unknown`. Options types should be inferable so callers rarely need to annotate anything but the response type.

One known compromise: `Promise<T>` is a small lie for empty responses, because a `204` resolves to
`null` while the signature still promises `T`. Modelling it honestly would mean `T | null` on every
call, which pushes a null check onto the majority of callers who never hit a 204. Prior art makes
the same trade. Keep the lie, keep it documented.

---

## Settled decisions

Raised, considered, and deliberately left alone. Do not re-open without new information:

- **`AirError` exposes `request` and `response` as plain enumerable properties**, so
  `console.error(err)` prints the request options — including an `Authorization` header. Redacting
  before logging is the consuming app's job, not the library's.
- **Error messages include the full URL**, query string and all. Same reasoning as every other HTTP
  client; those values are already in server access logs.
- **Packaging metadata** (`LICENSE`, real version, `repository`, `prepublishOnly`, CI) is done —
  publishing went from deferred to actually on the table. `prepublishOnly: "pnpm build"` exists
  specifically because `dist/` is gitignored while `files` points at it: without it, publishing
  from a clean clone (or CI) would ship an empty package. Verified by running
  `npm publish --dry-run` in a fresh clone with nothing but `pnpm install` — it built and packed
  the right five files.
- **Published as `@korastd/air`**, not the unscoped `air` — that name was already taken by an
  unrelated package on npm. The scope is Kora Estudio's; the internal export name (`air`, `create`,
  `AirError`, ...) is unaffected, only the install/import specifier changes
  (`import air from '@korastd/air'`).

---

## Code conventions

- Prefer closures and factory functions over classes. `air.create()` returns a function with properties attached, not a class instance. `AirError` is the one class, because it has to extend `Error`.
- Named exports for everything; default export is the root `air` instance.
- Keep `src/` flat until it genuinely hurts. Small focused modules (`url.ts`, `body.ts`, `error.ts`) beat one large file, but don't build a directory tree for six functions.
- No barrel files other than `src/index.ts`.
- No comments explaining _what_ the code does — the code says that. Comment only _why_, and only for non-obvious decisions (spec quirks, runtime bugs being worked around, a change that was tried and reverted).

---

## Testing

- Vitest. Tests live in `test/`, never beside the source.
- Test real behavior through the public API, not internals. No test imports from `src/` except `src/index.ts`.
- Mock `fetch` minimally: the mock builds a real `Request` from what was passed and records it, so
  assertions read against the `Request` that would have been sent. No deep mocking machinery.
- Every behavior rule above deserves a test. The ones that have actually caught bugs: FormData
  content-type, query merging with existing params, falsy-vs-nullish query values, empty bodies in
  every parse mode, non-2xx throwing, aborting during a slow body read, and URL joining.
- Type-level rules get type-level tests: `@ts-expect-error` on a `query` value that must not
  compile. `pnpm typecheck` covers `test/`, so loosening a type fails the build.
- `scripts/smoke.mjs` covers what the vitest suite structurally cannot: it imports the **built**
  `dist/`, not `src/`, so a broken build — bad bundling, a dropped export — fails there even with a
  fully green test run. It is plain Node with no test runner and no syntax past Node 18, because CI
  also runs it on the oldest version `engines` claims. Keep both of those properties if you edit it.
- `examples/demo.mjs` makes real network requests and is not part of `pnpm test` — run it by hand
  (`pnpm demo`) to sanity-check the library against the real thing, not against mocks.

---

## Prior art

`ofetch` and `ky` solve the same problem and have already hit the edge cases we will hit. Reading them to understand _why_ a decision was made is encouraged.

**But:** do not copy their code. Reimplement from understanding, in our own structure and naming. Our public surface should end up meaningfully smaller than `ofetch`'s — that's the whole point of the project. If a feature exists in `ofetch` and we can't justify it against the philosophy above, we don't ship it.

### `ofetch` comparison

A full read of `ofetch`'s source (`fetch.ts`, `error.ts`, `utils.ts`, `utils.url.ts`, `types.ts` —
about 800 lines) turned up two things worth adopting and several worth naming as deliberately
rejected, so the next person who reads `ofetch` doesn't re-propose them from scratch.

**Adopted, reimplemented in our own shape:**

- **Trimmed stack traces.** `ofetch` calls `Error.captureStackTrace(error, $fetchRaw)` so its
  error's stack starts at the caller, not inside the library. Verified against air's own output
  before the change: `air.get()` throwing showed `at request (client.ts:NN)` as the first frame,
  ahead of the caller's own line — one internal frame of noise on every thrown error, for free to
  remove. Air's `fail()` helper in `client.ts` does the same, guarded and without an `@types/node`
  dependency (see Errors, above).
- **`URL` as a request target.** Native `fetch` already accepts `RequestInfo | URL`; air's `url`
  parameter was narrower than the primitive it wraps, for no reason tied to the philosophy. `ofetch`
  accepts a full `Request` object too (`FetchRequest = RequestInfo`); air does not go that far — see
  rejected list below.

**Considered, rejected — do not re-open without new information:**

- **Full `Request` object as input**, not just `URL`. A caller holding a complete `Request` already
  has everything air would add (parsing, throwing) available to build themselves in a couple of
  lines, and in practice already has a working `fetch(request)` sitting right there. `URL` covers
  the real, common case — a server framework handing you a parsed URL — without absorbing the
  interplay of a `Request`'s own method, headers and body against air's options.
- **Lifecycle hooks** (`onRequest`/`onResponse`/`onRequestError`/`onResponseError`). This is the
  interceptor-chain non-goal, confirmed rather than merely asserted: `ofetch`'s implementation
  threads a `FetchContext` object through four optional hook slots and a `callHooks` utility just to
  support them. That cost, seen in a real 280-line `fetch.ts`, is exactly why this library doesn't
  carry it.
- **`ignoreResponseError`.** A per-request escape hatch from "non-2xx throws." It doesn't unlock
  anything air can't already do — `catch` + `isAirError` + `error.response` already gets you the
  status and body of a failed request — and it dilutes the one headline promise of the library.
- **`retryStatusCodes` / built-in retry and timeout.** Already removed from air; seeing `ofetch`'s
  own retry loop (`fetch.ts`, `onError`) sniff `error.name === 'AbortError'` to decide whether a
  failure was a deliberate cancellation is the same fragility that got `retry` removed here — real
  external confirmation, not just our own prior incident.
- **`dispatcher` / `agent`.** Node-only escape hatches for a custom `undici` dispatcher or HTTP
  agent. Explicitly the Node-specific-features non-goal; these don't exist in browser `fetch` at
  all. A Node caller who needs one can still pass it positionally today (anything unrecognized
  forwards to `fetch`) — just without a typed field for it, which is the right trade-off for a
  library that targets the browser and edge as first-class, not as an afterthought.
- **`parseResponse` custom parser option.** Fully achievable in userland today: `parse: 'text'`
  plus the caller's own `JSON.parse` (or a reviver, or a faster parser) is one extra line. No
  capability gap, so it stays out.
- **Response type inferred from `parse` via a conditional type** (`ofetch`'s
  `MappedResponseType<R, T>`, which types `ofetch(url, { responseType: 'blob' })` as `Blob` without
  an explicit generic). Real, but the win — skipping one generic annotation — is small next to the
  cost: conditional-type inference over an options field produces exactly the confusing compiler
  errors "predictable over clever" exists to avoid. The explicit `<T>` stays the simpler contract.
- **Query values silently `JSON.stringify`d when nested** (`ofetch`'s `normalizeQueryValue`, for
  `typeof value === 'object'`). This is precisely the implicit-serialization magic `Query`'s
  primitives-only type was built to prevent — confirmation, not a reason to loosen it.

---

## Commands

```bash
pnpm build         # tsdown → dist/ (ESM + .d.ts)
pnpm test          # vitest run
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint . --max-warnings 0
pnpm format        # prettier --write .
pnpm smoke         # build, then run scripts/smoke.mjs against the built dist/
pnpm demo          # build, then run examples/demo.mjs against real endpoints
```

`pnpm format` runs prettier over the whole repo, this file included.

---

## CI and releasing

Two workflows in `.github/workflows/`:

**`ci.yml`** runs on every push to `main` and every PR. Two jobs:

- `check` — lint, typecheck, tests and build on Node 24. The correctness gate.
- `compat` — builds on Node 24, then runs `scripts/smoke.mjs` against the built `dist/` on Node
  18, 20, 22 and 24. This exists because the two Node versions in play are not the same one: the
  build toolchain needs ≥22.18 (tsdown) while the package claims `engines: node >=18` for
  consumers. Without this job that claim would be an assertion nobody checks. It deliberately uses
  plain `node` rather than vitest, since vitest itself needs ≥20 and could not run on the oldest
  version being verified.

**`release.yml`** runs on a pushed `v*` tag and publishes to npm. It re-runs lint, typecheck and
tests, and refuses to publish if the tag disagrees with `package.json`'s version.

There is **no `NPM_TOKEN` secret**, deliberately. npm now requires 2FA to publish and has removed
the 2FA-bypass token that automation used to rely on, so a token in CI — where nobody can type a
one-time code — simply gets a `403`. Instead the workflow authenticates by **trusted publishing**:
npm checks the OIDC identity GitHub Actions presents against a trusted publisher configured on the
package, so no long-lived credential exists anywhere. That is what `id-token: write` is for, and
why provenance comes for free.

The trusted publisher is configured on npmjs.com under the package's _Settings → Trusted Publisher_
and must name this repository **and this workflow's filename**. Renaming `release.yml`, or
publishing from a different workflow, breaks it until the setting is updated to match.

To cut a release: bump `version` in `package.json`, commit, then

```bash
git tag v0.1.1 && git push origin v0.1.1
```

---

## Working agreements

For anyone contributing:

- **Never add a runtime dependency.** Ask first, every time. The answer is almost certainly no.
- **Small diffs.** One concern per change.
- **Before adding a feature, answer:** Would 80% of users need this? Can it be done in fewer lines? Is it typed without `any`? Does it work in the browser, Node, and on the edge? If any answer is no, don't add it.
- **Before removing one, answer the counterweight:** does this leave anything a user cannot do at all? A dead end is worse than an option.
- **When in doubt, leave it out.** Removing a feature after release is a breaking change; never shipping it costs nothing.
- **When a change is reverted, write down why** — in a comment, a test name, or this file. Every wrong turn here was retried later by someone who only saw the absence.
