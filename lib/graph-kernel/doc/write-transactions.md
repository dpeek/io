---
name: Graph kernel write transactions
description: "Canonical graph write envelopes, snapshot diff helpers, and retained-history contracts in @io/graph-kernel."
last_updated: 2026-04-02
---

# Graph kernel write transactions

## Read this when

- you are changing `GraphWriteTransaction`, `GraphWriteScope`, or snapshot diff helpers
- you need to compare transactions safely or derive writes from snapshots
- you are touching the contract boundary between kernel, sync, and authority layers

## Main source anchors

- `../src/tx.ts`: write-envelope types and helpers
- `../src/tx.test.ts`: canonicalization, diffing, clone helpers, and retained-history rules
- `../../graph-sync/doc/sync-stack.md`: cross-package ownership boundary with `@io/graph-sync` and `@io/graph-authority`

## What the kernel owns

- the low-level `GraphWriteOperation` and `GraphWriteTransaction` contract
- stable `GraphWriteScope` literals
- snapshot-diff helpers for deriving write operations
- retained-history policy and write-result value shapes shared with authority and sync layers
- clone and equality helpers for the public contract

It does not own sync sessions, authority state machines, persistence, or transport payload routing.

## Operation model

- `GraphWriteTransaction.id` is caller-supplied and acts as the idempotency key.
- Operations are either `assert` with a full `GraphFact` or `retract` by `edgeId`.
- `sameGraphWriteTransaction()` is exact and order-sensitive.

If you want logical equality across callers that may order operations differently, canonicalize first and compare the canonical form.

## Canonicalization rules

- Retracts are deduplicated by `edgeId`.
- Asserts are deduplicated by asserted edge `id`.
- Retracts and asserts are sorted into one stable deterministic order.
- `canonicalizeGraphWriteTransaction()` keeps the caller's `id` and returns a detached, normalized `ops` array.

This is the format that downstream authority and sync code should treat as stable.

## Snapshot diff helpers

- `createGraphWriteOperationsFromSnapshots(before, after)` emits retractions newly present in `after.retracted` and assertions for edges newly present in `after.edges`.
- `createGraphWriteTransactionFromSnapshots(before, after, txId)` wraps that diff in a canonical transaction.

The diff logic assumes edge ids are stable and immutable. If a caller changes edge contents without changing the edge id, that has already violated the store contract.

## Shared authority contract

- `GraphWriteScope` currently uses the same literal set as `GraphFieldWritePolicy`: `client-tx`, `server-command`, and `authority-only`.
- Retained history is either unbounded (`kind: "all"`) or count-based (`kind: "transaction-count"`).
- `AuthoritativeGraphWriteResult` records `txId`, `cursor`, `replayed`, `writeScope`, and the accepted transaction.
- `AuthoritativeGraphChangesAfterResult` distinguishes incremental replay (`kind: "changes"`) from retained-history reset (`kind: "reset"`).

## Clone helpers

- `cloneGraphWriteOperation()` normalizes unknown input to the public contract shape.
- `cloneGraphWriteTransaction()` and `cloneAuthoritativeGraphWriteResult()` return detached values for safe reuse.

These helpers are for contract hygiene. They are not a substitute for higher-level validation.

## Practical rules

- Keep session and persistence behavior out of this package.
- Canonicalize before hashing, serializing, or doing order-insensitive comparison.
- Use the snapshot diff helpers only when both snapshots already obey the store invariants.
