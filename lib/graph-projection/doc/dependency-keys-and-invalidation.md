---
name: Graph projection dependency keys and invalidation
description: "Dependency keys, invalidation events, and target matching in @io/graph-projection."
last_updated: 2026-04-03
---

# Graph projection dependency keys and invalidation

## Read this when

- you are changing dependency key construction
- you need to understand invalidation event compatibility rules
- you are wiring live refresh or retained rebuild fan-out

## Main source anchors

- `../src/index.ts`: dependency-key and invalidation helpers
- `../src/index.test.ts`: dependency-key and invalidation examples
- `../../graph-sync/doc/sync-stack.md`: cross-package live refresh and scoped sync flow

## What this layer owns

- the shared dependency-key vocabulary
- key normalization helpers
- invalidation event and target contracts
- event-to-target compatibility matching

It does not own event transport, event queues, or live router persistence.

## Dependency key model

Supported kinds are:

- `predicate`
- `projection`
- `scope`
- `shard`

`DependencyKey` is always canonical `<kind>:<value>` text.

Helper surface:

- `createDependencyKey(...)`
- `createPredicateDependencyKey(...)`
- `createProjectionDependencyKey(...)`
- `createScopeDependencyKey(...)`
- `createShardDependencyKey(...)`
- `isDependencyKey(...)`

Important behavior:

- helpers accept either a raw value or an already-prefixed value
- the returned key always preserves the requested prefix
- empty values and unknown prefixes fail validation

## Why the keys are coarse

Dependency keys are conservative invalidation units.

That means:

- false positives are acceptable
- false negatives are not

The package is designed for safe over-invalidation rather than exact minimal
change sets.

## Invalidation events

`InvalidationEvent` carries:

- stable event identity
- graph id
- source cursor
- dependency keys
- optional affected projection ids
- optional affected scope ids
- delivery metadata

Supported delivery kinds are:

- `cursor-advanced`
- `scoped-delta`

`cursor-advanced` is a freshness signal to re-pull. `scoped-delta` is reserved
for deterministic local merge contracts.

## Validation rules

`defineInvalidationEvent(...)` is fail-closed.

Important behavior:

- event id, graph id, and source cursor must be non-empty
- dependency keys must be non-empty, unique, and valid
- affected projection ids and scope ids must be non-empty and unique when
  provided
- `scoped-delta` must include a non-empty `scopeId` and `deltaToken`
- when `delivery.kind === "scoped-delta"`, `affectedScopeIds` must include the
  delivered `scopeId`

## Target matching

`isInvalidationEventCompatibleWithTarget(...)` matches in two ways:

- direct scope hit when the target `scopeId` appears in `affectedScopeIds`
- otherwise by any overlapping dependency key

That lets callers use explicit scope routing when available without giving up
the coarser dependency-key fallback.

## Practical rules

- Use dependency keys as stable families, not as exact row ids unless that is
  truly the family you want to invalidate.
- Treat invalidation events as freshness signals, not as authoritative change
  logs.
- Keep transport and queue semantics outside this package.
