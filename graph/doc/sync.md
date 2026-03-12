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

Accepted total snapshots are still authoritative replaces in v1, and a
successful total replace clears any locally pending write queue. Steady-state
local edits now use queued `GraphWriteTransaction`s plus `sync.flush()`, while
total sync remains the bootstrap and recovery boundary.

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

The first landed authority-side write contract now sits beside that snapshot
path:

- `GraphWriteTransaction = { id, ops }`
- `ops` currently use canonical low-level graph mutations:
  - `{ op: "retract", edgeId }`
  - `{ op: "assert", edge: { id, s, p, o } }`
- `createGraphWriteOperationsFromSnapshots(before, after)` derives the
  canonical op sequence from an already-committed local mutation without
  changing transport
- `createGraphWriteTransactionFromSnapshots(before, after, txId)` wraps that
  diff in the stable transaction envelope used by the sync layer
- `canonicalizeGraphWriteTransaction(...)` normalizes a transaction into one
  deterministic op order:
  - retract ops first, sorted by `edgeId`
  - assert ops next, sorted by `(s, p, o, id)`
  - duplicate identical ops collapse away
- `createAuthoritativeGraphWriteSession(store, namespace)` accepts that
  transaction shape on the authoritative store, validates the post-apply graph
  on a cloned store, and only then replaces the real store snapshot atomically
- successful writes return `{ txId, cursor, replayed, transaction }`
- transaction ids are idempotency keys for this authority session:
  - `transaction.id` and `result.txId` must be non-empty strings
  - exact replays return the original cursor with `replayed: true`
  - reusing an accepted id for a different canonical transaction fails with a
    structured runtime validation issue
- authoritative cursors are also required to be non-empty strings and remain
  monotonic within the authority session
- authoritative sessions now also expose the minimal history surface needed for
  incremental proofs:
  - `getBaseCursor()` returns the snapshot/reset cursor that precedes retained
    history
  - `getChangesAfter(cursor)` returns ordered accepted write results after a
    known cursor, or `{ kind: "reset" }` when callers must recover by full
    snapshot
  - `getHistory()` returns the accepted-write log state needed to persist and
    later rehydrate the same monotonic cursor progression
- direct non-throwing checks can use
  `validateAuthoritativeGraphWriteTransaction(tx, store, namespace)`

## Read-Write Proof Contract

The first shipped read-write loop is intentionally narrow and runtime-backed.

Sources:

- `graph/src/graph/sync.ts`
- `app/src/graph/runtime.ts`
- `app/src/graph/sync.test.ts`

The proven path today is:

1. a synced client applies a normal typed local mutation against its local store
2. `createSyncedTypeClient(...)` captures the committed edge-level diff as a
   pending `GraphWriteTransaction`
3. `sync.flush()` pushes those pending transactions through the configured
   write transport
4. the authority applies each transaction through
   `createAuthoritativeGraphWriteSession(...)`
5. the authority returns an `AuthoritativeGraphWriteResult`
6. synced clients reconcile that acknowledged result through
   `sync.applyWriteResult(result)` or the built-in flush loop

That means whole-graph total sync is still the bootstrap and recovery path, but
accepted writes no longer require a full-snapshot replace per mutation. The
per-write steady-state proof is now authoritative tx apply plus incremental
client reconciliation.

The generic synced-client contract now exposes:

- `sync.getPendingTransactions()` to inspect the queued canonical tx records
- `sync.flush()` to push the queue in order and acknowledge accepted writes
- `GraphSyncWriteError` when a push fails; it carries the failed transaction in
  `error.transaction` and preserves the remaining queue for retry
- `sync.getState().pendingCount` so callers can surface pending-write state

The app proof runtime demonstrates the contract with one shared authority and
multiple synced clients:

- each client still uses the normal typed graph handles for local reads and
  writes
- the synced client turns a committed local mutation into a deterministic
  queued write tx
- the authority remains the only place that decides whether the write is
  accepted
- peer clients observe the accepted write through `applyWriteResult(...)`
  instead of calling `sync.sync()` for every mutation

## Failure Handling Today

Failure handling is still intentionally conservative.

- Local invalid input fails before any tx is produced, using the same typed
  validation surface as unsynced clients.
- Authority-side tx validation failure rejects the write and leaves the
  authoritative store unchanged.
- Failed `sync.flush()` calls leave the queued txs intact, mark sync state
  stale/error, and let callers retry the same idempotent transactions.
- A synced client that needs to discard pending optimistic state or recover
  from divergence can still fall back to total sync via `sync.sync()` or
  `sync.apply(payload)`, which replaces the local view authoritatively.
