---
name: Graph bootstrap icon seeding
description: "Icon seed lookup, resolution, and materialization in @io/graph-bootstrap."
last_updated: 2026-04-04
---

# Graph bootstrap icon seeding

## Read this when

- you are changing bootstrap icon behavior
- you need to understand how icon ids become graph icon entities
- you are wiring a domain-owned icon catalog into bootstrap

## Main source anchors

- `../src/icons.ts`: seed lookup, icon id resolution, and icon materialization
- `../src/contracts.ts`: icon-related bootstrap options
- `../src/bootstrap.ts`: integration point for type and predicate icon linking
- `../src/bootstrap.test.ts`: additive icon seeding coverage
- `../../graph-module-core/doc/icons-and-svg.md`: canonical graph-wide icon
  and SVG contract plus the built-in core-owned icon layer

## What this layer owns

- lookup of icon seed records by id
- type and predicate icon id resolution during bootstrap
- materialization of icon entities when a seed record is available

It does not own the concrete icon catalog. That stays in the caller's domain.

## Seed lookup

Bootstrap builds one icon-seed lookup from three sources:

- inline seed records embedded directly in definition icon metadata
- `options.iconSeeds`
- `options.resolveIconSeed(iconId)`

Priority rule:

- inline seeds load first
- `options.iconSeeds` can replace those ids
- `resolveIconSeed(...)` is the final fallback for ids that are still missing

Inline seeds only count when the definition icon value is a full seed record,
not just a string id.

## Type icon resolution

`resolveBootstrapTypeIconId(...)` resolves one type icon id from:

- `options.resolveTypeIconId(typeDef)` first
- otherwise the authored definition icon ref on the type

That means the caller-supplied resolver can override an explicit authored icon
id when it needs remapping behavior.

## Predicate icon resolution

`resolveBootstrapPredicateIconId(...)` is a little different.

Behavior:

- if the predicate has an explicit icon ref, bootstrap prefers that authored id
  unless `resolvePredicateIconId(...)` overrides it
- if the predicate has no explicit icon and the range type is not available,
  bootstrap checks the store for an already-materialized range-type icon link
- otherwise it falls back to `resolvePredicateIconId(...)`

That lets additive passes reuse icon links from previously bootstrapped range
types.

## Materialization rule

Bootstrap only links type or predicate icon facts when the referenced icon
entity exists in the store.

In practice that means:

- bootstrap gathers referenced icon ids first
- it seeds icon entities for ids it can resolve to seed records
- later type and predicate icon links are only asserted if the icon node now
  exists

Missing seeds fail closed by omission. Bootstrap does not assert dangling icon
links.

## Seeded icon facts

`seedBootstrapIcon(...)` materializes a normal graph icon entity with:

- managed timestamps when the icon node is new
- `core:icon.key`
- `core:icon.svg`
- `core:node.name`
- `core:node.type = core:icon`

The package does not add extra catalog metadata beyond those graph facts.

## Practical rules

- Keep icon catalogs domain-owned and pass them through bootstrap options.
- Use `resolveIconSeed(...)` for installable or remapped icon ids.
- Do not treat bootstrap as the owner of icon fallback policy. It only
  materializes ids it can resolve.
