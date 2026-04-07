---
name: Graph query editor
description: "Editor catalog, draft lifecycle, serialization, normalization, and hydration boundaries in @io/graph-query."
last_updated: 2026-04-02
---

# Graph query editor

## Read this when

- you are changing the query-editor draft model or surface catalog
- you need to understand how authoring data becomes `SerializedQueryRequest`
- you are debugging unsupported field kinds, hydration failures, or parameter validation

## Main source anchors

- `../src/query-editor.ts`: draft model, validation, serialization, normalization, and hydration
- `../src/query-editor-catalog.ts`: installed-surface to editor-surface mapping
- `../src/query-editor-value-semantics.ts`: field-kind support and literal coercion
- `../src/query-editor.test.ts`: supported families, parameter-backed filters, and exclusion coverage
- `./query-stack.md`: broader saved-query and editor product model

## What this layer owns

- the React-free authoring surface for installed query surfaces
- draft state for filters, sorts, parameters, and pagination
- validation before serialization
- serialization and normalization back through `@io/graph-client`
- hydration from serialized requests back into an editable draft

It does not own saved-query persistence, preview execution, or browser widgets.

## Supported authoring boundary

- the editor only hydrates and serializes `collection` and named `scope` queries
- unsupported field kinds stay explicit through `describeQueryEditorSurfaceAuthoringExclusions(...)`
- the first authoring surface excludes list-valued predicate families instead of trying to coerce them into weak generic controls

Field kinds are intentionally collapsed into a smaller control set:

- `enum`
- `entity-ref`
- `date`
- `boolean`
- `text`
- `number`

That is why value families such as `percent` map to number controls while families such as `url`, `duration`, `money`, `quantity`, `range`, and `rate` currently reuse text controls.

## Draft lifecycle

- `createQueryEditorDraft(...)` starts from one selected surface
- filters, sorts, and parameters keep UI-local draft ids
- `validateQueryEditorDraft(...)` reports structured issues instead of throwing for expected authoring errors
- `serializeQueryEditorDraft(...)` emits `QueryParameterDefinition[]` plus one `SerializedQueryRequest`
- `normalizeQueryEditorDraft(...)` runs the serialized request back through `normalizeSerializedQueryRequest(...)`

Parameter-backed filters are first-class. They survive round-trip hydration and later feed saved-query defaults or runtime overrides.

## Hydration rules

- collection hydration resolves `surfaceId` from `query.indexId`
- scope hydration resolves `surfaceId` from `query.scopeId`
- missing surfaces, unsupported query kinds, or currently excluded surfaces throw `QueryEditorHydrationError`

This is deliberate. A stale or unsupported surface should not hydrate into a partially wrong editor state.

## Practical rules

- Keep the editor catalog derived from installed surfaces; do not invent a second surface-authoring shape.
- Keep unsupported field kinds explicit and fail closed.
- Keep the root editor model UI-framework-free. Browser ergonomics belong on `react-dom`.
