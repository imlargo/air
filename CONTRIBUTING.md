# Contributing to air

This document is for anyone changing the source: the philosophy behind the design, the
behavior rules that must stay exact, and decisions already settled. For how to _use_ the
library, see [README.md](./README.md).

---

## Philosophy

**Less code is better.** This is the single most important rule. Every line has to earn its place. If a feature can be expressed in five lines instead of thirty, it ships as five. If a feature can live in userland, it lives in userland.

Concretely:

- **Zero runtime dependencies.** Never add one. If something needs a dependency, it doesn't belong in `air`.
- **Native `fetch` only.** No XHR, no polyfills, no `node-fetch` fallback. Node 20+, browsers, Deno, Bun, edge runtimes. The `fetch` option accepts another fetch-_shaped_ function — a framework's per-request wrapper — which is not the same as supporting a second transport.
- **Predictable over clever.** A reader should be able to guess what a function does from its signature.
- **Small surface area.** Fewer options, better defaults. Every new option is a permanent maintenance cost and a permanent thing users have to learn.
- **Types are the docs.** Full generics, no `any` in public types. `unknown` is the fallback, never `any`.
- **ESM only.** No CJS build, no dual-package `exports` map, no interop shims. The source is ESM and so is everything shipped.
- **Composition over options.** If a concern can be a standalone function the caller wraps around a request, it is not an option on the request — and if the caller can write that function in a few lines, we do not ship it either. Options are for things that must reach inside the request; everything else stays outside, in userland.

**The counterweight.** "Less is better" can justify any omission, because the cost of what you did not ship is invisible. So the reduction question — _what can we remove?_ — has to be paired with its opposite: **what can a user not do at all?** Both `client.raw` and the escape hatches on `AirError` exist because minimalism had produced a genuine dead end — no way to read response headers on a successful call — and no amount of asking "what can we cut?" would have surfaced it. Ask the second question on every review.

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

Methods: `get`, `post`, `put`, `patch`, `delete`, `head`, `options`. Each client also carries
`raw` — the same callable shape and the same seven methods, resolving to `{ data, response }`
instead of the body. See The raw client below.

The whole export list is `air` (default and named), `create`, `AirError`, `isAirError`, and the
types `AirClient`, `AirRawClient`, `AirOptions`, `AirRequest`, `AirResponse`, `AirURL`, `Fetch`,
`HeaderSource`, `SignalSource`, `Query`, `QueryValue`, `ParseMode`, `StreamOptions`. Nothing
else.

Two options types, and the split is load-bearing: `AirOptions` is what you write at a call site
and excludes `parse: 'stream'`; `StreamOptions` is the streaming shape, with `parse` required.
`AirRequest.options` is `AirOptions | StreamOptions`, written out rather than hidden behind a
third alias — a caller holding `error.request.options` must be able to name it with exported
types, and for one release could not. The internal `AnyOptions` is that same union and is never
exported; `HeaderInit` is likewise internal.

The request target (`url` in every signature above) is `AirURL` — `string | URL`. A `URL`
instance is already absolute, so it behaves exactly like an absolute string: `baseURL` is
skipped, and `query` still merges onto whatever search params it already has.

A client from `air.create()` has the same shape as `air` itself — callable, same shortcuts, and its
own `create()` that inherits the parent's defaults without mutating it. The root `air` **is** a
client created with empty defaults, so there is exactly one implementation. Keep it that way: a
second code path for the root export is how the two drift apart.

### Options

Keep this list short. Adding to it requires justification.

| Option    | Type                                                      | Notes                                                                        |
| --------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `baseURL` | `string \| URL`                                           | Joined with the path, no double slashes                                      |
| `method`  | `string`                                                  | Inferred by the shortcuts, uppercased before sending                         |
| `query`   | `Query`                                                   | A record, a `URLSearchParams`, or tuples; primitive values only              |
| `body`    | `unknown`                                                 | Type auto-detected (see below)                                               |
| `headers` | `HeaderSource`                                            | Merged with client defaults, request wins; `null` removes; may be a function |
| `signal`  | `SignalSource`                                            | Forwarded to `fetch` untouched — never wrapped or bridged; may be a function |
| `parse`   | `'json' \| 'text' \| 'blob' \| 'arrayBuffer' \| 'stream'` | Overrides content-type detection; `'stream'` takes no `<T>` (see below)      |
| `fetch`   | `Fetch`                                                   | The global `fetch` unless given one; merges like the rest                    |

