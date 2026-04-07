---
name: Graph client typed client
description: "Typed type handles, local CRUD flows, and query projection in @io/graph-client."
last_updated: 2026-04-02
---

# Graph client typed client

## Read this when

- you are changing `createGraphClient()` or `createEntityWithId()`
- you need to understand the package-root typed CRUD and query surface
- you are tracing how local graph operations resolve through schema definitions

## Main source anchors

- `../src/graph.ts`: package-root typed client factory and type-handle proxy
- `../src/entity-actions.ts`: committed create, update, and delete flows
- `../src/query.ts`: typed local query projection
- `../src/index.test.ts`: package surface expectations

## What this layer owns

- the typed client proxy returned by `createGraphClient()`
- explicit create-at-id helpers through `createEntityWithId()`
- type-handle CRUD APIs layered over one `GraphStore`
- local typed query projection over already-present graph state

It does not own sync transport, authority routing, React hooks, or schema bootstrap itself.

## Definitions requirement

- `createGraphClient()` resolves references against `options.definitions ?? namespace`
- validation and typed graph behavior expect definitions that include the built-in core schema when node typing or runtime validation depends on it
- callers that only pass a namespace without core definitions will hit fail-closed behavior when required built-in contracts are missing

## Type-handle surface

For each entity type in the namespace, the client exposes one type handle with:

- `validateCreate()` and `create()`
- `get()`
- `validateUpdate()` and `update()`
- `validateDelete()` and `delete()`
- `list()`
- `query()`
- `ref()` and `node()`

The client is implemented as a proxy over the namespace, so only entity definitions become handles.

## Create and update flow

- `createEntityWithId()` fails if the target node id already has facts
- `create()` uses a stable local node-id allocator through the client core helpers
- create and update calls validate first, then commit through `entity-actions.ts`
- delete retracts all facts on the target node only after `prepareDeleteEntity()` succeeds

## Local query surface

- `query()` is a local typed projection helper, not a network query planner
- `TypeQuerySpec` requires a selection object
- `where` may use either `id` or `ids`, but not both
- entity and nested relationship selection are projected from the local store through `createQueryProjector()`

This is a local convenience layer above the current graph state, not the broader serialized-query transport model.

## Practical rules

- Keep authority and transport concerns out of `graph.ts`.
- Use `definitions` whenever validation or reference resolution depends on more than the narrow local namespace.
- Treat `query()` as a typed local projection helper, not as a durable or remote query contract.
- Keep create-at-id behavior explicit; it is intentionally narrower than the normal local id allocation path.
