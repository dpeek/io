# Graph Client

`@io/graph-client` is the extracted graph-client boundary for typed local graph
access, client validation, synced client composition, and client-side HTTP/query
transport helpers.

## Read This First

- Start with `./out/index.d.ts` for the compact public contract.
- Use the package-adjacent docs below for package-specific semantics.
- Read `./src/index.ts` for the curated root export surface.
- Internal package modules now follow role names such as `graph.ts`, `sync.ts`,
  `http.ts`, `core.ts`, `refs.ts`, and `validation.ts`.
- Read one nearby `./src/*.test.ts` file for usage examples.

## Package Docs

These are the canonical agent docs for package-specific behavior in
`@io/graph-client`.

- [`./doc/validation-stack.md`](./doc/validation-stack.md): cross-package ownership for local validation, authoritative apply validation, and sync-boundary validation
- [`./doc/typed-client.md`](./doc/typed-client.md): typed type handles, local CRUD flows, and query projection
- [`./doc/refs.md`](./doc/refs.md): entity refs, predicate refs, field-group traversal, and mutation ergonomics
- [`./doc/validation.md`](./doc/validation.md): local validation lifecycle, runtime invariants, and result surfaces
- [`./doc/synced-client.md`](./doc/synced-client.md): pending-write replay, flush and sync semantics, and status widening
- [`./doc/transport.md`](./doc/transport.md): HTTP sync requests, HTTP graph client wiring, and serialized-query transport helpers
- [`./doc/roadmap.md`](./doc/roadmap.md): future computed-value and derived-read direction above typed refs

Cross-package architecture now lives in `./doc/validation-stack.md`,
`../graph-query/doc/query-stack.md`, `../graph-sync/doc/sync-stack.md`, and
`../graph-surface/doc/ui-stack.md`. Start here when the question is local to
this package. Jump to the broader package roadmaps when the question crosses
package boundaries or future direction.

## What It Owns

- typed graph client construction over `GraphStore`
- composition of bootstrapped stores and snapshots into typed and synced clients
- entity refs, predicate refs, and field-group refs
- local create, update, delete, and typed query helpers
- client-facing validation results and `GraphValidationError`
- synced client composition on top of `@io/graph-sync`
- client-facing HTTP graph transport and serialized-query helpers

## What It Does Not Own

- authoritative persistence, retained-history storage, or replication policy
- authorization context, policy contracts, or share-grant flows
- projection planning, live-scope routing, or module workflow projections
- React bindings or host-specific runtime bootstrap shells
- schema bootstrap or bootstrap icon catalogs

## Important Semantics

- These APIs expect definitions that include the built-in core graph schema
  whenever validation or synced-client bootstrap needs core node/predicate
  contracts.
- `createGraphClient()` exposes handles from the `namespace` argument and resolves
  references against `options.definitions ?? namespace`.
- `createSyncedGraphClient()` and `createHttpGraphClient()` accept bootstrap
  options or a prebuilt schema snapshot when callers need
  `@io/graph-bootstrap`-owned schema materialization.
- `GraphClientSyncStatus` widens sync-core status with `"pushing"` while pending
  writes are flushing.
- `flush()` preserves optimistic local mutations until each pending transaction
  is acknowledged or a push failure marks the client stale.

## Public API

`@io/graph-client` exposes a single public entrypoint from `./src/index.ts`.

- typed client helpers: `createGraphClient`, `createEntityWithId`
- client refs and result types: `GraphClient`, `EntityRef`, `PredicateRef`,
  `FieldGroupRef`, `GraphValidationResult`, `GraphValidationError`
- validation: `validateGraphStore`
- synced client helpers: `createSyncedGraphClient`, `GraphClientSyncController`,
  `GraphClientSyncState`, `GraphClientSyncStatus`, `GraphSyncWriteError`
- HTTP helpers: `createHttpGraphClient`, `createHttpGraphTxIdFactory`,
  `applyHttpSyncRequest`, `readHttpSyncRequest`
- serialized-query helpers and request/response contracts
- advanced shared helpers currently used by in-repo runtime consumers:
  `fieldGroupMeta`, `collectScalarCodecs`, `collectTypeIndex`,
  `readPredicateValue`

## Build Output

Run `turbo build --filter=@io/graph-client` from the repo root, or
`bun run build` in this package, to emit `./out`.
Run `turbo check --filter=@io/graph-client` from the repo root, or
`bun run check` in this package, to lint, format, type-check, and execute the
package-local Bun tests.

Cross-package client/bootstrap coverage lives in `@io/graph-integration` so the
package can stay on public entrypoints and local fixtures only.

The intended first-read contract artifact for agents is `./out/index.d.ts`.
