# Graph Modules

## Purpose

`../../src/graph/modules/` owns built-in graph namespaces and the slice code
that backs the published module subpaths.

## Public Entry Surfaces

- `@io/core/graph/modules`: `../../src/graph/modules/index.ts`; re-exports
  `core`, `ops`, and `pkm` plus representative built-ins such as
  `stringTypeModule`, `envVar`, and `topic`
- `@io/core/graph/modules/core`: `../../src/graph/modules/core.ts`; canonical
  `core:` namespace assembly
- `@io/core/graph/modules/ops`: `../../src/graph/modules/ops.ts`; canonical
  `ops:` namespace assembly
- `@io/core/graph/modules/pkm`: `../../src/graph/modules/pkm.ts`; canonical
  `pkm:` namespace assembly
- `@io/core/graph/modules/ops/env-var`:
  `../../src/graph/modules/ops/env-var/schema.ts`
- `@io/core/graph/modules/ops/workflow`:
  `../../src/graph/modules/ops/workflow/schema.ts`
- `@io/core/graph/modules/pkm/topic`:
  `../../src/graph/modules/pkm/topic/schema.ts`

The namespace subpaths export only their namespace objects. The module root
re-exports the namespaces plus representative built-ins and slice symbols.

## Source Layout

- `../../src/graph/modules/core.ts`,
  `../../src/graph/modules/ops.ts`,
  `../../src/graph/modules/pkm.ts`: namespace assembly entrypoints that pair
  `*.json` id maps with slice exports
- `../../src/graph/modules/core/`: built-in scalar, enum, and helper families
- `../../src/graph/modules/core/identity/`: Branch 2 identity anchors for
  `principal`, `authSubjectProjection`, and `principalRoleBinding` plus the
  enum vocabulary those graph-owned types depend on
- `../../src/graph/modules/ops/<slice>/schema.ts`,
  `../../src/graph/modules/pkm/<slice>/schema.ts`: exported slice entrypoints
- `../../src/graph/modules/ops/workflow/`: Branch 6 workflow root plus
  repository execution mappings, state enums, and key validators
- type-specific directories keep schema, metadata, filters, and helper enums
  together with common files such as `type.ts`, `meta.ts`, `filter.ts`,
  `kind.ts`, `index.ts`, and `data.ts`
- `../../src/graph/testing/kitchen-sink/`: private graph test fixtures, not a
  published module surface

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
