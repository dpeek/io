---
name: Graph client refs
description: "Entity refs, predicate refs, field-group traversal, and mutation ergonomics in @io/graph-client."
last_updated: 2026-04-03
---

# Graph client refs

## Read this when

- you are changing `EntityRef`, `PredicateRef`, or `FieldGroupRef`
- you need to understand how typed local mutation hangs off refs
- you are debugging subscriptions, nested field groups, or relationship lookup behavior

## Main source anchors

- `../src/core.ts`: ref types, field-group helpers, and public value typing
- `../src/refs.ts`: runtime ref construction and mutation methods
- `../src/graph.ts`: entity-ref caching and type-handle integration
- `../../graph-surface/doc/ui-stack.md`: broader cross-package refs and adapter boundary

## Ref model

- `EntityRef` is the stable typed handle for one entity id and one entity definition
- `PredicateRef` is one typed handle for one `(subjectId, predicateId)` slot
- `FieldGroupRef` preserves nested traversal shape for grouped authored fields

Refs are stable handles over one store plus one resolved schema namespace. They are not detached snapshots.

## Predicate behavior

Every predicate ref exposes:

- `get()`
- `subscribe()`
- `batch()`
- `resolveEntity()` and `listEntities()` when the range is an entity type

Cardinality widens the mutation surface:

- `many`: `replace`, `add`, `remove`, `clear`
- `one?`: `set`, `clear`
- `one`: `set`

Validation variants such as `validateReplace()` and `validateSet()` return structured mutation validation results instead of throwing.

## Field groups

- nested authored field trees stay nested at runtime
- field groups are not their own reactive unit; they are traversal helpers that expose nested predicate refs
- `fieldGroupKey()`, `fieldGroupId()`, `fieldGroupPath()`, and `fieldGroupSubjectId()` are the stable inspection helpers for those refs

## Subscription semantics

- predicate subscriptions are keyed to one predicate slot in the underlying store
- refs suppress logically unchanged notifications by comparing decoded logical values, not just raw edge churn
- `batch()` delegates to the underlying store batch path so callers can coalesce multi-step updates

## Mutation ergonomics

- refs do not commit blind writes; they route through the same validation and entity-action paths used by type handles
- entity refs expose `update`, `delete`, and `batch`
- predicate refs expose cardinality-aware mutation helpers

This is why synced clients can wrap the same handles instead of inventing a second local graph API.

## Practical rules

- Keep traversal shape and validation behavior aligned with the authored field tree.
- Use the field-group helpers instead of re-deriving path or subject information from private metadata.
- Do not turn refs into detached value containers; they should remain live handles over the current store.
- If a UI layer needs richer widgets or async search, build that above these refs rather than inside them.
