# Graph Runtime

## Purpose

This document is the entry point for agents working on schema authoring, stable ids, bootstrap, or store behavior.

## Current Runtime Surface

### Store

`../src/graph/store.ts` owns the schema-agnostic store:

- facts are `Edge { id, s, p, o }`
- `assert(...)` appends a new edge
- `assertEdge(...)` preserves pre-authored edge ids for replay/sync
- `retract(...)` tombstones an edge without removing history
- `snapshot()` and `replace(...)` support full-state transport
- `batch(...)` coalesces predicate-slot notifications
- `subscribePredicateSlot(s, p, listener)` is the reactive leaf boundary

### Schema authoring

`../src/graph/schema.ts` defines the core authoring contract:

- `defineType(...)` for entity types
- `defineScalar(...)` for scalar codecs and reusable scalar validation
- `defineEnum(...)` for enum families and option identities
- `rangeOf(...)` to normalize key-or-type references without losing inference
- `edgeId(...)`, `fieldTreeId(...)`, and `typeId(...)` to switch from authored keys to resolved ids

### Stable ids

`../src/graph/identity.ts` and `../src/graph/ids-cli.ts` own key-to-id stability:

- `defineNamespace(...)` injects resolved ids into schema definitions
- `createIdMap(...)` and `extractSchemaKeys(...)` generate and reconcile id maps
- `bun run ids check <schema-file.ts>`
- `bun run ids sync <schema-file.ts> [--prune-orphans]`
- `bun run ids rename <schema-file.ts> <old-key> <new-key>`

The current implementation keeps ids stable per key and treats rename as an explicit map-key move. There is no alias history layer.

### Core schema and bootstrap

`../src/graph/core.ts` and `../src/graph/bootstrap.ts` define and materialize the base graph model:

- core scalars include string, number, date, boolean, url, email, and slug
- core entities include `core:node`, `core:type`, `core:predicate`, and `core:enum`
- bootstrap writes type, predicate, field-tree, enum-member, and core metadata facts into the store
- schema itself is represented as graph data, not only TypeScript structure

### Authoritative persistence

`../src/graph/authority.ts` owns the persisted authoritative runtime surface:

- `PersistedAuthoritativeGraphStorage` defines the load/save contract for durable state
- `createJsonPersistedAuthoritativeGraphStorage(path, namespace)` provides the shipped JSON-backed adapter
- `createPersistedAuthoritativeGraph(store, namespace, { storage, seed?, createCursorPrefix? })` composes seeding, reload, save, and authoritative write replay
- persisted state stores a validated `snapshot` plus retained `writeHistory`
- legacy snapshot-only files are rewritten into the current versioned state shape
- failed durable saves roll back the accepted in-memory write so the authority does not diverge from disk

### Runtime helpers

- `../src/graph/serialize.ts` contains internal helpers for turning store state into plain objects and schema views
- `../src/type/input.ts` contains input-kind guards used by scalar codecs

## Current Constraints

- Storage stays opaque and string-based; scalar decode/encode lives above it.
- Field trees preserve authoring shape, but runtime linking uses resolved ids.
- Reference fields should be authored through `defineReferenceField(...)` or helpers layered on top of it.
- The store does not currently advertise secondary indexes.
- The package owns the persisted-authority contract and JSON adapter, but consumers still choose storage paths, bootstrap order, seed data, and process lifecycle.
- Transport is still outside the runtime core; persisted authority helpers only produce and consume graph sync/session primitives.

## Roadmap

- add persistence backends beyond the current JSON snapshot-plus-history adapter
- decide whether internal serialization helpers should become supported exports
- improve indexing and query planning if current store scans become a bottleneck
- add stronger schema-evolution guidance beyond the current id-map workflow

## Future Work Suggestions

1. Add one small end-to-end example showing schema authoring, id resolution, bootstrap, and a resulting store snapshot.
2. Document when `rangeOf(...)` is preferred over passing raw strings directly.
3. Clarify whether `serialize.ts` is intended to remain internal or graduate to public API.
4. Add a short schema-evolution section covering safe rename and orphan-pruning workflows.
5. Document expected index strategy once performance work starts in earnest.
