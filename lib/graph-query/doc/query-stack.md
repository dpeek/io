---
name: Graph query stack
description: "Cross-package ownership for transport, installed query surfaces, durable saved queries, and execution boundaries centered on @io/graph-query."
last_updated: 2026-04-03
---

# Graph query stack

## Read this when

- the question spans `@io/graph-client`, `@io/graph-query`,
  `@io/graph-module-core`, `@io/graph-module-workflow`,
  `@io/graph-projection`, or app-owned query wiring
- you need the compatibility boundary for saved queries, installed surfaces,
  or executor routing
- you want the owning package doc before changing a query-related area

## Main source anchors

- `../src/index.ts`: package-root query runtime surface
- `../../graph-client/src/serialized-query.ts`: transport-safe serialized query
  request or response contract
- `../../graph-module-core/src/core/saved-query.ts`: durable saved-query and
  saved-view records
- `../../graph-module-workflow/src/projection.ts`: workflow-owned query
  surfaces, scope registrations, and invalidation planning
- `../../graph-projection/src/index.ts`: scope, projection, invalidation, and
  query-surface catalog contracts
- `../../app/src/web/lib/query-surface-registry.ts`: app-owned installed
  catalog composition
- `../../app/src/web/lib/registered-serialized-query-executors.ts`: app-owned
  executor composition

## What this doc owns

- the cross-package ownership map for the shipped query stack
- stable compatibility seams between transport, durable records, installed
  surfaces, and execution
- redirects to the package-local docs that own current runtime behavior

It does not own route-local browser policy, app shells, or historical design
notes.

## Current ownership

- `@io/graph-client` owns the transport-safe serialized-query contract, HTTP
  graph client helpers, and browser-safe request or response validators.
- `@io/graph-query` owns the installed query-surface registry, query editor
  model, saved-query runtime helpers, executor registry, query-container
  runtime, workbench helpers, and the browser `react-dom` layer.
- `@io/graph-module-core` owns the durable graph-native saved-query records:
  `core:savedQuery`, `core:savedQueryParameter`, and `core:savedView`, plus
  the built-in core catalog scope and saved-query library surface.
- `@io/graph-module-workflow` owns workflow-local query surfaces, workflow
  review scope registration, workflow retained projections, dependency-key
  planning, invalidation fan-out, and workflow query executor planning.
- `@io/graph-projection` owns named module read-scope contracts, retained
  projection compatibility metadata, provider registries, dependency keys, and
  invalidation event contracts.
- `@io/graph-authority` and host runtime code own authoritative query
  execution, installed-module activation state, and route or Worker
  composition.
- `app` owns activation-driven installed catalog composition, route parsing,
  page shells, and other host-local browser defaults.

## Stable contracts

### Query family boundary

The shipped serialized query family set stays bounded and explicit:

- `entity`
- `neighborhood`
- `collection`
- `scope`

Transport-safe request or response JSON belongs to `@io/graph-client`.
Installed-surface resolution, saved-query compatibility, and browser query
runtime belong above that layer.

### One logical query, three shapes

The same logical query crosses packages in three forms:

1. transport-safe serialized JSON for HTTP, browser cache keys, and previews
2. durable saved-query or saved-view records stored as graph-native objects
3. normalized execution input used by installed-surface and executor runtime

Those shapes do not need to be byte-for-byte identical, but they do need one
explicit compatibility boundary between them.

### Durable saved-query binding

Collection and scope saved queries bind to installed module-owned surfaces
through stored metadata on the durable core records:

- `moduleId`
- `catalogId`
- `catalogVersion`
- `surfaceId`
- `surfaceVersion`

Important rules:

- collection saved queries bind `surfaceId` to the serialized `indexId`
- scope saved queries bind `surfaceId` to the serialized `scopeId`
- compatibility fails closed when the installed catalog disappears, catalog or
  surface versions change, or the current authoring surface no longer matches
  the stored durable record

Durable saved-query identity belongs to `@io/graph-module-core`. Installed
surface compatibility checks and saved-source resolution belong to
`@io/graph-query`.

### Installed surfaces and executor compatibility

Installed query surfaces become one runtime registry through `@io/graph-query`.

That registry is the cross-package compatibility seam:

- module packages publish query-surface catalogs
- the installed registry attaches `moduleId`, `catalogId`, and
  `catalogVersion` to each runtime surface
- `surfaceId` and `surfaceVersion` become the runtime identity consumed by
  saved-query compatibility, executor routing, and browser bindings

Executor resolution also stays fail closed:

- collection executors resolve from `query.indexId`
- scope executors resolve from installed module scope surfaces
- executor registrations match on `queryKind + surfaceId + surfaceVersion`
- missing, stale, or ambiguous matches reject instead of silently guessing

### Container runtime and stale recovery

`@io/graph-query` owns the reusable query-container runtime above serialized
requests and below route-local UI shells.

Cross-package rules that stay stable:

- containers may execute inline serialized requests or durable saved-query
  sources
- cache identity is derived from the resolved serialized request, parameter
  definitions, execution context, and optional saved-source cache key
- renderer choice is not part of cache identity
- `projection-stale` is an explicit recovery signal rather than a generic
  error or silent continuation
- stale pagination recovery resets or refreshes from the first page; it does
  not continue from a stale continuation cursor

### Built-in module integration

The current built-in query split is intentionally package-owned:

- `@io/graph-module-core` owns the durable saved-query records and the core
  catalog scope
- `@io/graph-module-workflow` owns the workflow review scope and workflow
  projection-backed surfaces
- `@io/graph-projection` owns shared scope, retained-state, and invalidation
  contracts reused by those modules

The installed app registry composes active catalogs and executors from module
manifests. That host-local installation path should not be restated here as if
it were package-owned runtime behavior.

## Where current details live

- `../../graph-client/doc/transport.md`: serialized query transport, request
  or response validation, and HTTP helper boundaries
- `./installed-surfaces.md`: installed registry and editor-catalog projection
- `./executor-registry.md`: installed-surface to executor routing and version
  checks
- `./query-editor.md`: draft lifecycle, hydration, and serialization
- `./saved-queries.md`: saved-query compatibility and source resolution
- `./query-container.md`: container validation, cache identity, runtime state,
  and stale recovery
- `./query-workbench.md`: route-neutral workbench helpers and preview runtime
- `../../graph-module-core/doc/saved-queries-and-catalogs.md`: durable
  saved-query records and core catalog ownership
- `../../graph-module-workflow/doc/projections-and-query-surfaces.md`:
  workflow surfaces, workflow review scope, projections, and invalidation
- `../../graph-projection/doc/query-surface-catalogs.md`: shared catalog and
  registration contracts
- `../../graph-projection/doc/module-read-scopes.md`: named module scope
  contracts
- `../../graph-projection/doc/projections-and-retained-state.md`: retained
  projection compatibility
- `../../graph-projection/doc/dependency-keys-and-invalidation.md`:
  dependency keys and invalidation events

## Related docs

- `../../graph-sync/doc/sync-stack.md`: sync, scope identity, and stale
  recovery boundaries
- `../../graph-module/doc/module-stack.md`: built-in module ownership
- `../../graph-module-workflow/doc/workflow-stack.md`: workflow product-level
  contract
- `../../graph-surface/doc/ui-stack.md`: higher-level UI and adapter boundary
- `../../../doc/branch/03-sync-query-and-projections.md`: broader query and
  projection design direction

Keep this doc narrow. Current-state package behavior belongs in the package
docs listed above.
