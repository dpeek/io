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
`WebPrincipalBootstrapPayload`. The repo now also defines the planned
localhost-only instant-onboarding contract in `./local-bootstrap.md` so the
future local happy path can exchange one short-lived bootstrap credential for a
normal Better Auth session without adding a second long-lived auth model. The
current browser shell now exposes that localhost path as an explicit signed-out
`Start locally` action for the deterministic synthetic local identity, then
reuses the existing principal bootstrap, optional first-operator bootstrap, and
access-activation seams until the local session reaches a writable graph state
or fails explicitly. The create-account path is still a provisional local demo
surface rather than a finished account-management product.

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

- `../../lib/app/src/web/worker/index.test.ts`: anonymous, ready, expired,
  `auth.principal_missing`, and `auth.session_unavailable` worker responses
- `../../lib/app/src/web/lib/auth-client.test.ts`: shared client projection, retry, and
  bootstrap-error handling
- `../../lib/app/src/web/components/auth-shell.test.tsx`: graph-route gating for
  signed-out, expired, ready, and retryable bootstrap-error states

## Localhost Bootstrap Contract

The shipped localhost instant-onboarding slice does not change the browser's
stable bootstrap state machine. It first redeems a local-only bootstrap
credential into a normal Better Auth session, then the browser continues
through the existing `GET /api/bootstrap` and `POST /api/access/activate`
seams.

For developers, this is the default local first-run path: `io start`, open the
localhost web shell, then click `Start locally` once. That one click should end
in the same Better Auth-backed browser session model as every other auth path,
plus writable graph access when the local flow can determine one safe outcome.
Use the email auth entry instead when you want the more production-like path.

Stable contract anchors:

- `./local-bootstrap.md`: localhost bootstrap credential, deterministic
  synthetic local identity, the shipped Worker route contract, local-only
  guardrails, and failure behavior
- `../../lib/app/src/web/lib/local-bootstrap.ts`: typed contract and validation
  helpers for the shared Worker/browser flow
- `../../lib/app/src/web/lib/local-bootstrap.test.ts`: token format, TTL,
  local-origin, and deterministic identity coverage
- `../../lib/app/src/web/worker/index.test.ts`: local credential issuance,
  redemption, full instant-onboarding happy path, writable-graph proof, expiry,
  replay rejection, non-local denial, and ambiguous local-admission coverage

## Ownership Boundary

`web` is the browser product surface package, not the shared browser-primitive
package. The terminal sibling surface lives in `../../lib/cli/src/tui/*`.

- keep reusable browser UI and editor chrome in `../../lib/web/src/*`
- keep graph-aware field resolver, predicate mutation, and typed preview logic
  in `../../lib/graph-react/src/*`,
  `../../lib/graph-module-core/src/react-dom/*`
- keep route/page composition, explorer state, and Worker
  authority wiring in `../../lib/app/src/web/*`

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
command registries. Browser launch and attach do not go through Worker routes:
the browser now probes a separate localhost `browser-agent` runtime over
`../../lib/cli/src/browser-agent/transport.ts`, and `/workflow` keeps unavailable local
runtime state explicit until that bridge is reachable.
command registries. The shared browser query-container contract now also lives
behind the dedicated `@io/app/web/query-container` export, so routes can bind
saved or inline queries, renderer compatibility, and lifecycle state through
one reusable surface instead of route-local props. The first reusable route
mount seam now layers on top of that contract through
`query-renderers.tsx`, `query-container-surface.tsx`, and
`query-route-mount.tsx`, giving browser routes one shared path for query
validation, default loading and error chrome, pagination controls, and the
initial built-in `core:list`, `core:table`, and `core:card-grid` layouts with
declarative item, column, and card definitions plus shared inline and saved
query mounting helpers.
The current query-authoring proof now also includes a form-first editor
foundation in `query-editor.tsx` and `query-editor.ts` that lets routes author
source selection, typed filters, sort clauses, pagination defaults, and
parameter definitions before execution or save flows land. The pure editor and
saved-query helpers now also publish dedicated package exports:
`@io/app/web/query-editor` and `@io/app/web/saved-query`.

