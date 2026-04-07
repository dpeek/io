---
name: Graph surface record surfaces
description: "Readonly record-surface binding and ObjectView adaptation in @io/graph-surface."
last_updated: 2026-04-07
---

# Graph surface record surfaces

## Read this when

- you are changing `resolveRecordSurfaceBinding(...)`
- you need to understand how authored record surfaces become readonly runtime
  bindings
- you are migrating older `ObjectViewSpec` metadata into record surfaces
- you need the boundary between readonly record surfaces and the higher-level
  app-owned entity surface

## Main source anchors

- `../src/record-surface.ts`: binding and `ObjectViewSpec` adaptation
- `../src/record-surface.test.ts`: happy-path and failure examples
- `../src/react-dom/record-surface-mount.tsx`: current browser shell

## What this layer owns

- readonly record-surface binding over field-value lookups
- shared section shell chrome plus simple one- or two-column field layout
- related collection resolution for record surfaces
- compatibility adaptation from `ObjectViewSpec` to `RecordSurfaceSpec`

It does not own edit-session orchestration or authoritative command execution.
It also does not own product-facing row policy, draft flows, or validation
presentation for interactive entity screens.

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

## Boundary above this layer

`RecordSurfaceSpec` is still the durable authored contract. It names fields,
sections, title or subtitle lookups, and related collection keys. This package
binds that structure to readonly values through `RecordSurfaceLookup`.

Interactive entity screens sit above that layer in `@io/app`:

- app-owned surfaces resolve live predicate refs or draft fields, rather than
  routing edit behavior through `resolveRecordSurfaceBinding(...)`
- app-owned row planning decides title, body, meta, or hidden roles plus label
  and validation chrome
- app-owned validation models cover row-local mutation failures, submit-time
  draft failures, and non-field summary issues

The intended adapter path is to consume `RecordSurfaceSpec` as authored section
metadata, then map those field paths into app-owned row plans. Do not widen the
authored contract with host policy such as `name` promotion, `id` hiding, or
explicit `view | edit` mode.

## Practical rules

- Treat record surfaces here as readonly runtime bindings.
- Prefer host-supplied `renderField(...)` or the `columns` option when a
  product surface needs different row chrome or single-column density without
  forking the shared section shell.
- Keep `RecordSurfaceSpec` narrow. Use it for authored structure, not for
  app-specific interactive policy.
- Reuse `RecordSurfaceLayout` or `RecordSurfaceSectionView` chrome from app
  when helpful, but keep edit and validation ownership outside this package.
- Keep authored metadata ownership in `@io/graph-module`.
- Use `adaptObjectViewToRecordSurface(...)` as a migration bridge, not as a
  place to keep both models alive forever.

## Related docs

- [`../../app/doc/entity-surface.md`](../../app/doc/entity-surface.md):
  app-owned interactive entity-surface family above this readonly layer
