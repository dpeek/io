---
name: Graph module authored contracts
description: "Object-view, record-surface, collection-surface, command-surface, workflow, and command descriptors in @io/graph-module."
last_updated: 2026-04-03
---

# Graph module authored contracts

## Read this when

- you are changing the pure authored contracts in `contracts.ts`
- you need to understand the boundary between durable command descriptors and UI invocation metadata
- you are wiring record, collection, or workflow metadata above schema types

## Main source anchors

- `../src/contracts.ts`: all pure authored surface and command contracts
- `../src/index.typecheck.ts`: compatibility and boundary checks for the authored contracts
- `../../graph-surface/doc/roadmap.md`: broader product-layer design
- `./module-stack.md`: cross-package ownership only

## What this layer owns

- pure object-view, record-surface, collection-surface, workflow, command-surface, and command descriptors
- naming and structural compatibility between older object-view metadata and newer record-surface contracts

It does not own route registration, DOM layout, authoritative command execution, or host runtime state.

## Object versus record surfaces

`ObjectViewSpec` is still the compatibility-oriented record-view contract:

- keyed by `entity`
- sections contain field rows
- related content can point at list, table, or board presentation
- commands are still raw command keys

`RecordSurfaceSpec` is the preferred newer contract:

- keyed by `subject`
- section and field shapes stay aligned with `ObjectViewSpec`
- related content points at reusable collection-surface keys
- command affordances point at `GraphCommandSurfaceSpec` keys

That alignment is deliberate. Existing layout data can migrate without reshaping every section and field row first.

## Collection surfaces

`CollectionSurfaceSpec` is a pure authored contract over one durable source:

- `entity-type`
- `relation`
- `query`

Presentation hints stay narrow:

- `list`
- `table`
- `board`
- `card-grid`

This package only owns the metadata. Query execution, selection state, and browser mounting live later in the stack.

## Commands versus command surfaces

`GraphCommandSpec` owns:

- stable command identity
- execution mode: `localOnly`, `optimisticVerify`, or `serverOnly`
- input and output shape
- optional policy

`GraphCommandSurfaceSpec` owns:

- human-facing label and icon overrides
- subject model
- input presentation
- submit behavior
- post-success behavior

The split is enforced on purpose. The typecheck file explicitly rejects UI invocation metadata on `GraphCommandSpec`.

## Workflow contract

`WorkflowSpec` stays keyed to compatibility-era ids:

- workflow steps may reference `objectView`
- workflow steps may reference `command`

The typecheck file also enforces that workflow steps do not yet switch to `recordSurface`. That compatibility seam is still current.

## Practical rules

- Keep every contract here pure data.
- Put execution and policy on `GraphCommandSpec`.
- Put dialog, sheet, confirmation, and post-success UI on `GraphCommandSurfaceSpec`.
- Prefer `RecordSurfaceSpec` for new authored record surfaces, but keep `ObjectViewSpec` compatibility in mind when migrating older metadata.
