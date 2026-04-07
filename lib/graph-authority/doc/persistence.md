---
name: Graph authority persistence
description: "Persisted authority runtime, startup recovery, durable commit boundaries, and the Node JSON adapter in @io/graph-authority."
last_updated: 2026-04-02
---

# Graph authority persistence

## Read this when

- you are changing `createPersistedAuthoritativeGraph()` or the storage adapter contract
- you need to reason about startup recovery, rollback, or baseline resets
- you are touching the Node JSON adapter or another durable authority implementation

## Main source anchors

- `../src/persisted-authority.ts`: durable runtime, storage boundary, startup replay, and rollback behavior
- `../src/json-storage.ts`: shipped file-backed JSON adapter and legacy-history normalization
- `../src/server.ts`: Node-only entrypoint for JSON persistence helpers

## Stable storage boundary

`PersistedAuthoritativeGraphStorage` is intentionally small:

- `load()`: hydrate one snapshot plus optional retained history and retained records
- `commit()`: atomically persist one accepted authoritative transaction
- `persist()`: rewrite the full current authority baseline

SQL layouts, Durable Object wiring, filesystem formats, and secret side storage stay outside this shared contract.

## Durable state shape

- `PersistedAuthoritativeGraphState` is versioned and contains:
  - `snapshot`
  - `writeHistory`
  - optional semantic `retainedRecords`
- Retained records are opaque payloads committed atomically beside graph state. The shared runtime stores them but does not interpret record-family-specific semantics.

## Startup recovery model

`load()` returns both data and explicit recovery classification:

- `"none"`: the retained cursor window can resume as-is
- `"repair"`: the snapshot is still justified, but metadata or normalized history should be rewritten
- `"reset-baseline"`: the snapshot can no longer justify the retained cursor window, so the runtime must publish a fresh baseline

Startup diagnostics keep the reasons explicit through `repairReasons` and `resetReasons`.

## Runtime bootstrap flow

1. Create a typed graph client over the provided authority store.
2. Build a fresh write session with the configured retained-history policy.
3. If storage has persisted state:
   - replace the store with the persisted snapshot
   - replay retained history back through a fresh write session
   - persist again when recovery is `"repair"` or normalization changed the effective retained-history window
4. If replay fails, upgrade to `"reset-baseline"`, create a fresh session, and persist the current snapshot as a new baseline.
5. If storage is empty, optional `seed(graph)` runs before the first baseline persist.

## Rollback semantics

- `applyTransaction()` snapshots both the current store and current retained history before applying.
- It commits the exact `applyWithSnapshot()` result through the storage adapter.
- If `commit()` fails, the store is restored to the previous snapshot and the write session is rebuilt from the previous retained history.
- `persist()` also fails closed: it creates a fresh cursor prefix for the rewrite, but restores the previous write session if the baseline persist fails.

## JSON adapter

The shipped Node adapter is intentionally conservative:

- it validates loaded snapshots with `validateAuthoritativeTotalSyncPayload()`
- it normalizes legacy write history that predates stored `writeScope`
- it rewrites through a temp file and rename sequence
- it is exported only from `@io/graph-authority/server`

Browser bundles must not import the server subpath.

## Practical rules

- Keep the shared runtime focused on snapshot, history, and rollback semantics. Adapter-specific row planning belongs in consumer packages.
- Treat `"repair"` and `"reset-baseline"` differently. `"repair"` preserves the current replay window; `"reset-baseline"` intentionally abandons it.
- When durable commit fails, restore both store state and retained-history state together.
- Do not widen the storage contract with adapter-local concerns unless more than one adapter truly needs them.
