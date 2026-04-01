# Graph Package Formalization

## Purpose

This document turns the package-formalization plan into a concrete extraction
spec: which current files move where, which public APIs they should become,
which names should be normalized on the way out, and how the resulting
packages compose into one query, surface, and live-collaboration runtime.

The target is a small set of packages with simple, consistent APIs:

- `@io/graph-query` for authored and saved reads
- `@io/graph-surface` for higher-level collection and record surfaces
- `@io/graph-live` for invalidation and refresh plumbing
- `@io/graph-react` for host-neutral edit and predicate primitives
- module packages for module-owned catalogs, scopes, and executor
  registrations
- `@io/app` as installer, route host, and Worker shell rather than the place
  where shared runtime happens to live

This doc is intentionally more concrete than [`query.md`](./query.md) and
[`surfaces-and-editing.md`](./surfaces-and-editing.md). Those describe the
product model. This one describes where the code should live.

## Design Rules

The split should follow these rules.

1. Keep authored metadata separate from installed runtime.
   `@io/graph-module` and `@io/graph-projection` own authored contracts such as
   `CollectionSurfaceSpec`, `RecordSurfaceSpec`, `ModuleQuerySurfaceSpec`,
   module read scopes, dependency keys, and projection metadata. Installed
   registries, saved-query repositories, executor registries, container
   runtime, and live routers belong in runtime packages above those contracts.
2. Keep pure runtime separate from DOM mounts.
   Shared root entrypoints stay React-free. DOM/browser components belong on
   `react-dom` subpaths. Server-only routing belongs on `server` subpaths.
3. Keep module-owned behavior on module packages.
   Core and workflow catalogs, scope definitions, and executor registrations
   should be exported by `@io/graph-module-core` and
   `@io/graph-module-workflow`. `@io/app` should install them, not re-own them.
4. Keep route names out of shared package names.
   Shared packages should not expose `/query`, `/workflow`, or `/api/...`
   language in their public API. Shared names should describe the product
   concept: query, collection surface, record surface, live scope.
5. Delete wrappers when a real package exists.
   Once `@io/graph-query`, `@io/graph-surface`, and `@io/graph-live` exist,
   app-local re-exports such as `@io/app/web/query-container` should be
   removed instead of preserved as compatibility aliases.
6. Move tests with the code they prove.
   When a runtime file moves packages, its focused `*.test.ts[x]` should move
   with it so package-local proofs stay colocated with the public API.

## Canonical Vocabulary

Use these names consistently across code, docs, and package exports.

### Product Concepts

- `query surface`: a bounded read contract published by a module catalog
- `installed query surface`: one active query surface in the current host
- `saved query`: a durable graph-owned query definition
- `saved view`: a saved query plus renderer and container defaults
- `query container`: mounted runtime state for executing, paging, refreshing,
  and invalidating one saved or inline query
- `record surface`: the preferred detail/edit surface term
- `collection surface`: a higher-level surface that composes a query or saved
  view with selection, create, and command behavior
- `query renderer`: a concrete visual renderer for one query result kind
- `live scope`: a real-time invalidation subscription over one bounded read
  scope

### Naming Patterns

Use names by role, not by historical file placement.

- `Spec`: authored declarative input, usually module-owned
- `Catalog`: module-owned collection of authored specs
- `Registry`: validated installed runtime collection assembled by the host
- `Binding`: authored or durable input resolved against installed runtime
- `Runtime`: stateful controller that can load, refresh, invalidate, or page
- `Client`: transport wrapper
- `Router`: server-side live or request routing helper
- `Mount`: DOM component that binds runtime to browser UI

### Required Cleanup

The current code already has a few naming drifts. Clean these up as code moves.