Anything not recognized is forwarded to the underlying `fetch` call.

### Injected fetch

The one option here that isn't a request detail — it replaces the transport. It earns its place
because on the server the global `fetch` is the _wrong_ function, and no amount of configuring the
other options fixes that. SvelteKit's `event.fetch` (Remix, Astro, Nuxt all have an equivalent)
forwards the incoming request's cookies and headers, resolves a relative URL against the current
page, and short-circuits a request to your own app into a direct handler call instead of a real
HTTP round-trip back to the same process. It exists only inside a request, so nothing ambient can
be reached for — it has to be passed in, and a shared service module can only receive it if the
client accepts one.

Rules:

- The default resolves **inside `request()`**, not at module load: `fetch: send = fetch` in the
  destructure. A polyfill installed after import still wins, and the test suite's `vi.stubGlobal`
  keeps working.
- Destructured out of the options like every other named one, so it never reaches the `RequestInit`
  handed to the transport.
- `Fetch` is `(input: string, init: RequestInit) => Promise<Response>` — narrower than the global on
  the parameters, which is what makes it wide on implementations. `typeof fetch` (how every
  framework types its wrapper) is assignable to it; a test double that only handles a string URL is
  too. Do not widen `input` to `RequestInfo | URL` to "match fetch": air only ever calls it one way,
  and the wider type rejects the narrower doubles for a flexibility nobody can use.
- Not a hook, not an interceptor. It is one function in, called once, with no chain around it — see
  the interceptor non-goal. Wrapping it to log or retry is the caller's own closure, which is why
  the type stays this plain.

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

That decision left a hole, though, and it took a user-facing bug to see it: pointing people at
`AbortSignal.timeout(ms)` gave them no way to express a per-request budget as a client _default_. A
signal written into `air.create()` is one instance shared by every request that client will ever
make, its clock starts at `create()` time, and a fired signal stays fired — `fetch` rejects an
already-aborted signal before it sends anything, so the client works for five seconds and is then
permanently broken. So `signal` accepts a function too (`SignalSource`), resolved per request. Note
what this is not: no `AbortController` inside the client, no bridging, no composing two signals. The
function only decides _which_ signal gets forwarded, and forwarding is still untouched — the bug
above stays fixed. A request-level `signal` replaces the client's rather than merging with it;
composing is `AbortSignal.any` in the caller's own function.

It resolves **after** the headers, immediately before the send, and that order is deliberate: a
timeout should spend its budget on the request, not on an async header function that had to refresh a
token first.

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
changes. It does **not** generalize to a `beforeRequest` hook or any other lifecycle stage.

`signal` later took the same shape for the same reason (see above), so the pattern now has two
instances and a name: **an option whose right value is only knowable per request may be a function.**
That is the whole rule. It is not a licence to make every option a thunk — `baseURL` and `parse` do
not change between requests of the same client, and a function there would buy nothing but a call per
request. Ask whether a _correct_ value can go stale; if it cannot, keep the option plain.

---

## Behavior rules

These are the details that make the library feel good. Get them exactly right.

### URL building

- `baseURL` is a `string` or a `URL`, matching the request target — a caller holding a parsed
  URL should not have to write `.href`. A `URL` is normalized through `.href` and then joined
  exactly like a string, so nothing else about the rule changes.
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

- `query` accepts three spellings of the same thing: the record, a `URLSearchParams`, or an
  array of `[key, value]` tuples. The last two are what a caller already holds when the params
  came from elsewhere — the current URL's `searchParams`, a form, another library — and the
  narrow type made those a small dead end rather than a style choice, because `Object.fromEntries`
  keeps only the last of a repeated key and `?tag=a&tag=b` silently became `?tag=b`. Same argument
  as `URL` for the request target: the option was narrower than the primitive it wraps.
