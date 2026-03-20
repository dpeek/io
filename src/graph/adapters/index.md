# Graph Adapters

## Purpose

This directory owns host-specific graph adapter composition while the package
tree keeps host-neutral graph behavior under runtime or modules.

## Current State

- `@io/core/graph/adapters/react` maps directly to
  `../../src/graph/adapters/react/` and backs the stable `@io/core/graph/react`
  shim
- `@io/core/graph/adapters/react-dom` maps directly to
  `../../src/graph/adapters/react-dom/` and owns DOM capability registries,
  fallback rendering, and editor composition
- `@io/core/graph/adapters/react-opentui` keeps the reserved terminal adapter
  boundary in one place while `@io/core/graph/react-opentui` stays as the
  stable shim
- the top-level `../../src/graph/react*` folders remain compatibility shims
  while ownership lives here or under `../../src/graph/runtime/react/`
