# Durable Object Storage Adapter

## Purpose

Document the current SQLite-backed Durable Object storage adapter used by the
web graph authority and the persisted-authority contract it consumes.

The previous Durable Object path persisted one opaque blob containing the full
graph `snapshot`, retained `writeHistory`, and secret side-data on every
mutation. That was simple, but it was the wrong shape for a graph runtime whose
writes are already represented as ordered transactions.

The current adapter uses raw SQLite access inside the Durable Object and
persists graph mutations incrementally.

## Decision Summary

- Use raw SQL against SQLite-backed Durable Objects.
- Do not introduce Drizzle in the write path.
- Persist graph transactions and current edge state incrementally rather than
  rewriting a whole serialized graph blob.
- Keep secret plaintext in side storage separate from replicated graph facts.
- Treat derived indexes as rebuildable projections, not as the source of truth.

## Confirmed Platform Capabilities

Cloudflare's current SQLite-backed Durable Object docs materially change the
design space:

- Cloudflare recommends SQLite-backed Durable Objects for all new Durable Object
  namespaces.
- `ctx.storage.sql.exec(...)` is synchronous and the official examples show it
  being used directly in the Durable Object constructor.
- SQLite-backed Durable Objects also expose synchronous `ctx.storage.kv` APIs.
- Multi-step atomic work should use `ctx.storage.transaction()` or
  `ctx.storage.transactionSync()`. The docs explicitly say `sql.exec()` cannot
  run `BEGIN TRANSACTION` directly.
- Point-in-time recovery covers both SQL data and key-value data in the same
  Durable Object database.

Official references:

- <https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/>
- <https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/>

## Current Status

The first raw-SQL Durable Object adapter now exists in
`../../src/web/lib/graph-authority-do.ts`.

Current behavior:

- the Durable Object constructor bootstraps the SQLite schema synchronously
- startup hydrates graph snapshot rows, retained transaction rows, and secret
  side-data from SQL tables
- optional metadata reads iterate the SQL cursor directly so an unseeded table
  cleanly returns "no row" instead of depending on `cursor.one()`
- startup treats broken retained transaction windows as reset baselines instead
  of advertising stale cursors after restart
- retained history is pruned by transaction count (currently a 128-transaction
  window), advancing
  `history_retained_from_seq` and forcing old cursors onto total-sync fallback
- accepted graph transactions commit through one Durable Object storage
  transaction that writes `io_graph_tx`, `io_graph_tx_op`, `io_graph_edge`, and
  `io_secret_value`
- accepted authoritative results now carry `writeScope`, so durable state keeps
  `client-tx` versus `server-command` origin across commit, restart, and
  baseline rewrites for data written after `writeScope` existed
- additive compatibility is explicit: older `io_graph_tx` tables gain a
  `write_scope` column with a `client-tx` default, and legacy JSON write
  histories without `writeScope` are normalized and rewritten through the
  shared persisted-authority path rather than treated as exact pre-migration
  audit truth

### Constructor Implication

Yes: with SQLite-backed Durable Objects we can now do synchronous SQL work in
the constructor.

That does not mean all initialization should move there.

Good constructor work:

- `CREATE TABLE IF NOT EXISTS ...`
- `CREATE INDEX IF NOT EXISTS ...`
- reading tiny metadata rows needed to decide bootstrap behavior
- preparing any in-memory adapter state that does not require `await`

Work that should still stay in `blockConcurrencyWhile(...)`:

- async bootstrap paths
- seeding flows that call async helpers
- any future external secret-manager calls
- any hydration flow we want to keep explicitly ordered and testable

The constructor should establish schema and cheap invariants. The authority
bootstrap path should still own full runtime hydration.

## Previous Blob Path

The old Durable Object adapter stored one key:

- full `StoreSnapshot`
- full retained `AuthoritativeGraphWriteHistory`
- full secret side-map

That means every accepted mutation pays for:

- serializing the full graph
- writing the full graph
- writing the full retained history again
- writing the full secret map again

The graph runtime already has a better unit of persistence:

- one accepted graph transaction
- one ordered cursor
- one bounded history window for incremental sync

