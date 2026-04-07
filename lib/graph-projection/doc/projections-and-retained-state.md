---
name: Graph projection projections and retained state
description: "Projection specs, retained compatibility, and retained provider registries in @io/graph-projection."
last_updated: 2026-04-03
---

# Graph projection projections and retained state

## Read this when

- you are changing `ProjectionSpec`
- you need to understand retained compatibility boundaries
- you are wiring retained projection providers for scope lookup or recovery

## Main source anchors

- `../src/index.ts`: projection, retained metadata, and provider helpers
- `../src/index.test.ts`: projection catalog, provider, and compatibility examples
- `../../graph-sync/doc/sync-stack.md`: cross-package rebuild and refresh flow

## What this layer owns

- projection metadata contracts
- retained checkpoint and row compatibility metadata
- retained record lookup helpers
- retained projection provider registrations and registries

It does not own retained storage tables, rebuild execution, or workflow-local
projection row payloads.

## Projection spec

`ProjectionSpec` is the rebuildable read-model contract.

Fields that matter most:

- `projectionId`
- `kind`
- `definitionHash`
- `sourceScopeKinds`
- `dependencyKeys`
- `rebuildStrategy`
- `visibilityMode`

Important rule:

- `definitionHash` is the retained compatibility boundary

If row meaning, rebuild inputs, or query-visible semantics change in a
non-compatible way, callers should change `definitionHash` and rebuild instead
of mutating retained state in place.

## Projection catalogs

`defineProjectionCatalog(...)` validates one shipped catalog of projections.

Important behavior:

- the catalog must not be empty
- `projectionId` values must be unique

The helper freezes the array but does not invent any projection ordering or
dependency semantics beyond what the specs already declare.

## Retained compatibility model

Retained rows and checkpoints share one compatibility key:

- `{ projectionId, definitionHash }`

The package exposes:

- `RetainedProjectionMetadata`
- `RetainedProjectionCheckpointRecord`
- `RetainedProjectionRowRecord`
- `isRetainedProjectionMetadataCompatible(...)`
- `findRetainedProjectionRecord(...)`

`findRetainedProjectionRecord(...)` is intentionally explicit. It returns:

- `match`
- `definition-hash-mismatch`
- `missing`

That keeps callers from treating missing state and incompatible state as the
same condition.

## Retained provider registrations

`RetainedProjectionProviderRegistration` binds retained projection ownership to:

- one `providerId`
- one or more `scopeDefinitions`
- one or more `projections`
- explicit `recovery` modes
- optional invalidation targeting metadata

Current shared recovery mode is only `rebuild`.

That is the package-level statement that retained rows are rebuildable cache,
not source of truth.

## Provider registry rules

`defineRetainedProjectionProviderRegistry(...)` is non-empty and fail-closed.

Important behavior:

- `providerId` values must be unique
- `projectionId` values must be unique across the whole registry
- each provider registration is normalized before freezing

One projection id maps to one retained provider contract.

## Lookup helpers

The package exposes three lookup shapes:

- `matchesRetainedProjectionProviderScope(...)`
- `listRetainedProjectionProvidersForScope(...)`
- `findRetainedProjectionProviderByProjectionId(...)`

Scope matching uses the same module request identity as module read scopes. It
does not require the caller to already have a delivered scope hash.

## Practical rules

- Change `definitionHash` instead of trying to patch incompatible retained rows.
- Keep workflow- or product-specific row payloads outside this package.
- Use provider registries as installed ownership maps, not as best-effort hints.
