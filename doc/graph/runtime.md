# Graph Runtime

## Purpose

This document is the entry point for agents working on the graph engine's
low-level runtime seams after the package split.

There is no longer a public non-React `@io/core/graph/runtime` surface. The
old catch-all runtime layer has been collapsed into the owning packages plus a
small root definition surface.

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

### Root Definition Surface

`@io/core/graph/def` is the small root-owned definition surface for graph
helpers that do not belong in an extracted package:

- type-module authoring helpers
- existing-entity reference authoring policy
- pure definition-time contracts such as `ObjectViewSpec`, `WorkflowSpec`, and
  `GraphCommandSpec`

Key source files:

- `../../src/graph/def.ts`
- `../../src/graph/type-module.ts`
- `../../src/graph/reference-policy.ts`
- `../../src/graph/definition-contracts.ts`

### React Runtime

The host-neutral React layer now lives in the extracted `@io/graph-react`
package:

- `@io/graph-react` publishes predicate hooks, entity traversal helpers,
  resolver contracts, persisted-mutation helpers, and synced-runtime React
  hooks
- `../../lib/graph-react/src/` contains those implementation files

The root package no longer exports `@io/core/graph/runtime/react`, and the old
`react-opentui` adapter was removed because its runtime provider and query
hooks were host-neutral.

### Internal Inspection Helpers

`../../src/graph/inspect.ts` contains internal helpers for turning store state
into plain objects and schema views.

Those helpers are intentionally not exported from the package surface because
they depend on core-schema conventions such as `core:predicate.key`,
`core:node.name`, and the built-in core scalar codecs.

## Current Constraints

- Storage stays opaque and string-based; scalar decode/encode lives above it.
- Field trees preserve authoring shape, but runtime linking uses resolved ids.
- Reference fields should be authored through `defineReferenceField(...)` or
  helpers layered on top of it.
- Store indexes remain an internal implementation detail; the public surface is
  still pattern lookups.
- Transport and generic command dispatch remain consumer-owned.

## Future Work Suggestions

1. Add one small end-to-end example showing schema authoring, id resolution, bootstrap, and a resulting store snapshot.
2. Document when `rangeOf(...)` is preferred over passing raw strings directly.
3. Add a short schema-evolution section covering safe rename and orphan-pruning workflows.
4. Document which lookup patterns should stay covered by the current in-store indexes before a real query planner exists.