The SQLite adapter now persists those units directly.

## Design Goals

- Persist accepted graph mutations incrementally.
- Rehydrate the in-memory graph without replaying the entire lifetime history.
- Preserve exact transaction ordering and cursor behavior for sync.
- Keep the graph store authoritative for facts and safe metadata.
- Keep secret plaintext outside replicated graph state.
- Make common graph reads indexable with explicit SQL indexes.
- Keep the adapter small and auditable.

## Non-Goals

- Modeling the graph as a conventional relational domain schema.
- Replacing the in-memory graph runtime with direct SQL-backed query execution.
- Storing large binary payloads in the graph fact tables.
- Designing every future derived index up front.

## Storage Model

The adapter stores two kinds of durable state:

1. Current graph state for fast hydration and local authoritative reads.
2. Ordered transaction history for incremental sync and replay boundaries.

### Authoritative Tables

#### `io_graph_meta`

One-row metadata table.

Columns:

- `id INTEGER PRIMARY KEY CHECK (id = 1)`
- `schema_version INTEGER NOT NULL`
- `cursor_prefix TEXT NOT NULL`
- `head_seq INTEGER NOT NULL`
- `head_cursor TEXT NOT NULL`
- `seeded_at TEXT`
- `history_retained_from_seq INTEGER NOT NULL`
- `updated_at TEXT NOT NULL`

Purpose:

- durable adapter versioning
- cursor prefix ownership
- current head sequence/cursor
- bounded-history reset boundary
- seeded/bootstrap bookkeeping

#### `io_graph_tx`

One row per accepted authoritative transaction.

Columns:

- `seq INTEGER PRIMARY KEY`
- `tx_id TEXT NOT NULL UNIQUE`
- `cursor TEXT NOT NULL UNIQUE`
- `committed_at TEXT NOT NULL`
- `write_scope TEXT NOT NULL CHECK (write_scope IN ('client-tx', 'server-command', 'authority-only'))`

Purpose:

- canonical transaction order
- cursor lookup for incremental sync
- duplicate transaction detection
- sync retention window management
- authoritative origin retention for audit and restart-safe replay semantics

Compatibility note:

- older rows are backfilled as `client-tx` when the additive `write_scope`
  column is installed; that preserves compatibility but does not recover lost
  pre-migration `server-command` or `authority-only` origin

#### `io_graph_tx_op`

One row per write operation in a transaction.

Columns:

- `tx_seq INTEGER NOT NULL`
- `op_index INTEGER NOT NULL`
- `op_kind TEXT NOT NULL CHECK (op_kind IN ('assert', 'retract'))`
- `edge_id TEXT NOT NULL`
- `s TEXT`
- `p TEXT`
- `o TEXT`
- `PRIMARY KEY (tx_seq, op_index)`

Purpose:

- exact reconstruction of `GraphWriteTransaction`
- incremental sync delivery
- audit/debug visibility into accepted writes

Notes:

- `s`, `p`, and `o` are populated for `assert`
- only `edge_id` is required for `retract`

#### `io_graph_edge`

One row per asserted edge, retained even after retraction.

Columns:

- `edge_id TEXT PRIMARY KEY`
- `s TEXT NOT NULL`
- `p TEXT NOT NULL`
- `o TEXT NOT NULL`
- `asserted_tx_seq INTEGER NOT NULL`
- `retracted_tx_seq INTEGER`
- `retracted_op_index INTEGER`

Purpose:

- durable materialized graph state
- fast authority hydration into `StoreSnapshot`
- local graph queries over current facts
- preservation of retracted edge ids for snapshot fidelity

This table is the durable fact store. Retraction marks a row; it does not
delete it. `retracted_op_index` preserves the in-transaction or compacted
snapshot order of retractions so restart hydration can rebuild
`StoreSnapshot.retracted` exactly.

#### `io_secret_value`

Authority-only secret side storage.

Columns:

- `secret_id TEXT PRIMARY KEY`
- `value TEXT NOT NULL`
- `version INTEGER NOT NULL`
- `stored_at TEXT NOT NULL`
- `provider TEXT`
- `fingerprint TEXT`
- `external_key_id TEXT`

