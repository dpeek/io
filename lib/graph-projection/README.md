# Graph Projection

`@io/graph-projection` is the shared Branch 3 contract boundary for projection
metadata, retained projection compatibility, named module read-scope
registrations, retained projection provider registrations, and live
invalidation targeting.

## Read This First

- Start with `./out/index.d.ts` for the compact public contract.
- Read `./src/index.ts` for the curated root export surface.
- Read the module read-scope helpers and registrations in `./src/index.ts`
  first if the question is about named scoped sync.
- Read the projection, retained metadata, and provider registration helpers in
  `./src/index.ts` if the question is about rebuildable read models.
- Read the query-surface catalog helpers in `./src/index.ts` if the question is
  about installed bounded query surfaces.
- Read the dependency-key and invalidation helpers in `./src/index.ts` if the
  question is about live refresh or retained rebuild fan-out.
- Read `./src/index.test.ts` for package-level usage examples.

## Package Docs

These are the canonical agent docs for package-specific behavior in
`@io/graph-projection`.

- [`./doc/module-read-scopes.md`](./doc/module-read-scopes.md): named module
  read-scope definitions, registrations, and sync-scope interop
- [`./doc/projections-and-retained-state.md`](./doc/projections-and-retained-state.md):
  projection specs, retained compatibility, and retained provider registries
- [`./doc/query-surface-catalogs.md`](./doc/query-surface-catalogs.md):
  bounded query-surface metadata and validation rules
- [`./doc/dependency-keys-and-invalidation.md`](./doc/dependency-keys-and-invalidation.md):
  dependency keys, invalidation events, and target matching

Cross-package sync and query architecture still lives in
`../graph-sync/doc/sync-stack.md`, `../graph-query/doc/query-stack.md`, and
`../graph-kernel/doc/runtime-stack.md`. Start here when the question is local
to the projection contract surface. Jump to the broader package docs when the
question crosses authority, sync transport, module ownership, or host runtime
boundaries.

## What It Owns

- module read-scope definition and registration contracts plus sync-scope
  interop helpers
- projection kinds, rebuild strategies, visibility modes, and catalog helpers
- module query-surface catalog contracts for filters, ordering, selections,
  parameters, renderer compatibility, and versioned registration metadata
- dependency-key kinds plus normalization and validation helpers
- invalidation delivery, event, and target contracts
- retained projection checkpoint and row metadata contracts
- retained projection compatibility and lookup helpers
- retained projection provider registration contracts for lookup, recovery, and
  invalidation targeting

## What It Does Not Own

- graph store, id, bootstrap, and schema primitives
- sync payload/session contracts beyond the scope interop owned by `@io/graph-sync`
- authority write sessions, retained-history persistence, or projection storage adapters
- client transport, HTTP wiring, React hooks, or UI adapters
- workflow-specific projection row shapes, query logic, or module-local projection manifests
- web-specific SQL adapters under `lib/app/src/web/lib/*`

## Package Relationships

- `@io/graph-sync` owns transport-facing sync scopes and payload/session
  contracts plus the shared module-scope fallback vocabulary. This package
  depends on it to materialize and compare the shared module scope proof.
- `@io/graph-authority` owns authoritative write orchestration, durable state,
  and policy-aware replay. It may consume these contracts, but retained
  projection persistence remains authority- or host-owned.

## Important Semantics

- Dependency keys are conservative invalidation units. False positives are
  acceptable; false negatives are not.
- Module read scopes split requested identity from delivered identity.
  Requests use `{ moduleId, scopeId }`; delivered scopes add
  `definitionHash` and `policyFilterVersion`.
- `ProjectionSpec.definitionHash` and retained
  `{ projectionId, definitionHash }` pairs are the compatibility boundary for
  retained rows and checkpoints. Incompatible retained state should rebuild, not
  silently coerce.
- `ModuleReadScopeRegistration.fallback` is the explicit fail-closed boundary
  for named scope drift. Scope-definition changes and policy-filter changes are
  not inferred from caller behavior.
- `ModuleQuerySurfaceCatalog.catalogVersion` and
  `ModuleQuerySurfaceSpec.surfaceVersion` are the compatibility boundary for
  installed planner/editor/view-binding metadata. Incompatible saved-query or
  editor state should fail closed and re-hydrate from a fresh catalog, not
  silently reinterpret old semantics.
- Retained checkpoint and row records are rebuildable caches, not source of
  truth. If they are missing, stale, or incompatible, callers discard and
  rebuild from authoritative facts.
- `RetainedProjectionProviderRegistration.recovery` is the explicit retained
  fallback contract. The current shared mode is `rebuild`, so callers repair
  provider state by rebuilding from authoritative facts instead of mutating
  incompatible retained rows in place.
- `InvalidationEvent` delivery is a freshness signal. Events may be duplicated
  or broader than the exact changed rows, but they must never require consumers
  to inspect unauthorized raw facts.
- Scope query surfaces must use `source.kind === "scope"`, and collection query
  surfaces must use `source.kind === "projection"`. The package fails closed
  on mixed or empty metadata instead of guessing intent.
- Retained projection provider registries are also fail-closed. Projection ids
  must be unique across providers so one projection resolves to one retained
  provider contract.

## Public API

`@io/graph-projection` exposes a single public entrypoint from `./src/index.ts`.
Everything intended for consumers is re-exported from the package root.

- module read-scope definitions, registrations, registries, and sync-scope
  matching helpers
- projection kinds, specs, and catalog helpers
- query-surface specs and catalog helpers
- dependency-key constants, types, and constructors
- invalidation delivery/event/target contracts and matching helpers
- retained projection metadata/checkpoint/row contracts plus lookup helpers
- retained projection provider registrations, registries, and scope/projection
  lookup helpers

The package root is the only public entrypoint.

## Build Output

Run `turbo build --filter=@io/graph-projection` from the repo root, or
`bun run build` in this package, to emit `./out`.
Run `turbo check --filter=@io/graph-projection` from the repo root, or
`bun run check` in this package, to lint, format, type-check, and execute the
extracted projection contract Bun tests.

The package `tsconfig.json` drives the normal `tsgo` build and emits `./out`.
The intended first-read contract artifact for agents is `./out/index.d.ts`.
