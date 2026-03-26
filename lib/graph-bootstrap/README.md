# Graph Bootstrap

`@io/graph-bootstrap` owns graph schema bootstrap and materialization.

## What It Owns

- additive `bootstrap(store, definitions, options)` into a live store
- `createBootstrappedSnapshot(definitions, options)` for local and synced clients
- shared schema traversal and bootstrap materialization helpers
- bootstrap-facing core-schema requirement helpers
- pluggable icon seed and icon-resolution contracts

## What It Does Not Own

- typed graph client APIs
- sync transport or HTTP/query helpers
- kernel ids, store primitives, or schema authoring
- authority persistence or session logic
- concrete icon catalogs for `core` or any other domain
- workflow-, web-, or app-specific bootstrap policies
- module definitions themselves

## Icon Ownership

Icons are a core graph concept, but the concrete icon catalog is domain-owned.
`@io/graph-bootstrap` only understands icon contracts:

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