Current editor interaction model:

- source selection resets the draft against one registered query surface at a
  time and repopulates field-aware controls from that surface definition
- filters and sorts derive valid fields and operators from the selected source
  instead of route-local JSON editors
- pagination edits stay in draft state as window inputs (`after`, `limit`)
  until the surface converts them into the serialized and normalized execution
  requests
- validation errors render inline beside the affected draft controls and the
  serialized/normalized inspectors stay fail closed when the draft is invalid
- browser launch and attach do not go through Worker routes: the browser now
  probes a separate localhost `browser-agent` runtime over
  `../../lib/cli/src/browser-agent/transport.ts`, and `/workflow` keeps unavailable
  local runtime state explicit until that bridge is reachable

## Docs

- `../index.md`
- `./auth-store.md`
- `./local-bootstrap.md`
- `../storage.md`
- `./explorer.md`
- `../graph/spec/refs-and-ui.md`

## Layout

- `../../lib/app/src/web/router.tsx`, `../../lib/app/src/web/routeTree.gen.ts`: router assembly
  and generated route tree for the SPA routes, including `/workflow` and
  `/graph`
- `../../lib/app/auth.ts`: Better Auth CLI config entrypoint that keeps schema
  generation on a dedicated auth-store path without coupling it to the Worker's
  runtime bindings
- `../../lib/app/vite.config.ts`, `../../lib/app/wrangler.jsonc`,
  `../../lib/app/index.html`: app-local Vite, Worker, and SPA entry config for
  the shipped web runtime
- `../../lib/app/src/web/routes/`: top-level pages including `workflow`, `sync`,
  `views`, and the graph explorer routes
- `../../lib/app/src/web/components/home-page.tsx`: session-aware landing page that
  keeps the signed-out auth entry flow and the signed-in bootstrap summary in
  one place
- `../../lib/app/src/web/components/auth-shell.tsx`: principal-bootstrap consumer
  hook, signed-out localhost onboarding entrypoint, sign-in/sign-out chrome,
  provisional create-account form, and the gate that keeps graph surfaces from
  booting until bootstrap state is known
- `../../lib/app/src/web/components/graph-runtime-bootstrap.tsx`: shared synced graph
  runtime bootstrap for browser pages
- `../../lib/app/src/web/components/entity-type-browser.tsx`: reusable list/detail
  browser for one entity type keyed only by the target type id plus the list
  title, reusing the generic entity inspector for the selected record plus the
  explorer's generic draft-backed create flow inside a shared dialog with the
  base dialog header and footer primitives
- `../../lib/app/src/web/components/query-renderers.tsx`: host-owned query renderer
  registry keyed by stable renderer ids plus the first built-in list, table,
  and card-grid layouts, explicit renderer binding helpers, and declarative
  item/column/card definitions
- `../../lib/app/src/web/components/query-editor.tsx`: form-first query authoring
  surface that renders source selection, field-aware filters, sort,
  pagination, parameter editing, serialized-request inspection, and the first
  route-backed reopen/update flows for saved queries and saved views from the
  shared query catalog
- `../../lib/app/src/web/components/query-container-surface.tsx`: shared query
  container mount that validates renderer bindings, executes query pages, and
  renders the common loading, error, empty, stale, and pagination chrome
- `../../lib/app/src/web/components/query-route-mount.tsx`: shared route composition
  seam that lets routes mount one query container through common page chrome
  instead of route-local wiring
- `../../lib/app/src/web/components/workflow-page.tsx`: `/workflow` composition that
  binds the browser route to the shipped `workflow-review` sync scope and
  hands startup off to the workflow-native review contract
- `../../lib/app/src/web/components/workflow-review-page.tsx`: route-level workflow
  review startup surface that resolves the initial project, reads
  `ProjectBranchScope` and `CommitQueueScope`, re-pulls them after
  workflow-review invalidations through the scoped live transport, and keeps
  missing or partial workflow-review data explicit instead of widening to
  whole-graph bootstrap
