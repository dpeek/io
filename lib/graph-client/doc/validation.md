---
name: Graph client validation
description: "Local validation lifecycle, runtime invariants, and result surfaces in @io/graph-client."
last_updated: 2026-04-03
---

# Graph client validation

## Read this when

- you are changing local typed mutation validation
- you need to understand `GraphValidationResult` or `GraphValidationError`
- you are debugging create, update, or delete failures before sync or authority reconciliation

## Main source anchors

- `../src/validation.ts`: local validation pipeline and runtime invariants
- `../src/core.ts`: public validation result and issue shapes
- `../src/entity-actions.ts`: validation before committed entity changes
- `./validation-stack.md`: broader cross-package validation ownership

## Result surface

`@io/graph-client` owns the shared public validation shape:

- `GraphValidationIssue`
- `GraphValidationResult`
- `GraphValidationError`

Issues carry:

- `source`
- `code`
- `message`
- `path`
- `predicateKey`
- `nodeId`

Sources are `runtime`, `field`, or `type`.

## Local validation lifecycle

Typed local mutations follow one shared pattern:

1. normalize and clone caller input
2. run lifecycle hooks such as `onCreate` or `onUpdate`
3. validate scalar and enum semantics
4. validate field-local rules
5. materialize the post-mutation graph on a cloned store
6. run `validateGraphStore(...)`
7. commit only if the result is valid

The public exported entrypoints are:

- `validateCreateEntity()`
- `validateUpdateEntity()`
- `prepareDeleteEntity()`
- `validateGraphStore()`

## Runtime invariants

`validateGraphStore()` checks graph-state rules that field and type layers cannot know in isolation:

- required and cardinality constraints against current store state
- enum membership
- entity-reference existence and type correctness
- node typing through `core:node:type`
- delete safety against remaining references

It also treats `core:predicate.range` specially: range references may point at not-yet-bootstrapped type ids, but if the target exists locally it must still be a `core:type`.

## Managed-field rules

- typed handles enforce managed node-type expectations
- mutating a field that is treated as managed by the typed handle fails closed
- required fields and `createOptional: true` semantics are distinguished explicitly

`createOptional: true` keeps a required stored field optional at create-call sites while still expecting the managed lifecycle to populate it.

## Practical rules

- Keep local validation synchronous and deterministic inside this package.
- Add issue codes at the layer that actually owns the invariant: scalar or enum family, field, or runtime.
- Prefer returning structured validation results for expected user-facing errors and throwing `GraphValidationError` only at API boundaries that apply or assert validity.
- Keep authority-only or async validation out of this package; that belongs above the client boundary.
