---
name: Graph module manifests
description: "Shared built-in or local module manifest contract and fail-closed runtime contribution validation in @io/graph-module."
last_updated: 2026-04-03
---

# Graph module manifests

## Read this when

- you are changing `defineGraphModuleManifest(...)`
- you need to understand the authored manifest contract shared by built-in and local modules
- you are debugging fail-closed manifest validation

## Main source anchors

- `../src/manifest.ts`: manifest contract, runtime contribution vocabulary, and freezing logic
- `../src/index.test.ts`: built-in versus local manifest coverage and fail-closed cases
- `../src/index.typecheck.ts`: manifest typing against authored contributions
- `./module-stack.md`: built-in module ownership and installed-module lifecycle
- `../../graph-kernel/doc/runtime-stack.md`: broader runtime composition
  boundary

## What this layer owns

- the shared authored manifest contract for built-in and local modules
- runtime contribution vocabulary
- fail-closed validation and freezing of authored manifest data

It does not own installation planning, activation state, or runtime registry composition.

## Source and compatibility model

Every manifest has:

- `moduleId`
- `version`
- `source`
- `compatibility`
- `runtime`

Current source kinds are:

- `built-in`
- `local`

Compatibility is intentionally opaque:

- `compatibility.graph`
- `compatibility.runtime`

The manifest only requires explicit strings. Higher layers decide what they mean.

## Runtime contribution vocabulary

The authored runtime block may publish:

- `schemas`
- `querySurfaceCatalogs`
- `commands`
- `commandSurfaces`
- `objectViews`
- `recordSurfaces`
- `collectionSurfaces`
- `workflows`
- `readScopes`
- `projections`
- `activationHooks`

`defineGraphModuleManifest(...)` freezes these contributions and validates them through the owning helpers where needed. Query-surface catalogs, read scopes, and projections are validated through `@io/graph-projection`.

## Fail-closed rules

The manifest helper rejects:

- blank identity fields
- unknown source kinds or activation-hook stages
- empty runtime blocks
- empty arrays when a contribution block is provided
- duplicate contribution identities within one contribution kind
- query-surface catalogs whose `moduleId` does not match the manifest `moduleId`
- read scopes whose `moduleId` does not match the manifest `moduleId`

Returned manifests and contribution arrays are frozen. The helper is meant to catch bad authored data at definition time, not after runtime composition has already started.

## Practical rules

- Use this helper for every built-in or local manifest instead of assembling raw manifest objects ad hoc.
- Keep runtime blocks small and explicit. If a module contributes nothing, it should not ship a manifest yet.
- Leave install and activation lifecycle to `@io/graph-authority` and host runtime code.