| Current | Target | Reason |
| --- | --- | --- |
| `InstalledModuleQuerySurface` | `InstalledQuerySurface` | every installed query surface already comes from a module |
| `InstalledModuleQuerySurfaceRegistry` | `InstalledQuerySurfaceRegistry` | shorten and clarify |
| `RendererBinding` | `QueryRendererBinding` | avoid generic renderer naming |
| `QueryRendererDefinition` in query-container runtime | `QueryRendererBindingSpec` | distinguish saved binding data from DOM renderer components |
| `QueryRendererDefinition` in DOM renderer registry | `QueryRendererComponent` | distinguish component registry from binding data |
| `CollectionSurfaceMountedBinding` | `CollectionSurfaceBinding` | mounted is a host concern, not the domain concept |
| `CollectionCommandSurfaceBinding` | `CollectionCommandBinding` | package already implies surface context |
| `createEntityCommandSubject` | `createEntityCollectionCommandSubject` | make the subject type explicit |
| `createSelectionCommandSubject` | `createSelectionCollectionCommandSubject` | make the subject type explicit |
| `useStoreSlotValue` | `usePredicateSlotValue` | the primitive is predicate-slot subscription, not a store abstraction |
| `createDraftController` | `createEntityDraftController` | only if the generic core is extracted; be explicit about entity-draft scope |
| `WorkflowReviewLive*` generic runtime names | `LiveScope*` | generic live runtime must not carry workflow branding |
| `core:list`, `core:table`, `core:card-grid` | `default:list`, `default:table`, `default:card-grid` | these are host-default renderers, not `core:` module data |
| `CollectionSurfacePresentationKind = "cardGrid"` | `"card-grid"` | public discriminants should use kebab-case |
| `CollectionSurfaceSourceSpec.kind = "entityType"` | `"entity-type"` | public discriminants should use kebab-case |
| `QueryContainerQuerySource.kind = "saved"` | `"saved-query"` | public discriminants should name the durable thing directly |
| `ObjectViewSpec` as the preferred new term | `RecordSurfaceSpec` | `ObjectViewSpec` should stay compatibility-only |

## Target Package Graph

The intended dependency graph is:

```text
@io/graph-kernel
  -> @io/graph-bootstrap
  -> @io/graph-sync

@io/graph-bootstrap + @io/graph-sync + @io/graph-kernel
  -> @io/graph-client

@io/graph-client + @io/graph-sync + @io/graph-module
  -> @io/graph-react

@io/graph-client + @io/graph-projection + @io/graph-module-core
  -> @io/graph-query

@io/graph-query + @io/graph-module
  -> @io/graph-surface

@io/graph-projection + @io/graph-sync
  -> @io/graph-live

@io/graph-query + @io/graph-module-core/react-dom + @io/web
  -> @io/graph-query/react-dom

@io/graph-surface + @io/graph-query/react-dom + @io/web
  -> @io/graph-surface/react-dom

@io/graph-module-core and @io/graph-module-workflow
  export module-owned catalogs, scopes, and executor registrations

@io/app
  installs active modules, binds routes, owns auth/worker/bootstrap, and
  composes the packages above
```

Important consequences:

- `@io/graph-query` must not depend on `@io/app`
- `@io/graph-surface` may depend on `@io/graph-query`, but not the reverse
- `@io/graph-live` should remain domain-agnostic; modules provide scope ids and
  dependency-key planning
- `@io/graph-module-core` and `@io/graph-module-workflow` should not depend on
  `@io/graph-query`, `@io/graph-surface`, or `@io/graph-live`
- `@io/app` should own active installation, route/search adapters, and Worker
  wiring, not generic runtime contracts

## Target Packages And Entrypoints

This is the intended published surface after extraction.

| Package | Root owns | Subpaths |
| --- | --- | --- |
| `@io/graph-query` | installed query-surface runtime, query editor model, saved-query repository, query executor registry, query-container runtime, route-neutral workbench helpers | `react-dom` |
| `@io/graph-surface` | collection-surface binding/runtime, collection commands, later record-surface runtime | `react-dom` |
| `@io/graph-live` | live registration contracts, client refresh helpers | `server` |
| `@io/graph-react` | host-neutral edit-session, validation normalization, predicate and entity hooks, extracted draft helpers | none for now |
| `@io/graph-module-core` | core schema, saved-query graph schema, core query-surface catalogs, core DOM field/filter adapters, core executor registrations | `react-dom` |
| `@io/graph-module-workflow` | workflow schema, projections, workflow query-surface catalogs, workflow-specific read/mutation/executor helpers | `client`, `server` |
| `@io/app` | installed module selection, route state, page shells, Worker routing, auth, app-specific proof UIs | existing app-local web and worker entrypoints only |

## `@io/graph-query`

### Responsibility

`@io/graph-query` should own the shared query runtime layer above authored
`ModuleQuerySurfaceSpec` and below route-local UI shells.

It should own:

- installed query-surface registry
- query editor catalog and draft model
- saved-query and saved-view runtime helpers
- query executor registry
- query-container validation and runtime
- route-neutral query workbench helpers

It should not own:

- module-authored query-surface specs themselves
- app-specific route search state
- app page shells
- workflow-specific read routes

### Public Root API

Export the primary runtime along with supporting `*Options`, `*Result`, and
`*Error` types from the same modules.

- installed surfaces:
  `createInstalledQuerySurfaceRegistry`,
  `getInstalledQuerySurface`,
  `createQuerySurfaceRendererCompatibility`
