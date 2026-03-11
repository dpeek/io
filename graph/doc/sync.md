# Graph Sync V1

## Goal

Ship one real sync entry point now, but keep the contract compatible with
partial or incremental sync later.

## Current Contract

Sources:

- `graph/src/graph/sync.ts`
- `graph/src/graph/store.ts`
- `app/src/graph/runtime.ts`

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
That fresh local store is bootstrapped with the local schema first, so typed
reads and optimistic local edits can use the same validation boundary before
the first authoritative sync arrives.
That bootstrapped snapshot is also preserved at the total-sync apply boundary,
so authoritative payloads may contain data only and still validate/apply
against the same compiled schema contract.

That typed `graph` client still runs local create/update/delete and predicate
field edits through the same local validation precheck used by unsynced graph
clients. The sync layer does not introduce a second optimistic-mutation API.

Incoming total snapshots are now validated in two steps before the local store
is replaced:

1. validate the total-sync envelope itself (`mode`, `scope`, `cursor`,
   `completeness`, `freshness`, and `snapshot` shape)
2. validate the candidate graph facts against the same graph rules used by
   local mutation

Invalid authoritative payloads fail the sync attempt and leave the previous
ready state intact.

Accepted total snapshots are still authoritative replaces in v1. There is no
pending local-op merge queue yet; the durable boundary is validation-before-
replace.

That authoritative pass now also rejects data-bearing nodes that have lost all
current `core:node:type` edges, so sync cannot silently install untyped ghost
entities into the local store.

The shared apply boundary now lives in the total-sync session itself.

- `createSyncedTypeClient(...)` wires
  `createAuthoritativeTotalSyncValidator(namespace)` automatically.
- Lower-level integrations can opt into the same behavior with
  `createTotalSyncController(store, { pull, preserveSnapshot, validate: createAuthoritativeTotalSyncValidator(namespace) })`
  or
  `createTotalSyncSession(store, { preserveSnapshot, validate: createAuthoritativeTotalSyncValidator(namespace) })`.
- Callers that need a structured `GraphValidationResult` instead of an
  exception can call
  `validateAuthoritativeTotalSyncPayload(payload, namespace, { preserveSnapshot })`.
  Failed results carry the affected `changedPredicateKeys`; graph-fact failures
  point at predicate slots, while malformed envelope failures surface runtime
  issues at payload paths like `cursor` or `snapshot.retracted[0]`.
  When envelope shape validation succeeds, `result.value` is the materialized
  payload that graph validation actually checked, including any preserved
  schema baseline.
- `apply(...)` and `pull(...)` both run the same validation hook before store
  replacement, so authoritative reconciliation is not split across wrappers.
- Successful `apply(...)` and `pull(...)` calls return the materialized payload
  that was actually validated and installed, including any preserved schema
  baseline layered in at the apply boundary.
- `preserveSnapshot` should usually be the store snapshot captured immediately
  after local schema bootstrap. That keeps compiled schema facts durable across
  authoritative replace without merging pending local data writes.

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
