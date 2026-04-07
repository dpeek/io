# Graph Kernel

`@io/graph-kernel` is the extracted seed of the smallest graph-kernel boundary.

## Read This First

- Start with `./out/index.d.ts` for the compact public contract.
- Use the package-adjacent docs below for package-specific semantics.
- Read `./src/index.ts` for the curated root export surface.
- Read one nearby `./src/*.test.ts` file for usage examples.

## Package Docs

These are the canonical agent docs for package-specific behavior in
`@io/graph-kernel`.

- [`./doc/runtime-stack.md`](./doc/runtime-stack.md): cross-package ownership for kernel, module authoring, bootstrap, authority seams, and runtime layering
- [`./doc/roadmap.md`](./doc/roadmap.md): graph-engine roadmap, package-owned future docs, and promotion rules for shipped behavior
- [`./doc/schema.md`](./doc/schema.md): schema authoring, field trees, authority metadata, and fallback policy lowering
- [`./doc/identity.md`](./doc/identity.md): runtime ids, stable id maps, key extraction, and in-place id application
- [`./doc/store.md`](./doc/store.md): append-oriented facts, snapshots, versioning, and predicate-slot subscriptions
- [`./doc/write-transactions.md`](./doc/write-transactions.md): canonical write envelopes, snapshot diffs, and retained-history contracts

Cross-package architecture now lives in `./doc/runtime-stack.md`,
`./doc/roadmap.md`, and `../graph-sync/doc/sync-stack.md`. Start here when the
question is local to this package. Jump to the broader package roadmaps when
the question crosses package boundaries or future direction.

## What It Owns

- `GraphId` generation
- `GraphStore` and `GraphStoreSnapshot`
- schema authoring helpers and field-authority metadata
- stable key-to-id reconciliation with `GraphIdMap`
- fallback policy descriptor lowering for schema-owned predicates
- graph write transaction, `GraphWriteScope`, and snapshot-derivation helpers

## What It Does Not Own

- built-in `core` schema assembly
- bootstrap and seeded schema materialization
- typed client CRUD/query helpers
- sync sessions and transport payloads
- persisted authority and storage adapters
- React or host-specific adapters

## Common Workflows

- Author schema: `defineType`, `defineScalar`, `defineEnum`
- Reconcile stable ids: `createGraphIdMap`
- Apply stable ids in place: `applyGraphIdMap`
- Store facts: `createGraphStore`
- Derive sync writes: `createGraphWriteTransactionFromSnapshots`

## Important Semantics

- `applyGraphIdMap()` mutates the provided namespace objects in place.
- `find()` includes retracted facts. `facts()` excludes them.
- `newId()` allocates an id only. It does not create a node record.
- `edgeId()`, `typeId()`, `fieldTreeId()`, and `rangeOf()` fall back to authored keys until ids are applied.
- This package stops at pure contracts and storage primitives. Validation/bootstrap/client/session layers live above it.

## Public API

`@io/graph-kernel` exposes a single public entrypoint from `./src/index.ts`.
Everything intended for consumers is re-exported from the package root.

- `createGraphId`
- `fieldTreeMeta`, `fieldTreeId`, `fieldTreeKey`
- `createGraphStore`, `cloneGraphStoreSnapshot`
- `GraphFact`, `GraphStore`, `GraphStoreSnapshot`, `GraphIdMap`, `ResolvedGraphNamespace`
- `defineType`, `defineScalar`, `defineEnum`
- `fieldPolicyFallbackContractVersion`, `createFallbackPolicyDescriptor`,
  `resolveFieldPolicyDescriptor`
- `createGraphIdMap`, `applyGraphIdMap`, `extractGraphSchemaKeys`, `findDuplicateGraphIds`
- `GraphWriteScope`, `graphWriteScopes`, and graph write transaction helpers from `tx`

## Build Output

Run `turbo build --filter=@io/graph-kernel` from the repo root, or
`bun run build` in this package, to emit `./out`.
Run `turbo check --filter=@io/graph-kernel` from the repo root, or
`bun run check` in this package, to lint, format, type-check, and execute the
extracted kernel Bun tests.

The package `tsconfig.json` drives the normal `tsgo` build and emits `./out`.

The intended first-read contract artifact for agents is
`./out/index.d.ts`. That keeps the source layout natural while still giving
readers one low-noise declaration view of the exported API after build.

The root `lib/app/src/graph` surface should treat this package as the single source of
truth for ids, store primitives, schema authoring, and stable id reconciliation.
