# Current-State Architecture

This document summarizes what the repo appears to prove today across the
current workspace packages.

## Major Subsystems

The repo root now coordinates a set of workspace packages across the operator
runtime, config and context resolution, workflow contracts, graph runtime, web
surface, and shared browser and utility layers.

The current architecture is best described as:

- Graph kernel: reusable, in-memory-first graph runtime with persistence and
  sync
- Web operator surface: Worker-hosted SPA with explorer, sync monitor, and
  graph bootstrap
- Agent runtime: issue-driven automation layer with scheduling, worktree
  lifecycle, context assembly, Codex runner integration, retained runtime
  files, and TUI
- Persistence and authority layer: SQLite-backed Durable Object authoritative
  persistence with retained transaction history and authority-only secret side
  storage

## Package and Runtime Boundaries

### Graph package

`graph` owns schema authoring, stable ids, append-only facts, typed refs,
validation, sync, persisted authoritative runtimes, and type-module contracts.
It intentionally keeps React, DOM, and OpenTUI adapters off the root-safe
package surface.

### Web package

`web` owns the TanStack Router SPA, Worker entrypoint, graph explorer, sync
monitor, and thin HTTP route helpers around the graph authority.

### Agent package

`agent` owns workflow loading, issue routing, context assembly, worker
scheduling, worktree lifecycle, retained runtime state, Linear polling, and
operator-facing TUI streams. It is still issue-driven automation rather than
graph-native workflow.

### Consumer-owned seams

The graph package treats transport, bootstrap ordering, config resolution, and
process lifecycle as consumer-owned. `graph` owns field-authority metadata,
write-scope semantics, transaction and sync payload contracts, replay rules,
and persisted-authority APIs. It does not currently own a generic authoritative
command registry.

## Data Model and Storage

The current data model is graph-native rather than relational:

- facts are `Edge { id, s, p, o }`
- writes are append-oriented with explicit retraction
- the store supports snapshots and replacement for transport and recovery
- reactive invalidation is keyed by `(subjectId, predicateId)`

Schema is authored in TypeScript but bootstrapped into graph data with stable
ids for schema entities such as `core:node`, `core:type`, `core:predicate`, and
`core:enum`.

Persistence is now commit-oriented in the current web authority:

- authoritative persistence is SQLite-backed
- persisted state stores current edge rows, retained write history, metadata,
  and secret side-data rather than one serialized graph blob
- accepted writes commit graph and secret-side-storage changes inside one
  Durable Object storage transaction
- total-sync snapshots remain a transport and recovery format, not the primary
  durable storage shape

The old full-blob snapshot rewrite path has been removed.

## APIs, Protocols, and Messaging

The sync contract is one of the strongest existing stable surfaces.

Current sync supports:

- total payloads for bootstrap and recovery
- incremental payloads for authoritative transactions after a cursor
- monotonic cursors
- idempotent transaction ids
- fallback semantics for unknown-cursor, gap, and reset cases

The synced client can capture local diffs as pending graph write transactions,
`flush()` queued writes, `sync()` authoritative state, and expose queue and sync
state.

The web Worker exposes thin graph APIs, including `GET /api/sync`, `POST /api/tx`,
and a provisional consumer-owned `POST /api/commands` route. That command route
lowers web-owned command envelopes into the stable graph write and
persisted-authority boundary; it does not imply a graph-wide command registry.
There is also an explicit proposal for a read-first MCP server on top of one
synced HTTP graph client.

## Frontend Architecture

The frontend is a TanStack Router SPA aimed at operators and developers rather
than polished end-user module UX.

Current surfaces include:

- graph explorer
- sync monitor
- generic create flows for supported entity types
- inspector shell
- field editors
- entity-reference comboboxes
- enum and closed-option pickers
- markdown editing
- color predicate editing

The graph-adjacent UI layer already contains typed refs, predicate-local
invalidation, metadata and filter authoring primitives, root-safe object-view,
workflow, and command contracts, and narrow reference-policy helpers.

## Backend, Worker, and Infra

Today’s deployable proof appears to be:

- one Worker shell
- one global graph authority Durable Object proof
- thin HTTP APIs over graph sync and secret mutation
- an in-memory graph runtime hydrated from SQLite-backed persisted authority
- bounded retained transaction history plus authority-only secret side storage

The main remaining authority hardening work is around retained-history windows,
cursor fallback behavior, and restart recovery semantics on top of the shipped
SQLite path.

## Security-Sensitive Areas

The repo already has the shape of an authority model even if it is not yet a
fully productized policy runtime.

Sensitive areas already called out in the roadmap:

- predicate-level visibility
- authority boundaries for writes and business methods, with command lowering
  remaining consumer-owned today
- secret-backed predicates represented as handles rather than plaintext values
- execution modes such as `localOnly`, `optimisticVerify`, and `serverOnly`
- server-only access to hidden predicates, secret values, authoritative clocks,
  identity, and global uniqueness checks

The storage design reinforces the split between safe graph facts and authority-
only secret storage.

## Technical Debt and Scaling Constraints

The roadmap is explicit about current limits:

- the engine is still in-memory first
- there are no secondary indexes in the store
- there is no built-in query planner
- there is no query-scoped sync
- there is no live transport in `graph`
- there is no built-in ACL or runtime layer inside the core engine
- the SQLite-backed authority path is still a single-graph proof with a bounded
  retained-history window
- the agent runtime remains Linear-backed and issue-driven
- the current Durable Object topology is effectively a single-authority proof

The strongest current reading is: the repo proves a solid graph runtime,
operator surfaces, and an issue-driven agent system, but not yet the scalable,
module-installable, per-user sharded personal graph platform described in the
vision.