- editor model:
  `createQueryEditorCatalog`,
  `createQueryEditorCatalogFromInstalledSurfaces`,
  `createQueryEditorDraft`,
  `hydrateQueryEditorDraft`,
  `serializeQueryEditorDraft`,
  `normalizeQueryEditorDraft`,
  `validateQueryEditorDraft`
- saved queries and views:
  `createSavedQueryRepositoryFromGraph`,
  `createSavedQuerySourceResolver`,
  `resolveSavedQuery`,
  `resolveSavedView`,
  `validateSavedQueryCompatibility`,
  `validateSavedViewCompatibility`
- query execution:
  `createQueryExecutorRegistry`,
  `resolveCollectionQueryExecutor`,
  `resolveScopeQueryExecutor`
- query containers:
  `createInlineQueryContainer`,
  `createSavedQueryContainer`,
  `createQueryContainerRuntime`,
  `validateQueryContainer`,
  `assertValidQueryContainer`,
  `resolveQueryContainerState`
- workbench helpers:
  `hydrateQueryWorkbenchDraft`,
  `resolveQueryWorkbenchState`,
  `createQueryWorkbenchPreviewRuntime`,
  `createQueryWorkbenchInitialDraft`,
  `encodeQueryWorkbenchDraft`,
  `decodeQueryWorkbenchDraft`,
  `encodeQueryWorkbenchParameterOverrides`,
  `decodeQueryWorkbenchParameterOverrides`

### `react-dom` API

- `QueryEditor`
- `QueryContainerSurface`
- `QueryContainerSurfaceView`
- `QueryContainerMount`
- `createDefaultListRendererBinding`
- `createDefaultTableRendererBinding`
- `createDefaultCardGridRendererBinding`
- `createDefaultQueryRendererRegistry`
- `createQueryRendererCapabilityMap`

### Source Mapping

| Current source | Target | Public API | Notes |
| --- | --- | --- | --- |
| `../../lib/app/src/web/lib/query-container.ts` | `@io/graph-query` root | query-container runtime and validation exports | rename `mountInlineQueryRenderer` / `mountSavedQueryRenderer` to `createInlineQueryContainer` / `createSavedQueryContainer`; rename `RendererBinding` to `QueryRendererBinding`; rename `QueryRendererDefinition` to `QueryRendererBindingSpec` |
| `../../lib/app/src/web/lib/query-container.test.ts` | `@io/graph-query` root tests | package-local query-container coverage | move with runtime file |
| `../../lib/app/src/web/lib/saved-query.ts` | `@io/graph-query` root | saved-query repository, source resolver, compatibility exports | rename `createGraphBackedSavedQueryRepository` to `createSavedQueryRepositoryFromGraph`; keep dependence on `@io/graph-module-core` saved-query graph schema |
| `../../lib/app/src/web/lib/saved-query.test.ts` | `@io/graph-query` root tests | package-local saved-query coverage | move with runtime file |
| `../../lib/app/src/web/lib/serialized-query-executor-registry.ts` | `@io/graph-query` root | query executor registry exports | rename `createSerializedQueryExecutorRegistry` to `createQueryExecutorRegistry`; shorten `resolveSerializedQueryCollectionExecutor` and `resolveSerializedQueryScopeExecutor` |
| `../../lib/app/src/web/lib/serialized-query-executor-registry.test.ts` | `@io/graph-query` root tests | package-local executor-registry coverage | move with runtime file |
| generic parts of `../../lib/app/src/web/lib/query-surface-registry.ts` | `@io/graph-query` root | installed query-surface registry exports | split file; rename `InstalledModuleQuerySurface*` to `InstalledQuerySurface*`; built-in catalog activation stays in `@io/app` |
| generic parts of `../../lib/app/src/web/lib/query-workbench.ts` | `@io/graph-query` root | workbench hydration, state, preview, and persistence helpers | rename `encodeQueryWorkbenchParamOverrides` / `decodeQueryWorkbenchParamOverrides` to `encodeQueryWorkbenchParameterOverrides` / `decodeQueryWorkbenchParameterOverrides`; route-target parsing stays app-local |
| `../../lib/app/src/web/lib/query-workbench.test.ts` | `@io/graph-query` root tests | package-local workbench coverage | split or move test coverage with generic runtime |
| `../../lib/graph-module-core/src/react-dom/query-editor.ts` | `@io/graph-query` root | query editor model exports | move whole file; it is generic query logic, not core-module UI |
| `../../lib/graph-module-core/src/react-dom/query-editor.test.ts` | `@io/graph-query` root tests | package-local editor-model coverage | move with runtime file |
| `../../lib/graph-module-core/src/react-dom/query-editor-value-semantics.ts` | `@io/graph-query` root | internal value-semantic helpers | move whole file |
| `../../lib/graph-module-core/src/react-dom/query-editor-catalog.ts` | `@io/graph-query` root | `createQueryEditorCatalogFromInstalledSurfaces` | rename installed-surface types to drop `Module`; keep the file React-free |
| `../../lib/graph-module-core/src/react-dom/query-editor-catalog.test.ts` | `@io/graph-query` root tests | package-local editor-catalog coverage | move with runtime file |
| `../../lib/graph-module-core/src/react-dom/query-editor-component.tsx` | `@io/graph-query/react-dom` | `QueryEditor` | move whole file |
| `../../lib/graph-module-core/src/react-dom/query-editor-component.test.tsx` | `@io/graph-query/react-dom` tests | package-local query-editor DOM coverage | move with component |
| `../../lib/graph-module-core/src/react-dom/query-editor-predicate-field.tsx` | `@io/graph-query/react-dom` | internal DOM adapter used by `QueryEditor` | keep composing `@io/graph-module-core/react-dom` field editors instead of inventing a second field system |
| `../../lib/app/src/web/components/query-renderers.tsx` | `@io/graph-query/react-dom` | default renderer registry and renderer capability helpers | rename DOM type `QueryRendererDefinition` to `QueryRendererComponent`; rename built-in renderer ids from `core:*` to `default:*` |
| `../../lib/app/src/web/components/query-container-surface.tsx` | `@io/graph-query/react-dom` | `QueryContainerSurface`, `QueryContainerSurfaceView` | move whole file |
| `../../lib/app/src/web/components/query-container-surface.test.tsx` | `@io/graph-query/react-dom` tests | package-local query-container DOM coverage | move with component |
| `../../lib/app/src/web/components/query-route-mount.tsx` | `@io/graph-query/react-dom` | `QueryContainerMount` | rename away from route-specific language |
| `../../lib/app/src/web/components/query-route-mount.test.tsx` | `@io/graph-query/react-dom` tests | package-local mount coverage | move with component |
| `../../lib/app/src/web/components/query-editor.tsx` | delete wrapper | none | callers should import `QueryEditor` and catalog helpers directly from `@io/graph-query` and `@io/graph-query/react-dom` |
| `../../lib/app/src/web/lib/query-editor.ts` | delete wrapper | none | callers should import query-editor model directly from `@io/graph-query` |
| `../../lib/app/src/web/lib/query-transport.ts` | delete wrapper | none | callers should use `requestSerializedQuery(...)` from `@io/graph-client` directly |

