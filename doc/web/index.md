# Web Overview

## Purpose

`web` owns the TanStack Router SPA that runs on the Worker shell. It provides
operator-facing browser surfaces on top of the synced graph runtime, including
the graph explorer, the dedicated sync monitor, and the topic browser/editor.
The current explorer now uses the canonical type-first `/graph` route and
search-param selection model described in `./explorer.md`, plus a shared
inspector shell, draft-backed generic create flow for supported entity types,
and opt-in debug disclosures for raw ids and keys. Its authoritative graph path
now runs through a raw-SQL SQLite-backed Durable Object adapter that retains a
bounded transaction window and keeps secret plaintext in authority-only side
storage. The current auth foundation now also reserves a dedicated Better Auth
D1 store and migration path that stays separate from the graph authority's
SQLite Durable Object storage. The current shell now also reads Better Auth
session state client-side, exposes minimal email/password sign-in and sign-out
controls, and gates graph runtime bootstrap until the browser resolves an
authenticated session. That create-account path is still a provisional local
demo surface rather than a finished account-management product.

## Ownership Boundary

`web` is the browser product surface package, not the shared browser-primitive
package. The terminal sibling surface lives in `../../src/tui/*`.

- keep reusable browser UI and editor chrome in `../../lib/web/src/*`
- keep graph-aware field resolver, predicate mutation, and typed preview logic
  in `../../src/graph/runtime/react/*` and
  `../../src/graph/adapters/react-dom/*`
- keep route/page composition, explorer state, topic workflows, and Worker
  authority wiring in `../../src/web/*`

In practice, `web` should compose `@io/web` primitives such as shared inputs,
comboboxes, markdown rendering, Monaco loading, and source/preview shells, but
it should not become the default home for reusable editor infrastructure. If a
browser component can be reused by non-graph screens without importing graph
types, move it to `@io/web`. If it is deciding how a graph predicate validates,
mutates, or previews, leave that code in `graph` even when the surrounding
chrome comes from `@io/web`.

The current `POST /api/commands` and `POST /api/workflow-read` routes are part
of that same package boundary. They are web-owned proofs for the shipped
`write-secret-field` command envelope and the first workflow projection read
envelope, not published graph-owned registries or generic shared command/read
transports.

## Docs

- `../index.md`
- `./auth-store.md`
- `../storage.md`
- `./explorer.md`
- `../graph/spec/refs-and-ui.md`

## Layout

- `../../src/web/router.tsx`, `../../src/web/routeTree.gen.ts`: router assembly
  and generated route tree for the canonical `/graph` explorer route
- `../../auth.ts`: Better Auth CLI config entrypoint that keeps schema
  generation on a dedicated auth-store path without coupling it to the Worker's
  runtime bindings
- `../../src/web/routes/`: top-level pages including `topics`, `sync`, and the
  graph explorer routes
- `../../src/web/components/home-page.tsx`: session-aware landing page that
  keeps the signed-out auth entry flow and the signed-in bootstrap summary in
  one place
- `../../src/web/components/auth-shell.tsx`: Better Auth session hook,
  sign-in/sign-out chrome, provisional create-account form, and the gate that
  keeps graph surfaces from booting until session state is known
- `../../src/web/components/graph-runtime-bootstrap.tsx`: shared synced graph
  runtime bootstrap for browser pages
- `../../src/web/components/explorer/index.ts`: explorer entrypoint for the
  graph and sync pages
- `../../src/web/components/explorer/`: graph explorer modules split by
  responsibility, including shared catalog/navigation helpers, the unified
  inspector shell, draft-backed generic create bindings, field editors, and the
  sync inspector
- `../../src/web/components/sync-page.tsx`: top-level sync monitor for
  authority cursor, pending writes, recent authoritative activity, and
  surfaced write-scope diagnostics for acknowledged and pulled writes, plus
  cursor-advance diagnostics when incremental replication filters out all
  browser-visible transactions. The current proof now lets operators switch
  between explicit whole-graph recovery and the first named
  `ops/workflow` review scope, inspect delivered scope metadata, and trigger
  scoped refreshes over the shared `/api/sync` transport contract
