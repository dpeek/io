# Graph Projection

`@io/graph-projection` is the shared Branch 3 contract boundary for projection
metadata, retained projection compatibility, module read-scope definitions, and
live invalidation targeting.

## Read This First

- Start with `./out/index.d.ts` for the compact public contract.
- Read `./src/index.ts` for the curated root export surface.
- Read `./src/index.test.ts` for package-level usage examples.

## What It Owns

- module read-scope definition contracts and sync-scope interop helpers
- projection kinds, rebuild strategies, visibility modes, and catalog helpers
- dependency-key kinds plus normalization and validation helpers
- invalidation delivery, event, and target contracts
- retained projection checkpoint and row metadata contracts
- retained projection compatibility and lookup helpers

## What It Does Not Own

- graph store, id, bootstrap, and schema primitives
- sync payload/session contracts beyond the scope interop owned by `@io/graph-sync`
- authority write sessions, retained-history persistence, or projection storage adapters
- client transport, HTTP wiring, React hooks, or UI adapters
- workflow-specific projection row shapes, query logic, or module-local projection manifests
- web-specific SQL adapters under `lib/app/src/web/lib/*`

## Package Relationships

- `@io/graph-sync` owns transport-facing sync scopes and payload/session
  contracts. This package depends on it only to materialize and compare the
  shared module scope proof.
- `@io/graph-authority` owns authoritative write orchestration, durable state,
  and policy-aware replay. It may consume these contracts, but retained
  projection persistence remains authority- or host-owned.

## Important Semantics

- Dependency keys are conservative invalidation units. False positives are
  acceptable; false negatives are not.
- `ProjectionSpec.definitionHash` and retained
  `{ projectionId, definitionHash }` pairs are the compatibility boundary for
  retained rows and checkpoints. Incompatible retained state should rebuild, not
  silently coerce.
- Retained checkpoint and row records are rebuildable caches, not source of
  truth. If they are missing, stale, or incompatible, callers discard and
  rebuild from authoritative facts.
- `InvalidationEvent` delivery is a freshness signal. Events may be duplicated
  or broader than the exact changed rows, but they must never require consumers
  to inspect unauthorized raw facts.

## Public API

`@io/graph-projection` exposes a single public entrypoint from `./src/index.ts`.
Everything intended for consumers is re-exported from the package root.

- module read-scope definitions and sync-scope matching helpers
- projection kinds, specs, and catalog helpers
- dependency-key constants, types, and constructors
- invalidation delivery/event/target contracts and matching helpers
- retained projection metadata/checkpoint/row contracts plus lookup helpers

## Build Output

Run `vp run @io/graph-projection#build` from the workspace root, or
`bun run build` in this package, to emit `./out`.
Run `turbo run test --filter=@io/graph-projection` from the workspace root, or
`bun run test` in this package, to execute the extracted projection contract
tests.

The package `tsconfig.json` drives the normal `tsgo` build and emits `./out`.