### Integration Rules

- root stays React-free
- `react-dom` may depend on `@io/web` and `@io/graph-module-core/react-dom`
- module packages export query-surface catalogs into `@io/graph-query`; they do
  not import it
- `@io/app` owns which module catalogs are active and passes them into
  `createInstalledQuerySurfaceRegistry(...)`

## `@io/graph-surface`

### Responsibility

`@io/graph-surface` should own route-neutral runtime binding for authored
collection and record surfaces that compose the lower-level query runtime.

The first extraction scope is collection surfaces. Record-surface runtime
should land here later instead of staying inside app proof UIs.

It should own:

- collection-surface source resolution
- collection-surface binding over saved queries and saved views
- collection-command binding and subject modeling
- collection-surface runtime helpers that compose `@io/graph-query`
- browser mounts for authored collection surfaces

It should not own:

- query editor or query-container primitives
- explorer-specific inspector or create-dialog UI
- route-level shells

### Public Root API

- `resolveCollectionSurfaceBinding`
- `createCollectionSurfaceSourceResolver`
- `createCollectionSurfaceRuntime`
- `createEntityCollectionCommandSubject`
- `createSelectionCollectionCommandSubject`
- `resolveCollectionCommandBindings`

### `react-dom` API

- `CollectionSurfaceMount`
- `CollectionSurfaceMountView`
- `CollectionCommandButtons`

### Source Mapping

