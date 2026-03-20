# Graph Sync

## Purpose

This document is the entry point for agents working on sync payloads, authoritative write replay, or synced client behavior.

## Current Contract

The current engine already supports two authoritative delivery shapes in `../../src/graph/graph/sync.ts`:

- total payloads for bootstrap and recovery
- incremental payloads for ordered authoritative write delivery after a cursor

Total payloads carry:

- `mode: "total"`
- `scope: { kind: "graph" }`
- `snapshot`
- `cursor`
- `completeness`
- `freshness`

Incremental payloads carry:

- `mode: "incremental"`
- `scope: { kind: "graph" }`
- `after`
- `transactions`
- `cursor`
- `completeness`
- `freshness`
- optional `fallback`

## Current Session APIs

### Authoritative side

- `createAuthoritativeGraphWriteSession(store, namespace)`
- `createJsonPersistedAuthoritativeGraph(store, namespace, { path, ... })`
- `createPersistedAuthoritativeGraph(store, namespace, { storage, ... })`
- `createJsonPersistedAuthoritativeGraphStorage(path, namespace)`
- `apply(transaction)`
- `getBaseCursor()`
- `getCursor()`
- `getChangesAfter(cursor?)`
- `getIncrementalSyncResult(after?, { freshness? })`
- `getHistory()`

The current authority session already treats transaction ids as idempotency keys and emits monotonic cursors.
The persisted authority helper layers restart hydration, per-transaction durable commits, explicit snapshot persistence, retained history recovery, legacy snapshot rewrite, and rollback-on-durable-write-failure on top of that session model without changing the sync payload shapes clients consume.

### Client/session side

- `createTotalSyncSession(store, { preserveSnapshot, validate, validateWriteResult })`
- `apply(payload)`
- `applyWriteResult(result)`
- `pull(source)`
- `getState()`
- `subscribe(listener)`

### Typed synced client

- `createSyncedTypeClient(namespace, { pull, push?, createTxId? })`
- exposes `graph` for both `core` and the provided namespace, plus `sync`
- local typed mutations capture committed diffs as pending `GraphWriteTransaction`s
- `sync.flush()` pushes queued writes
- `sync.sync()` pulls authoritative state
- `sync.getPendingTransactions()` and `sync.getState()` expose queue and delivery state

## Ownership Boundary

- `graph` owns the total/incremental payload contracts, cursor progression rules, fallback semantics, and the persisted-authority history that feeds those contracts after restart.
- Consumer packages own transport and endpoint policy: when to call `createSyncPayload()` or `getIncrementalSyncResult(...)`, how to expose them over HTTP or another transport, and what auth wraps those endpoints.
- The web Worker is one such consumer: `src/web/lib/graph-authority-do.ts` now owns the SQLite-backed Durable Object storage path, while `src/web/lib/authority.ts` stays focused on the shared web authority behavior and request handlers.

## Current Behavior

- schema is bootstrapped locally before authoritative data arrives
- preserved bootstrap schema facts are layered back in at authoritative total apply
- incoming total payloads are validated before replace
- incoming write results and incremental batches are validated before apply
- successful total replace clears pending local transactions
- successful write reconciliation or incremental apply keeps local optimistic replay coherent
- fallback reasons already distinguish `unknown-cursor`, `gap`, and `reset`
- persisted authoritative runtimes can resume cursor progression from retained write history after restart
- unusable retained history is rewritten as a reset baseline instead of partially replayed

## Current Failure Model

- invalid local mutations fail before a transaction is queued
- invalid authoritative payloads or write results leave local state unchanged
- failed `flush()` calls preserve queued writes and surface `GraphSyncWriteError`
- incremental fallback results do not silently repair state; callers must recover via total sync
- failed persisted-authority saves roll back the in-memory authoritative write session instead of leaving a half-committed durable state

## Roadmap

- persistence backends beyond the current JSON snapshot-plus-history implementation
- live transport layered on top of the current pull/result shapes
- query-scoped partial sync and query-aware completeness
- richer conflict handling than retry-or-recover-by-total-snapshot

## Future Work Suggestions

1. Add one concrete sequence diagram for local mutation -> queue -> authority apply -> peer incremental pull.
2. Document the intended public stability of cursor formats and fallback reasons.
3. Add a short section on how `preserveSnapshot` should be captured and why it matters.
4. Document the contract expected from non-JSON persistence adapters once another backend exists.
5. Capture which conflict classes should remain “recover by snapshot” versus graduate to first-class protocols.
