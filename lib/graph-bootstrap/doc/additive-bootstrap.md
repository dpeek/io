---
name: Graph bootstrap additive bootstrap
description: "Additive schema materialization semantics in @io/graph-bootstrap."
last_updated: 2026-04-03
---

# Graph bootstrap additive bootstrap

## Read this when

- you are changing `bootstrap(...)`
- you need to understand what facts bootstrap owns
- you are debugging partial schema slices or additive bootstrap passes

## Main source anchors

- `../src/bootstrap.ts`: main additive bootstrap runtime
- `../src/bootstrap-facts.ts`: fact dedupe and managed timestamp helpers
- `../src/schema-tree.ts`: predicate and shape traversal
- `../src/bootstrap.test.ts`: additive icon and reuse coverage
- `../src/index.test.ts`: live-store bootstrap example

## What this layer owns

- additive schema materialization into an existing store
- ordering and traversal over the provided type definitions
- one-time assertion of bootstrap-owned schema facts
- optional managed timestamps for bootstrap-created schema nodes

It does not own retractions, store resets, or schema authoring.

## Additive model

`bootstrap(...)` runs inside `store.batch(...)` and treats the store as
append-oriented state.

Important behavior:

- it snapshots existing facts first through `createBootstrapFacts(...)`
- it only asserts facts that are missing
- it never retracts facts that are already present
- it never rewrites a node just because the current definitions changed

That makes bootstrap safe to run in multiple passes, including core first and
domain modules later.

## Resolution inputs

Bootstrap resolves against more than the immediate `definitions` object.

Inputs:

- `definitions`: the slice being materialized now
- `options.coreSchema`: explicit core contract for partial slices
- `options.availableDefinitions`: extra types available for scalar and icon
  resolution
- `options.timestamp`: canonical timestamp for bootstrap-created nodes

The runtime builds one `resolutionTypeById` map from `availableDefinitions`
plus the ordered bootstrap slice.

## Traversal and ordering

`bootstrap.ts` splits the ordered definitions into:

- entity types
- enum types
- predicates collected from entity field trees
- shape nodes collected from nested field trees

Important rule:

- `compareBootstrapTypeOrder(...)` forces the built-in `core:type` contract to
  materialize before the rest of the type slice

That keeps bootstrap-owned type facts stable when the store is still empty.

## Fact materialization

The package writes a narrow set of bootstrap-owned facts.

For types:

- node timestamps when the subject is new
- `core:key`
- optional `core:name`
- `core:type = core:type`
- optional type icon link when the icon entity exists

For shape nodes:

- shape-node `core:key`

For predicates:

- node timestamps when the subject is new
- `core:key`
- `core:name` from the predicate key
- `core:range`
- `core:cardinality`
- `core:type = core:predicate`
- optional predicate icon link when the icon entity exists

For enum members:

- node timestamps when the member is new
- `core:key`
- optional `core:name`
- optional `core:description`
- `core:type = core:type`
- enum-to-member edge

## Managed timestamps

Managed timestamps are deliberately narrow.

Behavior:

- bootstrap clones `options.timestamp`, or uses the package default timestamp
- timestamps are only written when the core node contract exposes
  `createdAt` and `updatedAt`
- timestamps are only written once for nodes bootstrap creates

Existing schema nodes keep their current timestamp facts.

## Practical rules

- Use bootstrap for additive schema materialization, not schema reconciliation.
- Pass `coreSchema` when the current definitions slice does not include the
  built-in core namespace directly.
- Use `availableDefinitions` when scalar encoding or icon resolution needs
  visibility into types outside the current slice.
