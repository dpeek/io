# Web Overview

## Purpose

`web` owns the TanStack Router SPA that runs on the Worker shell. It provides
operator-facing browser surfaces on top of the synced graph runtime, including
the workflow review route, the graph explorer, and the dedicated sync monitor.
The current explorer now uses the canonical type-first `/graph` route and
search-param selection model described in `./explorer.md`, plus a shared
inspector shell, draft-backed generic create flow for supported entity types,
and opt-in debug disclosures for raw ids and keys. Its authoritative graph path
now runs through a raw-SQL SQLite-backed Durable Object adapter that retains a
bounded transaction window and keeps secret plaintext in authority-only side
storage. The current auth foundation now also reserves a dedicated Better Auth
D1 store and migration path that stays separate from the graph authority's
SQLite Durable Object storage. The current shell now also consumes the Worker
served principal-summary bootstrap contract, keeps Better Auth limited to the
sign-in and sign-out mutations, and gates graph runtime bootstrap until the
browser resolves an explicit signed-out, ready, or expired bootstrap state.
The shared graph runtime contracts now also publish the
stable minimum browser identity bootstrap surface:
`WebPrincipalSession`, `WebPrincipalSummary`, and
`WebPrincipalBootstrapPayload`. That create-account path is still a provisional
local demo surface rather than a finished account-management product.

## Principal Bootstrap Contract

`GET /api/bootstrap` is the one stable browser identity bootstrap seam for the
current web shell. It resolves before any graph-backed route mounts and it does
not duplicate graph sync bootstrap. The Worker derives this payload from the
request-bound Better Auth session check plus authority-side principal lookup,
then the browser consumes that result without inferring identity locally.

Stable payload semantics:

- `signed-out`: anonymous caller or no active Better Auth session. The payload
  returns `session.authState = "signed-out"` with `sessionId = null`,
  `principalId = null`, `capabilityVersion = null`, and `principal = null`.
- `ready`: authenticated caller with a resolved graph principal. The payload
  returns a `WebPrincipalSummary` plus matching `session.sessionId`,
  `session.principalId`, and `session.capabilityVersion`.
- `expired`: the browser presented Better Auth cookies, but the Worker could no
  longer verify them. The payload returns `session.authState = "expired"` and
  `principal = null` so the shell can require reauthentication without
  pretending the old principal summary is still current.

Failure behavior outside the payload:

- bootstrap fetch failure: the shell stays outside graph runtime bootstrap and
  enters an explicit retryable error state instead of guessing `signed-out` or
  `ready`
- authenticated principal lookup failure: the Worker fails closed with
  `403 auth.principal_missing`; callers must not downgrade that response into an
  anonymous bootstrap
- session verification unavailable: the Worker returns
  `503 auth.session_unavailable`; callers should keep the signed-out shell
  chrome mounted and offer retry
- retry: refetching the principal bootstrap keeps the last resolved shell state
  visible until the new fetch settles, so shells and tools do not thrash
  between ready, signed-out, and loading during transient failures

Current proof anchors:

- `../../src/web/worker/index.test.ts`: anonymous, ready, expired,
  `auth.principal_missing`, and `auth.session_unavailable` worker responses
- `../../src/web/lib/auth-client.test.ts`: shared client projection, retry, and
  bootstrap-error handling
- `../../src/web/components/auth-shell.test.tsx`: graph-route gating for
  signed-out, expired, ready, and retryable bootstrap-error states

## Ownership Boundary

`web` is the browser product surface package, not the shared browser-primitive
package. The terminal sibling surface lives in `../../src/tui/*`.

- keep reusable browser UI and editor chrome in `../../lib/web/src/*`
- keep graph-aware field resolver, predicate mutation, and typed preview logic
  in `../../src/graph/runtime/react/*` and
  `../../src/graph/adapters/react-dom/*`
- keep route/page composition, explorer state, and Worker
  authority wiring in `../../src/web/*`

In practice, `web` should compose `@io/web` primitives such as shared inputs,
comboboxes, markdown rendering, Monaco loading, and source/preview shells, but
it should not become the default home for reusable editor infrastructure. If a
browser component can be reused by non-graph screens without importing graph
types, move it to `@io/web`. If it is deciding how a graph predicate validates,
mutates, or previews, leave that code in `graph` even when the surrounding
chrome comes from `@io/web`.

