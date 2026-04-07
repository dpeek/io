---
name: Graph authority roadmap
description: "Future retained-record and durable restore direction centered on @io/graph-authority."
last_updated: 2026-04-07
---

# Graph authority roadmap

## Read this when

- you are designing retained-record storage or restore semantics
- you need the boundary between live authority graph state and semantic
  retained records
- you are reading proposal work rather than the shipped authority runtime

## Current state

The current implementation already proves the first retained consumer for
document-oriented workspace memory:

- authoritative writes persist canonical retained `document` and
  `document-block` rows beside the live graph
- startup can load those retained rows even when the current live-graph
  metadata or retained-history baseline is missing
- durable restart reloads those retained rows and keeps restored workflow
  document memory readable through the live graph and workflow scopes
- retained rows can re-materialize `Document` and `DocumentBlock` facts when
  the live graph baseline must be rebuilt
- versioned retained payloads forward-migrate during load before
  re-materialization

The current proof does not yet extend that retained-record contract to later
families such as workflow artifacts, decisions, or broader context bundles.

## Problem

As the graph stores more real workspace data, not every persisted fact should
be treated as the long-term durable contract.

Some state is operational and rebuildable:

- current asserted edges
- retained sync history
- projection checkpoints
- derived indexes and read models

Some state is semantic workspace memory that should survive graph refactors,
field renames, type splits, and live-graph rebuilds:

- graph documents
- document blocks
- later workflow artifacts, decisions, and context bundles

Raw graph facts are too tightly coupled to the current graph shape to be the
only durable boundary for that kind of data.

## Proposed direction

Persist canonical retained records in SQL rows with versioned JSON payloads.

Use this split:

- SQL is the durable container and transaction boundary
- JSON payloads are the semantic retained-record contract
- live graph facts are the operational model materialized from those records
  for the current authority instance
- projections and indexes remain rebuildable derived state

## Storage direction

The default retained-record shape should stay close to:

- `record_kind`
- `record_id`
- `version`
- `payload_json`
- `created_at`
- `updated_at`
- `deleted_at`
- `materialized_at_cursor`

A later retained-history ledger may exist beside the current row if revision
history or repair diagnostics need it.

## Record design rules

- retained records should model semantic objects, not arbitrary graph slices
- every retained family owns a stable `record_kind`
- every retained object owns a stable `record_id`
- payload versions are forward-migrated explicitly and idempotently
- secrets and blobs should be referenced by durable handles, not embedded
  inline
- derived indexes may be promoted into side columns or side tables without
  becoming the canonical source of truth

## First retained family

The first retained-record family stays intentionally narrow:

- `record_kind = "document"`
- `record_kind = "document-block"`

The first restore target is durable authored workspace memory, not full
session-event playback.

That means the current milestone is about restoring meaningful document memory
through baseline repair, not reproducing every execution log line.

## Ownership split

- `@io/graph-authority` owns the shared retained-record contract, durable load
  or commit boundary, version migration, and re-materialization path above the
  live authority graph
- app-owned web storage code owns the current SQLite table layout and adapter
  mechanics
- workflow and higher product layers own which semantic record families are
  worth retaining and how restored records are consumed

## Source anchors

- `../src/persisted-authority.ts`
- `../../app/src/web/lib/graph-authority-sql-startup.ts`
- `../../app/src/web/lib/graph-authority-sql-storage.ts`
- `../../app/src/web/lib/graph-authority-sql-retained-records.ts`

## Related docs

- [`./persistence.md`](./persistence.md): current persisted-authority runtime
- [`./write-session.md`](./write-session.md): current authoritative session and
  replay behavior
- [`../../app/doc/authority-storage.md`](../../app/doc/authority-storage.md):
  current SQLite-backed web storage adapter
- [`../../graph-kernel/doc/roadmap.md`](../../graph-kernel/doc/roadmap.md):
  broader graph-engine roadmap
