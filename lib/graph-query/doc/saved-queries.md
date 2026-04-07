---
name: Graph query saved queries
description: "Graph-backed saved-query or saved-view records, compatibility checks, and source resolution in @io/graph-query."
last_updated: 2026-04-02
---

# Graph query saved queries

## Read this when

- you are changing saved-query or saved-view persistence helpers
- you need to understand compatibility checks against the installed surface catalog
- you are debugging saved-source resolution for query containers or workbench previews

## Main source anchors

- `../src/saved-query.ts`: repository, draft conversion, compatibility, and source resolution
- `../src/saved-query.test.ts`: graph-backed repository and fail-closed compatibility coverage
- `../src/query-editor.ts`: draft serialization consumed by saved-query builders
- `../../graph-module-core/src/core/saved-query.ts`: graph-native saved-query and saved-view schema helpers
- `./query-stack.md`: broader saved-query product model

## What this layer owns

- graph-backed repository helpers over the built-in saved-query schema
- draft-to-definition and record-derivation helpers
- saved-query and saved-view compatibility checks against the current installed editor catalog
- saved-source resolution for query-container runtime consumers

It does not own the saved-query graph schema itself or app-specific workbench storage.

## Repository semantics

`createSavedQueryRepositoryFromGraph(...)` wraps a typed graph client over the built-in core saved-query objects.

Important rules:

- repositories may be owner-scoped
- updates fail if an existing saved query or saved view belongs to another owner
- deleting a saved query also deletes attached saved views and saved-query parameters

## Compatibility boundary

Saved-query compatibility is keyed by installed metadata:

- `catalogId`
- `catalogVersion`
- `surfaceId`
- `surfaceVersion`

`validateSavedQueryCompatibility(...)` and `validateSavedViewCompatibility(...)` fail closed when:

- the installed surface disappeared
- the installed catalog version changed
- the surface version changed
- the serialized request points at a different surface than the stored record
- the current surface is no longer authorable because it now exposes excluded field kinds
- a saved view no longer matches its saved query or renderer compatibility contract

The distinction matters:

- `stale-*` means the installed runtime no longer contains the referenced thing
- `incompatible-*` means the thing still exists but its semantics changed

## Source resolution

`createSavedQuerySourceResolver(...)` is the query-container bridge for saved sources.

- inline sources pass through unchanged
- saved-query sources load the saved query, validate compatibility when a catalog is provided, merge param overrides, and revalidate against stored parameter definitions
- the resolved `sourceCacheKey` includes the saved query id plus serialized param overrides

That cache-key boundary is what lets query-container runtime share pages across multiple mounts of the same saved query while still splitting different parameter bindings.

## Practical rules

- Keep installed surface metadata attached to durable saved-query records.
- Validate compatibility before hydrating or executing saved queries.
- Do not silently rewrite stale or incompatible saved views. Those failures are part of the product contract.
