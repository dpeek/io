# Graph Adapters

## Purpose

`../../lib/graph-react/src/` and `../../lib/graph-module-core/src/react-dom/`
define the graph workspace's host-neutral React layer and the current default
browser adapter surface.

## Public Entry Surfaces

- `@io/graph-react`: `../../lib/graph-react/src/index.ts`; graph-aware,
  host-neutral React hooks, resolver primitives, mutation helpers, and synced
  runtime hooks
- `@io/graph-module-core/react-dom`:
  `../../lib/graph-module-core/src/react-dom/index.ts`; the canonical browser
  field/filter adapters, SVG helpers, and core-owned defaults such as
  `GraphIcon`, structured-value editors, and tag-aware entity-reference
  behavior

There is no separate `react-opentui` package anymore. TUI code imports the
shared runtime hooks directly from `@io/graph-react`.
There is also no `@io/graph-react-dom` package anymore. Browser callers import
`@io/graph-module-core/react-dom` directly.

## Source Layout

- `../../lib/graph-react/src/entity.tsx`,
  `../../lib/graph-react/src/predicate.ts`,
  `../../lib/graph-react/src/filter.tsx`,
  `../../lib/graph-react/src/mutation-validation.ts`,
  `../../lib/graph-react/src/persisted-mutation.tsx`,
  `../../lib/graph-react/src/resolver.tsx`,
  `../../lib/graph-react/src/runtime.tsx`: host-neutral React helpers
- `../../lib/graph-module-core/src/react-dom/field-registry.tsx`,
  `../../lib/graph-module-core/src/react-dom/filter.tsx`,
  `../../lib/graph-module-core/src/react-dom/filter-editors.tsx`,
  `../../lib/graph-module-core/src/react-dom/icon.tsx`,
  `../../lib/graph-module-core/src/react-dom/resolver.tsx`: browser adapter
  exports and capability registries
- `../../lib/graph-module-core/src/react-dom/fields/`: generic field-family
  modules, shared preview helpers, structured-value editors, tag-reference
  behavior, and other browser field modules

`@io/graph-module-core/react-dom` now composes the host-neutral contracts from
`@io/graph-react` into the current default browser field and filter
capabilities. The DOM split is intentionally consolidated here until a truly
shared browser layer emerges.
