---
name: Graph client synced client
description: "Pending-write replay, flush and sync semantics, and status widening in @io/graph-client."
last_updated: 2026-04-02
---

# Graph client synced client

## Read this when

- you are changing `createSyncedGraphClient()`
- you need to understand pending local writes, flush behavior, or sync state
- you are wiring client-side pull or push transports above the shared sync-core session

## Main source anchors

- `../src/sync.ts`: synced client runtime and pending-write controller
- `../src/sync-validation.ts`: client-side validators layered on top of `@io/graph-sync`
- `../src/sync.typecheck.ts`: explicit status widening checks
- `../../graph-sync/src/session.ts`: underlying total-sync session behavior

## Runtime model

The synced client keeps two stores:

- `authoritativeStore`: last authoritative synced state
- `store`: local working state presented through typed client refs

The local working state is always:

- authoritative store snapshot
- plus every pending local transaction replayed in order

## Pending transaction capture

- local writes do not record ad hoc mutation objects
- the client snapshots before and after one committed local mutation boundary and derives a canonical transaction with `createGraphWriteTransactionFromSnapshots()`
- no-op local mutations do not enqueue pending transactions

This is why pending writes stay aligned with the kernel and sync write-envelope contract.

## Sync controller surface

`graph.sync` exposes:

- `apply(payload)`
- `applyWriteResult(result)`
- `flush()`
- `sync()`
- `getPendingTransactions()`
- `getState()`
- `subscribe(listener)`

## Status widening

- `GraphClientSyncStatus` widens sync-core status with `"pushing"`
- `"pushing"` is client-only and does not exist in `@io/graph-sync`
- `pendingCount` is the length of the local pending transaction queue

## Reconciliation rules

- `apply(totalPayload)` resets pending transactions and rebuilds local state from the new authoritative baseline
- `applyWriteResult()` acknowledges the head pending transaction when its tx id matches the returned authoritative result
- `flush()` pushes queued transactions one at a time through the provided sink
- `sync()` delegates pull behavior to the underlying total-sync session

If push fails, the client marks state `error` and `stale`, preserves pending transactions, and throws `GraphSyncWriteError`.

## Validation boundary

The synced client layers extra client validation on top of sync-core:

- total payloads are validated against client graph invariants
- authoritative write results are validated against the client namespace before local reconcile
- sync-core validation errors are converted into `GraphValidationError`

That keeps local typed validation and sync-core validation on one client-facing error model.

## Ref wrapping

- synced clients reuse the ordinary graph-client handles
- type handles, entity refs, field groups, and predicate refs are wrapped so mutating methods capture pending transactions automatically
- read methods and validation helpers stay otherwise unchanged

## Practical rules

- Keep pending-write replay deterministic and derived from snapshots rather than from bespoke mutation bookkeeping.
- Preserve optimistic local writes until each one is explicitly acknowledged or replaced by a new authoritative total payload.
- Keep `"pushing"` and transport retry policy client-local; they do not belong in `@io/graph-sync`.
- If you add new mutating methods to refs or type handles, update the wrapper layer in `sync.ts` so pending transaction capture stays complete.
