# Vision Execution Model

This document collects the execution-facing sections from
[`../vision.md`](../vision.md): repo model, durable contracts, major risks,
phased plan, research questions, platform anchors, and the closing
recommendation.

## Monorepo And Development Model

The repo should keep its current "script repository" bias:

- one workspace
- small focused files
- explicit docs per area
- fast iteration
- agent-friendly structure

This is part of the product strategy, not only a style preference. If the
system is meant to be built and operated with agents, the codebase has to stay
legible to them through concise files, stable boundaries, strong entrypoints,
and durable docs close to the code.

## Suggested Durable Contracts

The vision pressure-tests these contract boundaries.

### In `graph`

- fact storage and ids
- schema authoring
- predicate authority metadata
- validation
- typed refs
- sync contracts
- query planner contracts
- module manifest contracts
- federation capability contracts

### In `web`

- browser bootstrap
- module UI loading
- authenticated sync APIs
- operator tooling
- graph explorer and devtools

### In `agent`

- workflow engine
- context retrieval
- execution tracking
- operator sessions
- graph-native planning and artifact storage

### In deployment and runtime

- Worker entrypoint
- Durable Object topology
- blob storage adapters
- queue consumers
- auth and capability enforcement

## Major Risks

The vision calls out these major risks for deep research and execution:

- cross-graph query complexity
- Durable Object partitioning
- index explosion
- module safety
- partial sync correctness
- push fan-out and subscription routing
- taxonomy fragmentation
- auth boundary confusion
- workflow migration

## Phased Product Plan

### Phase 1: strengthen the current single-graph proof

- keep one authoritative graph
- expand schema and module contracts
- harden predicate-level authority rules
- move more current proof data into graph-native modules
- continue improving web explorer and sync tooling

### Phase 2: introduce module installation and blob-backed types

- add module manifests and versioned installation
- add files, documents, and images as first-class modules
- add R2-backed blob references and processing jobs
- add import and export workflows

### Phase 3: replace external workflow dependencies

- model projects, branches, commits, sessions, and artifacts directly in the
  graph
- let the agent runtime operate on those graph-native workflows
- use the system to build itself

### Phase 4: shard one logical graph across many authorities

- add directory plus shard topology
- add shard-aware sync and indexes
- add migration and observability tooling

### Phase 5: add graph linking and controlled federation

- add explicit share capabilities
- add federated projections
- add remote query planning
- add provenance-rich imported facts

### Phase 6: harden multi-user and multi-device operation

- principal-aware policy
- richer auth
- conflict and offline handling
- more complete operator tooling

## Research Questions

The next deep research pass is expected to answer at least:

1. What Durable Object topology best supports one logical graph with many
   shards?
2. How should shard-local and global indexes be designed so common module
   queries stay fast?
3. What capability model best supports predicate-level privacy and cross-graph
   sharing?
4. Should remote graph access be exposed primarily as shared predicates, named
   views, or command and query endpoints?
5. Which storage layers should hold authoritative facts, blobs, indexes, and
   async job state?
6. What module manifest shape balances declarative installability with real UI,
   ingestion, and agent power?
7. How should graph-native workflow replace Linear without losing release
   discipline and operator visibility?
8. How should agent context retrieval be represented so it stays durable,
   minimal, and cheap to query?
9. Which current repo surfaces should stay proofs, and which should be promoted
   into stable public contracts first?
10. What partial incremental sync contract works for query-scoped,
    principal-scoped, and module-scoped sync without losing correctness?
11. How should modules be packaged, discovered, permissioned, versioned, and
    installed so schema, UI, types, commands, and ingestion arrive together?
12. What taxonomy belongs in `core:`, what belongs in foundation modules, and
    what should remain module-local by default?
13. What is the right boundary between Better Auth and graph identity?
14. How should active client queries register as live scopes so shard-level
    writes trigger bounded push sync?
15. For live push, when should the system send full deltas versus invalidations
    versus "cursor advanced, pull again" signals?

## Cloudflare Platform Anchors

The vision includes a short list of platform assumptions that should stay
anchored during research:

- Durable Objects are the right primitive for strongly coordinated,
  single-instance state, but scale comes from many objects rather than one
  singleton
- Durable Objects support SQLite-backed storage, which makes them attractive
  for shard-local graph state and indexes
- R2 is the natural storage tier for large unstructured blobs
- Queues are the natural fit for ingestion, batching, and background work

These are starting anchors, not substitutes for re-verifying current limits,
pricing, and product recommendations before implementation hardens.

## Recommendation

Treat `io` as the start of an open-source personal graph operating system:

- one logical graph per user
- many physical shards under the hood
- predicate-level privacy as a first-class rule
- capability-based graph linking rather than loose federation
- installable modules that bring schema, UI, ingestion, and agent behavior
- graph-native workflow and agent memory

If that direction holds, the product is not just a graph database. It becomes a
personal data, workflow, and agent platform that people can actually own and
extend.
