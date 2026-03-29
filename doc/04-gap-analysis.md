# Gap Analysis

This document isolates the main gaps between the current repo and the target
platform model.

## What Is Missing

Relative to the target vision, the repo is missing or only partially proving:

- a per-user graph deployment model
- a multi-shard Durable Object topology
- a query planner and index subsystem
- scoped partial sync
- live subscription routing
- installable module manifests plus registry and discovery flow
- a blob tier and ingestion pipeline
- graph-native workflow replacing Linear
- principal-aware policy beyond the current predicate-metadata direction
- a Better Auth integration boundary
- controlled federation and provenance-aware remote facts
- observability strong enough for sharded and federated operation

## What Must Be Refactored

### 1. Persistence boundary

Move from snapshot-only load and save to commit-oriented authoritative
persistence. The storage roadmap already identifies this as a prerequisite for
sharding, scoped sync, and durable indexes.

### 2. Authority model promotion

Predicate metadata, business-method dispatch, and secret semantics need to
become durable runtime contracts rather than remaining mostly conceptual.

### 3. Workflow substrate

The agent package still depends on issue-driven automation and Linear polling.
That needs a staged replacement with graph-native work entities.

### 4. Module boundary formalization

Root-safe object views, workflows, and commands already exist as contracts, but
installability, permissioning, migrations, and packaging are not yet stable
platform surfaces.

### 5. Sync contract extension

The current `{ kind: "graph" }` sync model needs to grow into scoped sync
without losing correctness.

## What Can Be Kept

The roadmap recommends preserving and promoting these surfaces:

- the stable id model and id-map workflow
- the append-oriented fact store with tombstoned retraction
- schema-as-graph-data bootstrap
- typed refs and predicate-slot subscriptions
- local plus authoritative validation lifecycle
- total and incremental sync payload shapes with cursor semantics
- root-safe object-view, workflow, and command contracts
- Worker-hosted operator surfaces
- the graph-first mental model shared by UI and agent runtime