The current `POST /api/commands`, `POST /api/query`, `POST /api/workflow-read`,
and `POST /api/workflow-live` routes are part of that same package boundary.
`/api/query` is now the reusable web transport path for the generic serialized
query envelope, while `/api/workflow-read` remains the workflow-specific proof
and compatibility surface for the first shipped board and commit-queue reads.
Those routes are still web-owned surfaces rather than published graph-owned
command registries.

## Docs

- `../index.md`
- `./auth-store.md`
- `../storage.md`
- `./explorer.md`
- `../graph/spec/refs-and-ui.md`

## Layout

- `../../src/web/router.tsx`, `../../src/web/routeTree.gen.ts`: router assembly
  and generated route tree for the SPA routes, including `/workflow` and
  `/graph`
- `../../auth.ts`: Better Auth CLI config entrypoint that keeps schema
  generation on a dedicated auth-store path without coupling it to the Worker's
  runtime bindings
- `../../src/web/routes/`: top-level pages including `workflow`, `sync`,
  `views`, and the graph explorer routes
- `../../src/web/components/home-page.tsx`: session-aware landing page that
  keeps the signed-out auth entry flow and the signed-in bootstrap summary in
  one place
- `../../src/web/components/auth-shell.tsx`: principal-bootstrap consumer
  hook, sign-in/sign-out chrome, provisional create-account form, and the gate
  that keeps graph surfaces from booting until bootstrap state is known
- `../../src/web/components/graph-runtime-bootstrap.tsx`: shared synced graph
  runtime bootstrap for browser pages
- `../../src/web/components/entity-type-browser.tsx`: reusable list/detail
  browser for one entity type keyed only by the target type id plus the list
  title, reusing the generic entity inspector for the selected record plus the
  explorer's generic draft-backed create flow inside a shared dialog with the
  base dialog header and footer primitives
- `../../src/web/components/workflow-page.tsx`: `/workflow` composition that
  binds the browser route to the shipped `workflow-review` sync scope and
  hands startup off to the workflow-native review contract
- `../../src/web/components/workflow-review-page.tsx`: route-level workflow
  review startup surface that resolves the initial project, reads
  `ProjectBranchScope` and `CommitQueueScope`, re-pulls them after
  workflow-review invalidations through the scoped live transport, and keeps
  missing or partial workflow-review data explicit instead of widening to
  whole-graph bootstrap
- `../../src/web/lib/workflow-review-contract.ts`: explicit `/workflow`
  startup contract covering scoped bootstrap, route search selection, initial
  project inference, first-branch selection, and missing-data handling before
  richer browser workflow composition lands
- `../../src/web/components/explorer/index.ts`: explorer entrypoint for the
  graph and sync pages
- `../../src/web/components/explorer/`: graph explorer modules split by
  responsibility, including shared catalog/navigation helpers, the unified
  inspector shell, draft-backed generic create bindings, field editors, the
  sync inspector, and the `/graph` entity-selection path now reusing the shared
  typed browser component for record lists plus default entity editing
- `../../src/web/components/sync-page.tsx`: top-level sync monitor for
  authority cursor, pending writes, recent authoritative activity, and
  surfaced write-scope diagnostics for acknowledged and pulled writes, plus
  cursor-advance diagnostics when incremental replication filters out all
  browser-visible transactions. The current proof now also surfaces the
  retained base cursor plus active retained-history policy so fallback causes
  stay legible to operators. It lets operators switch between explicit
  whole-graph recovery and the first named
  `ops/workflow` review scope, inspect delivered scope metadata, and trigger
  scoped refreshes over the shared `/api/sync` transport contract
- `../../src/web/components/app-shell.tsx`: shared shell and navigation
- `../../lib/web/src/markdown.tsx`: shared markdown renderer with Bun-first and
  `react-markdown` fallback behavior reused by graph field views and previews
- `../../lib/web/src/source-preview.tsx`,
  `../../lib/web/src/monaco.tsx`: shared source/preview editor shell, Monaco
  bootstrapping, shared source-editor preset, and panel styling reused by graph
  DOM field editors and future browser editors that need the same chrome, but
  without moving graph predicate semantics into `@io/web`
