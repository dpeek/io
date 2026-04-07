---
name: Graph query react dom
description: "Browser query editor, default renderers, and shared query-container chrome in @io/graph-query/react-dom."
last_updated: 2026-04-02
---

# Graph query react dom

## Read this when

- you are changing `@io/graph-query/react-dom`
- you need to understand how the root query runtime is mounted in the browser
- you are debugging default renderer ids, shared chrome, or query-editor UI behavior

## Main source anchors

- `../src/react-dom/index.ts`: curated browser entrypoint
- `../src/react-dom/query-editor-component.tsx`: browser query editor
- `../src/react-dom/query-container-surface.tsx`: shared container chrome
- `../src/react-dom/query-container-mount.tsx`: mount wrapper
- `../src/react-dom/query-renderers.tsx`: built-in renderers and capability registry
- `../src/react-dom/query-editor-predicate-field.tsx`: bridge to shared field editors

## What this layer owns

- the browser `QueryEditor` component
- `QueryContainerSurface` and `QueryContainerMount`
- the built-in default renderer registry
- binding helpers for the default list, table, and card-grid renderers
- the renderer capability map consumed by validation and saved-view compatibility

It does not own the generic query runtime semantics from the package root.

## Query editor component

`QueryEditor` is a browser consumer of the root draft model:

- it renders surface selection, filters, sorts, parameters, and pagination
- it shows validation issues from `validateQueryEditorDraft(...)`
- it previews the normalized serialized request when the draft is valid
- it reuses `QueryEditorPredicateField` so supported single-value field kinds can compose shared `@io/graph-module-core/react-dom` editors instead of inventing a second field system

## Shared query-container chrome

`QueryContainerSurfaceView` and `QueryContainerSurface` wrap the runtime with shared browser chrome for:

- invalid bindings
- loading
- empty results
- runtime errors
- refreshing and stale state
- pagination and refresh controls

`QueryContainerMount` is only the outer section wrapper for title and description. The runtime semantics still live in the root package.

## Built-in renderers

The stable built-in renderer ids are:

- `default:list`
- `default:table`
- `default:card-grid`

`createDefaultListRendererBinding(...)`, `createDefaultTableRendererBinding(...)`, and `createDefaultCardGridRendererBinding(...)` write both the renderer id and the declarative layout definition expected by those built-ins.

`createDefaultQueryRendererRegistry(...)` and `createQueryRendererCapabilityMap(...)` are the bridge back to root-level validation.

## Practical rules

- Keep `react-dom` a thin consumer of the root runtime.
- If renderer ids or capability rules change, update saved-view compatibility and container validation together.
- Keep route shells and page-specific UX above this package.
