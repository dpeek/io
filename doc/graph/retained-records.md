# Retained Records Proposal

## Purpose

Define the forward-looking persistence boundary for graph-backed workspace data
that must survive schema refactors, type splits, field renames, and authority
failures without snapshotting the entire graph.

This proposal sits above the current authoritative graph storage described in
[`./storage.md`](./storage.md). That storage keeps the live graph durable. This
document proposes how to keep selected workspace memory durable even when the
graph shape around it changes or the live graph must be rebuilt.

## Status

This is a working proposal, not current runtime behavior.

The current implementation persists:

- authoritative graph rows and retained transaction history
- secret side storage
- retained workflow projections as rebuildable derived state

The current implementation does not yet publish a separate retained-record
contract for migration-stable workspace data.

## Logical Ownership

This proposal is primarily a Branch 6 concern built on top of Branch 1.

- Branch 6 owns the product contract for durable workspace memory: graph
  documents, workflow artifacts, decisions, context bundles, and other
  retained agent-facing records.
- Branch 1 owns the persistence substrate those records live on: the authority
  transaction model, durable storage adapter, and restart-safe recovery rules.

This is not mainly about installable module lifecycle state. It is about how a
workspace can recover durable graph-native documents and agent memory after a
bad migration, storage repair, or live-graph rebuild.

## Problem

As the graph starts storing real workspace data, not every persisted fact
should be treated the same way.

Some graph state is operational:

- current asserted edges
- retained sync history
- projection checkpoints
- derived indexes
- helper and denormalized read models

Some graph state represents durable workspace memory we explicitly want to keep
through refactors or recovery:

- graph `Document` content for notes, specs, and planning docs
- branch and commit context documents
- workflow artifacts and decisions
- retained session or context history with restore value

Persisting selected raw graph edges is too tightly coupled to the current graph
shape. A field rename, type split, cardinality change, or namespace move can be
perfectly safe at the product level while still forcing awkward graph-shape
migrations if raw edges are treated as the long-term durable contract.

The practical failure mode is simple: if an agent spends days building up graph
documents and workflow memory for one workspace, we need a way to restore those
records even if the live graph storage becomes unusable or must be rewritten.

## Recommendation

Persist canonical retained records in SQL rows with versioned JSON payloads.

Use this split:

- SQL is the durable container and transaction boundary.
- JSON payloads are the semantic record contract.
- graph facts are the live operational model materialized from those records
  for the current authority instance.
- projections and indexes remain rebuildable derived state.

This keeps durable storage tied to stable business meaning rather than to the
exact current graph predicate layout.

For the first concrete use case, the retained boundary should focus on
workspace-native Branch 6 records:

- `Document`
- `DocumentBlock`
- `WorkflowArtifact`
- `WorkflowDecision`
- `ContextBundle`
- `ContextBundleEntry`

The exact record families may expand later, but the first goal is to preserve
workspace notes, specs, context, and execution outputs without requiring whole-
graph snapshots.

## Why SQL Plus JSON

### Why not raw selected graph facts

Raw facts are good operational state, but they are the wrong semantic boundary
for long-lived retained data.

They encode today's:

- type layout
- predicate names
- field-tree structure
- helper edges
- normalization choices

That makes durable retention too sensitive to refactors that should otherwise be
routine.

### Why not one large JSON blob

One blob is easy to start with, but it makes concurrent updates, uniqueness,
partial reads, repair, and migration bookkeeping harder than they need to be.

It is also a poor fit for the existing SQLite-backed authority direction.

### Why not JSONL as the authority

JSONL is a good log shape, not a good authority shape.

It works well for:

- export and import
- append-only audit streams
- debug and replay artifacts

It works poorly as the only canonical store for real app data because the
system still needs:

- atomic updates
- current-state lookup
- uniqueness constraints
- indexed reads
- compaction
- crash-safe recovery

Once those are required, the system has rebuilt a database around the JSONL
file. The current repo already has SQLite in the authority path, so the simpler
direction is to keep the log shape inside SQL rather than make flat JSONL files
the source of truth.