| Current source | Target | Public API | Notes |
| --- | --- | --- | --- |
| `../../lib/app/src/web/lib/collection-surface.ts` | `@io/graph-surface` root | collection-surface binding/runtime exports | rename `CollectionSurfaceMountedBinding` to `CollectionSurfaceBinding`; keep depending on `@io/graph-query` for saved queries, saved views, and query containers |
| `../../lib/app/src/web/lib/collection-surface.test.ts` | `@io/graph-surface` root tests | package-local collection-surface coverage | move with runtime file |
| `../../lib/app/src/web/lib/collection-command-surface.ts` | `@io/graph-surface` root | collection-command binding exports | rename `CollectionCommandSurfaceBinding` to `CollectionCommandBinding`; rename subject helpers to `createEntityCollectionCommandSubject` and `createSelectionCollectionCommandSubject` |
| `../../lib/app/src/web/lib/collection-command-surface.test.ts` | `@io/graph-surface` root tests | package-local command-binding coverage | move with runtime file |
| `../../lib/app/src/web/components/collection-surface-mount.tsx` | `@io/graph-surface/react-dom` | `CollectionSurfaceMount`, `CollectionSurfaceMountView` | move whole file |
| `../../lib/app/src/web/components/collection-command-actions.tsx` | `@io/graph-surface/react-dom` | `CollectionCommandButtons` | rename from `CollectionCommandActionButtons` |
| `../../lib/app/src/web/components/collection-browser-surface.tsx` | stays in `@io/app` | none | proving-ground browser surface; composes shared collection mounts with explorer-specific create and inspector flows |
| `../../lib/app/src/web/components/collection-browser-proof.tsx` | stays in `@io/app` | none | proof harness, not a reusable package surface |
| `../../lib/app/src/web/components/entity-type-browser.tsx` | stays in `@io/app` | none | product proof UI, not yet a generic record/collection host |
| `../../lib/app/src/web/components/entity-create-button.tsx` | stays in `@io/app` | none | depends on explorer runtime and create-dialog composition |

### Integration Rules

- `@io/graph-surface` may depend on `@io/graph-query`
- `@io/graph-query` must not depend on `@io/graph-surface`
- `@io/graph-surface/react-dom` should mount `QueryContainerSurface` from
  `@io/graph-query/react-dom` instead of re-owning container chrome
- future record-surface host APIs should be added here rather than directly
  into `@io/app`

## `@io/graph-live`

### Responsibility

`@io/graph-live` should own generic live-scope registration, invalidation
routing, and client refresh helpers for collaborative query and surface UIs.

It should own:

- live registration transport contracts
- generic client request helper
- generic refresh controller
- generic server-side invalidation router

It should not own:

- workflow-specific scope definitions
- module-specific dependency-key planners
- app route handlers
- app route paths such as `/api/workflow-live`

### Public Root API

- `liveScopeRequestKindValues`
- `LiveScopeRequestKind`
- `LiveScopeRegistration`
- `LiveScopeRegistrationTarget`
- `LiveScopeInvalidation`
- `LiveScopePullResult`
- `RegisterLiveScopeRequest`
- `PullLiveScopeRequest`
- `RemoveLiveScopeRequest`
- `LiveScopeRequest`
- `RegisterLiveScopeResponse`
- `PullLiveScopeResponse`
- `RemoveLiveScopeResponse`
- `LiveScopeResponse`
- `LiveScopeClientOptions`
- `LiveScopeClientError`
- `requestLiveScope`
- `createModuleLiveScopeRefreshController`

### `server` API

- `createLiveScopeRouter`
- `LiveScopeRouter`

### Source Mapping

| Current source | Target | Public API | Notes |
| --- | --- | --- | --- |
| generic contracts in `../../lib/app/src/web/lib/workflow-live-transport.ts` | `@io/graph-live` root | live registration contracts and request helper | split and rename request kinds away from workflow-specific strings; remove `webWorkflowLivePath` from shared API and make path a client option |
| `../../lib/app/src/web/lib/workflow-live-transport.test.ts` | `@io/graph-live` root tests | package-local live transport coverage | move the generic subset with the runtime |
| generic routing code in `../../lib/app/src/web/lib/workflow-live-scope-router.ts` | `@io/graph-live/server` | `createLiveScopeRouter` | rename `WorkflowReviewLiveScopeRouter` to `LiveScopeRouter` |
| `../../lib/app/src/web/lib/workflow-live-scope-router.test.ts` | `@io/graph-live/server` tests | package-local live router coverage | move with router |
| generic refresh logic in `../../lib/app/src/web/lib/workflow-review-live-sync.ts` | `@io/graph-live` root | `createModuleLiveScopeRefreshController` | split generic controller from workflow-specific scope checks; the generic controller should accept a module read-scope definition instead of importing workflow scope directly |
| `../../lib/app/src/web/lib/workflow-review-live-sync.test.ts` | `@io/graph-live` root tests | package-local refresh-controller coverage | split or move generic assertions with the controller |
| workflow-specific wrapper around the generic refresh controller | `@io/graph-module-workflow/client` or `@io/app` | temporary `createWorkflowReviewLiveSync(...)` wrapper | keep only until callers switch to generic live-scope APIs |

