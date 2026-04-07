---
name: Graph react runtime and persisted mutations
description: "Synced runtime context, query hooks, and persisted mutation flushing in @io/graph-react."
last_updated: 2026-04-03
---

# Graph react runtime and persisted mutations

## Read this when

- you are changing the synced runtime provider or query hooks
- you need to understand how successful mutations flush pending synced graph
  writes
- you are wiring a host-neutral React surface over a synced graph runtime

## Main source anchors

- `../src/runtime.tsx`: synced runtime provider and query hooks
- `../src/persisted-mutation.tsx`: persisted mutation runtime and flush helper
- `../../graph-surface/doc/ui-stack.md`: cross-package adapter split

## What this layer owns

- the synced graph runtime React context
- sync-state and query hooks over that context
- the persisted-mutation runtime context
- queued flush behavior after successful synced mutations

It does not own sync transport construction or app routes.

## Runtime provider

`GraphRuntimeProvider` shares one synced graph runtime through React context for
host-neutral hooks.

Important behavior:

- it publishes the graph runtime context
- it also wraps `GraphMutationRuntimeProvider`
- `useOptionalGraphRuntime(...)` may return `null`
- `useGraphRuntime(...)` throws outside the provider

## Sync-state and query hooks

The main runtime hooks are:

- `useGraphSyncState(...)`
- `useGraphQuery(...)`

Important behavior:

- sync-state snapshots are stabilized so logically identical sync state does not
  churn React unnecessarily
- `useGraphQuery(...)` recomputes when the runtime, sync state, query function,
  or explicit deps change

That keeps host-neutral query hooks aligned with sync progress rather than
memoizing against stale runtime state.

## Persisted mutation runtime

The persisted mutation runtime shape is intentionally small:

- optional `graph`
- `sync.flush()`
- `sync.getPendingTransactions()`

`persistSyncedGraphChanges(...)` serializes flushes per sync object through a
WeakMap-backed queue. It only flushes when pending transactions exist.

## Mutation callbacks

`usePersistedMutationCallbacks(...)` wraps mutation callbacks so successful
mutations can flush pending synced graph changes automatically.

Behavior:

- `onMutationSuccess` still runs first
- when a runtime is available, pending synced changes are flushed afterward
- flush failures report through `onMutationError`

That keeps flush behavior host-neutral and reusable without forcing every host
surface to hand-roll the same callback wiring.

## Practical rules

- Keep synced runtime context here, not in adapter packages.
- Keep flush orchestration generic and sync-object scoped.
- Leave transport construction and route handling outside this package.
