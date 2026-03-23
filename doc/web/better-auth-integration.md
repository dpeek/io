# Better Auth Integration Guide

This document turns the repo's existing auth and authorization contracts into a
concrete Better Auth integration plan for the current `web` Worker and
`GRAPH_AUTHORITY` Durable Object proof.

It is intentionally repo-specific. It describes what already exists in this
repo, what is still provisional, and what exact code and runtime changes would
be required to replace the current hardcoded operator auth path with a real
Better Auth-backed flow.

## Evidence Basis

Repo sources used for this guide:

- `doc/branch/02-identity-policy-and-sharing.md`
- `doc/03-target-platform-architecture.md`
- `doc/web/index.md`
- `src/web/worker/index.ts`
- `src/web/lib/auth-bridge.ts`
- `src/web/lib/server-routes.ts`
- `src/web/lib/graph-authority-do.ts`
- `src/web/lib/authority.ts`
- `src/graph/runtime/contracts.ts`
- `src/graph/runtime/authorization.ts`
- `src/graph/modules/core/identity/index.ts`
- `package.json`
- `wrangler.jsonc`

Primary external sources used for unresolved runtime details:

- [Better Auth options](https://www.better-auth.com/docs/reference/options)
- [Better Auth session management](https://www.better-auth.com/docs/concepts/session-management)
- [Better Auth cookies](https://www.better-auth.com/docs/concepts/cookies)
- [Better Auth user and accounts](https://www.better-auth.com/docs/concepts/users-accounts)
- [Better Auth Hono integration](https://www.better-auth.com/docs/integrations/hono)
- [Better Auth database concepts](https://www.better-auth.com/docs/concepts/database)
- [Better Auth other relational databases](https://www.better-auth.com/docs/adapters/other-relational-databases)
- [Cloudflare D1 Worker binding API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Cloudflare Workers compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)

Throughout this guide:

- `Repo:` means the conclusion is directly supported by the repo's current docs
  or code.
- `External:` means the conclusion comes from the linked Better Auth or
  Cloudflare docs.
- `Inference:` means the conclusion is a recommended design choice derived from
  both.

## Current State

### What Is Already Contractually Defined

Repo:

- `src/graph/runtime/contracts.ts` already defines the stable auth boundary the
  rest of the repo is supposed to use:
  - `AuthSubjectRef`
  - `AuthenticatedSession`
  - `AuthorizationContext`
- `src/web/lib/auth-bridge.ts` already defines the stable request-time
  projection seam:
  - `projectSessionToPrincipal(...)`
  - `createAnonymousAuthorizationContext(...)`
  - `SessionPrincipalProjection`
  - `SessionPrincipalProjectionError`
- `doc/branch/02-identity-policy-and-sharing.md` already assigns ownership:
  - Better Auth owns authentication state
  - the graph owns durable principals, roles, grants, and policy
  - the Worker auth bridge owns session verification plus reduction into
    `AuthorizationContext`
  - the authority runtime owns final read, write, and command enforcement
- `src/graph/modules/core/identity/index.ts` already adds the first graph types
  needed for identity projection:
  - `core:principal`
  - `core:authSubjectProjection`
  - `core:principalRoleBinding`

### What Is Already Implemented In Code

Repo:

- `src/web/worker/index.ts` already forwards `/api/sync`, `/api/tx`, and
  `/api/commands` to the Durable Object with a request-scoped
  `AuthorizationContext` encoded in `x-io-authorization-context`.
- `src/web/lib/server-routes.ts` already validates and consumes that header and
  passes a typed `AuthorizationContext` into sync, transaction, and command
  handlers.
- `src/web/lib/graph-authority-do.ts` already requires a request-bound
  `AuthorizationContext` before serving those routes.
- `src/web/lib/authority.ts` already enforces authorization from that context:
  - direct reads filter by `authorizeRead(...)`
  - sync payloads omit denied predicates
  - writes validate with `authorizeWrite(...)`
  - `/api/commands` validates with `authorizeCommand(...)`
  - stale `policyVersion` fails closed with `policy.stale_context`
- `wrangler.jsonc` already enables `nodejs_compat`, which Better Auth expects on
  Workers for Node compatibility features.

### What Is Still Hardcoded, Stubbed, Or Provisional

Repo:

- `src/web/worker/index.ts` now verifies Better Auth session state for
  `/api/sync`, `/api/tx`, and `/api/commands`, bypasses Better Auth's cookie
  cache on those graph routes, reduces verified session state into the repo's
  stable `AuthenticatedSession` contract, and forwards anonymous requests as
  anonymous instead of defaulting every browser request to the operator
  principal.
- `src/web/lib/auth-bridge.ts` now keeps the stable projection seam and also
  owns the Better Auth-specific reduction helpers that turn Worker session
  results into `AuthenticatedSession | null` before principal lookup runs.
- `package.json` now carries pinned `better-auth` runtime and the current
  Better Auth `auth` CLI migration dependency.
- `auth.ts` now gives the Better Auth CLI a repo-local config entrypoint for
  generating committed auth-store SQL migrations.
- `src/web/lib/better-auth.ts` now owns the shared Better Auth Worker factory
  and stable `/api/auth` base path, including optional trusted-origin env
  parsing.
- `src/web/worker/index.ts` now mounts `/api/auth/*` through that shared
  Better Auth handler before graph API forwarding and SPA asset handling.
- `src/web/lib/auth-client.ts` now provides the shared Better Auth SPA client
  wrapper for same-origin session reads.
- `src/web/components/auth-shell.tsx` now exposes the minimal signed-in or
  signed-out shell behavior, including sign-in, sign-out, and a provisional
  email/password create-account flow for local demos.
- graph-backed routes now gate `GraphRuntimeBootstrap` behind that client-side
  session check instead of mounting the full graph proof surface for anonymous
  browsers by default.
- `wrangler.jsonc` now declares a dedicated `AUTH_DB` D1 binding with a
  separate `migrations/auth-store` path and `better_auth_migrations` table.
- `src/web/lib/graph-authority-do.ts` now exposes a Worker-only internal fetch
  path that resolves a verified auth subject through the authority before the
  public graph routes are forwarded.
- `src/web/lib/authority.ts` now resolves `AuthSubjectRef` through
  `core:authSubjectProjection`, projects principal kind plus active role
  bindings into `SessionPrincipalProjection`, and repairs missing exact-subject
  projections or missing principals idempotently on first authenticated use.
  Authority bootstrap also repairs legacy persisted `core:principal` rows that
  are missing the required `homeGraphId`, and non-authority sync/read paths now
  exclude graph-owned identity entities entirely so required authority-only
  fields never reach browser replication as partial invalid entities.
- `capabilityGrantIds` and capability grant lookup are only placeholders today.
- `policyVersion` is a hardcoded constant (`0`) in both the Worker and the
  authority runtime.

### Contract And Implementation Gaps That Matter

Repo:

- `doc/branch/02-identity-policy-and-sharing.md` says the auth bridge should be
  able to repair or create missing projections on first authenticated use. The
  current implementation now does that synchronously in the authority-owned DO
  path, while still failing closed with explicit missing or conflict errors
  when repair cannot produce a single principal.
- `doc/03-target-platform-architecture.md` says session claims may include graph
  principal id plus capability snapshot or version. The current stable contract
  in `src/graph/runtime/contracts.ts` does not trust or require that. The
  stable request input is still a reduced session plus graph lookup.
- The Branch 2 sample `GraphPrincipal` model includes `capabilityVersion` and
  `defaultRoleIds`, but the shipped `core:principal` type currently has only:
  - `kind`
  - `status`
  - `homeGraphId`
  - `personId`
- `doc/web/index.md` now matches the current Worker behavior: anonymous graph
  requests stay anonymous, authenticated requests reduce through the auth
  bridge, and authenticated requests without a graph principal projection fail
  closed with `auth.principal_missing`.

## Ownership Boundary

### Better Auth Owns

Repo:

- Branch 2 and the target platform architecture both place authentication state
  outside the graph.

External:

- Better Auth owns the `user`, `session`, `account`, and `verification` tables.
- Better Auth owns cookie issuance, session verification, provider-specific
  login flows, account linking, and route handling at `/api/auth/*`.

In this repo that means Better Auth should own:

- sign-in and sign-out flows
- provider account records
- session records and session cookies
- password, passkey, OAuth, and verification-token concerns
- auth-specific rate limiting and verification state

### The Graph Owns

Repo:

- Branch 2 explicitly says the graph, not Better Auth, is the durable
  application model for identity and authorization.
- `src/graph/modules/core/identity/index.ts` already establishes the beginning
  of that model.

In this repo the graph should own:

- `core:principal`
- `core:authSubjectProjection`
- `core:principalRoleBinding`
- future capability grant and share grant records
- graph-specific role membership
- graph-specific policy and visibility decisions
- the authoritative mapping from a Better Auth subject to a principal

### The Worker Auth Bridge Owns

Repo:

- `src/web/lib/auth-bridge.ts` is the stable seam for this layer.
- `src/web/worker/index.ts` is the current host-specific request entrypoint.

In this repo the Worker auth bridge should own:

- mounting Better Auth's HTTP handler
- calling Better Auth to verify the incoming cookie-backed session
- reducing the Better Auth response into the repo's
  `AuthenticatedSession | null`
- invoking `projectSessionToPrincipal(...)`
- forwarding the resulting `AuthorizationContext` to the Durable Object

It should not own:

- final authorization decisions
- durable graph role assignment
- client-selected principal identity

### The Authority Runtime Owns

Repo:

- `src/web/lib/authority.ts` and `src/graph/runtime/authorization.ts` already
  enforce final policy from `AuthorizationContext`.

In this repo the authority runtime should own:

- exact lookup of `core:authSubjectProjection`
- exact lookup of `core:principal`
- exact lookup of `core:principalRoleBinding`
- future capability grant lookup
- idempotent repair and creation of missing projection rows
- the final read, write, and command policy decision

### Branch 2 Versus Branch 7

Repo:

- Branch 2 owns the durable meaning of identity and authorization.
- Branch 7 owns web and operator surfaces, including session handling UX.

The clean boundary for this repo is:

- Branch 2 semantics:
  - what a principal is
  - what an auth subject projection means
  - how authorization is evaluated
- Branch 7/web implementation:
  - where Better Auth is mounted
  - how the browser signs in
  - how request cookies are turned into `AuthenticatedSession`

Branch 7 may host the auth bridge code under `src/web/*`, but it must not
redefine Branch 2's principal or authorization semantics.

## Main Design Decisions

### 1. Use A Dedicated Better Auth Store

Repo:

- `doc/03-target-platform-architecture.md` already says Better Auth should run
  against a dedicated auth store separate from graph storage.
- `wrangler.jsonc` currently binds only the graph Durable Object and static
  assets.

External:

- Better Auth supports relational stores through its built-in Kysely adapter and
  supports Cloudflare D1 as a Kysely dialect.
- Cloudflare exposes D1 to Workers through an `env` binding.

Inference:

- The Better Auth store for this repo should be a separate D1 database binding,
  for example `AUTH_DB`.
- It should not share tables with `GRAPH_AUTHORITY`'s SQLite Durable Object
  storage.

Why this is the right split for this repo:

- it preserves the existing "Better Auth authenticates, graph authorizes"
  boundary
- it keeps auth schema migrations independent from graph/DO migrations
- it avoids coupling auth reads and writes to the graph authority DO lifecycle
- it lets Better Auth use its documented database support instead of forcing the
  graph store to impersonate a Better Auth adapter

### 2. Mount Better Auth In The Existing Worker

Repo:

- `src/web/worker/index.ts` is already the single Cloudflare Worker entrypoint.

External:

- Better Auth is mounted by routing `/api/auth/*` requests to `auth.handler(request)`.

Inference:

- This repo should keep one Worker and add a new route branch before the graph
  API forwarding:

```ts
if (url.pathname.startsWith("/api/auth/")) {
  return auth.handler(request);
}
```

This keeps auth, graph APIs, and SPA assets on the same origin, which is the
simplest cookie model for the current repo.

### 3. Verify Graph Requests Server-Side With Better Auth

External:

- Better Auth exposes `auth.api.getSession({ headers: request.headers })` for
  server-side session lookup.
- Better Auth's session cookie cache can be bypassed with
  `disableCookieCache: true`.

Inference:

- `src/web/worker/index.ts` should call Better Auth for every `/api/sync`,
  `/api/tx`, and `/api/commands` request.
- For graph routes, use `disableCookieCache: true` when verifying the session.

Recommended Worker-side behavior:

```ts
const betterAuthSession = await auth.api.getSession({
  headers: request.headers,
  query: { disableCookieCache: true },
});
```

Why this repo should bypass the cookie cache on graph routes:

- Better Auth cookie caching is a session-performance feature, not an
  authorization feature.
- The graph is the final authorization authority.
- This repo already treats revocation and policy versioning as fail-closed
  concerns.
- For graph APIs, avoiding stale revoked sessions is more important than saving
  one D1 read.

The browser can still use Better Auth's normal client caching for session-aware
UI. The stricter rule only needs to apply on Worker-side graph request
verification.

### 4. Keep Principal Resolution In The Graph, Not In Better Auth

Repo:

- `projectSessionToPrincipal(...)` already requires a graph lookup.
- Branch 2 says the graph is authoritative for authorization.

Inference:

- Even if Better Auth later returns a principal summary in a custom session
  payload, the Worker must still resolve the request through the graph-owned
  projection and role data before building `AuthorizationContext`.

That means:

- Better Auth may authenticate a user
- only the graph may say which principal that user is in `graph:global`
- only the graph may decide which `roleKeys` and future `capabilityGrantIds`
  apply

### 5. Do Not Auto-Grant Graph Membership On Sign-In

Repo:

- The current repo has a single hardcoded graph id: `graph:global`.
- The current core identity model has principals and role bindings, but no
  durable team membership or invite flow yet.

Inference:

- First-use projection repair may create a principal row, but it should not
  automatically create `graph:member` or `graph:authority` role bindings for
  every authenticated Better Auth user.
- Role binding must remain an explicit graph decision.

This is the biggest repo-specific constraint on a real integration. Without a
membership or invite model, automatic role grants would turn any valid Better
Auth account into a member of the shared proof graph.

Recommended first slice:

- create `core:principal` on first authenticated use if needed
- create `core:authSubjectProjection` on first authenticated use if needed
- do not create any role binding unless:
  - the deployment explicitly seeds one, or
  - an allowlist/bootstrap rule says this user should receive one

## Better Auth Runtime Integration For This Repo

### Worker Mounting

Recommended route order in `src/web/worker/index.ts`:

1. `/api/auth/*` -> Better Auth handler
2. `/api/sync` -> resolve request `AuthorizationContext`, forward to DO
3. `/api/tx` -> resolve request `AuthorizationContext`, forward to DO
4. `/api/commands` -> resolve request `AuthorizationContext`, forward to DO
5. everything else -> SPA asset handling

This preserves the repo's current graph API structure and keeps the Worker as
the single browser-facing host.

### Better Auth Factory Shape

Current repo file:

- `src/web/lib/better-auth.ts`

Recommended shape:

```ts
import { betterAuth } from "better-auth";

export function createBetterAuth(env: Env) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: env.AUTH_DB,
    trustedOrigins: env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    // provider config here
  });
}
```

Recommended env surface:

```ts
interface Env {
  ASSETS: Fetcher;
  GRAPH_AUTHORITY: DurableObjectNamespaceLike;
  AUTH_DB: D1Database;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_TRUSTED_ORIGINS?: string;
  // provider-specific env vars, e.g. GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
}
```

### Cookie And Session Handling

External:

- Better Auth's default cookie prefix is `better-auth`.
- Better Auth sets cookies as `httpOnly` and `secure` in production.
- Default cookie posture is same-origin friendly.
- Same-origin deployment is the simplest cookie model.

Inference:

- Because this repo serves both the SPA and the Worker APIs from the same
  origin, the initial integration should keep Better Auth on the same host and
  path prefix.
- No cross-domain cookie work is needed for the first slice.

Current repo impact:

- `src/web/components/graph-runtime-bootstrap.tsx` already uses same-origin
  fetches to `/api/sync` and `/api/tx`.
- Those fetches will naturally include same-origin cookies.

Only if the frontend later moves to a different origin should this repo add:

- `trustedOrigins`
- `credentials: "include"` on client requests
- `crossSubDomainCookies` or a reverse proxy strategy

### Storage Choice

Recommended store split:

- Better Auth state: D1 (`AUTH_DB`)
- Graph state: existing SQLite-backed Durable Object (`GRAPH_AUTHORITY`)

Do not do this:

- do not store Better Auth tables in the graph DO SQLite schema
- do not use the graph store as Better Auth's canonical session database
- do not make Better Auth session verification depend on a client-supplied
  principal or role

### Cloudflare-Specific Constraints

Repo:

- `wrangler.jsonc` already includes `"compatibility_flags": ["nodejs_compat"]`.

External:

- Better Auth's Worker guidance relies on Node compatibility features.
- Cloudflare's compatibility flags document says `nodejs_compat` populates
  `process.env` unless importable env is disabled.
- Cloudflare D1 is accessed through Worker env bindings.

Inference:

- The existing `nodejs_compat` flag is the right starting point and should stay.
- Even though Better Auth can read `process.env.BETTER_AUTH_SECRET` and
  `BETTER_AUTH_URL`, this repo should prefer explicit `env` wiring in
  `createBetterAuth(env)` because the Worker already uses explicit env plumbing.
- Better Auth schema migrations should be managed separately from DO
  migrations. Do not try to create Better Auth tables inside Worker request
  handling.

## Graph Projection Model

### Stable Repo Seam

Repo:

- `projectSessionToPrincipal(...)` takes:
  - `graphId`
  - `policyVersion`
  - `session: AuthenticatedSession | null`
  - `lookupPrincipal(...)`
- `lookupPrincipal(...)` returns:
  - `principalId`
  - `principalKind`
  - `roleKeys`
  - optional `capabilityGrantIds`
  - optional `capabilityVersion`

That seam is already correct for this repo and should remain the stable
boundary.

### Recommended Better Auth Subject Mapping

Repo:

- `AuthSubjectRef` is provider-neutral; it does not require a specific Better
  Auth internal payload shape.

External:

- Better Auth server-side session lookup returns `user` and `session`.
- Better Auth supports account linking by default, which means one Better Auth
  user can have multiple linked provider accounts.

Inference:

- The first shippable integration for this repo should canonicalize the subject
  to the Better Auth user id, not to a raw provider-account tuple.

Recommended first-slice subject:

```ts
const subject: AuthSubjectRef = {
  issuer: "better-auth",
  provider: "user",
  providerAccountId: betterAuthUser.id,
  authUserId: betterAuthUser.id,
};
```

Why this is the best first slice for this repo:

- it matches the repo's stable provider-neutral contract
- it avoids blocking the integration on provider-account disambiguation across
  linked accounts
- it guarantees one Better Auth user maps to one graph subject key

If the repo later needs provider-specific projections, it can add additional
`core:authSubjectProjection` rows such as:

- `provider = "github"`, `providerAccountId = githubAccountId`
- `provider = "google"`, `providerAccountId = googleAccountId`

while still keeping `authUserId` constant.

### Mapping To `core:authSubjectProjection`

Recommended durable mapping:

| Graph field         | Source                                    |
| ------------------- | ----------------------------------------- |
| `principal`         | graph-owned principal id                  |
| `issuer`            | `"better-auth"`                           |
| `provider`          | `"user"` for the first slice              |
| `providerAccountId` | Better Auth `user.id` for the first slice |
| `authUserId`        | Better Auth `user.id`                     |
| `status`            | `"active"` unless explicitly revoked      |
| `mirroredAt`        | current authority timestamp               |

### Mapping To `core:principal`

Recommended first-slice principal creation:

| Graph field   | Value                                      |
| ------------- | ------------------------------------------ |
| `kind`        | `human`                                    |
| `status`      | `active`                                   |
| `homeGraphId` | current graph id, currently `graph:global` |
| `personId`    | unset until person-model wiring exists     |

Repo caveat:

- `core:principal` does not yet contain `capabilityVersion`.
- The graph currently has no capability grant type at all.

So for the first slice:

- `capabilityGrantIds = []`
- `capabilityVersion = 0`

### Role Binding Lookup

Recommended authority-side lookup:

1. find the principal id from the active `core:authSubjectProjection`
2. list active `core:principalRoleBinding` rows for that principal
3. project `roleKey` values into `AuthorizationContext.roleKeys`

Current repo role semantics already used by `src/graph/runtime/authorization.ts`:

- `graph:authority`
- `graph:member`
- `graph:owner`

### Future Capability Grant Lookup

Repo:

- `AuthorizationContext` already includes `capabilityGrantIds` and
  `capabilityVersion`.
- the graph identity module does not yet define capability grant entities.

Recommended future extension:

1. add graph capability-grant types
2. load active grants targeted to the resolved principal
3. project their ids into `AuthorizationContext.capabilityGrantIds`
4. store or compute a monotonic `capabilityVersion`

Until then, Better Auth integration should leave capabilities empty rather than
invent a parallel auth-side capability system.

### Uniqueness And Idempotency Rules

Repo:

- Branch 2 requires `provider + providerAccountId` to map to at most one active
  projection per graph.

Recommended authority-side invariants:

- at most one active `core:authSubjectProjection` per
  `(graphId, issuer, provider, providerAccountId)`
- at most one active graph principal per canonical Better Auth user in the same
  graph
- repeated projection repair for the same subject must return the same principal
  and same projection row
- principal ids are generated only inside authority-owned code
- a revoked projection row is never silently reused; a new active row is
  created if re-linking is allowed

Current repo caveat:

- the graph store does not have dedicated uniqueness indexes for these identity
  facts today

So the first slice must enforce uniqueness transactionally in authority code.

## End-To-End Request Flow

### Browser Request

1. Browser loads the SPA from the existing Worker origin.
2. User signs in through Better Auth UI and Better Auth routes at `/api/auth/*`.
3. Better Auth sets session cookies on the same origin.
4. The existing SPA keeps calling `/api/sync`, `/api/tx`, and `/api/commands`
   on the same origin.

### Better Auth Session Verification In The Worker

1. `src/web/worker/index.ts` receives `/api/sync`, `/api/tx`, or
   `/api/commands`.
2. It creates or retrieves the Better Auth instance for the current env.
3. It calls `auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } })`.
4. If Better Auth returns `null`, the Worker treats the request as anonymous.
5. If Better Auth returns a session, the Worker reduces it to the repo's
   `AuthenticatedSession`.

### Reduction To `AuthenticatedSession`

Recommended first-slice reduction:

```ts
function reduceBetterAuthSession(result: BetterAuthSessionResult): AuthenticatedSession {
  return {
    sessionId: result.session.id,
    subject: {
      issuer: "better-auth",
      provider: "user",
      providerAccountId: result.user.id,
      authUserId: result.user.id,
    },
  };
}
```

This reduction belongs in `src/web/lib/auth-bridge.ts` or a Better Auth-specific
helper beside it. It should remain Worker-owned code, not graph runtime code.

### `projectSessionToPrincipal(...)`

1. The Worker calls `projectSessionToPrincipal(...)`.
2. If the reduced session is `null`, it returns the anonymous
   `AuthorizationContext`.
3. If the session is present, `projectSessionToPrincipal(...)` calls
   `lookupPrincipal(...)`.
4. `lookupPrincipal(...)` must be backed by the authoritative graph, not by
   Better Auth session claims.

### Graph Lookup Via `AuthSubjectProjection` And `Principal`

Recommended authority-side flow:

1. look up active `core:authSubjectProjection` by exact subject tuple
2. if found:
   - load `core:principal`
   - load active `core:principalRoleBinding` rows
   - return `SessionPrincipalProjection`
3. if missing:
   - run the first-use repair flow described below

### Construction Of `AuthorizationContext`

The Worker then constructs:

```ts
{
  graphId,
  principalId,
  principalKind,
  sessionId,
  roleKeys,
  capabilityGrantIds,
  capabilityVersion,
  policyVersion,
}
```

Current first-slice values still expected in this repo:

- `capabilityGrantIds = []`
- `capabilityVersion = 0`
- `policyVersion = 0`

### Forwarding To The Durable Object

1. The Worker encodes the `AuthorizationContext`.
2. It sets `x-io-authorization-context`.
3. It forwards the request to `GRAPH_AUTHORITY`.

This part already exists and should stay.

### Final Policy Enforcement In Authority

Repo:

- `src/web/lib/authority.ts` already enforces:
  - read filtering
  - write validation
  - command validation
  - stale `policyVersion` rejection

So after Better Auth is wired in, the final enforcement point does not move. The
Worker only stops fabricating the operator principal and starts supplying the
real request-bound context.

## First Authenticated-Use Flow

### Recommended Repair Strategy

The first slice should use synchronous, authority-owned, idempotent repair.

Reason:

- the repo already has a stable request-time projection seam
- there is no existing queue-driven auth mirror pipeline
- the graph authority DO is already the only canonical write point for graph
  state

### Exact Repair Algorithm

Given `subject = { issuer, provider, providerAccountId, authUserId }`:

1. Check for an active `core:authSubjectProjection` with the exact tuple.
2. If one exists, use it.
3. If none exists, look for other active projections with the same
   `authUserId`.
4. If exactly one principal is already associated with that `authUserId`:
   - create the missing exact-subject projection row pointing at that principal
   - do not create a second principal
5. If no principal exists for that `authUserId`:
   - create a new `core:principal`
   - create a new `core:authSubjectProjection`
   - do not automatically create role bindings unless an explicit bootstrap rule
     allows it
6. If multiple different principals are associated with the same Better Auth
   user:
   - fail closed
   - log an operator-visible conflict
   - do not guess

### What Is Authoritative

Authoritative:

- Better Auth is authoritative for "is this cookie-backed session valid?"
- the graph is authoritative for "which graph principal is this?" and "what can
  this principal do?"

Derived:

- `AuthenticatedSession`
- `AuthorizationContext`
- any principal summary cached in the client

### What Happens On Conflict

Recommended behavior:

- return a hard failure, not anonymous downgrade
- do not create a new principal
- log:
  - subject tuple
  - conflicting principal ids
  - graph id

Current contract caveat:

- the stable policy error set does not yet include a dedicated
  `auth.principal_conflict` code

Recommended first-slice behavior:

- surface `auth.principal_missing` to the caller
- record conflict details in logs or observability
- treat a dedicated conflict code as a future contract addition

## Failure Behavior

### Unauthenticated Request

Recommended behavior:

- Better Auth returns `null`
- Worker builds anonymous `AuthorizationContext`
- public reads may still work
- protected reads fail with `auth.unauthenticated` or are omitted from sync
- writes and commands fail through normal authority enforcement

### Missing Projection

Recommended behavior:

- attempt authority-side repair once inside the same request
- if repair still cannot resolve a principal, return `auth.principal_missing`

### Stale Policy Or Capability Context

Repo:

- authority already rejects stale `policyVersion`
- capability version is not yet enforced anywhere

Recommended first slice:

- keep `policyVersion = 0` in Worker and authority
- keep `capabilityVersion = 0`
- do not invent partial capability-version semantics before the graph model
  exists

### Better Auth Store Unavailable

Recommended behavior:

- if the request has no auth cookie and Better Auth returns `null`, treat it as
  anonymous
- if the request appears to be authenticated but Better Auth cannot verify
  because the auth store is unavailable, return `503`
- do not silently downgrade an apparently authenticated graph write request to
  anonymous

This is stricter than "serve anonymous" because this repo's graph APIs are not a
generic public content surface.

### Malformed Or Revoked Session

Recommended behavior:

- Better Auth returns `null`
- Worker treats the request as anonymous
- signed-in UI should redirect to sign-in or reauth
- graph writes remain denied

## Security Considerations

### The Client Must Never Choose `principalId`

Repo:

- Branch 2 explicitly says `projectSessionToPrincipal(...)` must never trust a
  client-supplied `principalId`.
- The current server-routes and authority flow already assume the header context
  is Worker-produced, not browser-produced.

That rule must remain absolute after Better Auth lands.

### Cookie And Session Trust Boundary

External:

- Better Auth signs its cookies with the configured secret.

Inference:

- the browser may present a Better Auth cookie
- only Better Auth may verify and decode it
- only the Worker may turn the verified Better Auth session into the repo's
  reduced `AuthenticatedSession`
- only the graph authority may map that reduced session to a principal and
  authorize data access

### Authentication And Authorization Must Stay Separate

This repo already has the right contract split. The Better Auth integration
must preserve it:

- Better Auth says whether the caller is authenticated
- the graph says what that caller may read or write

Do not move graph role, membership, or capability logic into Better Auth custom
session payloads.

### Replay, Revocation, And Versioning

Recommended behavior in this repo:

- bypass Better Auth cookie cache on graph route verification
- resolve graph roles and future grants on every request
- keep `policyVersion` in the request context so the authority can fail closed
- later add monotonic `capabilityVersion` once the graph model exists

This makes:

- Better Auth session revocation effective at session verification time
- graph role or grant revocation effective at graph authorization time

## Required Code And Runtime Changes

### Runtime And Dependency Changes

The repo now includes the runtime foundation described here:

1. `package.json`
   - committed `better-auth` runtime and `auth` CLI migration tooling
2. `wrangler.jsonc`
   - a dedicated `AUTH_DB` D1 binding
   - a separate `migrations/auth-store` path plus `better_auth_migrations`
   - the existing `nodejs_compat`, `GRAPH_AUTHORITY`, and `ASSETS` surfaces
3. auth database migrations
   - a committed Better Auth SQL migration workflow rooted at `auth.ts`
   - a dedicated D1 migration path outside the Durable Object migration block

### File-By-File Change Plan

`src/web/lib/better-auth.ts`

- keep the shared Better Auth instance factory
- configure:
  - `baseURL`
  - `basePath`
  - `secret`
  - `database: env.AUTH_DB`
  - optional `trustedOrigins`
  - chosen providers as follow-on auth UX work needs them

`src/web/lib/auth-bridge.ts`

- keep `projectSessionToPrincipal(...)` as the stable projection seam
- add Better Auth-specific reduction helpers, for example:
  - `reduceBetterAuthSession(...)`
  - `createWorkerAuthorizationContext(...)`
- do not embed graph lookup logic directly in Better Auth parsing helpers

`src/web/worker/index.ts`

- keep `/api/auth/*` mounted through the shared Better Auth handler
- replace `createRequestAuthorizationContext(...)` with:
  - Better Auth session verification
  - reduction to `AuthenticatedSession`
  - call to `projectSessionToPrincipal(...)`
  - authority lookup/repair callback
- stop forwarding the hardcoded operator principal

`src/web/lib/graph-authority-do.ts`

- now exposes an internal authority lookup/repair seam callable by the Worker
  before the public graph request is forwarded
- current shape:
  - an internal DO fetch path not routed publicly by the Worker
  - still compatible with a future Durable Object RPC migration if the repo
    adopts that style later

`src/web/lib/authority.ts`

- now implements authority-owned helpers to:
  - resolve a subject projection
  - resolve principal kind
  - resolve active role bindings
  - create missing principal and projection rows transactionally
  - detect multi-principal conflicts for one auth user and fail closed
  - later resolve capability grants
- keep final read, write, and command enforcement where it already lives

`src/graph/modules/core/identity/index.ts`

- add whatever missing durable identity fields the repo decides to make
  canonical for request projection
- likely follow-up candidates:
  - `capabilityVersion` on principal or an equivalent version source
  - future grant types

`src/graph/runtime/contracts.ts`

- no change required for the basic Better Auth integration
- optional later change if the repo wants a dedicated conflict error code such
  as `auth.principal_conflict`

`src/web/lib/auth-client.ts` or equivalent new client file

- add Better Auth client wiring for SPA sign-in and session-aware UI

`src/web/routes/*` and `src/web/components/*`

- add sign-in or signed-out shell behavior
- gate graph runtime bootstrap so unauthenticated users do not immediately try
  to mount the full graph proof surface

### Test Changes

Recommended new or updated tests:

- `src/web/worker/index.test.ts`
  - verify `/api/auth/*` routing
  - verify real session-derived `AuthorizationContext`
  - verify unauthenticated requests become anonymous
- `src/web/lib/auth-bridge.test.ts`
  - add Better Auth reduction tests
- `src/web/lib/graph-authority-do.test.ts`
  - add internal subject lookup/repair coverage
- `src/web/lib/authority.test.ts`
  - add projection creation, idempotent repair, and role binding lookup tests

## Recommended Sequencing

### Smallest Shippable Slice

1. Add Better Auth dependency and D1 auth store.
2. Mount `/api/auth/*` in the Worker.
3. Verify sessions on graph API requests and stop using the hardcoded operator
   principal.
4. Implement canonical Better Auth user -> graph principal projection with
   synchronous first-use repair.
5. Load role bindings from the graph.
6. Keep:
   - `policyVersion = 0`
   - `capabilityGrantIds = []`
   - `capabilityVersion = 0`
7. Do not auto-grant roles on sign-in.

That is the minimum slice that turns the repo from "static operator proof" into
"real authenticated principal projection" without pretending capability grants
or sharing already exist.

### Next Slice

1. Refine the new minimal signed-out and sign-in SPA shell into a fuller auth
   product surface.
2. Add an explicit operator bootstrap or allowlist rule for initial role
   assignment.
3. Add graph-backed principal summary/bootstrap payload for the app shell.
4. Add graph-backed, operator-editable auth policy/config entities for
   non-secret Better Auth settings such as:
   - enabled providers
   - provider presentation metadata
   - account-linking policy
   - invite or signup policy
   - domain allowlists
5. Keep Better Auth bootstrap/runtime config out of the graph, including:
   - `BETTER_AUTH_SECRET` and rotated secrets
   - Worker/D1 bindings
   - `baseURL` and `basePath`
   - callback and hook functions
   - other settings Better Auth needs before the graph can be queried

### What Should Remain Provisional For Now

- provider-specific subject tuples
- async auth-event mirroring into the graph
- capability grants
- share grants
- persisted `policyVersion`
- persisted `capabilityVersion`
- public multi-user admission or invite UX

## Open Questions And Recommendations

### 1. Should The Subject Tuple Be Better Auth User-Level Or Provider-Account-Level?

Current repo state:

- the stable contract is provider-neutral
- Better Auth `getSession` exposes `user` and `session`
- Better Auth supports linked accounts by default

Recommendation:

- use a canonical Better Auth user-level subject for the first slice
- add provider-account-specific projections later only if the repo genuinely
  needs them

### 2. Should First-Use Sign-In Auto-Provision Member Access?

Current repo state:

- the graph id is currently a single shared `graph:global`
- there is no invite or membership model in the shipped graph schema

Recommendation:

- no
- create principals and projections automatically if needed
- require explicit role binding for actual graph membership or authority

### 3. Where Should `capabilityVersion` Come From?

Current repo state:

- it exists in `AuthorizationContext`
- it does not exist in the shipped core identity graph types

Recommendation:

- keep `0` for the first Better Auth slice
- add a graph-owned monotonic source once capability grant entities exist

### 4. Where Should `policyVersion` Come From?

Current repo state:

- Worker and authority both hardcode `0`

Recommendation:

- keep `0` for the first slice so the contract stays intact
- later move to a graph-owned or authority-owned monotonic value shared by both
  the Worker auth bridge and the authority runtime

### 5. Should Projection Repair Happen Synchronously Or Through Async Mirroring?

Current repo state:

- there is no auth mirror worker or queue pipeline
- the authority DO is already the only canonical graph write point

Recommendation:

- implement synchronous repair in the authority for the first slice
- add async mirroring later only if auth volume or provider complexity justifies
  it

### 6. Should This Repo Use Better Auth Cookie Cache For Graph APIs?

External:

- Better Auth's cookie cache is optional and can be bypassed.

Recommendation:

- do not rely on cookie cache for graph route verification
- call Better Auth with `disableCookieCache: true` for `/api/sync`,
  `/api/tx`, and `/api/commands`

### 7. Should Better Auth Config Be Editable Through The Graph?

Current repo state:

- the repo already separates graph-visible metadata from authority-only secret
  storage
- Better Auth runtime configuration includes secrets, env-bound resources, and
  callback functions that are not natural graph data

Recommendation:

- yes for graph-backed, operator-editable auth policy/config
- no for the full raw Better Auth config object

Recommended graph-backed scope:

- enabled providers
- provider labels, ordering, and presentation metadata
- account-linking policy
- invite-only versus open signup policy
- domain allowlists
- graph-side first-use provisioning rules

Recommended non-graph scope:

- `BETTER_AUTH_SECRET` and rotated secrets
- D1 binding selection
- Worker mount path and base URL
- email sending implementations
- Better Auth hooks, callbacks, and background task handlers

Implementation rule:

- the Worker should compose Better Auth config from two sources:
  - env/code-owned bootstrap settings
  - graph-owned operator policy settings loaded through an authority-only read

This avoids a bootstrap cycle where Better Auth would need the graph before it
can authenticate the request that authorizes access to the graph.

## Summary

The repo already has the right long-term contract boundary:

- Better Auth authenticates
- the Worker reduces and forwards request auth context
- the graph authority authorizes

What it still does not have yet is the full end-user auth product surface. The
remaining work is:

- refining the minimal Better Auth client shell into a fuller account and auth
  product surface
- adding an explicit bootstrap or allowlist rule for initial role assignment
- adding capability grants and non-zero `capabilityVersion`

The repo now has the core runtime path needed for real authenticated principal
projection: Better Auth verifies the session, the Worker reduces it, and the
graph authority resolves or repairs graph-owned identity before authorization
continues.
