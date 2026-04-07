---
name: Graph module core saved queries and catalogs
description: "Durable saved-query or saved-view records plus the package-root core catalog and read-scope contract in @io/graph-module-core."
last_updated: 2026-04-03
---

# Graph module core saved queries and catalogs

## Read this when

- you are changing `core:savedQuery`, `core:savedQueryParameter`, or
  `core:savedView`
- you need to understand the package-root `coreQuerySurfaceCatalog`
- you are debugging saved-query surface bindings or durable identity failures

## Main source anchors

- `../src/core/saved-query.ts`: durable saved-query and saved-view schema plus
  the graph-native helper functions
- `../src/query.ts`: core catalog scope, saved-query library surface, and read
  scope definitions
- `../src/query-executors.ts`: built-in executor registrations for the core
  scope surface
- `../src/core/saved-query.test.ts`: durable behavior coverage
- `../../graph-module/doc/module-stack.md`: cross-package built-in module
  ownership

## What this layer owns

- durable graph-native saved-query and saved-view records
- the core-owned saved-query library collection surface
- the package-root core catalog module read scope and registration
- package-root metadata exports for the built-in core query surfaces

It does not own workflow-local projections, installed-surface registry
composition, or serialized-query execution runtime.

## Durable saved-query model

`core:savedQuery` stores:

- owner identity
- the normalized serialized query request
- the durable query kind
- a stable definition hash
- an optional module-owned surface binding

`core:savedQueryParameter` stores the ordered parameter definitions for one
saved query:

- `query`
- `order`
- `name`
- `label`
- `type`
- `required`
- optional `defaultValue`

`core:savedView` stores the reusable container and renderer defaults layered
above one saved query:

- `containerId`
- `rendererId`
- optional `containerDefaults`
- optional `queryParams`
- optional `rendererDefinition`

## Surface binding contract

Collection and scope saved queries must bind a module-owned query surface.

The stored surface contract requires:

- `moduleId`
- `catalogId`
- `catalogVersion`
- `surfaceId`
- `surfaceVersion`

Those ids must not be blank, and the saved query must agree with the binding:

- collection queries must use a `surfaceId` equal to `request.query.indexId`
- scope queries must use a `surfaceId` equal to `request.query.scopeId`

That keeps durable saved queries aligned with module-owned installed surfaces
instead of leaving the binding implicit in route code.

## Durable identity and normalization

Saved-query durability is fail closed.

Before write:

- collection and scope requests are normalized so window metadata only keeps
  `limit`; cursor-like `after` values do not become part of the durable
  definition
- the request is validated against the declared parameter definitions
- a `definitionHash` is derived from canonicalized JSON over the normalized
  request, parameter definitions, and optional surface binding

On read:

- the stored request is revalidated
- the stored query kind must match the serialized query kind
- the hash is recomputed and must match the stored `definitionHash`

If any of those checks fail, the helper throws `SavedQueryDefinitionError`
instead of guessing through stale durable state.

## Saved-view validation

Saved views also validate fail closed:

- `ownerId`, `containerId`, `queryId`, and `rendererId` must be non-empty
- pagination defaults require both `mode` and positive `pageSize`
- poll-backed refresh defaults require a positive `pollIntervalMs`
- non-poll refresh modes must not carry a poll interval
- `queryParams` must be a JSON object keyed by non-empty parameter names
- `rendererDefinition` must be a plain JSON object

## Core catalog and read scope

`query.ts` publishes the built-in package-root core catalog surface metadata.

Current built-in core surfaces are:

- `scope:core:catalog`: the bounded core catalog scope proof
- `core:saved-query-library`: the reusable saved-query library collection
  surface

The package also exports:

- `coreCatalogModuleReadScope`
- `coreCatalogModuleReadScopeRegistration`
- `coreBuiltInQuerySurfaces`
- `coreBuiltInQuerySurfaceIds`

Those exports are the stable package-root bridge between core-owned durable
records and later installed-surface composition.

## Executor boundary

`createCoreQueryExecutorRegistrations(...)` currently registers the built-in
scope executor only.

Important rule:

- core scope queries reject windowed pagination at execution time

The durable saved-query objects still belong here, but broad query-runtime
dispatch and installed-catalog composition belong in `@io/graph-query`,
`@io/graph-client`, and the host runtime.

## Practical rules

- Keep durable saved-query records here even when the bound surface belongs to
  another module.
- Treat surface ids and versions as part of the durable binding, not optional
  UI hints.
- Change the core catalog here only when the shared built-in core surfaces
  actually change.