- `../../src/web/lib/graph-authority-do.ts`: SQLite-backed Durable Object
  adapter entrypoint that bootstraps graph tables in the constructor, hydrates
  retained history during authority init, commits graph and secret side-storage
  changes in one Durable Object storage transaction, and routes between the
  internal Worker-only auth helpers plus the public sync, command, generic
  serialized query, and workflow surfaces
- `../../src/web/lib/query-transport.ts`: web-owned `POST /api/query` path
  constant plus the shared generic serialized-query client helper re-export
- `../../src/web/lib/graph-authority-internal-routes.ts`: web-only
  session-principal lookup-and-repair, bearer-share hash lookup, and
  authoritative policy-version handlers kept separate from the Durable Object
  storage composition entrypoint
- `../../src/web/lib/better-auth.ts`: shared Better Auth option/factory helper
  for the dedicated `AUTH_DB` binding, optional trusted-origin wiring, the
  stable `/api/auth` base path, and the minimal email/password browser demo
  flow
- `../../src/web/lib/auth-client.ts`: Better Auth React client mutations plus
  the shared principal-bootstrap fetch and shell-state projection helpers
- `../../src/web/lib/workflow-transport.ts`: shared `POST /api/workflow-read`
  request and response envelopes plus the fetch helper that browser, TUI, or
  MCP callers can reuse for the first shipped `ProjectBranchScope` and
  `CommitQueueScope` compatibility proof while generic serialized-query callers
  move to `../../src/graph/runtime/http-client.ts`
- `../../src/web/lib/workflow-live-transport.ts`: shared
  `POST /api/workflow-live` request and response envelopes plus the fetch
  helper that callers can reuse for the first ephemeral workflow review live
  registration, queued invalidation pull, and removal proof
- `../../src/web/lib/workflow-review-live-sync.ts`: browser-facing caller
  helper that composes `workflow-live-transport` with the scoped `/api/sync`
  client so workflow-review callers can register once, scoped-refresh on
  `cursor-advanced`, and recover from inactive pulls with re-registration plus
  another scoped re-pull
- `../../src/web/lib/workflow-review-refresh.ts`: small browser route refresh
  loop that keeps `/workflow` registered against workflow-review live
  invalidations, triggers scoped refreshes only, and tears the registration
  down on route exit
- `../../src/web/lib/authority.ts`: shared web authority behavior, secret-field
  mutation flow, the current web-owned `/api/commands` envelope, the shared
  write/command authorization seam, principal-aware sync filtering that omits
  denied predicates from total and incremental sync payloads, excludes
  graph-owned identity entities from non-authority snapshot and sync surfaces
  so required authority-only fields never leak partial invalid entities,
  direct-read helpers that omit denied predicates from snapshot-style reads and
  fail explicit protected predicate reads with stable `policy.read.forbidden`
  errors, decision-scoped lowering of active principal-target capability grants
  into the shared read, write, and command authorizers, explicit
  `policyVersion` fail-closed checks for authority-owned read,
  `/api/sync`, `/api/tx`, and `/api/commands` paths, authority-planned
  module-scoped sync for the first named `ops/workflow` review scope over
  `/api/sync`, authority-planned workflow review live registrations over
  `/api/workflow-live` that stay scoped to the current review cursor and
  authenticated session identity, conservative `cursor-advanced` invalidation
  emission for accepted workflow writes through the shared transaction hook
  plus dependency-key fan-out into matching live registrations,