- `../../src/web/components/topic-browser-page.tsx`: topic browsing, metadata
  editing, shared Base UI entity-reference combobox editing with inline chips
  and icon-aware option rows, tag create-on-enter flows on top of that shared
  combobox, shared Base UI combobox-backed predicate pickers for enum and other
  closed-option fields, markdown authoring UI, and shared `ColorInput`-backed
  color predicate editing with an inline swatch trigger in the input chrome
- `../../src/web/components/app-shell.tsx`: shared shell and navigation
- `../../lib/web/src/markdown.tsx`: shared markdown renderer with Bun-first and
  `react-markdown` fallback behavior reused by graph field views and previews
- `../../lib/web/src/source-preview.tsx`,
  `../../lib/web/src/monaco.tsx`: shared source/preview editor shell, Monaco
  bootstrapping, shared source-editor preset, and panel styling reused by graph
  DOM field editors and future browser editors that need the same chrome, but
  without moving graph predicate semantics into `@io/web`
- `../../src/web/lib/graph-authority-do.ts`: SQLite-backed Durable Object
  adapter that bootstraps graph tables in the constructor, hydrates retained
  history during authority init, commits graph and secret side-storage changes
  in one Durable Object storage transaction, prunes old transaction rows, and
  now exposes internal Worker-only auth-subject lookup-and-repair plus
  bearer-share hash lookup seams, alongside the first public workflow
  projection read route ahead of future transport expansion
- `../../src/web/lib/better-auth.ts`: shared Better Auth option/factory helper
  for the dedicated `AUTH_DB` binding, optional trusted-origin wiring, the
  stable `/api/auth` base path, and the minimal email/password browser demo
  flow
- `../../src/web/lib/auth-client.ts`: Better Auth React client helper plus the
  derived shell session-state projection consumed by the SPA
- `../../src/web/lib/workflow-transport.ts`: shared `POST /api/workflow-read`
  request and response envelopes plus the fetch helper that browser, TUI, or
  MCP callers can reuse for the first shipped `ProjectBranchScope` and
  `CommitQueueScope` proof
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
  `/api/sync`, authority-owned auth subject resolution with idempotent
  first-use principal/projection repair plus active role binding lookup, the
  provisional bearer-share lookup path that resolves hash-stored bearer grants
  only when they still have an active validated share surface plus an explicit
  unexpired `constraintExpiresAt`, and bearer-share visibility resets that
  force total-sync recovery when linked share grants change,
  authority-owned `ProjectBranchScope` and `CommitQueueScope` reads that
  rebuild from authoritative workflow, repository, and session records and
  fail closed with stable workflow query codes, and the storage abstraction
  consumed by both tests and the Durable Object adapter, including an opt-out
  seeded-example bootstrap path used by web authority tests plus a cached
  graph-metadata/bootstrap path for repeated authority construction
- `../../src/web/lib/authority-test-helpers.ts`: no-seed test authority
  factory plus cached persisted workflow baseline helpers for the slow web
  authority and Durable Object suites
- `../../src/web/lib/mutation-planning.ts`: shared snapshot-backed mutation
  planner that records asserted and retracted store operations directly instead
  of diffing whole-store before/after snapshots
- `../../src/web/lib/example-runtime.ts`: seeded sync-proof runtime fixture
  that now reuses a cached seeded authority baseline and direct recorded
  mutation planning for hidden-only cursor tests
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
  forwards anonymous requests as anonymous, resolves authenticated subjects
  through the Durable Object's internal lookup-and-repair seam, forwards the
  first `POST /api/workflow-read` proof alongside `/api/sync`, `/api/tx`, and
  `/api/commands`, hashes issued bearer share tokens locally before calling the
  Durable Object's internal bearer-share lookup seam, lowers successful bearer
  lookups into anonymous shared-read `GET /api/sync` requests only, strips raw
  `Authorization` and `Cookie` headers before forwarding to the Durable
  Object, and fails closed when an authenticated session or bearer share token
  no longer resolves to an active graph-backed authorization context.
- `../../migrations/auth-store/`: committed Better Auth schema migrations for
  the dedicated D1 auth store, applied separately from Durable Object
  migrations
