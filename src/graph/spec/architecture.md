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
- A persisted authority wrapper that validates reloads, preserves cursor continuity, and rolls back failed saves

### Main source boundaries

- `../../src/graph/runtime/store.ts`: append-only facts, batching, slot subscriptions, snapshots
- `../../src/graph/runtime/schema.ts`: schema definitions, field trees, type helpers
- `../../src/graph/runtime/identity.ts`: stable key-to-id resolution and id-map helpers
- `../../src/graph/runtime/bootstrap.ts`: schema bootstrap into store facts
- `../../src/graph/runtime/client.ts`: typed CRUD, refs, query, and validation lifecycle
- `../../src/graph/runtime/authority.ts`: persisted authority orchestration, storage contracts, and JSON hydration/commit/persist helpers
- `../../src/graph/runtime/sync.ts`: authoritative validation, sync sessions, write replay, and state
- `../../src/graph/runtime/type-module.ts`: typed scalar/enum module contracts

## What Is Current

- The engine is in-memory first.
- Schema is authored with readable keys and resolved to stable ids.
- Local mutation is validated before commit.
- Authoritative snapshots and authoritative write results are validated before apply.
- The first query surface is typed and local-store-backed.
- Incremental sync is already represented as ordered authoritative transactions after a cursor.
- JSON persistence can recover snapshot state and retained write history across restart.
- The graph package owns the persisted-authority contract, including versioned state shape, legacy rewrite, and save rollback semantics.

## Current Schema Ownership

The initial namespace and schema-module ownership rules are concrete now:

- `core:` is reserved for the engine metamodel plus the shared built-in type
  families shipped from `../../src/graph/modules/core/`. That means `core:node`,
  `core:type`, `core:predicate`, `core:enum`, `core:string`, `core:number`,
  `core:boolean`, `core:date`, `core:url`, `core:email`, `core:slug`,
  `core:address`, `core:country`, `core:currency`, `core:language`, and
  `core:locale` stay in `core:` for now.
- `pkm:` and `ops:` are the current product namespace buckets justified today.
  `pkm:` carries the knowledge/workflow proof types such as topics, while
  `ops:` owns environment configuration slices such as env vars.
- Do not pre-create extra namespace buckets such as `geo:`, `locale:`,
  `finance:`, or `collab:` before reusable code actually needs them.
- Promotion into a more specific namespace should happen only as a concrete
  refactor that updates imports, tests, and docs together, as the topic move to
  `pkm:` and the env-var move to `ops:` did.

The `graph` package owns canonical namespace keys and the long-term schema
module layout for `core:` plus the current product namespaces. Consumer
packages such as `app` compose those modules into routes, seed data, and
authority surfaces, but they do not own new durable namespace buckets.

## What Is Not Yet Current

- Additional persistence backends beyond the current JSON file adapter
- Query-scoped partial sync and query-aware completeness
- A separate query planner or index subsystem beyond the current in-store indexes and traversal paths
- ACL, secret storage, or server action/runtime layers
- A built-in HTTP or live transport layer inside `graph`
- A full web or TUI renderer stack inside `graph`
- Time-travel, audit, or richer observability tooling in the package itself

## Ownership Boundary

- `graph` owns the authoritative persistence primitives: the storage contract, JSON adapter, versioned persisted state, retained write history, cursor recovery, and rollback-on-durable-write-failure behavior.
- Consumer packages own composition around those primitives: bootstrap ordering, seed policy, file-path/config resolution, and process lifecycle.
- Transport remains consumer-owned. `graph` defines the sync payloads and replay rules, while packages like `app` choose how to expose them over HTTP or other transports.

## Architectural Direction

The likely direction is still the same as the legacy docs, but it should now be read as roadmap rather than current behavior:

- additional persistence backends beyond the current JSON snapshot-plus-history shape
- richer query and indexing contracts on top of the current typed client
- policy, secrets, and authoritative action layers above the core engine
- live transport layers over the existing total/incremental sync contracts
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
