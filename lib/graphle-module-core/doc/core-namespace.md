---
name: Graph module core namespace
description: "Built-in core namespace assembly, manifest ownership, and slice boundaries in @dpeek/graphle-module-core."
last_updated: 2026-04-15
---

# Graph module core namespace

## Read this when

- you are adding, removing, or moving a built-in `core:` slice
- you need to understand what the package root actually exports
- you are deciding whether behavior belongs in `graph-module-core`,
  `graph-module`, `graph-authority`, or a host adapter

## Main source anchors

- `../src/core.ts`: canonical `core:` namespace assembly
- `../src/core/minimal.ts`: minimal `core:` slice for the personal-site MVP
- `../src/core/index.ts`: curated slice exports
- `../src/index.ts`: package-root public entrypoint and `coreManifest`
- `../src/query.ts`: package-root core query-surface catalog and read-scope
  exports
- `../../graph-module/doc/module-stack.md`: cross-package built-in module
  ownership
- `../../graph-module/doc/type-modules.md`: definition-time authoring
  ownership

## What this layer owns

- the built-in `core:` namespace and its package-root manifest
- concrete built-in scalar, enum, entity, dataset, and helper contracts
- durable core-owned product records such as saved queries, saved views, icons,
  secret handles, and identity or admission records
- package-root runtime contribution metadata for the shipped core catalog scope

It does not own generic type-module authoring helpers, installed-module
planning, or browser routing.

## Namespace assembly

`core.ts` is the source of truth for what ships in the built-in `core:`
namespace.

It does three concrete things:

- imports the built-in slice definitions from `./core/*.ts`
- applies the generated `core.json` id map through `applyGraphIdMap(...)`
- publishes one canonical `core` object that later bootstrap, client, and
  package-root exports all share

That means package-local slice files define the contracts, but `core.ts` is the
place to check whether a slice is actually part of the shipped namespace.

## Minimal Core

`minimalCore` is a second exported namespace slice for the personal-site MVP
boot path. It reuses the stable core id map but includes only:

- schema anchors: `node`, `type`, `predicate`, `enum`, and `cardinality`
- scalar types: `string`, `number`, `boolean`, `date`, `json`, `markdown`,
  `slug`, and `url`
- node metadata fields required by the typed graph stack, including optional
  managed timestamps

It intentionally omits icon, SVG, saved-query/view, workflow, identity,
admission, share, capability, secret, installed-module, and other app-owned
records. Use `minimalCoreGraphBootstrapOptions` when booting the MVP site graph.
Use `core` and `coreGraphBootstrapOptions` when callers need the full built-in
core namespace and icon-capable bootstrap behavior.

## Package root versus slice exports

The package root exports:

- `core`
- `coreManifest`
- the curated slice exports from `./core/index.ts`
- the core query catalog and read-scope exports from `./query.ts`
- core query-executor helpers from `./query-executors.ts`

`coreManifest` is intentionally narrow. It contributes:

- the `core` schema namespace
- the built-in core query-surface catalog
- the built-in core catalog module read scope

It does not implement installation, activation, or runtime registry
composition. Those seams stay in `@dpeek/graphle-authority` and later host runtime
layers.

## What lives in this package

The built-in `core:` tree currently includes:

- foundational scalar or enum families such as `string`, `number`, `date`,
  `boolean`, `color`, `url`, `email`, `json`, `markdown`, `slug`, `svg`, and
  `cardinality`
- structured value families such as `duration`, `money`, `percent`,
  `quantity`, `range`, and `rate`
- graph-owned schema anchors such as `node`, `type`, `predicate`, `enum`,
  `tag`, `icon`, and `secretHandle`
- graph-owned product records such as `savedQuery`, `savedQueryParameter`, and
  `savedView`
- authority-facing shared records such as principal, grant, share, and
  admission types

The package is concrete by design. If a helper is generic across modules, it
usually belongs in `@dpeek/graphle-module`, not here.

## Boundary rules

- Put reusable authoring helpers in `@dpeek/graphle-module`.
- Put built-in `core:` contracts in this package.
- Put install lifecycle, approval records, and activation state in
  `@dpeek/graphle-authority`.
- Put browser defaults and DOM rendering on the `react-dom` subpath, not on the
  package root.

## Practical rules

- Add new built-in core slices under `../src/core/`.
- Re-export public slices through `../src/core/index.ts`.
- Wire shipped slices into `../src/core.ts` so they actually land in the
  canonical namespace.
- Add a slice to `minimalCore` only when it is required by the personal-site MVP
  boot path.
- Update `../src/index.ts` or `../src/query.ts` when the new slice changes the
  package-root public contract or runtime contributions.
