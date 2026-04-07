---
name: Graph bootstrap core schema requirements
description: "The minimal core schema contract required by @io/graph-bootstrap."
last_updated: 2026-04-03
---

# Graph bootstrap core schema requirements

## Read this when

- you are changing `requireGraphBootstrapCoreSchema(...)`
- you need to bootstrap a partial module slice
- you are debugging missing built-in core contracts during bootstrap

## Main source anchors

- `../src/core-schema.ts`: minimal core contract reader and validator
- `../src/contracts.ts`: `coreSchema` option surface
- `../src/bootstrap.ts`: call site for required core-schema resolution

## What this layer owns

- the minimal core schema shape bootstrap depends on
- validation of that shape when definitions are used as the source
- the explicit `coreSchema` override path for partial bootstrap flows

It does not own the concrete `core:` definitions themselves.

## Required contracts

Bootstrap needs these built-in contracts:

- `node`
- `predicate`
- `type`
- `icon`
- `enum`
- `cardinality`

More specifically, it needs these fields and ids:

- `node.fields.name`
- `node.fields.description`
- `node.fields.type`
- optional `node.fields.createdAt`
- optional `node.fields.updatedAt`
- `predicate.fields.key`
- `predicate.fields.range`
- `predicate.fields.cardinality`
- `predicate.fields.icon`
- `type.fields.icon`
- `icon.fields.key`
- `icon.fields.svg`
- `enum.fields.member`
- `cardinality.values.one.id`
- `cardinality.values.oneOptional.id`
- `cardinality.values.many.id`

## Resolution paths

Bootstrap has two ways to obtain that contract:

- read it directly from the current `definitions` object through
  `requireGraphBootstrapCoreSchema(...)`
- accept an explicit `options.coreSchema`

The explicit option exists for partial bootstrap passes where the current
definition slice does not include the full built-in core namespace.

## Validation behavior

`requireGraphBootstrapCoreSchema(...)` fails early when any required contract is
missing or malformed.

Important behavior:

- missing top-level contracts produce targeted bootstrap errors
- malformed fields or missing cardinality ids produce one shared invalid-core
  error
- optional `createdAt` and `updatedAt` are allowed to be absent

If those timestamp fields are absent, bootstrap simply skips managed timestamp
assertion.

## Practical rules

- Pass `coreSchema` explicitly when bootstrapping module slices outside the
  full core definition set.
- Treat this type as the minimum contract bootstrap needs, not as a full
  description of the built-in core package.
- Keep broader `core:` semantics documented in `@io/graph-module-core`.
