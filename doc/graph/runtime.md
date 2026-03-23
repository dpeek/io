# Graph Runtime

## Purpose

This document is the entry point for agents working on schema authoring, stable ids, bootstrap, or store behavior.

## Current Runtime Surface

### Store

`../../src/graph/runtime/store.ts` owns the schema-agnostic store:

- facts are `Edge { id, s, p, o }`
- `assert(...)` appends a new edge
- `assertEdge(...)` preserves pre-authored edge ids for replay/sync
- `retract(...)` tombstones an edge without removing history
- internal subject/predicate/object indexes accelerate common `find(...)` and `facts(...)` patterns
- `snapshot()` and `replace(...)` support full-state transport
- `batch(...)` coalesces predicate-slot notifications
- `subscribePredicateSlot(s, p, listener)` is the reactive leaf boundary

### Schema authoring

`../../src/graph/runtime/schema.ts` defines the core authoring contract:

- `defineType(...)` for entity types
- `defineScalar(...)` for scalar codecs and reusable scalar validation
- `defineEnum(...)` for enum families and option identities
- `rangeOf(...)` to normalize key-or-type references without losing inference
- `edgeId(...)`, `fieldTreeId(...)`, and `typeId(...)` to switch from authored keys to resolved ids
- `GraphFieldAuthority` plus `graphFieldVisibilities`, `graphFieldWritePolicies`,
  `fieldVisibility(...)`, `fieldWritePolicy(...)`, and
  `fieldSecretMetadataVisibility(...)` publish the stable field-authority metadata
  contract used by sync filtering, write validation, and secret-handle boundaries

### Stable ids

`../../src/graph/runtime/identity.ts` owns key-to-id stability:

- `defineNamespace(...)` injects resolved ids into schema definitions
- `createIdMap(...)` and `extractSchemaKeys(...)` generate and reconcile id maps
- rerunning `createIdMap(...)` with a prior map preserves assigned ids, adds ids only for newly
  introduced owned keys, and leaves orphaned keys in place unless `pruneOrphans` is requested
- `defineNamespace(...)` fails fast when a schema-owned key is missing a stable id or when the
  supplied map contains duplicate or malformed ids, so bootstrap never runs against ambiguous
  schema identity
- `bun run ids check <schema-file.ts>`
- `bun run ids sync <schema-file.ts> [--prune-orphans]`
- `bun run ids rename <schema-file.ts> <old-key> <new-key>`

The current implementation keeps ids stable per key and treats rename as an explicit map-key move. There is no alias history layer.

### Core schema and bootstrap

`../../src/graph/modules/core.ts` and `../../src/graph/runtime/bootstrap.ts` define and materialize the base graph model:

- core scalars include string, number, date, boolean, url, email, and slug
- core entities include `core:node`, `core:type`, `core:predicate`, and `core:enum`
- the canonical namespace id map lives beside that entrypoint at `../../src/graph/modules/core.json`
- bootstrap materializes seeded schema entities through the shared validated create path when it
  owns the full typed shape, then writes the remaining schema metadata facts into the store
- `bootstrap(store, namespace)` is additive and idempotent for a resolved namespace: reapplying
  it after repeated startup or restart does not duplicate schema facts or rewrite already
  materialized schema state
- bootstrap-owned typed entities pin `createdAt` and `updatedAt` to the canonical
  `2000-01-01T00:00:00.000Z` timestamp so independently bootstrapped stores converge on the same
  logical schema facts during sync and preserve-snapshot merges
- runtime-created entities keep their ordinary lifecycle timestamps; bootstrap-owned timestamps are
  limited to schema entities and seed entities that bootstrap materializes itself
- `createBootstrappedSnapshot(types?)` caches fully bootstrapped schema snapshots by namespace
  object identity so fixture-heavy flows can clone schema state instead of rebuilding it
- `core:type.icon` and `core:predicate.icon` track definition-level icons, with inferred defaults
  for enum types (`tag.svg`) and entity-reference predicates (`edge.svg`) before falling back to
  `unknown.svg`
- schema itself is represented as graph data, not only TypeScript structure

### Authoritative persistence

`../../src/graph/runtime/authority.ts` owns the persisted authoritative runtime surface:

- `../../src/graph/runtime/persisted-authority.ts` is the stable shared contract for
  `PersistedAuthoritativeGraphState`, the storage load/commit/persist inputs, and
  `PersistedAuthoritativeGraphStorage`