- `../../src/web/lib/workflow-authority.ts`,
  `../../src/web/lib/workflow-authority-aggregate-handlers.ts`,
  `../../src/web/lib/workflow-authority-commit-handlers.ts`,
  `../../src/web/lib/workflow-authority-shared.ts`: workflow mutation authority
  routing split between the public mutation dispatcher, aggregate-local
  project/repository/branch handlers, commit lifecycle handlers, and shared
  entity lookup plus uniqueness guards so branch reconciliation and
  repository-commit finalization stay isolated from unrelated mutation paths
  authority-owned auth subject resolution with idempotent first-use
  principal/projection repair plus active role binding lookup, explicit
  bootstrap-operator and admission-approval command paths that seed the first
  operator and maintain durable email-based initial-access approvals in
  graph-owned state, the provisional bearer-share lookup path that resolves
  hash-stored bearer grants only when
  they still have an active validated share surface plus an explicit unexpired
  `constraintExpiresAt`, bearer-share visibility resets that force total-sync
  recovery when linked share grants change, authority-owned
  `ProjectBranchScope` and `CommitQueueScope` reads that rebuild from
  authoritative workflow, repository, and session records and fail closed with
  stable workflow query codes, and the storage abstraction
  consumed by both tests and the Durable Object adapter, including an opt-out
  seeded-example bootstrap path used by web authority tests plus a cached
  graph-metadata/bootstrap path for repeated authority construction
- `../../src/web/lib/workflow-live-scope-router.ts`: in-memory workflow review
  registration router that renews, expires, and removes ephemeral live scope
  registrations while indexing them by session, scope, and dependency key,
  queueing matching invalidations, and reporting `active: false` when callers
  need to re-register after expiry or router loss
- `../../src/web/lib/authority-test-helpers.ts`: no-seed test authority
  factory plus cached persisted workflow baseline helpers for the slow web
  authority and Durable Object suites
- `../../src/web/lib/mutation-planning.ts`: shared snapshot-backed mutation
  planner that records asserted and retracted store operations directly instead
  of diffing whole-store before/after snapshots
- `../../src/web/lib/example-runtime.ts`: seeded sync-proof runtime fixture
  that now reuses a cached seeded authority baseline and direct recorded
  mutation planning for hidden-only cursor tests while seeding the local
  workflow shell fixture used by `io tui`
- `../../src/web/lib/`: worker-backed graph authority, generic secret-field
  mutation contracts, seeded example data/runtime fixtures, and HTTP route
  helpers
- `../../src/web/lib/example-runtime.test.ts`: sync proof coverage for the
  web-owned example runtime fixture
- `../../src/web/worker/index.ts`: Worker entrypoint for SPA assets and graph
  APIs. It mounts the shared Better Auth handler at `/api/auth/*`, then
  resolves a request-bound `AuthorizationContext` for graph routes and forwards
  that stable contract to the Durable Object authority path. The current worker
  now verifies Better Auth sessions with cookie-cache bypass for graph
  requests, reduces them into the repo's stable `AuthenticatedSession` shape,
  resolves the current authoritative `policyVersion` through the Durable
  Object's internal lookup seam before projecting request auth, with that
  served version sourced from the compiled contract snapshot in
  `../../src/web/lib/policy-version.ts`, forwards
  anonymous requests as anonymous, resolves authenticated subjects through the
  Durable Object's internal lookup-and-repair seam, serves
  `GET /api/bootstrap` as the explicit
  `WebPrincipalBootstrapPayload` seam for anonymous, authenticated, and stale
  browser sessions, exposes the explicit `POST /api/access/activate` initial
  role-binding workflow for the current authenticated principal, forwards the
  `POST /api/query`, `POST /api/workflow-read`, and `POST /api/workflow-live`
  routes alongside `/api/sync`, `/api/tx`, and `/api/commands`, hashes issued
  bearer share tokens locally before calling the Durable Object's internal
  bearer-share lookup seam, lowers successful bearer lookups into anonymous
  shared-read `GET /api/sync` requests only, strips raw `Authorization` and
  `Cookie` headers before forwarding to the Durable Object, and fails closed
  when an authenticated session or bearer share token no longer resolves to an
  active graph-backed authorization context.
- `../../src/web/worker/index.test.ts`: end-to-end admission coverage for the
  shipped Worker path, including bootstrap, explicit allowlist admission,
  domain-gated open signup, deny, admitted-but-unbound principals, and the
  explicit initial role-binding workflow
- `../../src/web/lib/graph-authority-do.test.ts`: Durable Object lookup-and-
  repair coverage for the same first authenticated-use admission branches
- `../../migrations/auth-store/`: committed Better Auth schema migrations for
  the dedicated D1 auth store, applied separately from Durable Object
  migrations
