---
name: Graph react resolvers and filters
description: "Host-neutral field and filter resolver primitives in @io/graph-react."
last_updated: 2026-04-03
---

# Graph react resolvers and filters

## Read this when

- you are changing the host-neutral field resolver
- you need to understand how field or filter capabilities are resolved from
  authored metadata
- you are wiring a host adapter on top of `graph-react`

## Main source anchors

- `../src/resolver.tsx`: field resolver primitives
- `../src/filter.tsx`: filter resolver primitives
- `../src/index.test.ts`: host-neutral default behavior coverage
- `../../graph-surface/doc/ui-stack.md`: cross-package adapter split

## What this layer owns

- host-neutral field resolver primitives
- host-neutral filter resolver primitives
- fallback wrapper components for unsupported modes or operand kinds
- lowering and compilation helpers for runtime filter clauses

It does not own DOM capability registries or browser fallback widgets.

## Field resolver model

`createGraphFieldResolver(...)` builds a resolver from host-supplied
capabilities for three explicit modes:

- `view`
- `control`
- `field`

Compatibility rule:

- `editor` is only an alias for `control`

Resolution uses authored predicate metadata:

- display kinds resolve `view`
- editor kinds resolve `control`
- editor kinds also key `field`

The default resolver is intentionally empty. Until a host supplies
capabilities, the package reports unsupported states instead of pretending to
have generic UI.

## Unsupported reasons

Field resolution distinguishes between:

- missing display metadata
- missing editor metadata
- unsupported display kinds
- unsupported editor kinds

That separation matters for adapter work because a missing authored kind is a
schema problem, while an unsupported kind is an adapter capability gap.

## Filter resolver model

`createGraphFilterResolver(...)` builds a host-neutral filter resolver from
host-supplied operand editors.

It resolves filter contracts from authored field metadata:

- field default operator
- operator labels
- operand shapes
- parse and format helpers
- pure `test(...)` functions

The default resolver is also intentionally host-neutral. Without operand
editors, it can still describe the filter contract, but editor resolution stays
unsupported.

## Enum operand behavior

Enum-backed filter operands have one extra identity step:

- authored filters may speak in canonical enum keys
- runtime values may use resolved enum ids

`filter.tsx` bridges those identities so parsing, formatting, and matching stay
consistent across authored keys and resolved runtime ids.

## Runtime filter lowering

The package also owns the bridge from active filter clauses to runtime data:

- `lowerGraphFilterClause(...)`
- `lowerGraphFilterQuery(...)`
- `compileGraphFilterQuery(...)`

Current runtime query shape is intentionally narrow:

- combinator is always `and`
- operands are lowered to formatted strings plus an explicit operand kind

`compileGraphFilterQuery(...)` can also build an in-memory matcher over a
host-supplied `readValue(...)` function.

## Practical rules

- Keep capability lookup host-neutral here.
- Keep actual browser widgets in adapter packages.
- Treat unsupported states as useful contract signals, not as places to invent
  implicit fallbacks.
