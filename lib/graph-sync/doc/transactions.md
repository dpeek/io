---
name: Graph sync transactions
description: "Transaction preparation, canonicalization, snapshot materialization, and store apply behavior in @io/graph-sync."
last_updated: 2026-04-02
---

# Graph sync transactions

## Read this when

- you are changing sync-side transaction preparation or apply behavior
- you need to materialize one write transaction against a store snapshot
- you are debugging transaction-shape validation or edge-id reuse failures

## Main source anchors

- `../src/transactions.ts`: transaction preparation, materialization, and apply helpers
- `../src/transactions.test.ts`: canonicalization and materialization coverage
- `../../lib/graph-kernel/src/tx.ts`: kernel-owned write-envelope and canonicalization contract

## Boundary

`@io/graph-sync` does not define the write-envelope contract. That belongs to `@io/graph-kernel`.

This package owns the sync-side handling around that contract:

- shape validation for incoming transactions
- canonical preparation for sync use
- materializing a transaction into a new store snapshot
- applying a valid transaction by replacing the target store snapshot

## Preparation

- `prepareGraphWriteTransaction()` validates basic shape first
- it clones the input and then canonicalizes through `canonicalizeGraphWriteTransaction()`
- empty ids, empty op lists, malformed operations, and conflicting duplicate edge ids fail with sync-specific validation issues

## Materialization

`materializeGraphWriteTransactionSnapshot()` applies one prepared transaction over either:

- the current store snapshot
- or an explicit `sourceSnapshot`

Rules:

- retracts must reference an existing edge id
- asserts normally must not reuse an existing edge id
- `allowExistingAssertEdgeIds` relaxes that last rule for incremental replay validation paths that may see already-applied edges

The result is a detached snapshot, not an in-place mutation.

## Apply helper

- `applyGraphWriteTransaction()` materializes first
- if materialization fails, it throws
- if materialization succeeds, it replaces the target store with the new snapshot

## Logical fact keys

- `logicalFactKey()` reduces one edge to `subject + predicate + object`
- the validation layer uses that to merge preserved snapshot facts without depending on edge id identity alone

## Practical rules

- Keep canonical transaction semantics in `@io/graph-kernel`; do not fork them here.
- Use `materializeGraphWriteTransactionSnapshot()` when you need validation plus detached snapshot output.
- Use `allowExistingAssertEdgeIds` only for replay or incremental apply paths that already proved idempotent intent.
- Do not mutate the target store until the full transaction has materialized successfully.
