# Graph Adapters

## Purpose

`../../src/graph/runtime/react/` and `../../src/graph/adapters/` define the
graph package's React and host-specific adapter surfaces.

## Public Entry Surfaces

- `@io/core/graph/runtime/react`: `../../src/graph/runtime/react/index.ts`;
  graph-aware, host-neutral React hooks and resolver primitives
- `@io/core/graph/adapters/react-dom`:
  `../../src/graph/adapters/react-dom/index.ts`; DOM field views and editors,
  filter resolvers, icon rendering, and field-family modules
- `@io/core/graph/adapters/react-opentui`:
  `../../src/graph/adapters/react-opentui/index.ts`; terminal adapter package
  root that currently exports an empty surface

## Source Layout

- `../../src/graph/runtime/react/entity.tsx`,
  `../../src/graph/runtime/react/predicate.ts`,
  `../../src/graph/runtime/react/filter.tsx`,
  `../../src/graph/runtime/react/mutation-validation.ts`,
  `../../src/graph/runtime/react/persisted-mutation.tsx`,
  `../../src/graph/runtime/react/resolver.tsx`: host-neutral React helpers
- `../../src/graph/adapters/react-dom/field-registry.tsx`,
  `../../src/graph/adapters/react-dom/filter.tsx`,
  `../../src/graph/adapters/react-dom/filter-editors.tsx`,
  `../../src/graph/adapters/react-dom/icon.tsx`,
  `../../src/graph/adapters/react-dom/resolver.tsx`: DOM adapter exports and
  capability registries
- `../../src/graph/adapters/react-dom/fields/`: DOM field-family view/editor
  modules and shared preview helpers
- `../../src/graph/adapters/react-opentui/index.ts`: terminal adapter entry
  file
