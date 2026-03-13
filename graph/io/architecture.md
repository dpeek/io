# Graph Architecture

## Purpose

This document is the high-level entry point for agents reasoning about the engine as a whole. It separates the current engine contract from broader platform ambitions that are still roadmap.

## Current Engine Model

### Durable primitives in code

- Stable opaque ids for types, predicates, field trees, nodes, and edges
- An append-oriented fact store with explicit retraction semantics
- Schema definitions for entities, scalars, and enums
- Typed client handles, typed entity refs, and typed predicate refs
- Predicate-slot subscriptions keyed by `(subjectId, predicateId)`
- Shared validation results across local mutation and authoritative apply
- Total sync plus authoritative write and incremental replay surfaces
- JSON persistence for authoritative snapshots plus retained write history

### Main source boundaries

- `../src/graph/store.ts`: append-only facts, batching, slot subscriptions, snapshots
- `../src/graph/schema.ts`: schema definitions, field trees, type helpers
- `../src/graph/identity.ts`: stable key-to-id resolution and id-map helpers
- `../src/graph/bootstrap.ts`: schema bootstrap into store facts
- `../src/graph/client.ts`: typed CRUD, refs, query, and validation lifecycle
- `../src/graph/authority.ts`: persisted authority orchestration and JSON load/save
- `../src/graph/sync.ts`: authoritative validation, sync sessions, write replay, and state
- `../src/graph/type-module.ts`: typed scalar/enum module contracts

## What Is Current

- The engine is in-memory first.
- Schema is authored with readable keys and resolved to stable ids.
- Local mutation is validated before commit.
- Authoritative snapshots and authoritative write results are validated before apply.
- The first query surface is typed and local-store-backed.
- Incremental sync is already represented as ordered authoritative transactions after a cursor.
- JSON persistence can recover snapshot state and retained write history across restart.

## What Is Not Yet Current

- Additional persistence backends beyond the current JSON file adapter
- Query-scoped partial sync and query-aware completeness
- A separate query planner or index subsystem beyond the current store traversal paths
- ACL, secret storage, or server action/runtime layers
- A full web or TUI renderer stack inside `graph`
- Time-travel, audit, or richer observability tooling in the package itself

## Architectural Direction

The likely direction is still the same as the legacy docs, but it should now be read as roadmap rather than current behavior:

- richer persistence backends beyond the current JSON snapshot-plus-history shape
- richer query and indexing contracts on top of the current typed client
- policy, secrets, and authoritative action layers above the core engine
- schema-driven UI built on typed refs and module metadata
- stronger explorer/devtool visibility into sync and validation boundaries

## Design Rules That Already Hold

- Keep the store schema-agnostic and stringly at the storage layer.
- Keep key-based authoring and id-based runtime use distinct.
- Keep reusable value rules with scalar/enum definitions.
- Keep predicate-specific rules with field definitions.
- Keep store-dependent graph invariants in the shared runtime validation pass.
- Keep UI adapter concerns outside the runtime core.

## Future Work Suggestions

1. Add one architecture diagram that maps current exported APIs to these source boundaries.
2. Document which roadmap items require new packages versus expansion of `graph`.
3. Document when the JSON persistence surface is sufficient versus when a new backend is warranted.
4. Capture intended observability hooks before sync and validation traces spread ad hoc.
5. Revisit this document whenever a roadmap item becomes a real exported engine contract.