- `toQueryRecord` in `url.ts` folds the other two into the record, **grouping** repeated keys into
  an array rather than overwriting. Both `buildURL` and `merge()` call it — `merge()` because a
  `URLSearchParams` spreads to `{}`, so a client default written that way would vanish the moment
  a request passed any options at all. There is a test pinning each.
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
- A value of `null` or `undefined` in the **record** form removes an inherited header instead of
  setting one. Every other option could already be opted out of per request (`baseURL: undefined`,
  `query: { key: undefined }`, `signal: null`, `fetch: undefined`); headers could not, by any
  means — `''` sends an empty header, which is not the same as absent, and a function only ever
  adds, so a derived client could never become anonymous. It is `signal: null`'s idiom one level
  deeper, and `undefined` behaves the same because `query` already drops both.
- That sentinel is **record-only**, and it is the one place the shapes are not uniform. A `Headers`
  instance has no way to represent "delete", so setting is uniform across shapes and removing is
  not. The asymmetry is the price, deliberately paid: the alternative design was
  `headers: (inherited) => ...`, which is strictly more powerful, keeps every shape uniform, and is
  one argument away from the `beforeRequest` hook the non-goals forbid.
- Removal runs through `applyHeaders` in `client.ts`, and **`request()` has to call it too**, not
  just `mergeHeaders`. `create()` takes its defaults as given and `merge()` hands them straight
  back when a call passes no options, so a record written into the exported `create()` reaches
  `request()` having never been normalized; the `Headers` constructor would stringify the `null`
  and send `Authorization: null`. `air.create()` does not hit that path because it merges — which
  is precisely why the test for it uses `create` directly.
- `headers` may also be a function (sync or async) returning one of the above; see Lazy headers.
- A header function is called once per request and is **not** deduplicated. That is correct — the
  point is a fresh value per request — but an async one that hits the network will do so on every
  call. Single-flighting it is the caller's job, and the README shows the pattern.
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
- **`URLSearchParams`, `Blob`, `File`, `ArrayBuffer`, typed arrays, `string`** → pass through untouched, no `Content-Type` added.
- **`ReadableStream`** → passes through untouched, but also sets `duplex: 'half'`, which `fetch`
  refuses to send a stream without (`RequestInit: duplex option is required when sending a body`).
  A caller-supplied `duplex` wins. This was a genuine bug: streaming bodies were documented as
  supported and threw at runtime, because the test suite mocks `fetch` and a mock does not enforce
  the requirement — it only showed up against a real server.
- **`undefined` and `null`** → no body sent. `null` matches `fetch`'s own meaning for `body: null`.
- Never send a body on `GET` or `HEAD`.

### Response parsing

- Parse based on the response `Content-Type` by default: JSON for `application/json` and `+json`
  suffixes, text for `text/*`, a `Blob` for anything else, including a missing header. `arrayBuffer`
  is never chosen automatically — it is only reachable through `parse`.
- `stream` **is** chosen automatically, for the content types that are streams by definition:
  `text/event-stream`, `application/x-ndjson` and `application/jsonl`. Every other mode reads the
  body to completion, so against a real SSE endpoint — one that stays open, which is the entire
  point — the default used to produce a promise that never settled. Not a failure with a status to
  inspect or an `AirError` to log: the request succeeded, the bytes were arriving, and the call
  simply hung. The check runs **before** the `text/*` prefix rule, since `text/event-stream` is the
  one member of `text/*` that is not a document.
- That list is something we now maintain, which is the cost of the fix. Keep it to types that are
  streams by definition. `application/octet-stream` is not one, despite the name — a large binary
  download still ends, and buffering it is what `Blob` is for. Adding a type here is a breaking
  change for anyone parsing it today, so it needs the same bar as any other default.
- Detection is the same on the error path, so `error.data` for a non-2xx carrying one of these
  types is the unread stream. That is deliberate: one rule everywhere, and the alternative is the
  hang above, on a request that had already failed.
- `204 No Content` and empty bodies resolve to `null`, not a parse error. This holds for every parse
  mode, including `blob` and `arrayBuffer` — an empty body is never a zero-length value. `stream` is
  the one exception it cannot honour in full: a 204 is still `null`, but an otherwise empty body
  comes back as whatever `response.body` is, because detecting it would mean consuming the stream
  the caller asked for.
