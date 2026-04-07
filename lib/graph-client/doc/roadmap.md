---
name: Graph client roadmap
description: "Future client-side graph work centered on computed values above typed refs."
last_updated: 2026-04-07
---

# Graph client roadmap

## Read this when

- you are designing computed or derived reads above `PredicateRef`
- you need to decide whether future work belongs in `@io/graph-client`,
  `@io/graph-module`, or `@io/graph-react`
- you are checking proposal status rather than shipped client behavior

## Current state

This package already owns:

- typed graph clients
- entity refs and predicate refs
- local read semantics
- the `get()` and `subscribe(...)` contract that future derived reads should
  reuse

Computed values are not current shipped behavior yet.

## Proposed direction: computed values

The proposed computed layer is a lazily evaluated, memoized, read-only
derivation surface built on top of the existing typed-ref and
predicate-slot-subscription model.

The intended shape is:

- definition-time authoring in `@io/graph-module`
- runtime evaluation in `@io/graph-client`
- host-neutral hooks in `@io/graph-react`

That keeps authoring, runtime evaluation, and React wiring in their current
owning layers instead of inventing a second reactive stack.

## Core model

- computed values are local derived cells, not durable graph predicates
- a computed ref should expose `get()` and `subscribe(...)`
- evaluation should stay lazy until something reads or subscribes
- results should memoize until an observed dependency changes
- dependency capture should be automatic from tracked reads inside the compute
  body
- dynamic dependency sets are expected, not a corner case
- cycles between computed values should fail fast

## First-cut limits

The first cut should stay narrow:

- support synchronous derived reads over typed refs and predicate reads
- do not add async evaluation
- do not add writes or side effects during evaluation
- do not pretend arbitrary `list()` or `query()` calls are fully reactive yet
- do not change sync, persistence, or authority contracts for local computed
  reads

The reactive leaf is still the predicate slot. Future query reactivity would
need new observable roots rather than a thinner computed wrapper.

## Package split

### `@io/graph-module`

Owns definition-time helpers such as a future `defineComputed(...)` or
`computed(...)` authoring surface.

### `@io/graph-client`

Owns:

- `ComputedRef<T>`
- dependency collection
- invalidation
- memoized evaluation
- typed `entity.computed.*` runtime attachment

### `@io/graph-react`

Owns future host-neutral helpers such as `useComputedValue(...)`.

## API direction

The proposed shape keeps stored and derived data separate:

```ts
taskRef.fields.title.get();
taskRef.computed.displayTitle.get();
```

Not:

```ts
taskRef.fields.displayTitle.get();
```

That keeps durable predicates and transient derived state visibly different in
application code.

## Source anchors

- `../src/graph.ts`
- `../src/refs.ts`
- `../src/validation.ts`
- `../../graph-module/src/index.ts`
- `../../graph-react/src/predicate.ts`
- `../../graph-react/src/entity.tsx`

## Related docs

- [`./refs.md`](./refs.md): current typed-ref behavior
- [`./typed-client.md`](./typed-client.md): current local client behavior
- [`../../graph-react/doc/predicate-and-entity-hooks.md`](../../graph-react/doc/predicate-and-entity-hooks.md):
  current host-neutral hook layer
- [`../../graph-kernel/doc/roadmap.md`](../../graph-kernel/doc/roadmap.md):
  broader graph-engine roadmap
