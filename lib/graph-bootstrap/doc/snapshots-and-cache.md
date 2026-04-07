---
name: Graph bootstrap snapshots and cache
description: "Convergent snapshot creation and cache behavior in @io/graph-bootstrap."
last_updated: 2026-04-03
---

# Graph bootstrap snapshots and cache

## Read this when

- you are changing `createBootstrappedSnapshot(...)`
- you need to understand bootstrap snapshot cache behavior
- you are wiring local or synced clients from bootstrapped schema state

## Main source anchors

- `../src/snapshot.ts`: snapshot creation and WeakMap cache
- `../src/bootstrap.ts`: shared bootstrap runtime
- `../src/index.test.ts`: snapshot usage example

## What this layer owns

- convergent bootstrapped schema snapshots
- in-memory cache reuse for repeated snapshot requests
- clone-on-read behavior for cached snapshots

It does not own client construction or snapshot persistence.

## Snapshot flow

`createBootstrappedSnapshot(...)` creates a fresh in-memory store, runs
`bootstrap(...)`, captures `store.snapshot()`, and returns a clone.

That keeps snapshot creation aligned with the live-store bootstrap path instead
of maintaining a second materialization implementation.

## Cache model

The cache is two-level and identity-based:

- outer `WeakMap`: keyed by the `definitions` object identity
- inner `WeakMap`: keyed by `options.cacheKey`, or by the `options` object when
  no explicit cache key is provided

Special case:

- when `options` is empty, the package uses one frozen default cache key so the
  common no-options path still hits cache

## Cache invalidation rule

Caching is disabled whenever `options.timestamp` is provided.

That is intentional. A timestamped bootstrap request is asking for a distinct
materialization, not cache reuse.

## Clone behavior

The function always returns `cloneGraphStoreSnapshot(...)`.

Important behavior:

- cached snapshots are cloned before return
- freshly built snapshots are also cloned before return

That keeps callers from sharing mutable snapshot references through the cache.

## Practical rules

- Use `cacheKey` when you reuse one bootstrap configuration object across many
  callers.
- Do not expect cache reuse when you pass explicit timestamps.
- Treat the snapshot API as convergent schema setup for local clients, synced
  clients, and replay flows.
