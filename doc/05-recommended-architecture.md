# Recommended Architecture

This document contains the proposed architecture split and runtime model from
[`../roadmap.md`](../roadmap.md).

## Concrete Subsystem Design

### Graph kernel

Keep `graph` as the durable contract package for:

- ids
- schema authoring
- fact model
- validation
- authoritative sessions
- sync payloads
- module contract types
- policy contract types
- federation capability contract types

### Authority runtime

Add a dedicated runtime package or subpackage for:

- shard runtime
- directory runtime
- commit backends
- scope planner
- projection and index builder interfaces
- policy enforcement
- command execution

The roadmap explicitly advises against overloading the in-memory store API with
distributed planner concerns.

### Web runtime

Keep SPA and operator surfaces in `web`, but separate:

- generic graph devtools
- module route host
- live scope registration and bootstrap
- auth and session bridge
- capability-aware query client

### Agent runtime

Split the current `agent` package into:

- execution and scheduler shell
- graph-native workflow client
- context retrieval engine
- retained session and event model
- legacy tracker adapters during transition

## Proposed Module Boundaries

```text
graph/
ids
schema
facts
validation
sync
refs
module-contracts
policy-contracts
federation-contracts

authority/
directory
shard
commit-backends
scope-planner
command-runtime
projection-runtime
secret-runtime

web/
app-shell
graph-devtools
module-host
sync-client
live-subscriptions
auth-bridge

agent/
workflow-engine
context-retrieval
run-tracking
operator-sessions
legacy-linear-adapter

modules/
core/*
foundation/*
domain/*
```

This keeps distributed runtime concerns out of the pure graph kernel while
making room for installable modules and authority-specific behavior.

## Canonical Data and Event Model

The roadmap proposes these canonical authoritative concepts:

- Fact: current or retracted edge state keyed by stable edge id
- Transaction: ordered commit with tx id, cursor, ops, and scope metadata
- Scope: named or ad hoc sync, query, or share context with completeness
- Projection: rebuildable derived index or view over facts and blobs
- Capability: principal- or graph-targeted read, write, or share grant
- Artifact: durable output from agent, workflow, or module execution
- Run: execution unit for workflows, commands, ingestion, or agent tasks
- Blob: metadata record pointing at R2

## Storage and Indexing Strategy

### Authoritative shard storage

Adopt the SQL-backed Durable Object model proposed in `storage.md`:

- `io_graph_meta`
- `io_graph_tx`
- `io_graph_tx_op`
- `io_graph_edge`
- `io_secret_value`

### Derived storage

Add rebuildable indexes and projections for:

- collection indexes
- time-range indexes
- full-text and retrieval indexes
- outbound share projections
- agent context retrieval projections

### Blob storage

Use R2 for raw objects. The graph stores metadata, ownership, hashes, MIME,
status, access policy, and processing references.

### Query strategy

- single-entity and neighborhood reads remain shard-local
- indexed collections use projection-backed reads
- cross-shard joins are bounded planner fan-out only
- cross-graph reads are capability-bounded named surfaces only

## Query Model

The recommended query surface is:

```text
EntityQuery(id)
NeighborhoodQuery(rootId, predicates?, depth?)
CollectionQuery(indexId, filter, order, window)
ScopeQuery(scopeId or scopeDefinition)
FederatedQuery(capabilityId, namedView or sharedIndex, filter/window)
```

Important constraints:

- no arbitrary distributed graph scans
- no raw remote predicate traversal by default
- every collection query maps to a known index or bounded plan
- every federated query maps to an explicit shared surface

## Client and Server Responsibilities

### Client

- local typed reads over an authorized scope cache
- local validation and optimistic transaction creation
- live scope registration
- view composition
- artifact inspection
- offline cache and fallback handling

### Server and authority

- authoritative write validation and apply
- predicate and principal policy enforcement
- secret unsealing and use
- transaction ordering and cursor management
- invalidation publication
- projection build and rebuild
- import/export, module install, and federation grant coordination

## Deployment Architecture

Recommended deployment per user or team graph:

### Cloudflare Worker app

- SPA assets
- HTTP APIs
- Better Auth handlers
- command and orchestration endpoints

### Durable Objects

- one `GraphDirectory` DO per graph
- `N` `GraphShard` DOs
- optional `Subscription` DOs
- optional `ModuleInstall` DO
- optional federation and share DOs

### R2

- file, image, and document blobs
- derivatives and previews

### Queues

- ingestion
- indexing
- projection rebuilds
- federation and import fan-out
- agent async jobs

## ASCII Summary Diagrams

### Current state

```text
                 +----------------------+
                 |      Agent runtime   |
                 |  issue/worktree/TUI  |
                 +----------+-----------+
                            |
                            | docs/context/workflow
                            v

+-------------+  +----------------+  +------------------+
| Browser     |<->| Worker shell  |<->| Durable Object   |
| TanStack SPA|  | /api/sync etc. |  | single authority |
+------+------+  +-------+--------+  +---------+--------+
       |                 |                     |
       | synced client   | thin transport     | load/save
       v                 v                     v
+------+-------------------------------------------------------+
| Graph runtime                                                 |
| ids | schema | append-only facts | validation | sync | refs  |
+--------------------------------------------------------------+
|
v
JSON snapshot + history
```

### Recommended target

```text
                         +-------------------+
                         | Better Auth       |
                         | sessions/providers|
                         +---------+---------+
                                   |
                                   v

+-----------+  +----------------------------------------------+
| Browser / |  | Worker app                                   |
| TUI/Agent |->| auth | module host | HTTP APIs | orchestration|
+-----------+  +------------------+---------------------------+
                                  |
              +-------------------+------------------+
              |                                      |
              v                                      v
      +-------+--------+                     +-------+--------+
      | Graph Directory|                     | Subscription   |
      | module manifest|                     | scope registry |
      | shard map      |                     | invalidation   |
      +-------+--------+                     +-------+--------+
              |                                      ^
              +-----------+---------------+----------+
                          |               |
                          v               |
                     +----+----+          |
                     | Shard DO|----------+
                     +----+----+
                          |
                +---------+----------+
                | projections / jobs |
                +---------+----------+
                          |
                     +----+----+
                     | R2/Queue |
                     +---------+
```
