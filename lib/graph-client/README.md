# Graph Client

`@io/graph-client` is the extracted graph-client boundary for typed local graph
access, client validation, synced client composition, and client-side HTTP/query
transport helpers.

## Read This First

- Start with `./out/index.d.ts` for the compact public contract.
- Read `./src/index.ts` for the curated root export surface.
- Internal package modules now follow role names such as `graph.ts`, `sync.ts`,
  `http.ts`, `core.ts`, `refs.ts`, and `validation.ts`.
- Read `./src/http-sync-request.test.ts` and `./src/serialized-query.test.ts` for
  focused transport examples.

## What It Owns

- typed graph client construction over `GraphStore`
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

Run `bun run build` in this package to emit `./out`.
Run `bun test` in this package to execute the package-local tests.
