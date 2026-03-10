# Graph Sync V1

## Goal

Ship one real sync entry point now, but keep the contract compatible with
partial or incremental sync later.

## Current Contract

Sources:

- `graph/src/graph/sync.ts`
- `graph/src/graph/store.ts`
- `graph/src/graph/runtime.ts`

The first landed client-facing contract is a total graph snapshot:

- `mode: "total"`
- `scope: { kind: "graph" }`
- `snapshot: { edges, retracted }`
- `cursor: string`
- `completeness: "complete"`
- `freshness: "current" | "stale"`

The high-level entry point is `createSyncedTypeClient(...)`.

It creates a local store plus the existing typed client, then exposes a
pre-bound `sync.sync()` method for the configured total-sync source.

For lower-level integration, `createTotalSyncSession(store)` still exposes:

- `apply(payload)` to install a total snapshot into the local store
- `pull(source)` to fetch a payload and apply it with sync-state transitions
- `getState()` to read current sync metadata
- `subscribe(listener)` to observe sync-state changes

## Query And Subscription Semantics

The typed client still reads only from the local store. Under the v1 total-sync
scope, that means:

- local queries are only as complete as `sync.getState()`
- completeness and freshness live beside the query surface for now, not inside
  every query result
- schema and data can both arrive inside the synced snapshot, so the client no
  longer has to assume local bootstrap data is authoritative

Predicate-slot subscriptions stay local and keep the same contract they already
used for UI bindings. A total resync replaces the store snapshot, then only
re-notifies subscribed `(subject, predicate)` slots whose logical value changed.
That keeps sync delivery aligned with the current local subscription model.

## Compatibility Path

The total-sync shape is intentionally a subset of the future sync model.

The compatibility path is:

1. keep `mode`, `scope`, `cursor`, `completeness`, and `freshness` as stable
   metadata
2. narrow `scope` from `{ kind: "graph" }` to query-backed or region-backed
   scopes
3. allow `completeness: "incomplete"` once a client holds only part of the
   graph
4. add incremental delivery beside the same local store contract, first as
   refreshed total snapshots, then as patches or tx streams
5. keep predicate-slot subscriptions and typed local reads unchanged, so sync
   evolution happens around the store boundary instead of replacing the UI/query
   model

What does change later is where completeness is tracked. With whole-graph total
sync, completeness is one global state value. With partial sync, completeness
must become scope-aware and query-aware, but the same metadata words and store
update path still apply.
