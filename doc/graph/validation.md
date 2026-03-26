# Graph Validation

## Purpose

This document is the entry point for agents working on mutation rules, runtime invariants, or authoritative apply boundaries.

## Current Rule Ownership

The code already enforces a three-layer validation split:

- scalar and enum families own reusable value semantics
- field definitions own predicate-specific invariants
- runtime validation owns store-dependent graph invariants

Relevant source:

- `../../src/graph/runtime/schema.ts`
- `../../src/graph/runtime/type-module.ts`
- `../../src/graph/runtime/client-core.ts`
- `../../src/graph/runtime/client-validation.ts`
- `../../src/graph/runtime/client.ts`
- `../../src/graph/runtime/authority-validation.ts`
- `../../lib/graph-sync/src/validation.ts`

## Current Local Lifecycle

Local typed mutations in `../../src/graph/runtime/client.ts` already follow one shared path:

1. normalize and clone caller input
2. run `onCreate` or `onUpdate` lifecycle hooks
3. validate scalar and enum semantics
4. validate field-level rules
5. simulate the post-mutation graph on a cloned store
6. run `validateGraphStore(...)`
7. commit only if that shared result is valid

This applies to:

- type-handle `validateCreate`, `create`, `validateUpdate`, `update`, `validateDelete`, `delete`
- entity-ref `validateUpdate`, `update`, `validateDelete`, `delete`
- predicate-ref `validateSet`, `validateClear`, `validateReplace`, `validateAdd`, `validateRemove`, and the matching mutators

Lifecycle-managed required predicates can opt into `createOptional: true` on the field
definition. That keeps them optional in `create(...)` input while still treating the stored
value as required for projected entities and query results. Those fields can still accept explicit
create-time values when callers need deterministic imports or bootstrap-owned records.

## Current Runtime Invariants

The runtime pass in `validateGraphStore(...)` currently checks things the field/type layers cannot know in isolation:

- required and cardinality constraints against current store state
- enum membership using resolved allowed ids
- entity-reference integrity
- `core:predicate.range` is allowed to point at a type id that is not locally bootstrapped yet;
  if that target exists locally it must still be a `core:type` node
- node typing via `core:node:type`
- delete safety against remaining references

The code also rejects missing or wrong-type mutation targets before commit.

## Current Authoritative Lifecycle

Validation is also enforced at sync boundaries:

- `validateAuthoritativeTotalSyncPayload(...)` validates total payload shape plus resulting graph state
- `validateAuthoritativeGraphWriteTransaction(...)` validates authoritative transactions on a cloned store
- `validateAuthoritativeGraphWriteResult(...)` validates authoritative write results before reconcile

That keeps local optimistic mutation and authoritative reconciliation on one issue/result model.

## Current Result Surface

`GraphValidationResult` and `GraphValidationError` are defined in
`../../src/graph/runtime/client-core.ts` and re-exported through
`../../src/graph/runtime/client.ts` as the shared public-facing shape:

- `ok`
- `phase`
- `event`
- `value`
- `changedPredicateKeys`
- `issues[]` when invalid

Issues currently carry:

- `source`
- `code`
- `message`
- `path`
- `predicateKey`
- `nodeId`

## Roadmap

- async or server-only validation stages are not implemented
- there is no separate policy/ACL validation layer yet
- validation results are structured, but the package does not yet ship richer developer tooling around them

## Future Work Suggestions

1. Add a compact matrix mapping each mutation API to its validation path and returned result type.
2. Add regression tests for the most important shared-local-vs-authoritative parity cases.
3. Document which validation codes are intended to be stable for UI consumption.
4. Document when `createOptional: true` is appropriate beyond timestamps and managed ids.
5. Capture how async or authority-only validation would layer onto the current synchronous result surface.
