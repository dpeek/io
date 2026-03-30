# Graph Module Workflow

`@io/graph-module-workflow` is the canonical workspace package for the built-in
`workflow:` namespace.

## What It Owns

- the canonical `workflow` namespace assembly
- workflow entity, enum, and type definitions
- workflow command contracts and summary/result types, including retained
  session append, artifact-write, and decision-write surfaces
- workflow projection metadata, read-scope contracts, and invalidation helpers
- workflow query-surface catalogs for planner, saved-query, editor, and
  renderer registration
- retained workflow projection checkpoint and row types
- workflow query/projection index builders and projection schema
- workflow-owned `env-var` and `document` slices

## What It Depends On

- `@io/graph-module` for module authoring helpers
- `@io/graph-module-core` for built-in core scalar and shared value contracts
- `@io/graph-kernel` for ids and low-level graph helpers
- `@io/graph-client` for typed query helpers
- `@io/graph-projection` for retained projection and invalidation contracts

## What It Does Not Own

- generic helpers from `@io/graph-module`
- `core:` schema/contracts from `@io/graph-module-core`
- graph-owned saved-query, saved-query-parameter, and saved-view durability
  records from `@io/graph-module-core`
- host-neutral React helpers from `@io/graph-react`
- web authority handlers in `lib/app/src/web/lib/*`
- live transport, routes, Durable Object composition, or other host/runtime adapters
- workflow UI components in `lib/app/src/web/components/*` or `lib/cli/src/tui/*`

The package root is the canonical internal import surface for built-in
`workflow:` contracts, projection metadata, and query helpers. Web and TUI
runtime code consume this package; they do not extend it.

## Query Ownership

- `workflowQuerySurfaceCatalog` and the related
  `workflowBuiltInQuerySurface*` exports are workflow-local module metadata for
  planner, editor, renderer, and saved-query compatibility
- workflow owns the concrete projection-backed collection surfaces and the
  workflow review scope surface; it does not own the durable saved-query
  graph objects
- the current built-in registry combines this package-root catalog with the
  core package-root catalog in `lib/app/src/web/lib/query-surface-registry.ts`

Callers import workflow query-surface metadata through the package root:

```ts
import { workflowQuerySurfaceCatalog } from "@io/graph-module-workflow";
```

## Build Output

Run `turbo build --filter=@io/graph-module-workflow` from the repo root, or
`bun run build` in this package, to emit `./out`.
Run `turbo check --filter=@io/graph-module-workflow` from the repo root, or
`bun run check` in this package, to lint, format, type-check, and execute the
package-local Bun tests.
