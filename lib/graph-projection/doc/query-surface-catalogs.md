---
name: Graph projection query surface catalogs
description: "Bounded query-surface metadata and validation rules in @io/graph-projection."
last_updated: 2026-04-03
---

# Graph projection query surface catalogs

## Read this when

- you are changing module-authored query-surface metadata
- you need to understand what `defineModuleQuerySurfaceSpec(...)` validates
- you are wiring editor, planner, or renderer compatibility to installed surface metadata

## Main source anchors

- `../src/index.ts`: query-surface field, renderer, surface, and catalog contracts
- `../src/index.test.ts`: query-surface catalog examples and failure cases
- `../../graph-query/doc/query-stack.md`: cross-package query ownership and execution flow

## What this layer owns

- bounded query-surface metadata contracts
- validation and freezing for surface specs and catalogs
- renderer compatibility metadata shared across editor, planner, and host UI

It does not own query execution, renderer implementation, or browser editing UI.

## Surface metadata model

`ModuleQuerySurfaceSpec` is one installed bounded surface.

It owns:

- stable identity through `surfaceId` and `surfaceVersion`
- user-facing label and optional description
- query kind
- source contract
- optional filters, ordering, selections, parameters, and renderer metadata
- optional default page size

Compatibility rule:

- `surfaceVersion` is the compatibility boundary for saved queries, editor
  assumptions, and renderer bindings

## Source and query-kind rules

The package validates query kind against source kind.

Rules:

- `queryKind: "collection"` must use `source.kind: "projection"`
- `queryKind: "scope"` must use `source.kind: "scope"`
- scope surfaces must not declare filters or ordering

The helper fails closed when those combinations drift.

## Field and parameter metadata

The surface helpers normalize and freeze:

- filter fields
- order fields
- selectable fields
- parameters
- renderer metadata

Important behavior:

- ids and names must be non-empty and unique within their section
- empty sections are rejected when provided
- filter operators must be non-empty and valid `@io/graph-client` operators
- order directions must be valid `@io/graph-client` directions
- parameter types must be valid `@io/graph-client` parameter types
- option lists must use unique non-empty values

That keeps the catalog contract aligned with the shared query transport surface.

## Renderer metadata

`QuerySurfaceRendererSpec` declares compatibility, not implementation.

It describes:

- `compatibleRendererIds`
- `resultKind`
- optional `sourceKinds`
- optional `itemEntityIds` support

The package validates known values and freezes the metadata. It does not choose
one renderer for you.

## Catalog rules

`ModuleQuerySurfaceCatalog` is one installable bundle of surfaces.

Important behavior:

- `catalogId`, `catalogVersion`, and `moduleId` must be non-empty
- `surfaces` must not be empty
- `surfaceId` values must be unique within the catalog

Compatibility rule:

- `catalogVersion` is the group-level compatibility boundary across the shipped
  set of surfaces

## Practical rules

- Change `surfaceVersion` when one surface changes incompatibly.
- Change `catalogVersion` when the installed surface bundle changes
  incompatibly as a group.
- Keep execution logic and renderer code outside this package. This package
  only owns the shared metadata contract.