- `../../lib/app/src/web/lib/workflow-review-contract.ts`: explicit `/workflow`
  startup contract covering scoped bootstrap, route search selection, initial
  project inference, first-branch selection, and missing-data handling before
  richer browser workflow composition lands
- `../../lib/app/src/web/lib/workflow-session-feed-contract.ts`: explicit
  `/workflow` session-feed contract covering optional `commit` and `session`
  route selection, the graph-backed session-feed read shape, and explicit
  `no-session`, `stale-selection`, and partial-history states before the feed
  panel is wired
- `../../lib/app/src/web/components/explorer/index.ts`: explorer entrypoint for the
  graph and sync pages
- `../../lib/app/src/web/components/explorer/`: graph explorer modules split by
  responsibility, including shared catalog/navigation helpers, the unified
  inspector shell, draft-backed generic create bindings, field editors, the
  sync inspector, and the `/graph` entity-selection path now reusing the shared
  typed browser component for record lists plus default entity editing
- `../../lib/app/src/web/components/sync-page.tsx`: top-level sync monitor for
  authority cursor, pending writes, recent authoritative activity, and
  surfaced write-scope diagnostics for acknowledged and pulled writes, plus
  cursor-advance diagnostics when incremental replication filters out all
  browser-visible transactions. The current proof now also surfaces the
  retained base cursor plus active retained-history policy so fallback causes
  stay legible to operators. It lets operators switch between explicit
  whole-graph recovery and the first named
  `workflow` review scope, inspect delivered scope metadata, and trigger
  scoped refreshes over the shared `/api/sync` transport contract
- `../../lib/app/src/web/components/app-shell.tsx`: shared shell and navigation
- `../../lib/web/src/markdown.tsx`: shared markdown renderer with Bun-first and
  `react-markdown` fallback behavior reused by graph field views and previews
- `../../lib/web/src/source-preview.tsx`,
  `../../lib/web/src/monaco.tsx`: shared source/preview editor shell, Monaco
  bootstrapping, shared source-editor preset, and panel styling reused by graph
  DOM field editors and future browser editors that need the same chrome, but
  without moving graph predicate semantics into `@io/web`
- `../../lib/app/src/web/lib/graph-authority-do.ts`: SQLite-backed Durable Object
  adapter entrypoint that bootstraps graph tables in the constructor, hydrates
  retained history during authority init, commits graph and secret side-storage
  changes in one Durable Object storage transaction, and routes between the
  internal Worker-only auth helpers plus the public sync, command, generic
  serialized query, and workflow surfaces
- `../../lib/app/src/web/lib/query-transport.ts`: web-owned `POST /api/query` path
  constant plus the shared generic serialized-query client helper re-export
- `../../lib/app/src/web/lib/query-container.ts`: shared query-container and
  renderer-binding contract covering saved and inline query references,
  container pagination and refresh policy, explicit renderer compatibility
  metadata, validation helpers, and the canonical loading, empty, error,
  paginated, stale, and refreshing container states exported via
  `@io/app/web/query-container`, plus the shared container runtime/controller
  that resolves saved or inline queries through one execution path, derives
  renderer-independent cache keys, keeps page state scoped per container
  instance, restarts from page 1 when saved-query identity or execution
  context changes invalidate the current page, and fails closed on stale
  pagination by resetting or refreshing instead of silently continuing with
  invalid cursors
- `../../lib/app/src/web/lib/query-editor.ts`: shared query-editor draft, query
  surface catalog, field-aware validation, and serialization helpers that keep
  inline drafts aligned with the generic serialized-query contract plus future
  saved-query parameter metadata
- `../../lib/app/src/web/lib/saved-query.ts`: shared saved-query and saved-view
  graph-backed repository helpers, shared draft-to-record and record-to-definition
  adapters, and normalized-resolution seams that return validated graph-native
  definitions plus normalized query requests for planner, editor, and
  container consumers, exported as `@io/app/web/saved-query`
- `../../lib/app/src/web/lib/serialized-query-executor-registry.ts`: installed
  query-surface executor registration seam that binds bounded collection and
  scope executors to registered surfaces, resolves runtime dispatch from the
  installed workflow and core surface catalogs, and fails closed when a
  surface is missing, ambiguous, stale, or missing an executor
