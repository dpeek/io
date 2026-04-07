---
name: Graph query installed surfaces
description: "Installed query-surface registry, renderer compatibility, and editor-catalog projection in @io/graph-query."
last_updated: 2026-04-02
---

# Graph query installed surfaces

## Read this when

- you are changing installed query-surface registry behavior
- you need to understand how module catalogs become one installed runtime
- you are tracing renderer compatibility or query-editor catalog projection

## Main source anchors

- `../src/query-surface-registry.ts`: installed surface registry and renderer compatibility projection
- `../src/query-editor-catalog.ts`: installed-surface to query-editor catalog mapping
- `../src/query-surface-registry.test.ts`: duplicate-id and compatibility coverage
- `../../app/src/web/lib/query-surface-registry.ts`: app-owned activation and built-in catalog composition
- `./query-stack.md`: broader cross-package query ownership

## What this layer owns

- flattening installed module query-surface catalogs into one runtime registry
- attaching `moduleId`, `catalogId`, and `catalogVersion` to each installed surface
- the smaller renderer-compatibility contract consumed by query containers and saved views
- projecting installed surfaces into the query-editor catalog

It does not own manifest activation, built-in module selection, or module-authored query-surface specs themselves.

## Registry semantics

- installed catalogs must be non-empty
- `catalogId` values must be non-empty and unique across the installed set
- `surfaceId` values must be non-empty and unique across the installed set
- the registry exposes `catalogs`, flattened `surfaces`, and `surfaceById`

The uniqueness rule is fail-closed on purpose. Once surfaces are installed, `surfaceId` is the runtime identity used by saved queries, query execution, and browser bindings.

## Renderer compatibility projection

`createQuerySurfaceRendererCompatibility(...)` keeps only the container-facing compatibility data:

- `compatibleRendererIds`
- `queryKind`
- `resultKind`
- optional `sourceKinds`
- optional `itemEntityIds`
- `surfaceId`
- `surfaceVersion`

That smaller contract is what query-container validation and saved-view compatibility should depend on. They do not need the whole module catalog shape.

## Editor-catalog projection

`createQueryEditorCatalogFromInstalledSurfaces(...)` converts installed surfaces into authoring surfaces:

- filter field kinds are mapped to editor controls through `query-editor-value-semantics.ts`
- installed catalog metadata stays attached so saved-query compatibility can compare current and stored versions later
- the result stays React-free and can be used by root helpers or `react-dom`

## Practical rules

- Keep installed runtime metadata attached to surfaces all the way through the editor and saved-query layers.
- Fail closed on duplicate or blank ids instead of letting ambiguity leak into execution or persistence.
- Keep activation-driven composition in app code. The generic installed-surface runtime belongs here.
