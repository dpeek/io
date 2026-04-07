---
name: Graph authority write session
description: "Authoritative apply flow, idempotent replay, retained-history windows, and total or incremental sync seams in @io/graph-authority."
last_updated: 2026-04-02
---

# Graph authority write session

## Read this when

- you are changing `createAuthoritativeGraphWriteSession()` or `createAuthoritativeTotalSyncPayload()`
- you need to reason about authority idempotency, cursor windows, or replay
- you are touching the contract between `@io/graph-authority`, `@io/graph-sync`, and `@io/graph-kernel`

## Main source anchors

- `../src/session.ts`: in-memory authoritative runtime, replay handling, and sync helpers
- `../src/session-contracts.ts`: public session interface plus replication authorizer contract
- `../src/validation.ts`: authoritative transaction and payload validation
- `../../graph-sync/doc/sync-stack.md`: cross-package sync ownership and transport behavior

## What this layer owns

- in-memory authoritative apply over one `GraphStore`
- authority idempotency keyed by `GraphWriteTransaction.id`
- retained-history windows and base-cursor advancement
- authority-owned total payload creation plus incremental replay output

It does not own durable storage, HTTP routes, Durable Object wiring, or client-side sync orchestration.

## Apply flow

1. `prepareGraphWriteTransaction()` normalizes and validates the caller input.
2. Existing transaction ids short-circuit:
   - same canonical transaction returns the stored accepted result with `replayed: true`
   - different contents for the same id fail with `sync.tx.id.conflict`
3. `validateAuthoritativeGraphWriteTransaction()` runs the authority validation pass, including field write-scope checks from `replication.ts`.
4. `materializeGraphWriteTransactionSnapshot()` derives the post-apply snapshot.
5. The authority store is replaced with that snapshot and a new monotonic cursor is emitted.

`applyWithSnapshot()` is the durable-commit seam. It returns both the accepted result and the exact post-apply snapshot that persisted runtimes commit atomically.

## Idempotency and replay

- Transaction ids are authority idempotency keys, not just caller-local request ids.
- Replays preserve the original accepted transaction and cursor; only `replayed` flips to `true` on the direct replay response.
- History loaded into a session must already match the expected cursor sequence for the configured `cursorPrefix` and `baseSequence`.

## Retained-history window

- The session stores accepted results in retained order and exposes them through `getHistory()`.
- Unbounded retention uses `kind: "all"`.
- Count-based retention uses `kind: "transaction-count"` and advances `baseSequence` when older results are pruned.
- `getBaseCursor()` is the floor of the retained replay window. Incremental callers older than that cursor must recover with total sync.

## Incremental semantics

- `getChangesAfter(undefined)` and `getChangesAfter(baseCursor)` return the current retained suffix.
- `getChangesAfter(currentHeadCursor)` returns an empty successful change set.
- Unknown or pruned cursors return `{ kind: "reset" }`, not a guessed partial replay.
- `getIncrementalSyncResult()` wraps retained changes in `@io/graph-sync` payload helpers and emits explicit fallback reasons when the cursor no longer fits the retained window.

## Total payload semantics

- `createAuthoritativeTotalSyncPayload()` filters the current store through authority replication rules before building the payload.
- The optional `authorizeRead` callback runs after schema visibility filtering.
- Callers own `cursor`, `scope`, `freshness`, `completeness`, and optional diagnostics values; the helper just clones and packages them safely.

## Practical rules

- Keep storage rollback and startup recovery out of this file; that belongs in `persisted-authority.ts`.
- Keep request-bound auth or route policy out of this file; that belongs in consumer packages.
- Treat replayed results as acknowledgements only. Retained history stays stored with `replayed: false`.
- When you need the exact durable-commit snapshot, use `applyWithSnapshot()` rather than calling `apply()` and then re-snapshotting.
