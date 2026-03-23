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
storage.

## Ownership Boundary

`web` is the product surface package, not the shared browser-primitive package.

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

The current `POST /api/commands` route is part of that same package boundary.
It is a web-owned proof for the shipped `write-secret-field` envelope and its
authority-local staging path, not a published graph-owned command registry or
generic shared command transport.

## Docs

- `../index.md`
- `../storage.md`
- `./explorer.md`
- `../graph/spec/refs-and-ui.md`

## Layout

- `../../src/web/router.tsx`, `../../src/web/routeTree.gen.ts`: router assembly
  and generated route tree for the canonical `/graph` explorer route
- `../../src/web/routes/`: top-level pages including `topics`, `sync`, and the
  graph explorer routes
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
  browser-visible transactions
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
  in one Durable Object storage transaction, and prunes old transaction rows
- `../../src/web/lib/authority.ts`: shared web authority behavior, secret-field
  mutation flow, the current web-owned `/api/commands` envelope, the shared
  write/command authorization seam, principal-aware sync filtering that omits
  denied predicates from total and incremental sync payloads, direct-read
  helpers that omit denied predicates from snapshot-style reads and fail
  explicit protected predicate reads with stable `policy.read.forbidden`
  errors, explicit `policyVersion` fail-closed checks for authority-owned read,
  `/api/sync`, `/api/tx`, and `/api/commands` paths, and the storage
  abstraction consumed by both tests and the Durable Object adapter
- `../../src/web/lib/`: worker-backed graph authority, generic secret-field
  mutation contracts, seeded example data/runtime fixtures, and HTTP route
  helpers
- `../../src/web/lib/example-runtime.test.ts`: sync proof coverage for the
  web-owned example runtime fixture
- `../../src/web/worker/index.ts`: Worker entrypoint for SPA assets and graph
  APIs. It now resolves a request-bound `AuthorizationContext` through the
  shared web auth bridge and forwards that stable contract to the Durable
  Object authority path, while the host-specific request/session parsing and
  relay details remain provisional. Until Branch 7 supplies non-anonymous
  browser principals, the write/command path intentionally fails closed for
  callers that do not meet the current authority policy contract.