- Authority persistence should treat a durable snapshot plus durable write
  history as one consistency boundary. If retained history is unavailable or
  malformed after restart, the authority keeps the snapshot and resets history,
  so callers must recover from that new snapshot cursor instead of replay.
- There is not yet a rollback protocol, cursor-based incremental pull, or
  query-scoped repair path.

So the durable v1 rule is:

- bootstrap and recovery use total snapshots
- accepted writes reconcile incrementally
- failed pushes stay retryable until the caller chooses to retry or recover by
  full snapshot

For lower-level integration, `createTotalSyncSession(store)` still exposes:

- `apply(payload)` to install a total snapshot into the local store
- `applyWriteResult(result)` to reconcile an authoritative write result into the
  existing local store without replacing the whole snapshot
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

## Next Concrete Work Areas

The current sync surface now has:

- authoritative total-snapshot pull/replace
- a canonical write transaction envelope
- an authority-side apply path with idempotent tx ids
- synced-client pending write queues plus `sync.flush()`
- an end-to-end runtime proof of local mutation -> queue -> authority ack ->
  peer visibility through incremental write-result reconciliation

The next work should build on that landed client contract rather than making
the snapshot contract more elaborate.

### 1. Incremental authoritative apply on synced clients

The synced client now:

- captures committed local typed mutations as pending `GraphWriteTransaction`
  records
- flushes those transactions through a configured authority write transport
- rebases the local optimistic graph from the last authoritative snapshot plus
  any still-pending txs after acknowledged write results
- keeps local optimistic validation exactly where it already lives today, before
  a tx is queued or sent

That still leaves room for richer conflict handling later, but the generic
queue/push path is now real.

### 2. Incremental pull and live tx delivery

After the push/ack loop is real, sync can stop relying on full-graph refresh as
the normal read path.

That path:

- let clients pull transactions or patches after a cursor instead of only a
  complete snapshot
- keep total snapshot apply as the bootstrap and recovery path
- preserve the existing typed-read and predicate-slot subscription surface while
  changing only how new authoritative state arrives

This is the point where "graph stream" becomes literal: normal sync traffic is
an ordered transaction stream, while total snapshots become a fallback for
bootstrap, reset, or resubscribe flows.

## Execution Plan

The next execution slice should stay narrowly focused on whole-graph
transaction-stream delivery. Use the following order.

### 1. Persist authoritative transaction history and cursor progression

Goal:
keep enough durable authority state to answer "what changed after cursor X?"
without replacing the existing total-snapshot bootstrap flow.

Proof surfaces:

- `graph/src/graph/sync.ts`
- `app/src/authority.ts`
- `app/src/authority.test.ts`

Out of scope:

- multi-backend persistence adapters
- query-scoped replication storage

### 2. Define one incremental pull envelope beside total snapshots

Goal:
ship one stable response shape for ordered authoritative tx delivery after a
cursor, including the cases that require clients to fall back to total sync.

Proof surfaces:

- `graph/src/graph/sync.ts`
- `graph/doc/sync.md`
- `app/src/graph/sync.test.ts`

Out of scope:

- live transport wiring
- partial or query-scoped completeness semantics

### 3. Apply pulled tx batches through the shared sync session

Goal:
teach the session and synced-client surfaces to consume ordered tx batches,
preserve predicate-slot notification behavior, and reset cleanly to total sync
when a cursor gap or invalid batch is detected.

Proof surfaces:

- `graph/src/graph/sync.ts`
- `graph/src/graph/store.ts`
- `app/src/graph/sync.test.ts`

Out of scope:

- conflict resolution beyond snapshot reset
- new typed-read APIs

### 4. Prove multi-client incremental delivery in the app runtime

Goal:
extend the existing authority/runtime proof so one client can push, other
clients can pull or subscribe to the resulting tx stream, and the system can
still recover by snapshot when needed.

Proof surfaces:

- `app/src/authority.ts`
- `app/src/graph/runtime.ts`
- `app/src/graph/sync.test.ts`

Out of scope:

- generalized production transport infrastructure
- polished UI beyond the proof surfaces already in `app`

### 5. Surface tx-stream state in explorer and docs

Goal:
make the new delivery path inspectable enough that future query, partial-sync,
and devtool work has one concrete operator-visible baseline.

Proof surfaces:

- `graph/doc/sync.md`
- `graph/doc/big-picture.md`
- `app/src/web/explorer.tsx`

Out of scope:

- time travel
- policy simulation
- full devtools packaging
