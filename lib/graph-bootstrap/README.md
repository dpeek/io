# Graph Bootstrap

`@io/graph-bootstrap` owns graph schema bootstrap and materialization.

## Public API

`src/index.ts` is the curated package surface. It exports:

- `bootstrap(store, definitions, options)`
- `createBootstrappedSnapshot(definitions, options)`
- `requireGraphBootstrapCoreSchema(definitions)`
- type-only bootstrap option and icon-resolution contracts

The implementation lives in focused internal modules such as `bootstrap.ts`,
`snapshot.ts`, `icons.ts`, and `bootstrap-facts.ts`. Those files are package
internals rather than additional public entrypoints.

## What It Owns

- additive `bootstrap(store, definitions, options)` into a live store
- `createBootstrappedSnapshot(definitions, options)` for local and synced clients
- shared schema traversal and bootstrap materialization helpers
- bootstrap-facing core-schema requirement helpers
- pluggable icon seed and icon-resolution contracts

## What It Does Not Own

- typed graph client APIs
- client-facing composition behavior over bootstrapped stores or snapshots
- sync transport or HTTP/query helpers
- kernel ids, store primitives, or schema authoring
- authority persistence or session logic
- concrete icon catalogs for `core` or any other domain
- workflow-, web-, or app-specific bootstrap policies
- module definitions themselves

## Icon Ownership

Icons are a core graph concept, but the concrete icon catalog is domain-owned.
`@io/graph-bootstrap` only understands icon contracts:

- schema-authored `DefinitionIconRef` values and `readDefinitionIconId(...)`
  from `@io/graph-kernel`
- optional icon seed records that can be materialized during bootstrap
- optional type and predicate icon resolvers
- optional per-id seed resolution for remappable or installable catalogs

Concrete icon catalogs such as the built-in `core` SVG seeds must stay in the
owning domain and be passed into bootstrap through these contracts.

## Snapshot vs Live Bootstrap

- `createBootstrappedSnapshot()` creates a convergent schema snapshot for local
  clients, synced clients, and replay flows.
- `bootstrap()` adds schema state into an existing store without retracting or
  rewriting previously materialized facts.

Both APIs share the same traversal and icon-extension seams.