Purpose:

- plaintext or sealed secret payload storage
- future migration path toward an external secret provider
- separation between graph metadata and secret material

The graph should continue to store only `secretHandle` identity and safe
metadata. This table owns the actual secret value lifecycle.

### Optional Later Tables

These are not required for the first adapter cut:

#### `io_graph_checkpoint`

Store explicit checkpoints only if hydration from `io_graph_edge` becomes too
slow or if we later want snapshot export/import workflows.

#### `io_graph_fts_*`

Full-text or retrieval indexes. These should be rebuildable from authoritative
graph rows and blob metadata.

#### `io_graph_projection_*`

Module-specific or UI-specific materialized views. These should also be
rebuildable.

## Required Indexes

The current adapter uses a very small set of explicit indexes:

- `io_graph_edge(s, p)` for subject-predicate lookups
- `io_graph_edge(p, o)` for reverse/reference lookups
- `io_graph_edge(retracted_tx_seq)` for current-vs-retracted scans
- `io_graph_tx(cursor)` unique
- `io_graph_tx(tx_id)` unique
- `io_graph_tx_op(tx_seq, op_index)` primary key

If partial indexes are supported in the Durable Object SQLite environment, add
live-fact indexes such as:

- `io_graph_edge(s, p) WHERE retracted_tx_seq IS NULL`
- `io_graph_edge(p, o) WHERE retracted_tx_seq IS NULL`

Do not invent more indexes until a read path needs them. Index writes count
toward SQL write volume.

## Adapter Behavior

### Load / Hydration

On startup:

1. The constructor creates tables and indexes synchronously if they do not
   exist.
2. `blockConcurrencyWhile(...)` loads adapter metadata.
3. The adapter reads all rows from `io_graph_edge`.
4. It reconstructs `StoreSnapshot` as:
   - `edges`: every row in `io_graph_edge`
   - `retracted`: every `edge_id` where `retracted_tx_seq IS NOT NULL`
5. It reads the retained transaction window from `io_graph_tx` and
   `io_graph_tx_op`.
6. It rebuilds `AuthoritativeGraphWriteHistory` from those retained rows.
7. It loads `io_secret_value` into the authority-owned secret map.

This avoids replaying the entire historical log just to rebuild the current
graph.

### Commit

For every accepted mutation:

1. The in-memory graph runtime validates and applies the transaction.
2. The adapter opens one Durable Object storage transaction.
3. It inserts the `io_graph_tx` row.
4. For each `assert` op:
   - insert one `io_graph_tx_op` row
   - insert one `io_graph_edge` row
5. For each `retract` op:
   - insert one `io_graph_tx_op` row
   - update `io_graph_edge.retracted_tx_seq`
6. It writes any secret side-data updates in the same transaction.
7. It updates `io_graph_meta.head_seq`, `head_cursor`, and `updated_at`.
8. It commits.

If the SQL transaction fails, the in-memory authority should roll back to the
previous snapshot exactly as it does today.

### Incremental Sync

Incremental sync reads from retained transaction rows, not from a serialized
in-memory history blob.

Behavior:

- if `after` matches a retained cursor, return later retained transactions
- if `after` is the current head cursor, return an empty change set
- if `after` is older than `history_retained_from_seq` or unknown, return a
  reset/fallback result and force total snapshot recovery

This matches the existing sync contract without whole-graph rewrites.

### Retention

The adapter retains only a bounded transaction window for incremental sync.

Retention can be defined by:

- maximum retained transaction count
- maximum retained age

When old transaction rows are pruned:

- `io_graph_edge` remains authoritative
- `io_graph_tx_op` rows older than the boundary are deleted
- `io_graph_tx` rows older than the boundary are deleted
- `io_graph_meta.history_retained_from_seq` advances

Older clients then fall back to total sync, which is already part of the sync
model.

## Secret Handling

Secret-backed fields already have the right logical split:

- graph facts store the `secretHandle` reference and safe metadata
- authority side storage stores the secret value

The current adapter preserves that split:

- secret writes commit alongside the graph transaction in one DO storage
  transaction
- the graph transaction never embeds plaintext secret data
- the secret table schema still allows a later move to sealed payloads
  or an external provider handle

## What Else We Need To Store

For the first adapter, store only what the current authority actually needs:

- graph facts
- transaction log rows for retained sync history
- authority metadata
- secret side-data

The broader storage roadmap still reserves space for:

- module manifests
- workflow state
- agent execution records
- blob metadata and object-storage references
- rebuildable derived indexes

Large raw payloads still do not belong in the graph fact store.

## Why Raw SQL Instead Of Drizzle

This adapter is not a normal ORM-shaped application data model.

It needs:

- exact control over transaction order
- exact control over cursor and retention behavior
- exact control over indexes and query shapes
- exact control over how graph ops map to storage writes

Raw SQL is the simpler and more honest abstraction here.

If we want migration helpers later, Drizzle can be reconsidered for schema
generation only. It should not define the graph adapter contract.

## Persistence Boundary

The graph package now exposes a commit-oriented persistence boundary so
authoritative runtimes no longer assume that every accepted mutation rewrites a
whole serialized state blob.

The current shape is:

```ts
type PersistedAuthoritativeGraphStorageLoadResult = {
  snapshot: StoreSnapshot;
  writeHistory?: AuthoritativeGraphWriteHistory;
  needsPersistence: boolean;
};

interface PersistedAuthoritativeGraphStorage {
  load(): Promise<PersistedAuthoritativeGraphStorageLoadResult | null>;
  commit(input: {
    snapshot: StoreSnapshot;
    transaction: GraphWriteTransaction;
    result: AuthoritativeGraphWriteResult;
    writeHistory: AuthoritativeGraphWriteHistory;
  }): Promise<void>;
  persist(input: {
    snapshot: StoreSnapshot;
    writeHistory: AuthoritativeGraphWriteHistory;
  }): Promise<void>;
}
```

Important point:

- `commit(...)` is the primary durable write path
- `persist(...)` is reserved for explicit snapshot baselines and hydration
  rewrites, not the normal mutation path
- `AuthoritativeGraphWriteResult.writeScope` is the storage-boundary field that
  lets adapters durably retain `client-tx` versus `server-command` origin
  without inventing a second source of truth

The web authority can then layer secret side-data writes on top of that graph
commit.

## Implementation Status

Done in the current web Durable Object path:

- the Durable Object constructor bootstraps tables and indexes synchronously
- `graph` exposes the `load(...)`, `commit(...)`, and `persist(...)`
  persistence boundary consumed by the adapter
- accepted writes append `io_graph_tx` including `write_scope`, append
  `io_graph_tx_op`, materialize `io_graph_edge`, and upsert `io_secret_value`
  inside one Durable Object storage transaction
- startup hydrates snapshot rows and retained transaction rows from SQL, and
  rewrites reset baselines when retained history no longer matches the hydrated
  head
- retained history is bounded by transaction count, `history_retained_from_seq`
  advances with pruning, and old or unknown cursors fall back to total sync
- file-backed persisted authorities normalize legacy write histories that lack
  `writeScope` to `client-tx` and rewrite them through the same shared
  persistence contract instead of claiming exact historical authority origin
- coverage in `../../src/web/lib/graph-authority-do.test.ts` exercises
  constructor bootstrap, restart hydration, retained-history pruning, reset
  baselines, rollback on SQL failure, secret side-storage behavior, and
  retraction fidelity, including persisted write-scope recovery
- the web Durable Object authority path in
  `../../src/web/lib/graph-authority-do.ts` no longer uses
  `state.storage.get/put(...)` whole-blob persistence

Still deferred:

- optional checkpoint and projection tables only if read or recovery paths
  justify them

## Current Outcome

- one mutation no longer rewrites the whole graph
- startup hydrates from explicit rows rather than a giant serialized blob
- incremental sync history is retained intentionally instead of accidentally
- secret storage stops piggybacking on the graph blob
- the adapter becomes smaller, more explicit, and easier to reason about under
  load