- `../../lib/app/src/web/lib/registered-serialized-query-executors.ts`: the
  shipped web-authority executor registrations for the current bounded surface
  set, including the workflow branch board and commit queue planners plus the
  shared module-scope executor wrapper used for both workflow and core scopes
- `../../lib/app/src/web/lib/authority.ts`: principal-scoped Durable Object
  saved-query and saved-view CRUD plus normalized-resolution seams that sit
  beside the generic serialized-query executor instead of overloading
  `/api/query`, with collection and scope execution now dispatched through the
  registered serialized-query executor registry rather than any authority-local
  workflow surface branches, with the bounded built-in registrations defined in
  one dedicated seam and one shared module-scope executor path now proven
  across both workflow and core surfaces
- `../../lib/app/src/web/lib/graph-authority-internal-routes.ts`: web-only
  session-principal lookup-and-repair, bearer-share hash lookup, and
  authoritative policy-version handlers kept separate from the Durable Object
  storage composition entrypoint
- `../../lib/app/src/web/lib/better-auth.ts`: shared Better Auth option/factory helper
  for the dedicated `AUTH_DB` binding, optional trusted-origin wiring, the
  stable `/api/auth` base path, and the minimal email/password browser demo
  flow
- `../../lib/app/src/web/lib/local-bootstrap.ts`: shared localhost-only instant
  onboarding contract covering token format, TTL, local-origin guardrails, and
  deterministic synthetic local identity mapping ahead of the Worker/browser
  redemption flow
- `../../lib/app/src/web/lib/auth-client.ts`: Better Auth React client mutations plus
  the shared principal-bootstrap fetch and shell-state projection helpers
- `../../lib/app/src/web/lib/workflow-transport.ts`: shared `POST /api/workflow-read`
  request and response envelopes plus the fetch helper that browser, TUI, or
  MCP callers can reuse for the first shipped `ProjectBranchScope` and
  `CommitQueueScope` compatibility proof while generic serialized-query callers
  move to `../../lib/graph-client/src/http.ts` via `@io/graph-client`
- `../../lib/app/src/web/lib/workflow-live-transport.ts`: shared
  `POST /api/workflow-live` request and response envelopes plus the fetch
  helper that callers can reuse for the first ephemeral workflow review live
  registration, queued invalidation pull, and removal proof
- `../../lib/app/src/web/lib/workflow-review-live-sync.ts`: browser-facing caller
  helper that composes `workflow-live-transport` with the scoped `/api/sync`
  client so workflow-review callers can register once, scoped-refresh on
  `cursor-advanced`, and recover from inactive pulls with re-registration plus
  another scoped re-pull
- `../../lib/app/src/web/lib/workflow-review-refresh.ts`: small browser route refresh
  loop that keeps `/workflow` registered against workflow-review live
  invalidations, triggers scoped refreshes only, and tears the registration
  down on route exit
- `../../lib/cli/src/browser-agent/transport.ts`: shared localhost browser-agent
  transport contract covering runtime health, launch-session requests, and
  active-session lookup so browser and local runtime use the same typed bridge

## Query Container Refresh Model

The current Branch 3 browser model stays fail closed.

- live invalidation or scoped refresh does not merge arbitrary deltas into a
  generic query container page
- the container keeps the last page visible but marks it stale while refresh is
  pending
- refresh reruns the active query from the first valid page
- if a continuation cursor is rejected as `projection-stale`, scope-mismatched,
  or policy-mismatched, the container either resets to the first cached page or
  re-fetches page 1 with explicit recovery state
- changing saved-query params or principal/policy interpretation changes the
  container cache identity, so the route starts from a fresh first page instead
  of trying to continue an older pagination cursor
- stale saved-query, saved-view, and draft route state now also fail closed
  when the current query catalog can no longer hydrate their surface
  definitions, catalog versions, or saved-view container bindings, so the
  workbench renders an explicit recovery card instead of crashing or silently
  drifting to another query or renderer contract
