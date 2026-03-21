# Branch 1: Graph Kernel And Authority

## Mission

Stabilize the graph kernel and authoritative runtime so every other branch can
build on one durable data, validation, and transaction model.

## Why This Is A Separate Branch

Every other workstream depends on the kernel contracts. If ids, facts,
transactions, authoritative persistence, or secret-handle semantics keep
moving, all downstream branches will thrash.

## In Scope

- stable ids, schema authoring, and schema bootstrap
- append-oriented fact model and retraction semantics
- local and authoritative validation lifecycle
- authoritative write, transaction, and session model
- cursor continuity and replay contracts
- persisted authority runtime
- SQLite-backed Durable Object persistence for the current single-graph proof
- secret-handle and secret side-storage split

## Out Of Scope

- scope-based sync planner
- Better Auth integration
- module installation
- graph-native workflow productization
- end-user web UX

## Durable Contracts Owned

- `Edge` or fact model
- transaction and cursor envelopes
- authoritative write session model
- persistence backend boundary
- secret handle versus plaintext boundary

## Likely Repo Boundaries

- `src/graph/`
- `src/graph/runtime/`
- authority and storage runtime packages that split out from the current graph
  runtime
- the current Durable Object authority path in `src/web/lib/`

## Dependencies

- no new platform dependencies beyond the current repo proof

## Downstream Consumers

- Branch 2 needs authoritative policy enforcement hooks
- Branch 3 needs stable transaction and cursor semantics
- Branches 4, 5, and 6 need stable graph types and write contracts
- Branch 7 needs a stable client-facing graph runtime

## First Shippable Milestone

This milestone is already shipped: blob-style snapshot rewrites are gone and
the single-graph proof now uses commit-oriented SQLite-backed authority
persistence while keeping the current developer flow working.

## Done Means

The current baseline proves:

- accepted writes persist as ordered rows rather than full snapshot rewrites
- restarts preserve graph state, cursor continuity, and secret side storage
- current total and incremental sync behavior still works
- the contract is documented well enough for downstream branches to target

## First Demo

Create, update, retract, restart the authority, and prove the graph and secret
fields reload correctly without replay drift.

## What This Unlocks

- scoped sync and projection work in Branch 3
- module install and migration runtime in Branch 4
- blob-backed entity families in Branch 5
- graph-native workflow entities in Branch 6

## Source Anchors

- `doc/02-current-state-architecture.md`
- `doc/03-target-platform-architecture.md`
- `doc/05-recommended-architecture.md`
- `doc/06-migration-plan.md`
- `doc/09-vision-platform-architecture.md`
- `doc/11-vision-execution-model.md`
