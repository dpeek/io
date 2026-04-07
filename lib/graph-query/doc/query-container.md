---
name: Graph query container
description: "Container spec, validation, cache identity, runtime state, and stale recovery in @io/graph-query."
last_updated: 2026-04-02
---

# Graph query container

## Read this when

- you are changing `QueryContainerSpec`, validation, or runtime behavior
- you need to understand saved or inline query execution through one shared controller
- you are debugging pagination, cache identity, or `projection-stale` recovery

## Main source anchors

- `../src/query-container.ts`: spec, validation, runtime, cache keys, and state resolution
- `../src/query-container.test.ts`: validation and stale-recovery coverage
- `../src/saved-query.ts`: saved-query source resolver used by runtime consumers
- `../src/react-dom/query-container-surface.tsx`: browser chrome layered over the runtime
- `./query-stack.md`: broader query-container model

## What this layer owns

- `QueryContainerSpec` for inline and saved-query bindings
- explicit validation of source, renderer, pagination, and refresh contracts
- runtime page caching and per-container instance state
- canonical container states: loading, empty, error, ready, paginated, stale, and refreshing

It does not own route composition, DOM rendering, or query execution itself.

## Query source model

Containers support two source kinds:

- `inline`: the container carries one serialized request directly
- `saved-query`: the container carries a saved query id plus optional parameter overrides

Validation is intentionally split:

- inline sources are validated immediately with `validateSerializedQueryRequest(...)`
- saved-query sources only validate local shape until a source resolver loads the durable saved query

## Cache identity

The runtime uses two identities:

- cache identity for shared query data
- instance identity for one mounted container lifecycle

Shared cache identity is derived from:

- the resolved serialized request
- parameter definitions
- execution context
- optional saved-source cache key

Renderer choice does not participate in cache identity. Two different mounts can render the same cached page data differently.

Instance identity is `containerId + cacheKey`. That is what keeps current page selection local even when multiple containers share the same cached pages.

## Runtime behavior

`createQueryContainerRuntime(...)` owns:

- `get(...)`
- `load(...)`
- `markStale(...)`
- `paginate(...)`
- `refresh(...)`

Key rules:

- page results are cached per page cursor
- continuation pages are cleared on refresh
- `markStale(...)` keeps the current result but flips freshness to stale
- `resolveQueryContainerState(...)` gives one canonical state machine for chrome and renderers

## Renderer compatibility

`validateRendererBindingCompatibility(...)` checks renderer contracts against a query surface:

- compatible renderer ids
- supported query kinds
- supported result kinds
- supported source kinds
- supported pagination modes
- entity-id requirements

That explicit compatibility boundary is also what saved-view validation depends on.

## Stale recovery

`projection-stale` is handled as a controlled fail-closed case, not a generic error.

On pagination:

- `reset` returns to the first cached page
- `refresh` clears continuation pages and reloads from the first page without cache

Both paths surface explicit `staleRecovery` metadata on the returned runtime value.

## Practical rules

- Keep source resolution separate from execution.
- If cache identity changes, update both runtime and tests together.
- Treat `projection-stale` as a product boundary. Do not silently continue from a stale cursor.
