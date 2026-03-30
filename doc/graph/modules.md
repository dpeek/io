# Graph Modules

## Purpose

Built-in graph namespaces are now split by owner:

- `../../lib/graph-module-core/src/` owns the built-in `core:` namespace
- `../../lib/graph-module-workflow/src/` owns the built-in `workflow:`
  namespace

This document is about concrete built-in graph modules. The extracted
`@io/graph-module` package that owns type-module authoring helpers is covered
in [`type-modules.md`](./type-modules.md).

## Public Entry Surfaces

- `@io/graph-module-core`: `../../lib/graph-module-core/src/index.ts`;
  canonical `core:` namespace assembly plus curated built-in core contracts,
  graph-owned saved-query records, and the package-root core query-surface
  catalog exports
- `@io/graph-module-core/react-dom`:
  `../../lib/graph-module-core/src/react-dom/index.ts`; core-owned browser
  defaults such as `GraphIcon`, structured-value editors, and tag-aware
  reference behavior; this replaces the former `@io/graph-react-dom` package
- `@io/graph-module-workflow`: `../../lib/graph-module-workflow/src/index.ts`;
  canonical `workflow:` namespace assembly plus the workflow, env-var, and
  document slice exports together with workflow-local query-surface and
  projection metadata

`@io/graph-module-core` owns the canonical `core:` namespace object plus the
curated slice symbols that callers use directly, including the durable
saved-query object types and the built-in core module query-surface catalog.
`@io/graph-module-workflow` owns the `workflow` namespace object plus the
workflow, env-var, and document slice symbols plus the workflow-local
query-surface catalog.

## Built-In Query Catalogs

The current built-in query-catalog proof is split by owner:

- `@io/graph-module-core` owns the durable `core:savedQuery`,
  `core:savedQueryParameter`, and `core:savedView` graph objects plus the
  package-root `coreQuerySurfaceCatalog` export for the bounded
  `scope:core:catalog` surface and the reusable `core:saved-query-library`
  collection surface
- `@io/graph-module-workflow` owns the workflow-local
  `workflowQuerySurfaceCatalog` export for the projection-backed branch board
  and commit queue surfaces plus the `workflow:review-scope` scope surface
- saved queries bind to module-owned surfaces by storing module, catalog, and
  surface ids plus versions on the core-owned durable saved-query records
- `lib/app/src/web/lib/query-surface-registry.ts` keeps the built-in
  multi-module registry explicit through one shared workflow-plus-core catalog
  installation list; there is no manifest-backed activation layer yet

The initial saved-query library surface belongs in core rather than workflow
because it exposes core-owned saved-query product records that any module may
author against, not workflow-only projection rows or route-local UI state.

## Source Layout

- `../../lib/graph-module-core/src/core.ts`: namespace assembly entrypoint for
  the extracted `core:` package
- `../../lib/graph-module-core/src/core/`: built-in scalar, enum, and helper
  families
- `../../lib/graph-module-core/src/core/identity.ts`: Branch 2 identity anchors for
  `principal`, `authSubjectProjection`, and `principalRoleBinding` plus the
  enum vocabulary those graph-owned types depend on
- `../../lib/graph-module-workflow/src/`: workflow package root and the merged
  workflow, env-var, and document slice implementation
- `../../lib/graph-module-workflow/src/document/`: reusable markdown
  documents, ordered document blocks, and external placement trees
- `../../lib/graph-module-core/src/react-dom/`: core-owned browser defaults
  that depend on built-in `core:` value contracts or entity shapes
- type-specific directories keep schema, metadata, filters, and helper enums
  together with common files such as `type.ts`, `meta.ts`, `filter.ts`,
  `kind.ts`, `index.ts`, and `data.ts`
- `../../lib/app/src/graph/testing/kitchen-sink/`: private graph test fixtures, not a
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