### Integration Rules

- `@io/graph-live` depends on `@io/graph-projection` and `@io/graph-sync`
- modules provide scope definitions such as `workflowReviewModuleReadScope`
- app authority computes `LiveScopeRegistrationTarget`s and publishes
  invalidations
- query containers and surface hosts should react through their own runtime
  refresh APIs instead of merging raw invalidation payloads directly

## `@io/graph-react`

### Responsibility After Refactor

`@io/graph-react` should keep the host-neutral React graph runtime and absorb
the truly generic edit-session helpers currently trapped in the explorer proof.

It should own:

- edit-session contracts
- validation issue normalization
- predicate hooks
- predicate-slot subscription hooks
- generic draft-value helpers
- generic entity-draft controller core

It should not own:

- explorer entity catalogs
- workflow- or core-specific create defaults
- browser dialog composition

### Public API Additions

Keep the current root exports and add:

- `usePredicateSlotValue`
- generic draft-value helpers, likely internal first and public only if reused
- `createEntityDraftController` once the generic controller core is split out

### Source Mapping

| Current source | Target | Public API | Notes |
| --- | --- | --- | --- |
| `../../lib/app/src/web/components/explorer/field-editor-store.ts` | `@io/graph-react` root | `usePredicateSlotValue` | move whole file; rename away from store-local language |
| `../../lib/app/src/web/components/explorer/create-draft-values.ts` | `@io/graph-react` root or internal | draft-value helpers | move whole file; generic cloning, equality, and nested-value helpers belong with edit-session runtime |
| generic session logic inside `../../lib/app/src/web/components/explorer/create-draft-controller.ts` | `@io/graph-react` root | `createEntityDraftController` | split only the generic edit-session controller core; current file also depends on explorer catalog lookups and app graph types |
| app-specific wrappers in `../../lib/app/src/web/components/explorer/create-draft-controller.ts` | stays in `@io/app` or later `@io/graph-surface` | none | entity catalog lookup, default planning, and create-flow composition stay out until generalized |
| generic parts of `../../lib/app/src/web/components/explorer/create-draft-plan.ts` | maybe `@io/graph-react` later | internal planning helpers | split only if a second caller appears; current defaults for `core:tag` and `workflow:documentBlock` are still module- or app-owned |

### Integration Rules

- `@io/graph-react` primitives should be reusable by both
  `@io/graph-surface/react-dom` and app-local proof UIs
- do not move explorer catalog types such as `EntityCatalogEntry` into
  `@io/graph-react`; keep the API generic and callback-based

## `@io/graph-module-core`

### Responsibility After Refactor

`@io/graph-module-core` should keep:

- built-in `core:` schema and data contracts
- saved-query and saved-view graph schema
- core query-surface catalogs
- core DOM field/filter adapters in `react-dom`

It should stop owning:

- generic query-editor model
- generic query-editor browser UI
- generic installed query-surface runtime helpers

### Source Mapping

| Current source | Target | Public API | Notes |
| --- | --- | --- | --- |
| `../../lib/graph-module-core/src/react-dom/query-editor.ts` | `@io/graph-query` | query editor model | move out |
| `../../lib/graph-module-core/src/react-dom/query-editor-catalog.ts` | `@io/graph-query` | installed-surface to editor-catalog mapping | move out |
| `../../lib/graph-module-core/src/react-dom/query-editor-component.tsx` | `@io/graph-query/react-dom` | `QueryEditor` | move out |
| `../../lib/graph-module-core/src/react-dom/query-editor-predicate-field.tsx` | `@io/graph-query/react-dom` | internal query-editor field adapter | move out, but keep composing core DOM field editors |
| `../../lib/graph-module-core/src/query.ts` | stays in `@io/graph-module-core` | `coreQuerySurfaceCatalog`, `coreBuiltInQuerySurfaces`, saved-query library surface exports | root module-owned metadata stays here |

### New Module-Owned APIs

`@io/graph-module-core` should continue exporting:

- `coreQuerySurfaceCatalog`
- `coreBuiltInQuerySurfaces`

Add:

- `createCoreQueryExecutorRegistrations(...)`

That new executor-registration export should be split out of
`../../lib/app/src/web/lib/registered-serialized-query-executors.ts` so the app
stops hard-coding core-owned scope executor registration.

## `@io/graph-module-workflow`

### Responsibility After Refactor

`@io/graph-module-workflow` should keep:

- workflow schema
- workflow projection metadata
- workflow query-surface catalogs
- workflow scope definitions and invalidation helpers

It should also absorb workflow-specific read, mutation, and executor logic now
living in app-local web code.

### Public APIs