- The `parse` option overrides detection. Every mode answers one question — what shape should the
  body be? — so it never decides what the call resolves to. That is `client.raw`, below.
- **`parse: 'stream'` takes no type argument.** `AirOptions.parse` is `Exclude<ParseMode,
'stream'>`, and `'stream'` is reachable only through an overload that has no `<T>` to
  contradict. Every other mode's type is the caller's assertion, because only they know what the
  endpoint returns; `'stream'` is the one whose answer air already knows, so letting a caller
  assert over it was the compiler endorsing a wrong answer —
  `api.get<User>('/u', { parse: 'stream' })` used to compile and hand back a `ReadableStream`
  typed as a `User`, the exact hole 0.4.0 closed for `parse: 'response'` and reopened here.
- Note what that is **not**: not `MappedResponseType`. Nothing is inferred and no mode's type is
  computed from a conditional over the options — one mode is declared where a generic cannot
  reach it. The rule states in a sentence, which is the "predictable over clever" bar the
  conditional-type design failed.
- Three designs were compiled against TypeScript 6 before this one, and two of them do not work.
  A plain overload pair whose generic signature still accepts `AirOptions` does **not** close the
  hole, and neither does constraining `T extends ReadableStream` on the stream overload: an
  explicit `<T>` makes TypeScript discard every overload without type parameters and fall through
  to the generic one. Narrowing the generic overload's `parse` instead does close it, but rejects
  a prebuilt `AirOptions` variable. Excluding `'stream'` from `AirOptions.parse` is the only one
  of the four that closes the hole while leaving every legitimate call compiling. Do not
  "simplify" this back into a plain overload pair without re-running that check.
- The interface pair `Call`/`RawCall` is declared once and reused by the callable form and all
  seven verbs, for the same reason `verbs()` exists in `client.ts`: a signature that lives in one
  place cannot be added to one client and forgotten in the other.
- `AnyOptions` (both shapes as one) is what the implementation and `create` use. `create` has no
  return body to get wrong, so it accepts a streaming default; the lie that remains — a
  client-level `parse: 'stream'` plus a `<T>` at the call site — is out of reach of any signature
  and is documented in the README rather than pretended away.

### The raw client

`client.raw` is the same client resolving to `AirResponse<T>` (`{ data, response }`) instead of the
body. It exists because a successful call otherwise discards the response entirely: `Link`, `ETag`,
rate-limit headers, `201` vs `200` and `response.url` after a redirect were unreachable, which is a
real dead end. Rules:

- It changes nothing about the request or the parsing. `data` is byte-for-byte what the plain client
  would have resolved to, `parse` included. Anything else is a bug.
- Consequently the `response` it hands back has `bodyUsed: true` in every mode that reads the body —
  it is there for headers, status and URL, and re-reading it throws. The exception is
  `parse: 'stream'`, where `data` **is** `response.body`: one stream, two names, consumed once from
  either. That pairing (a header describing the stream — `content-length` for progress) is the case
  `raw` and `stream` exist to serve together, and it must keep working.
- A separate client, not a `raw: true` option. An option that rewrites the return type has to be
  read back out with a conditional type over `AirOptions` — the same inference rejected below for
  `MappedResponseType`, and for the same reason.
- Non-2xx still throws from both, because the status check runs before parsing. `error.response` is
  the only way to hold a failed `Response`, and it is enough.
- Built from the same `request()` as the plain client, which returns both halves and lets each
  client project one. Two code paths through a request is how they drift.

### Errors

This is the main reason people wrap `fetch`: **non-2xx responses throw.**

Throw an `AirError` that extends `Error` and carries:

- `status`, `statusText`
- `data` — the parsed error body, when there is one. An error body that fails to parse leaves `data`
  undefined; it never turns a 500 into a parse error.
