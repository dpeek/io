---
name: Graph kernel roadmap
description: "Future-state direction for the graph engine plus the package-owned roadmap map."
last_updated: 2026-04-07
---

# Graph kernel roadmap

## Read this when

- the question is about future graph-engine direction rather than shipped
  package behavior
- you need the top-level package boundary before deciding which package should
  own new runtime or persistence work
- you are looking for the package-owned roadmap docs after the retirement of
  `doc/graph/*`

## What this roadmap owns

- the umbrella roadmap for the graph engine as a whole
- the promotion rule for moving shipped behavior out of roadmap docs and into
  owning package docs
- links to the more focused package-owned roadmap docs

Current-state behavior lives in owning package READMEs and `doc/*.md` files.
This file is only for work that is still directional, provisional, or in
active design.

## Documentation rule

- current-state docs live in the owning package
- cross-package shipped behavior lives in the owning package's stack doc
- future-state and proposal work lives in the owning package's
  `doc/roadmap.md`
- `doc/graph/*` is retired; do not recreate a second root-level graph doc tree

## Current baseline

The shipped baseline now includes:

- `@io/graph-kernel` for ids, store primitives, schema contracts,
  field-authority metadata, and authoritative write envelopes
- `@io/graph-module` for definition-time type, field, command, surface, and
  manifest contracts
- `@io/graph-module-core` and `@io/graph-module-workflow` for the current
  built-in module packages
- `@io/graph-bootstrap` for schema materialization and bootstrapped snapshots
- `@io/graph-client` for typed refs, local CRUD, validation, and synced-client
  composition
- `@io/graph-sync` for total and incremental whole-graph sync contracts
- `@io/graph-authority` for authoritative write sessions, persisted authority
  runtime, retained-history validation, and graph-owned authority contracts
- `@io/graph-projection` for module read scopes, projection metadata, retained
  projection compatibility, and invalidation targeting
- `@io/graph-react` for host-neutral React hooks, edit-session contracts, and
  resolver primitives
- `@io/graph-surface` for route-neutral record and collection surface runtime
- the current web authority proof in `lib/app/src/web/lib/` for the SQLite
  Durable Object adapter and thin consumer-owned transport or command seams

That shipped baseline is the floor. Roadmap work should clarify it, extend it,
or layer on top of it. It should not silently reopen the basic graph model.

## Stable boundaries already in force

- keep the store schema-agnostic and stringly at the storage layer
- keep key-based authoring and id-based runtime use distinct
- keep reusable value rules with scalar or enum definitions
- keep predicate-specific rules with field definitions
- keep UI adapter concerns outside the runtime core
- keep `@io/app/graph` as a small curated helper layer rather than another
  canonical package surface
- promote shipped behavior into owning package docs rather than leaving it in
  roadmap prose

## Active direction

### Engine and persistence

- harden the current SQLite-backed authority proof without letting web adapter
  details leak into shared package contracts
- keep retained-history, startup recovery, cursor fallback, and baseline reset
  behavior mechanically explicit
- support additional persistence backends only when they can preserve the same
  authority, replay, and recovery guarantees
- keep semantic retained data and rebuildable derived state as separate
  contracts

### Query, projection, and derived reads

- grow richer query and indexing contracts above the current typed client
- add computed or derived reads above predicate-slot subscriptions without
  changing the kernel's reactive leaf
- keep retained projection and scope contracts explicit about rebuild versus
  source-of-truth ownership

### UI and application model

- keep pushing graph-native authored metadata toward reusable record,
  collection, command, and route surfaces
- expand edit-session and validation contracts without moving route or browser
  shell composition into the shared runtime packages
- keep command execution authority-owned even when command-surface UX becomes
  more generic

### Transport and observability

- keep HTTP, Worker, and other transports consumer-owned above the shared sync
  contracts
- improve observability around sync, validation, recovery, and baseline-reset
  boundaries before ad hoc traces spread across packages

## Package-owned roadmap docs

- [`../../graph-client/doc/roadmap.md`](../../graph-client/doc/roadmap.md):
  computed values and other client-side derived-read work above typed refs
- [`../../graph-surface/doc/roadmap.md`](../../graph-surface/doc/roadmap.md):
  graph-native surfaces, edit-session composition, and route-level UI direction
- [`../../graph-authority/doc/roadmap.md`](../../graph-authority/doc/roadmap.md):
  retained-record storage and restore semantics above the live authority graph

Use those docs for focused proposal work. Use this file when the question is
about the whole engine or the boundary between those tracks.

## Promotion workflow

When roadmap work ships:

1. update the owning package README and current-state topic docs
2. update any affected stack docs such as `runtime-stack.md` or `sync-stack.md`
3. trim the now-shipped detail out of the relevant `roadmap.md`
4. keep only the still-open design or initiative material in roadmap docs

## Source anchors

- `../README.md`
- `./runtime-stack.md`
- `../../graph-client/doc/roadmap.md`
- `../../graph-surface/doc/roadmap.md`
- `../../graph-authority/doc/roadmap.md`
- `../../app/src/graph/index.ts`
- `../../app/src/web/lib/authority.ts`
- `../../app/src/web/lib/graph-authority-sql-startup.ts`
- `../../app/src/web/lib/graph-authority-sql-storage.ts`
