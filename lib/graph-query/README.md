# Graph Query

`@io/graph-query` owns the shared query runtime above authored module query
surfaces and below route-local UI shells.

It includes the installed query-surface registry, query editor model, saved
query and saved view helpers, query executor registry, query-container runtime,
route-neutral workbench helpers, and the browser `react-dom` bindings for the
shared query UI.

## Read This First

- Start with `./out/index.d.ts` for the compact public contract.
- Use the package-adjacent docs below for package-specific semantics.
- Read `./src/index.ts` for the React-free root surface.
- Read `./src/react-dom/index.ts` for the browser entrypoint.
- Read one nearby `./src/*.test.ts` or `./src/react-dom/*.test.tsx` file for
  concrete behavior.

## Package Docs

These are the canonical agent docs for package-specific behavior in
`@io/graph-query`.

- [`./doc/query-stack.md`](./doc/query-stack.md): cross-package ownership for transport, installed surfaces, durable saved queries, executor routing, and stale recovery
- [`./doc/installed-surfaces.md`](./doc/installed-surfaces.md): installed query-surface registry, renderer compatibility, and editor-catalog projection
- [`./doc/executor-registry.md`](./doc/executor-registry.md): installed-surface to executor resolution and fail-closed version checks
- [`./doc/query-editor.md`](./doc/query-editor.md): editor catalog, draft lifecycle, serialization, normalization, and hydration limits
- [`./doc/saved-queries.md`](./doc/saved-queries.md): graph-backed saved-query or saved-view records, compatibility, and source resolution
- [`./doc/query-container.md`](./doc/query-container.md): container spec, validation, cache identity, runtime state, and stale recovery
- [`./doc/query-workbench.md`](./doc/query-workbench.md): route-neutral draft hydration, browser storage, preview runtime, and save helpers
- [`./doc/react-dom.md`](./doc/react-dom.md): browser query editor, default renderers, and shared query-container chrome

Cross-package query architecture now lives in `./doc/query-stack.md`,
`../graph-sync/doc/sync-stack.md`, and `../graph-surface/doc/ui-stack.md`.
Start here when the question is local to this package. Jump to the broader
root graph docs when the question crosses package, module, or app boundaries.

## What It Owns

- installed query-surface registry and editor-catalog projection
- query editor catalog, draft model, serialization, normalization, and hydration
- graph-backed saved-query and saved-view repository helpers
- installed-surface to executor resolution
- query-container validation, cache-keying, runtime state, and stale recovery
- route-neutral query-workbench helpers and browser-safe stores
- browser `react-dom` mounts, query editor, and default renderer registry

## What It Does Not Own

- serialized-query transport contracts or HTTP request helpers
- module-authored query-surface catalogs or executor registrations
- graph-native saved-query schema definitions
- app-specific route parsing, activation-driven catalog composition, or page shells
- authoritative query execution, projection storage, or live invalidation routing

## Important Semantics

- The root package stays React-free. Browser components live on
  `@io/graph-query/react-dom`.
- Installed query-surface registries fail closed on empty or duplicate
  `catalogId` and `surfaceId` values.
- The editor only hydrates and serializes collection and named-scope surfaces.
  Unsupported field kinds stay explicit and block authoring.
- Saved-query compatibility is keyed by installed catalog and surface metadata:
  `catalogId`, `catalogVersion`, `surfaceId`, and `surfaceVersion`.
- Query-container cache identity is derived from the resolved request,
  parameter definitions, execution context, and saved-source cache key. It is
  not keyed by renderer choice.
- Pagination stale recovery is explicit. `projection-stale` resets to the first
  page or refreshes from it; it does not silently continue.

## Entrypoints

- `@io/graph-query`
- `@io/graph-query/react-dom`

## Public API

The root entrypoint from `./src/index.ts` exports:

- installed query-surface helpers: `createInstalledQuerySurfaceRegistry`,
  `getInstalledQuerySurface`, `createQuerySurfaceRendererCompatibility`,
  `createQueryEditorCatalogFromRegistry`
- query editor helpers: `createQueryEditorCatalog`, `createQueryEditorDraft`,
  `hydrateQueryEditorDraft`, `serializeQueryEditorDraft`,
  `normalizeQueryEditorDraft`, `validateQueryEditorDraft`
- saved-query helpers: `createSavedQueryRepositoryFromGraph`,
  `createSavedQuerySourceResolver`, `resolveSavedQuery`, `resolveSavedView`,
  `validateSavedQueryCompatibility`, `validateSavedViewCompatibility`
- executor routing helpers: `createQueryExecutorRegistry`,
  `resolveCollectionQueryExecutor`, `resolveScopeQueryExecutor`
- query-container helpers: `createInlineQueryContainer`,
  `createSavedQueryContainer`, `createQueryContainerRuntime`,
  `validateQueryContainer`, `assertValidQueryContainer`,
  `resolveQueryContainerState`
- workbench helpers: `resolveQueryWorkbenchRouteTarget`,
  `hydrateQueryWorkbenchDraft`, `resolveQueryWorkbenchState`,
  `createQueryWorkbenchPreviewRuntime`, `createQueryWorkbenchInitialDraft`,
  `encodeQueryWorkbenchDraft`, `decodeQueryWorkbenchDraft`,
  `encodeQueryWorkbenchParameterOverrides`,
  `decodeQueryWorkbenchParameterOverrides`

The `react-dom` subpath exports:

- `QueryEditor`
- `QueryContainerSurface` and `QueryContainerSurfaceView`
- `QueryContainerMount` and `QueryContainerMountView`
- `createDefaultListRendererBinding`
- `createDefaultTableRendererBinding`
- `createDefaultCardGridRendererBinding`
- `createDefaultQueryRendererRegistry`
- `createQueryRendererCapabilityMap`

## Build

Run `turbo build --filter=@io/graph-query` from the repo root, or
`bun run build` in this package, to emit `./out`.
Run `turbo check --filter=@io/graph-query` from the repo root, or
`bun run check` in this package, to lint, format, type-check, and run the
package-local tests.

The intended first-read contract artifact for agents is `./out/index.d.ts`.