### Why not fully normalized relational tables

Fully normalizing every retained field couples durable storage too tightly to
today's schema shape.

That is appropriate for a few hot selectors and invariants, but not as the
default for migration-stable retained data.

## Proposed Storage Shape

The default retained-record shape should be:

```text
io_retained_record
- record_kind
- record_id
- version
- payload_json
- created_at
- updated_at
- deleted_at
- materialized_at_cursor
```

Optional retained-history ledger:

```text
io_retained_record_event
- seq
- record_kind
- record_id
- version
- event_kind
- payload_json
- committed_at
```

Interpretation:

- `record_kind` identifies the stable retained record family
- `record_id` is the stable logical identity of one retained object
- `version` is the payload schema version, not the graph cursor
- `payload_json` stores the canonical business object
- `deleted_at` is a tombstone for non-destructive delete semantics
- `materialized_at_cursor` records which authoritative graph baseline the row
  has been materialized into, if the runtime needs that checkpoint

For document-bearing records, a later refinement may split immutable revision
events from the current-head row. Branch 6 already has the adjacent open
question of whether `Document` should own explicit revision snapshots.

## Record Design Rules

- retained records should model semantic objects, not arbitrary graph slices
- every retained record family owns a stable `record_kind`
- every retained object owns a stable `record_id`
- payload versions are forward-migrated explicitly and idempotently
- secrets and blobs are referenced by durable handles, not embedded inline
- derived indexes may be promoted into side columns or side tables without
  becoming the canonical source of truth

## Materialization Model

The intended runtime flow is:

1. authoritative write updates one or more retained records
2. the same authority transaction materializes the corresponding graph facts
3. derived projections or indexes rebuild incrementally from graph state or the
   retained record ledger

That gives the system three distinct layers:

- retained records: semantic durability layer
- graph facts: live operational model
- projections and indexes: rebuildable read layer

The graph remains central to the product. It is just no longer forced to be the
only recovery-grade representation of every durable workspace object.

## Restore Semantics

The retained boundary should let the runtime recover selected workspace data
without replaying or preserving the entire graph forever.

Expected restore properties:

- if retained sync history is pruned or unusable, workspace documents and
  retained workflow memory still remain restorable
- if projections are lost, they rebuild from graph facts or retained records
- if the live graph baseline must be rewritten, retained workspace records can
  be re-materialized into a fresh graph baseline
- restore targets the selected durable workspace surface, not every helper edge
  or transient read model ever written

This is the main reason to add a retained-record layer at all.

## When To Promote Fields Out Of JSON

Keep fields inside `payload_json` by default.

Promote a field into indexed SQL columns or side tables only when one of these
is true:

- the field participates in uniqueness checks
- the field is a common lookup key
- the field drives scheduling or retention scans
- the field is needed for selective rebuilds without decoding every row
- the field has join-heavy read paths that are operationally important

Promoted columns remain helpers around the canonical payload, not replacements
for it.

## Migration Contract

Retained-record migrations should be:

- forward-only in the stable contract
- idempotent per `(record_kind, record_id, from_version, to_version)` step
- explicit about semantic changes rather than graph-shape rewrites

The preferred migration surface is:

```ts
type RetainedRecordMigration = {
  recordKind: string;
  fromVersion: number;
  toVersion: number;
  migrate(payload: unknown): unknown;
};
```

Graph materialization then consumes the migrated canonical payload rather than
trying to infer workspace meaning from partially stale graph facts.

## Relationship To Existing Graph Storage

[`./storage.md`](./storage.md) should remain the canonical doc for the current
SQLite Durable Object authority tables and commit path.

This document adds a second boundary above it:

- `storage.md`: how the live authoritative graph is stored today
- `retained-records.md`: how selected durable workspace data should survive
  refactors, recovery, and graph-baseline rewrites over time

If this proposal hardens into a canonical branch contract, its primary home
should move under Branch 6 with a smaller Branch 1 note covering the storage
seam needed to support it.
