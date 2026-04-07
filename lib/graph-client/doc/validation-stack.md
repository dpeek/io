---
name: Graph validation stack
description: "Cross-package ownership for local mutation validation, authoritative apply validation, and sync-boundary validation centered on @io/graph-client."
last_updated: 2026-04-03
---

# Graph validation stack

## Read this when

- the question spans authored field or type rules, local typed mutations,
  authoritative apply, or sync-boundary validation
- you need the shared validation boundary before changing mutation or apply
  code
- you want the owning package doc before editing a validation-related area

## Main source anchors

- `../src/core.ts`: public validation issue, result, and error contracts
- `../src/validation.ts`: store-dependent runtime validation
- `../src/entity-actions.ts`: local mutation lifecycle before commit
- `../../graph-authority/src/validation.ts`: authoritative transaction,
  write-result, and total-payload validation
- `../../graph-sync/src/validation.ts`: sync payload normalization and
  incremental apply validation
- `../../graph-module/src/type.ts`: shared field authoring helpers and
  type-local metadata contracts
- `../../graph-module-core/src/core/node.ts`: current built-in lifecycle hooks
  and `createOptional` usage in the core module
- `../../graph-module-workflow/src/type.ts`: workflow-owned field validators
  and lifecycle hooks above the shared package layer

## What this doc owns

- the cross-package ownership map for the shipped validation stack
- stable seams between authored value rules, local mutation validation,
  authoritative apply validation, and sync-boundary payload validation
- redirects to the package-local docs that own current runtime behavior

It does not own async provider checks, auth-session policy, or host-specific
form UX.

## Current ownership

- scalar and enum families own reusable value semantics
- field definitions own predicate-specific invariants and lifecycle hooks
- `@io/graph-client` owns the public validation result surface, local mutation
  precheck, and store-dependent runtime validation for local or browser-facing
  clients
- `@io/graph-authority` owns authoritative transaction, write-result, and
  total-payload validation against authoritative state
- `@io/graph-sync` owns sync-payload normalization and incremental-apply
  validation over shared sync contracts
- host runtime code owns async or provider-specific checks that depend on
  request context or external systems

## Stable contracts

### Three-layer validation split

The validation split is deliberate:

- scalar and enum families own reusable value semantics
- field definitions own predicate-local invariants
- runtime validation owns store-dependent graph invariants

Add issue codes at the layer that actually owns the rule. Do not duplicate the
same invariant across layers unless a boundary truly requires revalidation.

### Local mutation lifecycle

Typed local mutations follow one shared path:

1. normalize and clone caller input
2. run `onCreate` or `onUpdate` lifecycle hooks
3. validate scalar and enum semantics
4. validate field-local rules
5. simulate the post-mutation graph on a cloned store
6. run `validateGraphStore(...)`
7. commit only if the shared result is valid

That lifecycle is the compatibility seam for type handles, entity refs, and
predicate refs. When mutation APIs change, keep them aligned with this shared
path instead of introducing parallel validation flows.

### Shared result surface

`@io/graph-client` owns the public validation result model reused across local
and authoritative boundaries:

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

Expected user-facing failures should return structured results. Throwing is for
API boundaries that assert or apply validity.

### Runtime invariants versus authority invariants

`validateGraphStore(...)` owns the graph-state checks that field or type layers
cannot know in isolation:

- required and cardinality constraints against current store state
- enum membership
- entity-reference integrity
- node typing through `core:node:type`
- delete safety against remaining references
- the special `core:predicate.range` rule for not-yet-bootstrapped type ids

Authority still revalidates on cloned authoritative state before accepting a
write. A successful local precheck is not authoritative success.

### Sync-boundary validation

Sync validation stays transport-shaped:

- total payloads are validated before bootstrap or recovery apply
- incremental results are validated before reconcile
- authoritative write results are validated before client-side replay or
  acknowledgement handling

`@io/graph-sync` owns payload normalization and apply preconditions. It does
not own field-level schema semantics.

### Lifecycle-managed required fields

`createOptional: true` is the main explicit exception in the create-time input
contract:

- the stored field remains required
- create-call input may omit it
- the managed lifecycle is expected to populate it before the record is treated
  as valid projected graph state

That setting belongs with the field owner, not with sync or authority.

## Where current details live

- `./validation.md`: local validation lifecycle, runtime invariants, and
  result surfaces
- `./synced-client.md`: pending-write replay and client reconcile on top of
  shared validation results
- `../../graph-authority/doc/write-session.md`: authoritative apply, replay,
  and total-payload creation
- `../../graph-sync/doc/validation.md`: sync-payload normalization and
  incremental apply rules
- `../../graph-react/doc/edit-sessions-and-validation.md`: host-neutral
  validation issue mapping and edit-session behavior
- `../../graph-module/doc/type-modules.md`: type-module value and filter
  contracts
- `../../graph-module/doc/reference-and-secret-fields.md`: shared field
  authoring helpers that shape validation expectations

## Related docs

- `../../graph-sync/doc/sync-stack.md`: sync, recovery, and replay boundaries
- `../../graph-query/doc/query-stack.md`: serialized queries and
  `projection-stale` recovery above synced clients
- `../../graph-module/doc/module-stack.md`: built-in module ownership

Keep this doc narrow. Current-state package behavior belongs in the package docs
listed above.
