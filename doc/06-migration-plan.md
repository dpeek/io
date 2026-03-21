# Migration Plan

This document collects the phased rollout from [`../roadmap.md`](../roadmap.md)
and the recommended first 90 days.

## Phased Roadmap

### Phase 0: Promote durable contracts

Freeze and document the stable contracts for:

- ids and schema
- fact and transaction model
- validation
- sync payloads
- object-view, workflow, and command specs
- authority and policy metadata

The roadmap treats this as the prerequisite for larger runtime changes.

### Phase 1: Harden the shipped SQLite authority baseline

The SQLite-backed Durable Object adapter and commit-oriented persistence
boundary are already shipped. This phase is now about hardening retained
history, restart recovery, cursor fallback, and the persisted-authority
boundary so downstream branches can treat the baseline as stable.

### Phase 2: Introduce module manifests and install permissions

Formalize module install, update, uninstall, required indexes, and requested
permissions. The registry can wait; built-in and local modules are enough to
prove the contract.

### Phase 3: Add blob-backed module families

Introduce file, blob, document, and image modules, R2 metadata refs, queue-
backed extraction, and import and export workflows.

### Phase 4: Move workflow into the graph

Model streams, features, tasks, runs, sessions, artifacts, and decisions in the
graph. Keep Linear as a temporary adapter or mirror until operator confidence is
high.

### Phase 5: Add scoped sync and materialized indexes

Before sharding, introduce scope definitions, scope cursors, completeness
semantics, index-backed collection queries, and subscription routing for live
scopes.

### Phase 6: Split authority into directory and shards

Add subject-home sharding, shard-local transaction history, a bounded cross-
shard planner, and migration tooling.

### Phase 7: Add federation

Expose only named shared predicates, views, workflows, and indexes behind
explicit capabilities. Do not expose arbitrary raw predicate traversal.

## Sequencing Rationale

The roadmap recommends this order because each step unlocks the next:

- SQL persistence makes durable authoritative state tractable
- the shipped SQL baseline is now available for downstream contracts to target
- module manifests prevent installability from becoming ad hoc later
- blob modules validate multi-tier storage and ingest early
- graph-native workflow gives the system a self-hosted proving ground
- scoped sync and indexes create the read model needed for sharding
- sharding before scoped sync would create uncontrolled fan-out
- federation before capabilities and projections would create security and cost
  risk

## Risks and Fallback Options

- SQLite authority hardening: keep the persisted-authority boundary small and a
  simple test backend available while the SQL path hardens
- workflow migration friction: dual-write or mirror from Linear-backed tasks
  into graph-native task types until operator tooling is credible
- scoped sync correctness: promote only materialized scopes first and keep ad
  hoc query views pull-only
- sharding complexity: keep a single-shard-per-graph deployment option for
  small graphs

## Recommended First 90 Days

### Days 1-30

- freeze the durable contracts in docs and code comments
- harden the `AuthoritativeGraphCommitBackend` boundary and the shipped
  SQLite-backed Durable Object adapter around retained history, restart
  recovery, and cursor fallback
- document and tighten the SQL row contracts around `io_graph_meta`,
  `io_graph_tx`, `io_graph_tx_op`, `io_graph_edge`, and `io_secret_value`
- keep non-Durable-Object test backends minimal and clearly non-canonical

### Days 31-60

- add a first-class module manifest format and install pipeline for built-in and
  local modules
- introduce blob, file, document, and image foundation modules with R2 metadata
  records and queue-backed extraction stubs
- add minimal observability for transaction commits, sync fallbacks, queue job
  status, and module install status

### Days 61-90

- define graph-native workflow types such as stream, feature, task, run,
  artifact, decision, and session
- mirror current Linear-backed task flows into graph-native workflow records
- design and implement the first scoped sync contract for one narrow scope class
- build one materialized collection index and one live scope registration proof
- end the period with one end-to-end demo:
  install module, ingest blob, produce graph entities, view them in the SPA,
  and let an agent retrieve a context bundle from graph-native workflow state

## Short Version

Stabilize the kernel, harden the shipped persistence baseline, formalize
modules, move workflow into the graph, and add scoped sync before sharding.
That sequence preserves the repo’s strongest current contracts while making the
target architecture achievable.
