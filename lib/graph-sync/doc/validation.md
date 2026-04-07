---
name: Graph sync validation
description: "Payload normalization, incremental apply rules, and sync-specific validation results in @io/graph-sync."
last_updated: 2026-04-02
---

# Graph sync validation

## Read this when

- you are changing sync payload validation or normalization
- you need to understand why incremental apply failed
- you are exposing sync-core errors to callers or tests

## Main source anchors

- `../src/validation.ts`: payload, write-result, and incremental-apply validation helpers
- `../src/validation.test.ts`: graph-scope versus module-scope validation coverage
- `../src/contracts.ts`: `GraphSyncValidationResult`, issues, and `GraphSyncValidationError`

## Validation surface

This package uses its own sync-specific validation shape:

- source: `sync`
- phase: `authoritative`
- event: `reconcile`

That keeps sync-core independent from the broader typed-client validation layer.

## Total payload preparation

- `prepareTotalSyncPayload()` validates shape and then normalizes the payload
- `validateTotalSyncPayload()` exposes the same result shape without throwing
- graph-scoped total payloads must be `complete`
- module-scoped totals may be `incomplete`

If `preserveSnapshot` is provided, preparation merges preserved facts and retractions into the delivered snapshot without overwriting logically equivalent payload facts.

## Write-result preparation

- `prepareAuthoritativeGraphWriteResult()` validates:
  - `txId`
  - `cursor`
  - `replayed`
  - `writeScope`
  - embedded transaction validity
- `txId` must match `transaction.id`
- write results returned here carry normalized transactions

## Incremental result validation

- `createIncrementalSyncPayload()` creates successful incremental delivery
- `createIncrementalSyncFallback()` creates recovery-only incremental results
- `validateIncrementalSyncPayload()` rejects `fallbackReason`
- `validateIncrementalSyncResult()` accepts both successful incremental results and explicit fallbacks

Important rules:

- graph scope only allows `unknown-cursor`, `gap`, or `reset`
- module scope may also use `scope-changed` and `policy-changed`
- `fallbackReason` requires `transactions: []`
- when transactions are present, the result cursor must match the last transaction cursor
- if `after` and `cursor` share a parsed prefix, `cursor` must not move backward
- incremental delivery must never contain `replayed: true` transactions

## Incremental apply preparation

`prepareIncrementalSyncPayloadForApply()` adds session-specific checks on top of result validation:

- `after` must match the current session cursor when one exists
- delivered scope must match the current active scope identity
- any fallback result is rejected as a recovery signal, not applied
- each transaction is materialized over a validation store with `allowExistingAssertEdgeIds: true`
- optional `validateWriteResult` hooks run before each validation-store replace

The result is either one fully materialized next snapshot or one sync validation failure.

## Practical rules

- Use `prepare*` helpers when you need normalized values that are safe to apply.
- Use `validate*` helpers when you only need a result object for branching or tests.
- Keep fallback results explicit; do not coerce them into empty successful incrementals.
- Keep graph-scoped and module-scoped completeness or fallback rules distinct.
