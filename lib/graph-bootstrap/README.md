# Graph Bootstrap

`@io/graph-bootstrap` owns graph schema bootstrap and materialization.

## Read This First

- Start with `./out/index.d.ts` for the compact public contract.
- Start with `./src/index.ts` for the curated package entrypoint.
- Read `./src/bootstrap.ts` for additive schema materialization into a live
  store.
- Read `./src/snapshot.ts` for convergent snapshot creation and cache
  behavior.
- Read `./src/icons.ts` and `./src/contracts.ts` for icon seed and resolver
  seams.
- Read `./src/core-schema.ts` for the minimal core contract bootstrap
  requires.
- Read `./src/bootstrap-facts.ts` and `./src/schema-tree.ts` for the internal
  dedupe and traversal helpers that shape bootstrap behavior.

## Package Docs

These are the canonical agent docs for package-specific behavior in
`@io/graph-bootstrap`.

- [`./doc/additive-bootstrap.md`](./doc/additive-bootstrap.md): additive
  bootstrap semantics, ordering, and fact materialization
- [`./doc/snapshots-and-cache.md`](./doc/snapshots-and-cache.md): convergent
  snapshot creation and cache rules
- [`./doc/icon-seeding.md`](./doc/icon-seeding.md): icon seed lookup,
  resolution, and materialization
- [`./doc/core-schema-requirements.md`](./doc/core-schema-requirements.md):
  the minimal core schema contract bootstrap depends on

Cross-package runtime and icon architecture now lives in
`../graph-kernel/doc/runtime-stack.md` and
`../graph-module-core/doc/icons-and-svg.md`. Start
here when the question is local to bootstrap. Jump to the root graph docs when
the question crosses package, authority, or host boundaries.

## Public API

`src/index.ts` is the curated package surface. It exports:

- `bootstrap(store, definitions, options)`
- `createBootstrappedSnapshot(definitions, options)`
- `requireGraphBootstrapCoreSchema(definitions)`
- type-only exports for `GraphBootstrapIconSeed`,
  `GraphBootstrapIconSeedResolver`, `GraphBootstrapOptions`,
  `GraphBootstrapPredicateIconResolver`, `GraphBootstrapTypeIconResolver`,
  and `GraphBootstrapCoreSchema`

The package root is the only public entrypoint.

## What It Owns

- additive `bootstrap(store, definitions, options)` into a live store
- `createBootstrappedSnapshot(definitions, options)` for local and synced clients
- shared schema traversal and bootstrap materialization helpers
- bootstrap-facing core-schema requirement helpers
- pluggable icon seed and icon-resolution contracts

## Important Semantics

- `bootstrap(...)` is additive and idempotent for the resolved definition
  slice. It fills in missing bootstrap-owned facts, but it does not retract or
  rewrite facts that already exist in the store.
- The package needs the built-in core node, predicate, type, enum, icon, and
  cardinality contracts. By default it reads them from `definitions`; partial
  bootstrap flows must pass `options.coreSchema`.
- `options.availableDefinitions` widens the resolution set used for icon and
  scalar lookup when the bootstrapped slice itself is incomplete.
- Managed timestamps are only asserted for nodes bootstrap creates, and only
  when the core node contract exposes `createdAt` and `updatedAt`.
- `createBootstrappedSnapshot(...)` caches only when `options.timestamp` is
  absent. It always returns a clone of the cached or freshly created snapshot.
- Icon seeding is opt-in and domain-owned. Bootstrap will materialize icon
  entities only when it can resolve an icon id to a seed record.

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

## Build Output

Run `turbo build --filter=@io/graph-bootstrap` from the repo root, or
`bun run build` in this package, to emit `./out`.
Run `turbo check --filter=@io/graph-bootstrap` from the repo root, or
`bun run check` in this package, to lint, format, type-check, and execute the
package-local Bun tests.

The intended first-read contract artifact for agents is `./out/index.d.ts`.