- the current proof anchors for those guarantees live in
  `../../lib/app/src/web/lib/query-container.test.ts`,
  `../../lib/app/src/web/lib/query-workbench.test.ts`, and
  `../../lib/app/src/web/components/query-workbench.test.tsx`
- durable saved-query/view authority persistence, normalized re-derivation,
  installed-catalog validation, and explicit stale-ref recovery are proven in
  `../../lib/app/src/web/lib/authority.test.ts` and
  `../../lib/app/src/web/lib/graph-authority-sql-saved-query.test.ts`; the
  browser `/views` proof route still keeps a browser-local workbench cache for
  reopen and route-state testing, but that cache is not the durable
  graph-backed authority seam
- `../../lib/app/src/web/lib/authority.ts`: shared web authority behavior, secret-field
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
  module-scoped sync for the first named `workflow` review scope over
  `/api/sync`, authority-planned workflow review live registrations over
  `/api/workflow-live` that stay scoped to the current review cursor and
  authenticated session identity, conservative `cursor-advanced` invalidation
  emission for accepted workflow writes through the shared transaction hook
  plus dependency-key fan-out into matching live registrations,
- `../../lib/app/src/web/lib/workflow-authority.ts`,
  `../../lib/app/src/web/lib/workflow-authority-aggregate-handlers.ts`,
  `../../lib/app/src/web/lib/workflow-authority-commit-handlers.ts`,
  `../../lib/app/src/web/lib/workflow-authority-shared.ts`: workflow mutation authority
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
- `../../lib/app/src/web/lib/workflow-live-scope-router.ts`: in-memory workflow review
  registration router that renews, expires, and removes ephemeral live scope
  registrations while indexing them by session, scope, and dependency key,
  queueing matching invalidations, and reporting `active: false` when callers
  need to re-register after expiry or router loss
- `../../lib/app/src/web/lib/authority-test-helpers.ts`: no-seed test authority
  factory plus cached persisted workflow baseline helpers for the slow web
  authority and Durable Object suites
- `../../lib/app/src/web/lib/mutation-planning.ts`: shared snapshot-backed mutation
  planner that records asserted and retracted store operations directly instead
  of diffing whole-store before/after snapshots
- `../../lib/app/src/web/lib/example-runtime.ts`: seeded sync-proof runtime fixture
  that now reuses a cached seeded authority baseline and direct recorded
  mutation planning for hidden-only cursor tests while seeding the local
  workflow shell fixture used by `io tui`
- `../../lib/app/src/web/lib/`: worker-backed graph authority, generic secret-field
  mutation contracts, seeded example data/runtime fixtures, and HTTP route
  helpers
- `../../lib/app/src/web/lib/example-runtime.test.ts`: sync proof coverage for the
  web-owned example runtime fixture
- `../../lib/app/src/web/worker/index.ts`: Worker entrypoint for SPA assets and graph
  APIs. It mounts the shared Better Auth handler at `/api/auth/*`, then
  resolves a request-bound `AuthorizationContext` for graph routes and forwards
  that stable contract to the Durable Object authority path. The current worker
  now verifies Better Auth sessions with cookie-cache bypass for graph
  requests, reduces them into the repo's stable `AuthenticatedSession` shape,
  resolves the current authoritative `policyVersion` through the Durable
  Object's internal lookup seam before projecting request auth, with that
  served version sourced from the compiled contract snapshot in
  `../../lib/app/src/web/lib/policy-version.ts`, forwards
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
- `../../lib/app/src/web/worker/index.test.ts`: end-to-end admission coverage for the
  shipped Worker path, including bootstrap, explicit allowlist admission,
  domain-gated open signup, deny, admitted-but-unbound principals, and the
  explicit initial role-binding workflow
- `../../lib/app/src/web/lib/graph-authority-do.test.ts`: Durable Object lookup-and-
  repair coverage for the same first authenticated-use admission branches
- `../../lib/app/migrations/auth-store/`: committed Better Auth schema
  migrations for the dedicated D1 auth store, applied separately from Durable
  Object migrations