- `request` — the final URL (query string included), the method, the options used, and `headers`:
  the `Headers` as actually sent, resolved and including anything the body contributed. That field
  exists because `options.headers` may be an unevaluated function, which is useless when you are
  holding a 401 and want to know which token went out.
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
  the right files. `CHANGELOG.md` is listed in `files` explicitly: npm adds `README` and
  `LICENSE` to a tarball on its own but not the changelog, as `npm pack --dry-run` confirms.
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
- The one place the mock does more than record: it rejects an already-aborted `signal` before
  recording, because real `fetch` does. It was added after a bug the mock had been hiding — a signal
  shared by every request of a client, which looks fine when nothing enforces the check. When the
  mock and the platform disagree, the mock is wrong; verify against real `fetch` in a throwaway
  script and fix the mock.
- Every behavior rule above deserves a test. The ones that have actually caught bugs: FormData
  content-type, query merging with existing params, falsy-vs-nullish query values, empty bodies in
  every parse mode, non-2xx throwing, aborting during a slow body read, and URL joining.
- Type-level rules get type-level tests: `@ts-expect-error` on a `query` value that must not
  compile. `pnpm typecheck` covers `test/`, so loosening a type fails the build.
- `scripts/smoke.mjs` covers what the vitest suite structurally cannot: it imports the **built**
  `dist/`, not `src/`, so a broken build — bad bundling, a dropped export — fails there even with a
  fully green test run. It is plain Node with no test runner and no syntax past Node 20, because CI
  also runs it on the oldest version `engines` claims. Keep both of those properties if you edit it.
- **`examples/` is the integration lane, and it is not optional.** Each file starts a local
  HTTP server, exercises the built `dist/` over real `fetch`, and asserts what it demonstrates.
  `pnpm examples` runs them all; CI runs them on every Node in the compat matrix. They exist
  because all three bugs this library has shipped — `duplex` in 0.2.0, the shared signal in
  0.3.1, the stringified `null` header in 0.5.0 — got through a green vitest run, and every one
  of them is now pinned in `examples/platform.mjs`.
- A file there is a recipe _and_ a test, in that order. Keep the server setup above a
  `--- the recipe ---` marker so the part a reader copies is obvious, and keep the assertions
  below a `--- what it proves ---` one. If a recipe cannot be asserted, it is not understood
  well enough to publish.
- `examples/_server.mjs` is the shared harness, not an example, and `scripts/examples.mjs`
  skips anything starting with `_`.
