---
name: Graph module core structured values
description: "Duration, money, percent, quantity, range, and rate families plus the shared structured-value helpers in @io/graph-module-core."
last_updated: 2026-04-03
---

# Graph module core structured values

## Read this when

- you are changing one of the built-in structured value families
- you need to decide whether a field should use `duration`, `money`,
  `percent`, `quantity`, `range`, or `rate`
- you are debugging shared parsing, formatting, or comparison behavior

## Main source anchors

- `../src/core/structured-value.ts`: shared structured-value helpers
- `../src/core/duration.ts`: duration type module
- `../src/core/money.ts`: money type module
- `../src/core/percent.ts`: percent type module
- `../src/core/quantity.ts`: quantity type module
- `../src/core/range.ts`: range type module
- `../src/core/rate.ts`: rate type module
- `../../graph-module/doc/module-stack.md`: cross-package built-in module
  ownership

## What this layer owns

- the concrete built-in structured value scalar families in `core:`
- shared parsing, normalization, formatting, and comparison helpers for those
  families
- the browser-default display and editor metadata attached to those type
  modules

It does not own generic scalar-module authoring helpers. Those stay in
`@io/graph-module`.

## Shared model

`structured-value.ts` defines the common vocabulary for the polymorphic
families:

- `duration`
- `money`
- `percent`
- `quantity`

`StructuredValuePart` is the shared tagged-value shape:

- `kind`
- `value`

Shared helpers normalize, parse, format, compare, and label those values so
the polymorphic `range` and `rate` families can reuse one core representation.

## Concrete family rules

The current built-in families are semantic value contracts, not display-only
wrappers.

- `duration`: finite millisecond count, validated as zero or greater
- `money`: `{ amount, currency }`, where currency must be one of the built-in
  currency keys
- `percent`: finite number in the inclusive `0-100` range
- `quantity`: `{ amount, unit }`, where `unit` must not be blank
- `range`: `{ kind, min, max }`, where both endpoints share one structured
  value kind and `min <= max`
- `rate`: `{ numerator, denominator }`, where denominator magnitude must be
  greater than zero

Cross-kind comparison is intentionally narrow:

- money comparisons require matching currencies
- quantity comparisons require matching units

Those checks are reused by `range` and `rate` validation.

## Choosing the right family

Use these types when the unit or bounded semantic meaning is part of the
contract itself.

- use `duration` for elapsed time, not timestamps
- use `percent` only when `0-100` is part of the contract
- use `quantity` when one value carries an explicit unit
- use `money` when currency identity matters
- use `rate` when the field semantically means one structured value per another
- use `range` when lower and upper bounds are one concept

If stripping the unit, currency, or bounds would change the meaning of the
field, a structured value family is usually the right contract.

## Authoring and filter behavior

Each family publishes a concrete type module with:

- one scalar definition
- summary formatting
- browser-default display or editor kinds
- a narrow filter contract over its own parsed value

Examples:

- `percent` allows `number/percent`, `number`, and `text` display or editor
  fallbacks
- `money`, `quantity`, `range`, and `rate` keep their richer editor or display
  kinds but still allow `text` fallbacks
- `duration` chooses human-readable units such as `min`, `hr`, or `day` for
  formatting while storing a normalized millisecond count

## Practical rules

- Choose these types for semantics, not just for nicer formatting.
- Keep comparison rules strict. If units or currencies do not line up, fail
  closed instead of inventing implicit conversion.
- Reuse `structured-value.ts` when adding new polymorphic logic around `range`
  or `rate`.
