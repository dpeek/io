# Branch 3: Sync, Query, And Projections

## Mission

Turn the current whole-graph sync proof into a scope-based read runtime with
bounded queries, materialized projections, and live invalidation routing.

## Why This Is A Separate Branch

This branch carries the main correctness and scaling risk after the kernel.
Scoped sync, indexed reads, and query planning are their own platform surface,
not an implementation detail inside the web app.

## In Scope

- scope definitions and scope cursors
- principal-aware completeness semantics
- bounded query model
- materialized collection indexes
- projection runtime and rebuild rules
- live scope registration and invalidation routing
- cursor-advanced or scoped-pull live update model

## Out Of Scope

- arbitrary distributed graph scans
- full cross-graph federation planner
- module UI implementation
- auth session ownership

## Durable Contracts Owned

- scope definition model
- scope cursor and fallback semantics
- query surface contracts
- projection and index runtime contracts
- invalidation event shape

## Likely Repo Boundaries

- graph sync contracts
- future authority scope planner and projection runtime
- subscription routing layer
- synced client extensions in web

## Dependencies

- Branch 1 for transaction, cursor, and authority state contracts
- Branch 2 for policy-filtered scope semantics

## Downstream Consumers

- Branch 5 needs projection and retrieval hooks for ingestion outputs
- Branch 6 needs scoped context-bundle retrieval
- Branch 7 needs capability-aware live product views

## First Shippable Milestone

Ship one narrow scoped sync class, ideally a module slice or work queue, plus
one materialized collection index and one live invalidation proof.

## Done Means

- the client can bootstrap a named scope instead of the whole graph
- the scope carries explicit completeness and cursor state
- live updates can advance the scope without forcing a whole-graph reload
- one collection query reads from a documented projection rather than raw
  traversal

## First Demo

Open one scoped view in the browser, mutate data from another session, and
prove the first client receives a scoped update or cursor-advanced re-pull
without full resync.

## What This Unlocks

- sharding without uncontrolled fan-out
- module-specific read surfaces in Branch 4
- performant workflow inboxes in Branch 6
- product-grade web surfaces in Branch 7

## Source Anchors

- `doc/03-target-platform-architecture.md`
- `doc/05-recommended-architecture.md`
- `doc/06-migration-plan.md`
- `doc/09-vision-platform-architecture.md`
- `doc/10-vision-product-model.md`
- `doc/11-vision-execution-model.md`
