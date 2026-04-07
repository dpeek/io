---
name: Graph surface record surfaces
description: "Readonly record-surface binding and ObjectView adaptation in @io/graph-surface."
last_updated: 2026-04-03
---

# Graph surface record surfaces

## Read this when

- you are changing `resolveRecordSurfaceBinding(...)`
- you need to understand how authored record surfaces become readonly runtime
  bindings
- you are migrating older `ObjectViewSpec` metadata into record surfaces

## Main source anchors

- `../src/record-surface.ts`: binding and `ObjectViewSpec` adaptation
- `../src/record-surface.test.ts`: happy-path and failure examples
- `../src/react-dom/record-surface-mount.tsx`: current browser shell

## What this layer owns

- readonly record-surface binding over field-value lookups
- related collection resolution for record surfaces
- compatibility adaptation from `ObjectViewSpec` to `RecordSurfaceSpec`

It does not own edit-session orchestration or authoritative command execution.

## Lookup model

`resolveRecordSurfaceBinding(...)` depends on `RecordSurfaceLookup`:

- required `getFieldValue(path)`
- optional `getCollectionSurface(key)`

The binding layer reads:

- title field
- subtitle field
- section fields
- related collection surfaces

All of that is lookup-driven. The package does not assume one graph client or
one persistence model.

## Binding result

On success, the binding includes:

- the authored surface
- resolved section field bindings
- resolved related collection bindings
- title and subtitle values when authored
- `commandSurfaces`

Field binding behavior:

- `label` falls back to the field path when the authored field omitted one
- `span` is preserved when present
- field values are whatever the lookup returns

## Failure model

The record binding returns explicit issues for expected integration failures.

Current issue codes are:

- `field-read-failed`
- `related-collection-lookup-missing`
- `related-collection-missing`

Field read failures include the surface key, field path, and original error
message when available.

## Related collections

Related content in record surfaces is deliberately indirect.

The authored record surface only names a related collection key. The runtime
then resolves that key through `lookup.getCollectionSurface(...)`.

That keeps authored record layout separate from collection-surface runtime
details.

## `ObjectViewSpec` adaptation

`adaptObjectViewToRecordSurface(...)` is the compatibility bridge for older
authored layout data.

Current mapping:

- `view.commands` -> `commandSurfaces`
- `view.entity` -> `subject`
- `view.titleField` -> `titleField`
- `view.subtitleField` -> `subtitleField`
- `view.sections` -> `sections`
- `view.related` -> `related`, but only when
  `mapRelatedCollectionKey(...)` resolves a collection key

The adapter intentionally drops related items it cannot map.

## Practical rules

- Treat record surfaces here as readonly runtime bindings.
- Keep authored metadata ownership in `@io/graph-module`.
- Use `adaptObjectViewToRecordSurface(...)` as a migration bridge, not as a
  place to keep both models alive forever.
