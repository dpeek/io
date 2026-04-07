---
name: Graph module core icons and SVG
description: "core:icon, core:svg, icon seeds, fallback resolution, SVG sanitization, and bootstrap wiring in @io/graph-module-core."
last_updated: 2026-04-04
---

# Graph module core icons and SVG

## Read this when

- you are changing `core:icon` or `core:svg`
- you need to understand icon seeds, default fallback resolution, or bootstrap
  icon wiring
- you are debugging SVG sanitization or the shipped DOM icon renderer

## Main source anchors

- `../../graph-kernel/src/schema.ts`: `DefinitionIconRef`,
  `GraphIconSeedRecord`, and `readDefinitionIconId(...)`
- `../src/core/icon.ts`: `core:icon` and `iconReferenceField(...)`
- `../src/core/svg.ts`: `core:svg` and the SVG type module metadata
- `../src/core/svg-sanitization.ts`: SVG parser, sanitizer, and normalization
- `../src/icon/seed.ts`: core-owned icon-seed helper and unknown fallback
- `../src/icon/resolve.ts`: default type or predicate icon resolution
- `../src/core/bootstrap.ts`: bootstrap adapter wiring for the built-in core
  icon contracts
- `../src/react-dom/icon.tsx`: `GraphIcon` and `SvgMarkup`
- `../../graph-bootstrap/doc/icon-seeding.md`: bootstrap-side seed lookup,
  resolution, and icon materialization

## What this layer owns

- the canonical graph-wide icon and SVG contract for the shipped graph stack
- the graph-owned `core:icon` entity and `core:svg` scalar
- concrete core icon seeds and the unknown fallback seed
- default icon resolution for core-owned type and predicate definitions
- SVG sanitization and normalization for the built-in core contract
- the built-in bootstrap adapter that hands those contracts to
  `@io/graph-bootstrap`

It does not own a separate global icon registry outside the graph.

## Graph-wide contract

- icons are graph-owned entities
- SVG is graph-owned scalar data
- `core:icon` is the canonical built-in icon entity type
- `core:svg` is the canonical built-in scalar for sanitized SVG markup
- type and predicate definitions store icon refs through the shared schema
  contract, including `DefinitionIconRef` and `readDefinitionIconId(...)`
- bootstrap consumes caller-supplied icon seeds and icon resolvers; it does
  not define a separate global icon catalog
- host code should treat icons through the normal typed entity and predicate
  surface rather than a bespoke route-local icon workflow

## Ownership split

- `@io/graph-kernel` owns the schema-level icon reference and seed-record
  contracts definitions use
- `@io/graph-module-core` owns the concrete built-in icon and SVG contracts,
  default seed records, fallback resolution, sanitization, and the default DOM
  renderer
- `@io/graph-bootstrap` owns icon materialization from caller-supplied seeds
  and resolvers
- client and host code read icon ids and rendered SVG data; they do not own
  the catalog contract

## core:icon and core:svg

`core:svg` is the scalar contract for sanitized SVG markup.

It carries:

- summary formatting as the raw string
- display kinds `text` and `svg`
- editor kinds `text`, `textarea`, and `svg`

`core:icon` is the ordinary graph entity that stores icon metadata:

- inherited node fields
- `key`
- `svg`

The `svg` field normalizes and validates markup through the shared sanitizer on
create and update.

## Icon assignment stays explicit

Type and predicate definitions opt into icons explicitly through definition
metadata.

`iconReferenceField(...)` is the built-in helper for fields that point at a
real `core:icon` entity. It uses the shared existing-entity reference authoring
contract rather than a bespoke icon picker contract.

## Icon seeds and fallback resolution

`defineCoreIconSeed(...)` is the package-local helper for concrete built-in icon
seed records.

The package ships:

- explicit seeds beside the definitions that own them
- `unknownIconSeed` as the fallback when no explicit icon can be resolved

Default resolution rules in `resolve.ts` are intentionally small:

- explicit definition icons win
- enum types fall back to the built-in tag icon
- predicates whose range is another entity type fall back to the built-in edge
  icon
- otherwise resolution falls back to the unknown icon seed

## SVG sanitization contract

The SVG sanitizer is fail closed.

Current rules include:

- exactly one root `<svg>`
- valid or derivable `viewBox`
- allowlist-only tags and attributes
- no scripts, event handlers, foreign content, or unsafe external references
- local-only `href` or `xlink:href` references
- root-level `width` and `height` stripped during normalization

That same sanitizer is reused across:

- field validation
- create or update normalization
- DOM icon rendering
- SVG preview rendering

## Bootstrap boundary

`coreGraphBootstrapOptions` is the domain-owned bootstrap adapter for the
built-in `core:` namespace.

It contributes:

- `availableDefinitions`
- `coreSchema`
- `iconSeeds`
- `resolveTypeIconId`
- `resolvePredicateIconId`

Bootstrap consumes those contracts. It does not define the icon catalog or
fallback policy itself.

## DOM rendering boundary

The `react-dom` subpath publishes the default browser renderer:

- `SvgMarkup` sanitizes and renders inline SVG with the built-in DOM chrome
- `GraphIcon` resolves the current `core:icon` entity through the active graph
  mutation runtime and renders its `svg`
- `SvgPreview` reuses the same sanitizer-backed rendering path for authoring

That browser layer is package-owned default behavior, not a second graph icon
contract.

## Practical rules

- Keep icon semantics graph-native. Use `core:icon` or definition icon metadata
  instead of bespoke route-local icon state.
- Put built-in fallback policy in `../src/icon/resolve.ts`.
- Reuse the shared sanitizer everywhere SVG enters or leaves the built-in core
  contract.
