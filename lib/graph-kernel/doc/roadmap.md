@@ -0,0 +1,223 @@

# Kernel Initiative

## Status

- Status: active
- Scope: post-shipment follow-on work for the Branch 1 kernel and authority
  baseline
- Supersedes as the active work doc: `doc/branch/01-graph-kernel-and-authority.md`
- Promotion rule: when a slice ships, move the durable behavior into
  current-state docs and package READMEs, then trim it out of this file

## Purpose

The initial graph kernel and authoritative runtime baseline is already shipped.
The repo now has extracted package boundaries for the kernel, bootstrap, sync,
authority, module authoring, and built-in module surfaces.

This document is not a replacement roadmap for the whole platform. It is the
active initiative doc for the next bounded phase of kernel work:

- keep the shipped kernel and authority contract explicit
- harden the current single-graph authority proof where Branch 1 still owns it
- reduce doc drift between package surfaces, current-state docs, and older
  branch planning docs
- avoid letting future branch work leak back into the kernel initiative

Current-state truth belongs in `doc/02-current-state-architecture.md`,
topical docs under `doc/graph/`, and the relevant package READMEs. This file
tracks only the work that is still active.

## Current Baseline

The shipped baseline now includes:

- `@io/graph-kernel`: ids, store primitives, schema contracts, field-authority
  metadata, and authoritative write envelopes
- `@io/graph-bootstrap`: schema materialization and bootstrapped snapshots
- `@io/graph-sync`: total and incremental sync contracts, cursor helpers, and
  total-sync sessions
- `@io/graph-authority`: authoritative write sessions, persisted authority
  runtime, retained-history validation, replication filtering, and graph-owned
  authority contracts
- the current web authority proof in `lib/app/src/web/lib/`: SQLite-backed
  Durable Object storage, thin Worker transport routes, and the current
  consumer-owned command lowering seam

That shipped baseline is the floor. This initiative should narrow and clarify
it, not reopen the basic graph model.

## In Scope

- keep the stable package boundaries for:
  - `@io/graph-kernel`
  - `@io/graph-bootstrap`
  - `@io/graph-sync`
  - `@io/graph-authority`
- keep the root `@io/app/graph` surface small and explicitly non-canonical
- harden retained-history, restart recovery, and cursor fallback behavior in
  the current SQLite Durable Object proof
- keep the secret-handle versus authority-only plaintext boundary explicit
- document exactly which authority and transport seams remain provisional
- promote shipped stable behavior into current-state docs and package READMEs
- remove stale descriptions from older roadmap docs when the code has moved on

## Out Of Scope

This initiative does not own:

- principal-aware policy, auth session semantics, or sharing product behavior
- Better Auth integration
- scoped sync planners, query planning, retained projection routing, or live
  scope registration
- module installation, manifests, activation, or permission UX
- blob/media ingestion and queue-backed derivatives
- graph-native workflow productization above the lowering boundary
- sharding, directory topology, federation, or cross-shard semantics
- secret reveal flows, external KMS integration, or provider-specific secret
  protocols

Those belong in other initiative docs, even if they depend on this baseline.

## Stable Contract Surface

This initiative treats the following as stable unless there is an explicit
contract change with doc and package updates in the same change:

- graph ids, stable-id mapping, and schema bootstrap behavior
- append-oriented fact and retraction semantics
- `GraphWriteTransaction`, `AuthoritativeGraphWriteResult`, and write-scope
  semantics
- total and incremental whole-graph sync payloads and cursor fallback behavior
- persisted-authority storage boundaries
- secret-handle schema metadata and the secret-handle versus plaintext split

The package README and root entrypoint for each owning package are the nearest
contract source:

- `lib/graph-kernel/src/index.ts`
- `lib/graph-bootstrap/src/index.ts`
- `lib/graph-sync/src/index.ts`
- `lib/graph-authority/src/index.ts`

## Provisional Seams

The following remain intentionally provisional in this phase:

- web-owned `/api/commands` envelopes, dispatch, and result payloads
- the exact HTTP transport shape for `/api/sync`, `/api/tx`, and
  `/api/commands`
- Durable Object SQL table layout and adapter-specific retained-record tables
- the cross-initiative meaning of optional secret-provider metadata such as
  `provider`, `fingerprint`, and `externalKeyId`
- web authority composition details that sit above the shared
  persisted-authority and write-session contracts

The rule here is simple: do not promote these seams to “stable” accidentally
through convenience exports or broad prose.

## Active Slices

### 1. Contract Promotion And Doc Cleanup

Goal:

- move shipped kernel behavior out of broad roadmap prose and into current-state
  docs, topical docs, and package READMEs

This slice includes:

- updating `doc/02-current-state-architecture.md` when a stable kernel behavior
  changes materially
- keeping `doc/graph/runtime.md`, `doc/graph/storage.md`,
  `doc/graph/sync.md`, and `doc/graph/secrets.md` aligned with package
  boundaries
- trimming or archiving stale sections from
  `doc/branch/01-graph-kernel-and-authority.md`

### 2. Web Authority Proof Hardening

Goal:

- keep the current web proof thin and honest about what it owns

This slice includes:

- keeping web-owned command envelopes clearly above the Branch 1 lowering
  boundary
- keeping Worker routes as transport adapters, not semantic owners
- preventing app-level command growth from leaking into `@io/graph-authority`
  as if it were a generic graph command system

### 3. Durable Authority Hygiene

Goal:

- keep restart recovery and retained-history mechanics mechanically reliable in
  the SQLite proof

This slice includes:

- retention policy normalization and diagnostics
- retained-history continuity checks and reset-baseline behavior
- explicit secret-side lifecycle semantics in the current adapter
- clear adapter ownership for retained semantic rows that commit alongside graph
  writes

### 4. Root Surface Discipline

Goal:

- keep `@io/app/graph` as a curated helper layer rather than another kitchen
  sink

This slice includes:

- preferring owning package imports in internal code
- keeping graph-owned leftovers on the root surface intentionally small
- avoiding new stable contract growth through the umbrella package

## Exit Criteria

This initiative is complete when:

- current-state docs describe the shipped kernel and authority baseline without
  relying on the old branch doc as the primary source
- package READMEs are the nearest public contract docs for the stable package
  surfaces
- remaining provisional seams are explicitly named and stay outside the stable
  contract surface
- the current web authority proof is documented as an adapter/composition layer
  rather than the source of graph semantics
- the old broad Branch 1 doc can be archived or reduced to historical context

## Update Workflow

Use this file only for active kernel work.

When a slice ships:

1. update the owning package README and entrypoint comments
2. update current-state docs and any affected topical docs
3. remove or compress the shipped detail from this file
4. leave only the still-active work here

When no active kernel-only work remains:

- archive this file or reduce it to a short completion note
- stop carrying future-branch design work in the kernel initiative doc

## Source Anchors

- `doc/02-current-state-architecture.md`
- `doc/graph/runtime.md`
- `doc/graph/storage.md`
- `doc/graph/sync.md`
- `doc/graph/secrets.md`
- `lib/graph-kernel/src/index.ts`
- `lib/graph-bootstrap/src/index.ts`
- `lib/graph-sync/src/index.ts`
- `lib/graph-authority/src/index.ts`
- `lib/app/src/web/lib/authority.ts`
- `lib/app/src/web/lib/graph-authority-sql-startup.ts`
- `lib/app/src/web/lib/graph-authority-sql-storage.ts`