- `examples/demo.mjs` is the odd one out: it makes real network requests to third parties, so
  it cannot gate a build and the runner skips it. Run it by hand (`pnpm demo`) to check the
  library against the actual internet — TLS, redirects, a server nobody here wrote.

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
  carry it. The concrete request behind this ask is almost always "refresh the token on a 401,"
  which the README now answers with a `fetch` wrapper — point people there rather than re-arguing
  the general case.
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
pnpm format:check  # prettier --check . — what CI runs, writes nothing
pnpm smoke         # build, then run scripts/smoke.mjs against the built dist/
pnpm demo          # build, then run examples/demo.mjs against real endpoints
```

`pnpm format` runs prettier over the whole repo, this file included. `.prettierignore` holds
the two exceptions: `dist/` is build output, and `pnpm-lock.yaml` is pnpm's to format —
prettier and pnpm would rewrite it past each other on every install.

### Pre-commit hook

`pnpm install` sets up a husky `pre-commit` hook (via the `prepare` script) that runs
`lint-staged`: prettier and `eslint --fix` over the staged files only, with the results added
back to the commit. Formatting is therefore not something you have to remember.

- Config is `.lintstagedrc.json`. TS/JS gets prettier then `eslint --fix --no-warn-ignored`;
  markdown, JSON and YAML get prettier. `--no-warn-ignored` is there so staging a file eslint
  ignores is not an error.
- An eslint error that `--fix` cannot fix aborts the commit and lint-staged restores exactly
  what you had staged. Formatting alone never blocks a commit — it just happens.
- The hook is deliberately fast: no typecheck, no test run. `tsc` cannot be scoped to staged
  files and a slow hook is a hook people bypass. CI is the gate for those.
- `git commit --no-verify` skips it, `HUSKY=0` disables it for a shell. Both are fine — this
  is a convenience, not the enforcement.
- **The enforcement is `pnpm format:check` in `ci.yml`.** A hook only exists on a clone where
  someone ran `pnpm install`, so it cannot be the only copy of the rule. If you change the
  prettier config, change nothing else and watch that step fail — that is the one that matters.
- `prepare` is `husky || true` rather than `husky`: the script also runs for anyone installing
  this package from a git URL, and without devDependencies the `husky` binary is not there.
  Husky's own docs recommend this. CI sets `HUSKY: 0` for the same reason — nothing to install
  on a throwaway checkout.

---

## CI and releasing

Two workflows in `.github/workflows/`:

**`ci.yml`** runs on every push to `main` and every PR. Two jobs:

- `check` — format check, lint, typecheck, tests and build on Node 24. The correctness gate.
- `compat` — builds on Node 24, then runs `scripts/smoke.mjs` against the built `dist/` on Node
  18, 20, 22 and 24. This exists because the two Node versions in play are not the same one: the
  build toolchain needs ≥22.18 (tsdown) while the package claims `engines: node >=20` for
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

To cut a release: move the `Unreleased` entries in `CHANGELOG.md` under a new heading for the
version, bump `version` in `package.json`, commit, then

```bash
git tag v0.1.1 && git push origin v0.1.1
```

`release.yml` refuses to publish a tag that `CHANGELOG.md` has no section for, the same way it
refuses one that disagrees with `package.json`. Both checks exist because the failure they
prevent is only visible after the fact, when the version is already on npm and cannot be
republished.

### Changelog

`CHANGELOG.md` is written by hand, in [Keep a Changelog](https://keepachangelog.com/) order —
newest first, grouped under `Added` / `Changed` / `Fixed` / `Removed`.

Changelog tooling comes in two families, and they fail differently. Keep them apart before
proposing one:

**Generated from commit messages** — `semantic-release`, `git-cliff`, `conventional-changelog`,
and `release-please`'s changelog half. Mechanically these would work here: all but three commits
in the project's history carry a conventional prefix. The output is the problem. Run
`git log --format='%s' v0.1.0 | grep -E '^(feat|fix)'` and read what 0.1.0's entry would have
been: thirty lines, of which maybe seven mean anything to someone installing the package, plus
`feat: add dist to .gitignore` and four separate `fix:` commits for one README path. Seven of
those lines are the dynamic-headers feature, counted once per commit. Commits track how the work
was built; a changelog tracks what changed. A parser cannot convert between them.

**Collected from hand-written entries** — `changesets`. It does _not_ read commits: you write a
markdown file per change, and it handles collecting them, bumping the version and assembling the
file. That is compatible with everything above, so the reason it isn't here is scale, not
quality: one maintainer and one to three entries per release, against a devDependency and a file
per PR to save a two-minute edit.

**Revisit when** releases stop being one person's decision, or an `Unreleased` section starts
arriving from more than one contributor at a time — that is the point changesets actually solves,
and the argument above stops holding. Nothing about the current file blocks the switch.

Two rules for entries:

- **Only what is observable from outside.** A refactor, a test, a docs fix — none of them get a
  line. If a user cannot tell it happened, the git history is the right place for it.
- **Say why, not just what.** The `duplex` entry in 0.2.0 is useful because it explains that a
  mocked `fetch` could not have caught the bug. "Fixed streaming bodies" would not have been.

Add entries under `## [Unreleased]` as the work lands, not at release time — reconstructing
them from `git log` afterwards is how the "why" gets lost.

---

## Working agreements

For anyone contributing:

- **Never add a runtime dependency.** Ask first, every time. The answer is almost certainly no.
- **Small diffs.** One concern per change.
- **Before adding a feature, answer:** Would 80% of users need this? Can it be done in fewer lines? Is it typed without `any`? Does it work in the browser, Node, and on the edge? If any answer is no, don't add it.
- **Before removing one, answer the counterweight:** does this leave anything a user cannot do at all? A dead end is worse than an option.
- **When in doubt, leave it out.** Removing a feature after release is a breaking change; never shipping it costs nothing.
- **When a change is reverted, write down why** — in a comment, a test name, or this file. Every wrong turn here was retried later by someone who only saw the absence.