The root package should continue exporting schema and projection helpers such
as:

- `workflowQuerySurfaceCatalog`
- `workflowBuiltInQuerySurfaces`
- `workflowReviewModuleReadScope`
- workflow projection dependency-key planners

Add:

- `createWorkflowQueryExecutorRegistrations(...)`
- `./client` for workflow-specific read clients, session-feed contracts, and
  temporary live wrappers
- `./server` for workflow-specific read and mutation helpers

### Source Mapping

| Current source | Target | Public API | Notes |
| --- | --- | --- | --- |
| workflow-specific executor registrations in `../../lib/app/src/web/lib/registered-serialized-query-executors.ts` | `@io/graph-module-workflow` root or `./server` | `createWorkflowQueryExecutorRegistrations(...)` | app should install these, not own them |
| generic helper in `../../lib/app/src/web/lib/registered-serialized-query-executors.ts` | `@io/graph-query` or duplicated as a tiny internal helper in each module package | none or internal helper | `createRegisteredModuleScopeExecutor(...)` is generic over module scope execution and should not stay app-local |
| `../../lib/app/src/web/lib/workflow-session-feed-contract.ts` | `@io/graph-module-workflow/client` or root | session-feed request/result contracts | module-owned read model |
| `../../lib/app/src/web/lib/workflow-transport.ts` | `@io/graph-module-workflow/client` | temporary workflow-specific read client | keep only until all reads go through generic query endpoints or module-specific clients |
| `../../lib/app/src/web/lib/workflow-session-feed.ts` | `@io/graph-module-workflow/server` | session-feed read helper | split app-specific HTTP helpers away first |
| `../../lib/app/src/web/lib/workflow-authority.ts` | `@io/graph-module-workflow/server` | workflow mutation helper | split app authority wiring away first |
| workflow-specific live wrapper over generic live-scope controller | `@io/graph-module-workflow/client` | `createWorkflowReviewLiveSync(...)` | temporary convenience wrapper over `@io/graph-live` |

### Integration Rules

- workflow package exports module-owned registrations and helpers
- app installs those helpers into the active runtime
- workflow-specific compatibility routes should shrink over time as generic
  query and live packages take over

## `@io/app`

### Responsibility After Extraction

`@io/app` should become the installer and host shell.

It should keep:

- active installed module list
- route and search-param adapters
- auth integration
- Durable Object and Worker route wiring
- graph runtime bootstrap for the current app schema
- proof pages and product-specific surfaces

It should stop owning:

- shared query runtime
- shared collection-surface runtime
- generic live routing/runtime
- module-owned executor registrations

### Source Mapping

| Current source | Target | Notes |
| --- | --- | --- |
| built-in catalog activation and caches in `../../lib/app/src/web/lib/query-surface-registry.ts` | stay in `@io/app` | rename file to reflect installation, not registry ownership; the generic registry implementation moves to `@io/graph-query` |
| app aggregator in `../../lib/app/src/web/lib/registered-serialized-query-executors.ts` | stay in `@io/app`, but shrink | app should only combine module-owned executor registrations and pass them into `createQueryExecutorRegistry(...)` |
| `../../lib/app/src/web/lib/query-route-state.ts` | stay in `@io/app` | `/query` route search state is app-specific |
| route-local parts of `../../lib/app/src/web/lib/query-workbench.ts` | stay in `@io/app` | `resolveQueryWorkbenchRouteTarget(...)` and route-specific persistence belong with the `/query` host |
| `../../lib/app/src/web/components/query-page.tsx`, `../../lib/app/src/web/components/query-workbench.tsx`, `../../lib/app/src/web/components/views-page.tsx` | stay in `@io/app` | page shells over shared packages |
| `../../lib/app/src/web/components/graph-runtime-bootstrap.tsx` | stay in `@io/app` for now | schema, endpoints, and runtime caching are still app-owned; later this may become a host/bootstrap package |
| `../../lib/app/src/web/lib/server-routes.ts` and `../../lib/app/src/web/lib/graph-authority-do.ts` | stay in `@io/app` | should become thin wiring over package-owned query, live, and module helpers |
| `../../lib/app/src/web/lib/query-container.ts`, `../../lib/app/src/web/lib/saved-query.ts`, `../../lib/app/src/web/lib/collection-surface.ts`, `../../lib/app/src/web/lib/workflow-live-transport.ts` | move out | app should not remain the shared runtime dumping ground |
| `@io/app` exports `./web/query-container` and `./web/saved-query` from `../../lib/app/package.json` | remove | callers should import from `@io/graph-query` instead |

### Installed Runtime Assembly

App-owned installation code should look like this:

```ts
import { coreQuerySurfaceCatalog, createCoreQueryExecutorRegistrations } from "@io/graph-module-core";
import {
  workflowQuerySurfaceCatalog,
  createWorkflowQueryExecutorRegistrations,
} from "@io/graph-module-workflow";
import {
  createInstalledQuerySurfaceRegistry,
  createQueryExecutorRegistry,
} from "@io/graph-query";

const installedCatalogs = [coreQuerySurfaceCatalog, workflowQuerySurfaceCatalog];
const installedSurfaces = createInstalledQuerySurfaceRegistry(installedCatalogs);

const executorRegistry = createQueryExecutorRegistry(installedSurfaces, [
  ...createCoreQueryExecutorRegistrations(coreDependencies),
  ...createWorkflowQueryExecutorRegistrations(workflowDependencies),
]);
```

That keeps module ownership on module packages and limits app ownership to one
question: which modules are installed right now?

## Cross-Package Integration

These are the intended module and runtime seams once extraction is complete.

### Query Authoring And Preview

1. `@io/app` activates module query-surface catalogs.
2. `@io/graph-query` builds the installed query-surface registry and query
   editor catalog.
3. `@io/graph-query/react-dom` renders `QueryEditor`.
4. `@io/graph-query` resolves saved queries and saved views against the
   installed registry.
5. `@io/graph-query` executes preview and mounted runtime through one
   query-container runtime.
6. `@io/app` adds route-state, save actions, and page-shell concerns on top.

### Collection Surfaces

1. A module authors `CollectionSurfaceSpec` and later `RecordSurfaceSpec` in
   `@io/graph-module`.
2. `@io/graph-surface` resolves those authored specs against saved queries,
   saved views, and installed query surfaces from `@io/graph-query`.
3. `@io/graph-surface/react-dom` mounts the resulting surface with
   `QueryContainerSurface` from `@io/graph-query/react-dom`.
4. `@io/app` composes the shared mount with product-specific inspector,
   selection, and create affordances.

### Live Collaboration

1. A module exports a bounded scope definition and dependency-key planner.
2. App authority builds `LiveScopeRegistrationTarget`s for accepted writes.
3. `@io/graph-live/server` routes invalidations to active registrations.
4. `@io/graph-live` client refresh helpers re-pull scoped sync or query data.
5. Query containers and surface hosts mark stale and refresh through their own
   runtime instead of directly merging raw invalidation payloads.

## Migration Sequence

The extraction order matters because later packages depend on earlier ones.

### Slice 1: Naming Cleanup

- normalize public discriminants to kebab-case
- rename renderer ids from `core:*` to `default:*`
- rename generic types to drop repeated `Module` and `WorkflowReview`
- update docs and tests to use the canonical vocabulary above

### Slice 2: Extract `@io/graph-query` Root

- move query-container, saved-query, executor-registry, editor model, and
  installed-registry code
- remove `@io/app/web/query-container` and `@io/app/web/saved-query`
- update app runtime assembly to install module-owned catalogs and executors

### Slice 3: Extract `@io/graph-query/react-dom`

- move `QueryEditor`, query-container DOM mounts, and default query renderers
- keep only app-local page shells and route wrappers in `@io/app`

### Slice 4: Extract `@io/graph-surface`

- move collection-surface runtime and collection-command binding
- move collection-surface DOM mounts
- leave explorer proof UI in app until record-surface and generic create flows
  are formalized

### Slice 5: Extract `@io/graph-live`

- move generic live transport, router, and refresh controller
- keep temporary workflow wrappers until all callers use generic live-scope
  runtime

### Slice 6: Move Module-Owned Registrations Back To Modules

- split core and workflow executor registrations out of the app aggregator
- move workflow-specific read and mutation helpers into
  `@io/graph-module-workflow/client` and `./server`
- make `server-routes.ts` and `graph-authority-do.ts` wiring-only

### Slice 7: Extract Generic Draft Primitives Into `@io/graph-react`

- move predicate-slot subscription and generic draft-value helpers
- split a generic entity-draft controller core away from explorer-specific
  entity catalog and default-planning code

## End State

After these moves:

- `@io/app` installs and wires packages instead of defining them
- `@io/graph-query` becomes the shared query runtime
- `@io/graph-surface` becomes the shared surface runtime
- `@io/graph-live` becomes the shared collaboration runtime
- `@io/graph-react` exposes the edit and predicate primitives shared by both
  surfaces and app proof UIs
- module packages own their catalogs, scopes, and executor registrations
- public names describe stable product concepts instead of reflecting the first
  route or feature proof where the code happened to land
