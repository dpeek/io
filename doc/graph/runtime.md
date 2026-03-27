# Graph Runtime

## Purpose

This document is the entry point for agents working on the graph engine's
low-level runtime seams after the package split.

There is no longer a public non-React `@io/app/graph/runtime` surface. The
old catch-all runtime layer has been collapsed into the owning packages plus a
small extracted module-authoring surface.

## Current Ownership

### Kernel

`@io/graph-kernel` is the source of truth for:

- ids and stable id generation
- append-oriented store primitives
- schema authoring helpers for entities, scalars, and enums
- stable id mapping and namespace resolution
- predicate policy descriptor helpers, including fallback policy lowering

Key source files:

- `../../lib/graph-kernel/src/id.ts`
- `../../lib/graph-kernel/src/store.ts`
- `../../lib/graph-kernel/src/schema.ts`
- `../../lib/graph-kernel/src/identity.ts`

### Bootstrap

`@io/graph-bootstrap` owns:

- additive bootstrap into a live store
- bootstrapped snapshot creation
- bootstrap-facing schema requirements
- bootstrap-specific icon seed/resolver contracts

Key source file:

- `../../lib/graph-bootstrap/src/index.ts`

### Authority

`@io/graph-authority` owns:

- authoritative write sessions and persisted-authority contracts
- auth subject, principal session, and browser bootstrap/session summary contracts
- admission/share/module-permission contracts
- replication filtering and authority validation helpers

Key source files:

- `../../lib/graph-authority/src/session.ts`
- `../../lib/graph-authority/src/persisted-authority.ts`
- `../../lib/graph-authority/src/contracts.ts`

### `@io/graph-module` Package

`@io/graph-module` is the definition-time authoring package layered directly
above `@io/graph-kernel`:

- type-module authoring helpers
- existing-entity reference authoring policy
- pure definition-time contracts such as `ObjectViewSpec`, `WorkflowSpec`, and
  `GraphCommandSpec`

Naming note:

- use "graph modules" for concrete namespace slices such as `core` and
  `workflow`
- use "type modules" for the reusable `{ type, meta, filter, field(...) }`
  authoring objects exposed by `@io/graph-module`

Key source files:

- `../../lib/graph-module/src/index.ts`
- `../../lib/graph-module/src/type-module.ts`
- `../../lib/graph-module/src/reference-policy.ts`
- `../../lib/graph-module/src/definition-contracts.ts`

### `@io/graph-module-core` Package

`@io/graph-module-core` is the extracted built-in `core:` package:

- canonical `core:` namespace assembly
- built-in scalar/entity/enum families
- core bootstrap inputs and colocated icon seed ownership
- structured-value helpers plus locale/country/currency datasets

Key source files:

- `../../lib/graph-module-core/src/index.ts`
- `../../lib/graph-module-core/src/app.ts`
- `../../lib/graph-module-core/src/app/bootstrap.ts`
- `../../lib/graph-module-core/src/icon/seed.ts`
- `../../lib/graph-module-core/src/icon/resolve.ts`

### React Runtime

The host-neutral React layer now lives in the extracted `@io/graph-react`
package:

- `@io/graph-react` publishes predicate hooks, entity traversal helpers,
  resolver contracts, persisted-mutation helpers, and synced-runtime React
  hooks
- `../../lib/graph-react/src/` contains those implementation files
- `@io/graph-module-core/react-dom` now owns the current browser/DOM adapter
  layer on top of those contracts, including the default field/filter
  capabilities, graph-aware SVG helpers, `GraphIcon`, structured-value
  editors, and tag-aware entity-reference behavior

The root package no longer exports `@io/app/graph/runtime/react`, and the old
`react-opentui` adapter was removed because its runtime provider and query
hooks were host-neutral.

### Internal Inspection Helpers

`../../lib/app/src/graph/inspect.ts` contains internal helpers for turning store state
into plain objects and schema views.

Those helpers are intentionally not exported from the package surface because
they depend on core-schema conventions such as `core:predicate.key`,
`core:node.name`, and the built-in core scalar codecs.

## Current Constraints

- Storage stays opaque and string-based; scalar decode/encode lives above it.
- Field trees preserve authoring shape, but runtime linking uses resolved ids.
- Reference fields should be authored through `@io/graph-module`.
- Store indexes remain an internal implementation detail; the public surface is
  still pattern lookups.
- Transport and generic command dispatch remain consumer-owned.

## Future Work Suggestions

1. Add one small end-to-end example showing schema authoring, id resolution, bootstrap, and a resulting store snapshot.
2. Document when `rangeOf(...)` is preferred over passing raw strings directly.
3. Add a short schema-evolution section covering safe rename and orphan-pruning workflows.
4. Document which lookup patterns should stay covered by the current in-store indexes before a real query planner exists.