- `PersistedAuthoritativeGraphStorage` defines the hydration, incremental commit, and explicit snapshot-persist contract for durable state
- `createJsonPersistedAuthoritativeGraphStorage(path, namespace)` provides the shipped file-backed JSON adapter for non-DO runtimes
- `createJsonPersistedAuthoritativeGraph(store, namespace, { path, seed?, createCursorPrefix? })` composes that file-backed adapter with the persisted authority runtime
- `createPersistedAuthoritativeGraph(store, namespace, { storage, seed?, createCursorPrefix? })` composes seeding, reload, incremental commit, explicit snapshot persistence, and authoritative write replay
- `../../src/web/lib/graph-authority-do.ts` is the current SQLite-backed Durable Object consumer of that storage contract; it bootstraps SQL tables in the constructor, hydrates rows during authority init, and commits graph plus secret side-storage writes inside one Durable Object storage transaction
- the SQLite row layout, Durable Object transaction wiring, and secret side-table
  shape are current web-adapter details rather than part of the shared runtime
  contract
- the stable command-related shared surface stops at field-authority metadata,
  `writeScope`, graph write envelopes, sync payloads, and
  `PersistedAuthoritativeGraphStorage`; generic command envelopes, dispatch
  registries, and routes remain consumer-owned
- `../../src/web/lib/authority.ts` is the current web proof of that
  consumer-owned lowering boundary rather than a published `graph` command
  registry
- `AuthoritativeGraphWriteResult` now retains `writeScope`, so persisted-authority storage keeps accepted `client-tx` versus `server-command` origin alongside cursor and transaction data
- `GraphWriteTransaction.id` is the stable idempotency key; replaying the same canonical transaction reuses the accepted cursor with `replayed: true`, while reusing the id for different operations is rejected
- graph-scoped incremental sync treats `transactions: []` without `fallback` as a successful no-op or cursor-advanced result; only explicit `fallback` requires total-sync recovery
- cursor strings are opaque to transport callers; the current prefix-plus-sequence encoding belongs to shared runtime internals and persisted history rather than the downstream transport contract
- file-backed persisted state stores a validated `snapshot` plus retained `writeHistory`, while the web Durable Object path reconstructs that same in-memory shape from `io_graph_meta`, `io_graph_tx`, `io_graph_tx_op`, `io_graph_edge`, and `io_secret_value`
- legacy snapshot-only files are rewritten into the current versioned state shape
- legacy versioned write histories that predate `writeScope` are normalized to `client-tx` on load and rewritten through the shared persistence path rather than treated as exact pre-migration authority-origin audit data
- failed durable commits or snapshot persists roll back the accepted in-memory authority state so it does not diverge from disk
- retained history can be bounded by transaction count; when the retained window no longer covers an older or broken cursor, authorities fall back to total-sync recovery instead of serving stale incremental state

### Runtime helpers

- `../../src/graph/runtime/serialize.ts` contains internal helpers for turning store state into plain objects and schema views
- `../../src/graph/modules/core/input.ts` contains input-kind guards used by scalar codecs

## Current Constraints

- Storage stays opaque and string-based; scalar decode/encode lives above it.
- Field trees preserve authoring shape, but runtime linking uses resolved ids.
- Reference fields should be authored through `defineReferenceField(...)` or helpers layered on top of it.
- Store indexes remain an internal implementation detail; the public surface is still pattern lookups.
- The package owns the persisted-authority contract and JSON adapter, but consumers still choose storage paths, bootstrap order, seed data, and process lifecycle, including the web package's SQLite Durable Object adapter.
- Transport and generic command dispatch are still outside the runtime core;
  persisted authority helpers only produce and consume graph sync/session
  primitives.

## Roadmap

- add persistence backends beyond the current JSON snapshot-plus-history adapter
- decide whether internal serialization helpers should become supported exports
- add stronger schema-evolution guidance beyond the current id-map workflow

## Future Work Suggestions

1. Add one small end-to-end example showing schema authoring, id resolution, bootstrap, and a resulting store snapshot.
2. Document when `rangeOf(...)` is preferred over passing raw strings directly.
3. Clarify whether `serialize.ts` is intended to remain internal or graduate to public API.
4. Add a short schema-evolution section covering safe rename and orphan-pruning workflows.
5. Document which lookup patterns should stay covered by the current in-store indexes before a real query planner exists.
