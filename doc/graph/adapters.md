# Graph Adapters

## Purpose

`../../lib/graph-react/src/` and `../../src/graph/adapters/` define the
graph package's host-neutral React and host-specific adapter surfaces.

## Public Entry Surfaces

- `@io/graph-react`: `../../lib/graph-react/src/index.ts`; graph-aware,
  host-neutral React hooks, resolver primitives, mutation helpers, and synced
  runtime hooks
- `@io/core/graph/adapters/react-dom`:
  `../../src/graph/adapters/react-dom/index.ts`; DOM field views and editors,
  filter resolvers, icon rendering, and field-family modules

There is no separate `react-opentui` package anymore. TUI code imports the
shared runtime hooks directly from `@io/graph-react`.

## Source Layout

- `../../lib/graph-react/src/entity.tsx`,
  `../../lib/graph-react/src/predicate.ts`,
  `../../lib/graph-react/src/filter.tsx`,
  `../../lib/graph-react/src/mutation-validation.ts`,
  `../../lib/graph-react/src/persisted-mutation.tsx`,
  `../../lib/graph-react/src/resolver.tsx`,
  `../../lib/graph-react/src/runtime.tsx`: host-neutral React helpers
- `../../src/graph/adapters/react-dom/field-registry.tsx`,
  `../../src/graph/adapters/react-dom/filter.tsx`,
  `../../src/graph/adapters/react-dom/filter-editors.tsx`,
  `../../src/graph/adapters/react-dom/icon.tsx`,
  `../../src/graph/adapters/react-dom/resolver.tsx`: DOM adapter exports and
  capability registries
- `../../src/graph/adapters/react-dom/fields/`: DOM field-family view/editor
  modules and shared preview helpers

`react-dom` stays browser-specific. It composes the host-neutral contracts from
`@io/graph-react` into default web field and filter capabilities.
