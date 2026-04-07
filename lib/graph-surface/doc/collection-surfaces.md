---
name: Graph surface collection surfaces
description: "Collection-surface binding and query-container runtime behavior in @io/graph-surface."
last_updated: 2026-04-03
---

# Graph surface collection surfaces

## Read this when

- you are changing `resolveCollectionSurfaceBinding(...)`
- you need to understand how authored collection surfaces become query
  containers
- you are wiring saved queries, saved views, or installed query-surface
  registries into the shared surface runtime

## Main source anchors

- `../src/collection-surface.ts`: binding, renderer selection, and runtime
  helpers
- `../src/collection-surface.test.ts`: field fallback and renderer examples
- `../../../lib/graph-query/README.md`: underlying query-container runtime
- `../../graph-query/doc/query-stack.md`: cross-package query ownership

## What this layer owns

- collection-surface binding over authored `CollectionSurfaceSpec`
- saved-query and saved-view compatibility checks
- renderer binding for the current collection surface presentations
- the route-neutral runtime wrapper over `@io/graph-query`

It does not own authored `CollectionSurfaceSpec` metadata or query execution
contracts themselves.

## Source support

The current collection runtime is intentionally narrow.

Current behavior:

- only `collection.source.kind === "query"` is supported
- the authored source must resolve to one saved query
- an optional saved view may refine the container spec

Other source kinds fail closed with `unsupported-source-kind`.

## Binding flow

`resolveCollectionSurfaceBinding(...)` resolves one authored collection surface
in this order:

- load the saved query through `lookup.getSavedQuery(...)`
- derive or accept a query editor catalog
- validate the saved query against installed surface metadata
- resolve the installed query surface from the registry
- resolve renderer compatibility for that installed surface
- optionally load and validate the saved view
- build one query-container spec
- validate the final container spec against renderer capabilities

The returned binding preserves:

- the authored collection
- the saved query
- the installed query surface
- the query-container spec
- the renderer compatibility metadata
- the validation result
- the saved view, when one was used

## Binding issue model

The binding layer returns explicit issues instead of throwing for expected
integration failures.

Current issue codes include:

- `unsupported-source-kind`
- `saved-query-missing`
- `query-surface-missing`
- `query-surface-renderers-missing`
- `saved-view-resolver-missing`
- `saved-view-missing`
- `unknown-presentation-field`
- `unsupported-presentation-kind`
- `invalid-container`
- compatibility pass-through codes such as stale or incompatible saved query or
  saved view metadata

## Presentation field selection

The package chooses renderer fields in a fixed order.

Rules:

- use authored `collection.presentation.fields` first when present
- otherwise use default-selected query-surface selections
- otherwise use all query-surface selections
- otherwise fall back to ordering fields, then filter fields not already used

If the installed query surface exposes field metadata and the authored surface
references an unknown field id, the binding fails closed.

## Supported presentations

The current renderer binding supports:

- `list`
- `table`
- `card-grid`

`board` is still unsupported in this runtime.

Renderer details:

- list and card-grid infer title and description fields from common ids such as
  `title`, `name`, and `label`
- table columns infer alignment from field kind
- boolean columns center
- date and numeric families end-align

## Saved query versus saved view

Without a saved view, the runtime creates a default query container:

- `containerId` derived from the collection surface key
- paged pagination
- page size from `querySurface.defaultPageSize` or `25`
- manual refresh
- renderer derived from the authored presentation

With a saved view, the runtime reuses the view's pagination, params, refresh,
and renderer metadata after compatibility validation.

## Runtime helpers

The package also owns the route-neutral runtime wrappers:

- `createCollectionSurfaceSourceResolver(...)`
- `createCollectionSurfaceRuntime(...)`

Default behavior:

- source resolution delegates to `createSavedQuerySourceResolver(...)`
- page execution delegates to `requestSerializedQuery(...)`

That keeps the package host-neutral while still shipping a practical default
browser path.

## Practical rules

- Treat collection surfaces here as query-container assembly, not as authored
  metadata ownership.
- Pass an installed query-surface registry whenever possible.
- Expect the current runtime to fail closed on unsupported presentation or
  source shapes instead of inventing fallback behavior.
