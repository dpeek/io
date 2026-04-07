---
name: App web authority storage
description: "Current SQLite-backed Durable Object storage adapter for the app-owned web graph authority."
last_updated: 2026-04-07
---

# App web authority storage

## Read this when

- you are changing the SQLite-backed Durable Object storage adapter
- you need the persisted-authority contract consumed by the web authority
- you are debugging retained rows, secret side storage, or startup recovery

## Decision summary

- use raw SQL against SQLite-backed Durable Objects
- do not introduce Drizzle in the authority write path
- persist graph transactions and current edge state incrementally rather than
  rewriting one opaque serialized graph blob
- keep secret plaintext in side storage separate from replicated graph facts
- treat derived indexes and retained projections as rebuildable derived state,
  not as the source of truth

## Current adapter split

- `../src/web/lib/graph-authority-sql-storage.ts`: stable persisted-authority
  SQL storage seam
- `../src/web/lib/graph-authority-sql-startup.ts`: startup metadata hydration
  and recovery classification
- `../src/web/lib/graph-authority-sql-secrets.ts`: secret-side storage,
  plaintext hydration, and orphan pruning
- `../src/web/lib/graph-authority-sql-retained-records.ts`: retained document
  rows
- `../src/web/lib/graph-authority-sql-workflow-projection.ts`: retained
  workflow projection rows
- `../src/web/lib/graph-authority-do.ts`: Durable Object bootstrap and request
  routing

## Current behavior

- the Durable Object constructor bootstraps the SQLite schema synchronously
- startup inspects retained history, retained rows, and secret side tables
  before declaring the authority ready
- accepted graph transactions commit through one Durable Object storage
  transaction that writes graph rows, retained rows, workflow projection rows,
  and secret rows together
- secret plaintext stays outside replicated graph facts
- missing or version-skewed secret side rows for live handles fail closed
- broken retained transaction windows force reset-baseline recovery instead of
  advertising stale cursors

## Durable split

The adapter stores:

1. current graph state for fast hydration
2. ordered transaction history for incremental sync and replay boundaries
3. retained rows and retained workflow projection state that can be rebuilt or
   re-materialized from authoritative graph facts

## Main tables

- `io_graph_meta`
- `io_graph_tx`
- `io_graph_tx_op`
- `io_graph_edge`
- `io_secret_value`
- `io_retained_record`

## Related docs

- [`./web-overview.md`](./web-overview.md): app-owned browser and Worker map
- [`./roadmap.md`](./roadmap.md): future auth and web direction
- [`../../graph-authority/doc/persistence.md`](../../graph-authority/doc/persistence.md):
  shared persisted-authority runtime contract
- [`../../graph-authority/doc/roadmap.md`](../../graph-authority/doc/roadmap.md):
  retained-record direction above the live authority graph
