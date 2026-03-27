# Graph Module Workflow

`@io/graph-module-workflow` is the canonical workspace package for the built-in
`workflow:` namespace.

## What It Owns

- the canonical `workflow` namespace assembly
- workflow entity, enum, and type definitions
- workflow command contracts and summary/result types
- workflow projection metadata, read-scope contracts, and invalidation helpers
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
- host-neutral React helpers from `@io/graph-react`
- web authority handlers in `lib/app/src/web/lib/*`
- live transport, routes, Durable Object composition, or other host/runtime adapters
- workflow UI components in `lib/app/src/web/components/*` or `lib/app/src/tui/*`

The package root is the canonical internal import surface for built-in
`workflow:` contracts, projection metadata, and query helpers. Web and TUI
runtime code consume this package; they do not extend it.
