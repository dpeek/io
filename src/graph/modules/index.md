# Graph Modules

## Purpose

This root now owns built-in graph module authoring as the package tree shifts
from top-level `schema/` ownership toward explicit module ownership.

## Current State

- canonical built-in schema now lives under `../../src/graph/modules/`
- `@io/core/graph/modules`, `@io/core/graph/modules/core`,
  `@io/core/graph/modules/ops`, and `@io/core/graph/modules/pkm` are the
  ownership-first package entry surfaces
- structured core value families such as `duration`, `percent`, `quantity`,
  `money`, `rate`, and `range` live here as authored modules instead of being
  modeled as loose number/string conventions
- focused product slices stay available from `@io/core/graph/modules/pkm/topic`
  and `@io/core/graph/modules/ops/env-var`
- per-type authoring stays in singular folders such as
  `../../src/graph/modules/pkm/topic/`, with `schema.ts` as the slice entry
  file and direct compatibility shims at `../../src/graph/schema/<namespace>/<type>.ts`
- large static enum datasets can live in adjacent `data.ts` modules so the
  type entry file stays focused on schema wiring
- `../../src/graph/schema/` and `@io/core/graph/schema*` remain as compatibility
  wrappers for existing imports
- follow-up slices can extend module families here without reintroducing the
  legacy `../../src/graph/graph/` compatibility bucket

## Choosing Structured Values

Treat these as semantic families, not formatting hints. If a field would lose
meaning when you strip away its unit, currency, percent sign, numerator, or
boundaries, it should probably use one of these modules instead of a loose
`number`, `string`, or `json` placeholder.

- `duration`: use for elapsed time, estimates, windows, and retention periods.
  The core value is a non-negative millisecond count, and the default editor
  and display family is `number/duration`.
- `percent`: use for bounded `0-100` ratios such as completion, confidence,
  and utilization. The default editor and display family is
  `number/percent`.
- `quantity`: use for measured amounts with an explicit unit such as `kg`,
  `GB`, `seats`, or `requests`. The default editor and display family is
  `number/quantity`.
- `money`: use for monetary amounts that need a real currency code rather than
  an ad hoc unit string. The default editor and display family is
  `money/amount`.
- `rate`: use for numerator-per-denominator values such as `money / duration`
  burn, `quantity / duration` throughput, or similar "per" fields. The default
  editor and display family is `number/rate`.
- `range`: use for inclusive min/max bands over one structured value kind such
  as completion bands, budget bands, or quantity bands. The default editor and
  display family is `number/range`.

## Selection Rules

- choose `duration` instead of `date` only when the field means elapsed time;
  timestamps and schedule anchors should stay date-based
- choose `percent` only when `0-100` is part of the contract; if the value can
  exceed `100` or is canonically stored as a raw coefficient, keep a plain
  numeric type
- choose `quantity` when the unit is part of one value; choose `rate` when the
  field semantically means one structured value per another
- choose `money` instead of `quantity` whenever currency identity matters for
  comparison, ranges, or display
- choose `range` only when both bounds matter as one concept; a single lower or
  upper bound is usually clearer as its own field
- `rate` and `range` are polymorphic wrappers over the structured value kinds
  `duration`, `money`, `percent`, and `quantity`
- `rate` denominators must be greater than zero
- `range` endpoints must share the same kind, and money or quantity ranges must
  also share currency or unit

## Editor Fallbacks

- keep the value family and its default editor family paired by default; do not
  mix `core:money` with `number/quantity` or `core:range` with plain `number`
- `text` remains an allowed fallback for all current structured value families
  when a surface deliberately wants literal entry or text-only rendering
- `percent` also supports generic `number` display and editor fallbacks; the
  other current structured families do not
