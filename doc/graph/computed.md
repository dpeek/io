# Computed Values

## Purpose

This document describes a proposed computed-predicate or computed-value layer
for `graph`: lazily evaluated, memoized, read-only derivations built on top of
the existing typed ref and predicate-slot subscription surface.

This document uses "computed predicate" as schema-authoring shorthand for a
field-like derived read that belongs with a type definition. It does not imply
that the result is a durable graph predicate or an authoritative stored fact.

This is not current engine behavior. Today the reactive leaf boundary is still
the predicate slot, exposed through `PredicateRef.get()` and
`PredicateRef.subscribe(...)`. Computed values would sit above that boundary
rather than replacing it.

## Why This Belongs Here

The graph model already has the right low-level shape for computed values:

- predicate slots are the smallest reactive unit
- typed refs already expose `get()` plus `subscribe(...)`
- React bindings already consume that contract with `useSyncExternalStore(...)`
- store batching already coalesces slot notifications

That means computed values do not need a second reactive model. They can reuse
the same read and subscribe contract that predicates already implement.

## Goals

- allow arbitrary synchronous derived reads over graph refs
- capture dependencies automatically from the body of the computation
- keep evaluation lazy so unused computations cost nothing
- memoize results until an observed dependency changes
- support dynamic dependency sets that can change between evaluations
- compose computed values from predicates, entities, and other computed values
- preserve the boundary between durable graph facts and transient derived state
- fit naturally into the existing typed client and React surface

## Non-Goals

- making computed values durable or authoritative by default
- replacing stored predicates or the append-only fact model
- introducing asynchronous evaluation in the first cut
- attaching side effects or writes to read-time evaluation
- making arbitrary `list()` or `query()` calls fully reactive in the first cut
- changing sync payloads, retained history, or persistence formats

## Current Substrate

The current runtime already establishes the key constraints:

- the store is schema-agnostic and only exposes slot-level subscriptions
- `subscribePredicateSlot(subjectId, predicateId, listener)` is the reactive
  leaf boundary
- `PredicateRef.get()` reads a decoded predicate value
- `PredicateRef.subscribe(...)` wraps slot subscriptions with logical equality
- React hooks like `usePredicateValue(...)` already consume that shape directly

That suggests the correct placement for computed values is above the store and
alongside the typed client surface, not inside the schema-agnostic kernel.

## Package Placement In The Current Layout

The extracted package split changes where each part of this feature should
live.

### Definition-time authoring belongs on `@io/core/graph/def`

Schema authors should define computed predicates through `@io/core/graph/def`,
the same focused root-owned authoring surface that already gathers:

- `defineType(...)`, `defineScalar(...)`, and `defineEnum(...)` from
  `@io/graph-kernel`
- field-authoring helpers such as `defineReferenceField(...)`
- root-owned definition-time contracts that do not belong in an extracted
  runtime package cleanly

That keeps model authoring coherent. A type author should not need to import
`@io/graph-client` just to declare that a type has computed predicates.

In the current source tree, that means the canonical import surface is
`../../src/graph/def.ts`, with the actual computed-definition helpers likely
living in a small root-owned definition module re-exported from that barrel.

### Runtime evaluation belongs in `@io/graph-client`

The runtime behavior of computed predicates should live in `@io/graph-client`,
because that package already owns:

- typed graph clients
- entity refs and predicate refs
- local read semantics
- the subscribe/get contract that computed values should reuse

This is where `ComputedRef<T>`, dependency collection, invalidation, memoized
evaluation, and `entity.computed.*` attachment belong.

### React helpers belong on `@io/core/graph/runtime/react`

Host-neutral React helpers such as `useComputedValue(...)` should live beside
the existing predicate and entity hooks on `@io/core/graph/runtime/react`.

That keeps React concerns out of `@io/graph-client` while still exposing one
small host-neutral hook layer above the computed runtime.

### Other extracted packages should stay uninvolved in the first cut

The first cut should not require core feature work in:

- `@io/graph-kernel`: it should remain schema-agnostic and unaware of computed
  evaluation
- `@io/graph-bootstrap`: bootstrap does not need special computed behavior
- `@io/graph-sync`: sync contracts do not change when computed values are
  transient
- `@io/graph-authority`: authority storage and replay do not need schema
  changes for local computed reads
- `@io/graph-projection`: only relevant later if materialized computed outputs
  become retained projection caches

## Core Model

### Computed values are read-only derived cells

A computed value is a local cell whose value is derived from other graph reads.
It exposes the same high-level contract as a predicate read:

```ts
type ComputedRef<T> = {
  get(): T;
  subscribe(listener: () => void): () => void;
};
```

The main difference is where the value comes from:

- a predicate ref reads directly from persisted facts
- a computed ref evaluates a pure function against typed refs

### Computed values are not predicates

Even if they feel field-like in application code, computed values should not be
modeled as ordinary predicates unless they are explicitly materialized.

That distinction matters:

- predicates are durable facts in the graph
- predicates participate in sync, authority, and persistence
- predicates can be validated and written
- computed values are transient, read-only projections over existing facts

The API should reflect that separation clearly. A good default is:

```ts
taskRef.fields.title.get();
taskRef.computed.displayTitle.get();
```

Not:

```ts
taskRef.fields.displayTitle.get();
```

The latter blurs the line between stored and derived data.

### Computed values form a local dependency graph

Each computed value becomes a node in a transient dependency graph. During
evaluation it can depend on:

- one or more predicate slots
- one or more other computed values

The runtime captures those dependencies automatically by observing which reads
happen while the compute function runs.

## Proposed User-Facing Shape

### Authoring

The cleanest first shape is to define computed values adjacent to a durable type
definition rather than mixing them into `defineType(...)` itself.

The canonical authoring import should be `@io/core/graph/def`, even though the
evaluation runtime lives elsewhere.

```ts
import { computed, defineComputed, defineType } from "@io/core/graph/def";
```

```ts
export const task = defineType({
  key: "ops:task",
  name: "Task",
  fields: {
    title: stringTypeModule.field({ label: "Title" }),
    shortTitle: stringTypeModule.optionalField({ label: "Short title" }),
    done: booleanTypeModule.field({ label: "Done" }),
    blockedBy: defineReferenceField({
      label: "Blocked by",
      cardinality: "many",
      range: "ops:task",
    }),
  },
});

export const taskComputed = defineComputed(task, {
  displayTitle: computed(core.string, ({ self }) => {
    return self.fields.shortTitle.get() ?? self.fields.title.get();
  }),

  status: computed(core.string, ({ self, ns }) => {
    if (self.fields.done.get()) return "done";

    const blockers = self.fields.blockedBy.get();
    const blocked = blockers.some((id) => ns.task.ref(id).computed.status.get() !== "done");
    return blocked ? "blocked" : "ready";
  }),
});
```

The important properties of that shape are:

- durable `fields` stay durable
- computed values are explicitly grouped under `computed`
- the body uses ordinary typed refs, not a special dependency DSL
- return type metadata stays explicit enough for inference and tooling
- the schema author stays on the root-owned definition surface rather than
  importing client runtime internals

Whether the helper ends up named `defineComputed(...)`, `defineDerived(...)`, or
something else is secondary. The important part is keeping durable fields and
computed fields separate in authoring.

### Consumption

A typed entity ref would gain a `computed` object alongside `fields`.

```ts
const taskRef = client.task.ref(taskId);

const title = taskRef.computed.displayTitle.get();
const status = taskRef.computed.status.get();

const stop = taskRef.computed.status.subscribe(() => {
  console.log(taskRef.computed.status.get());
});
```

That makes computed values feel field-like without claiming they are persisted
graph facts.

### React

React support should mirror the existing predicate helper shape:

```ts
function TaskStatus({ task }: { task: TaskRef }) {
  const status = useComputedValue(task.computed.status);
  return <span>{status}</span>;
}
```

That hook can be implemented the same way `usePredicateValue(...)` works today:
read a snapshot with `get()`, subscribe with `subscribe(...)`, and preserve
stable snapshots when the logical value has not changed.

## Evaluation Semantics

### Lazy by default

A computed value should not evaluate until something asks for it.

That means:

- declaring a computed definition has no immediate cost
- creating an entity ref has no immediate cost
- the first `get()` triggers evaluation
- unsubscribed values can stay dirty until the next read

This keeps computed values aligned with the rest of the graph model: pay for
the read when the application actually needs it.

### Memoized until invalidated

Each computed node keeps a cache of:

- the last computed value, or the last thrown error
- the dependency set captured during evaluation
- unsubscribe handles for the currently tracked dependencies
- a dirty flag
- the current subscriber set

If the node is clean, `get()` returns the cached result immediately.

If one of its dependencies changes:

- the node becomes dirty
- if it has no subscribers, it remains dirty until the next `get()`
- if it has subscribers, it should recompute eagerly enough to decide whether
  listeners need to be notified

### Dependency capture is automatic

The body of a computed value should not require users to list dependencies
manually.

Instead, the runtime keeps an active dependency collector while a computed value
is evaluating. Any tracked read performed during that window registers itself as
a dependency of the active computation.

At minimum, these reads should be tracked in the first cut:

- `PredicateRef.get()`
- nested computed `get()`

Because entity and query projection helpers already bottom out in predicate
reads, tracking the predicate read path gives broader coverage automatically.

### Dynamic dependencies are first-class

Dependencies should be captured from what the body actually reads, not from a
static declaration.

For example:

```ts
displayTitle: computed(core.string, ({ self }) => {
  return self.fields.shortTitle.get() ?? self.fields.title.get();
});
```

If `shortTitle` is present, the computation may not read `title` at all. If
`shortTitle` later becomes empty, the next evaluation can start depending on
`title`. That is a feature, not an edge case.

The runtime therefore needs to:

1. collect the dependency set during evaluation
2. diff it against the previous dependency set
3. unsubscribe from removed dependencies
4. subscribe to newly added dependencies

### Equality should follow logical value equality

Predicate refs already avoid notifying React consumers when the logical value
did not change. Computed values should follow the same rule.

The default equality should match the existing logical comparison behavior used
for predicate values:

- primitives compare by `Object.is(...)`
- `Date` compares by timestamp
- `URL` compares by string form
- arrays compare element-by-element
- plain objects compare structurally

That keeps derived reads consistent with existing predicate behavior.

### Errors should be cached like values

If a computed body throws, that failure should become the node's current cached
state until one of its dependencies changes.

That means:

- repeated `get()` calls rethrow the same failure while the node stays clean
- a dependency change marks the node dirty
- the next evaluation can either produce a value or throw again

Caching failures avoids repeated work and makes error behavior deterministic for
the current dependency state.

### Cycles must fail fast

Computed values should be allowed to depend on other computed values, but direct
or indirect cycles must be rejected.

Examples:

- `a` reads `a`
- `a` reads `b`, and `b` reads `a`

The runtime should detect cycles from the active evaluation stack and throw a
specific cycle error rather than recursing until the stack blows up.

## Internal Runtime Sketch

The runtime can stay small if it treats computed values as ordinary readable
nodes above the existing typed read layer.

```ts
function get(): T {
  if (!state.dirty) return readCachedState(state);

  pushActiveCollector(state);
  try {
    const value = compute(context);
    const deps = popActiveCollector();
    reconcileDependencies(state, deps);
    state.cached = { kind: "value", value };
    state.dirty = false;
    return value;
  } catch (error) {
    const deps = popActiveCollector();
    reconcileDependencies(state, deps);
    state.cached = { kind: "error", error };
    state.dirty = false;
    throw error;
  }
}
```

The tracked-read side only needs two hooks:

- when a predicate read occurs, register the `(subjectId, predicateId)` slot
  with the active collector
- when a computed `get()` occurs inside another computed evaluation, register
  the nested computed node with the active collector

Everything else follows from dependency reconciliation and the existing
subscription contract.

## Supported Read Shapes In A First Cut

The first cut should be strict about what is reactive and what is not.

### Good first-cut reads

- `predicate.get()`
- `entity.get()` when it bottoms out in predicate reads
- `otherEntityRef.computed.someValue.get()`
- ordinary synchronous branching and control flow around those reads

### Reads that should stay out of scope initially

- `client.task.list()`
- `client.task.query(...)`
- raw `store.find(...)` and `store.facts(...)`
- "all entities of type T" membership changes
- reactive reverse-edge searches that are not already represented as direct
  predicate reads

Those operations can read useful data today, but they do not yet have a stable
observable root equivalent to predicate-slot subscriptions. Making them
automatically reactive would require new subscription primitives, not just a
computed wrapper.

## Queries And Membership

This is the biggest design constraint.

The current client can project entity reads and execute typed queries, but its
reactive boundary is still a predicate slot. Type membership and broad query
results are currently assembled by store scans rather than a query-specific
subscription primitive.

That means a first computed layer should not claim to support "arbitrary
memoized graph operations" in the fully reactive sense yet. It can support
arbitrary synchronous graph reads, but only the subset that bottoms out in
observable dependencies.

If fully reactive queries become a goal later, the runtime will likely need
additional observable roots such as:

- type membership subscriptions
- reverse-reference subscriptions
- query result subscriptions or query-planner-backed dependency sets

Computed values can sit on top of those later, but they should not pretend they
already exist.

## Materialization

Some derived values should remain purely computed:

- display labels
- UI summaries
- local readiness states
- convenience projections that are cheap to recompute

Other derived values may eventually need to be materialized into stored
predicates because they must be:

- queryable remotely
- sync-visible to clients that do not ship the computed definition
- filterable or sortable without re-running the computation everywhere
- used as explicit authority-owned state

That should be a separate decision and a separate mechanism.

Computed values are the right default for transient derived state. Materialized
predicates are the right tool when the result needs durable graph semantics.

## Purity And Determinism

The compute body should be treated as a pure read function over the current
graph plus its explicit context.

In particular, it should not:

- mutate graph state during evaluation
- depend on ambient time without opting into some future time signal
- make network requests
- perform async work in the first cut

The more deterministic the body is, the more predictable memoization and
subscription behavior become.

## Likely Internal Source Layout

This feature should not force major package reshaping, but it does need one
clear split between definition-time helpers and runtime evaluation.

### Root-owned definition surface

Definition-only helpers should be exported from `../../src/graph/def.ts`.

That barrel already exists to gather:

- kernel-owned schema primitives that remain part of the authoring surface
- root-owned definition helpers that do not fit an extracted package cleanly
- root-owned definition contracts such as command and view manifests

Computed-predicate authoring utilities belong in that same category. The
underlying implementation likely belongs in a small sibling module such as a
new computed-definition file re-exported from `def.ts`, rather than inside
`@io/graph-client`.

### Client runtime

The execution runtime should live under `../../lib/graph-client/src/`.

That package should own:

- `ComputedRef<T>`
- the dependency collector
- node invalidation and memoization
- attachment of computed refs onto typed entity refs
- any runtime helpers needed to bridge predicate reads into computed
  dependencies

This is the real engine for computed values. It is where reads happen and where
subscriptions are already modeled today.

### React layer

The React helper layer should live under `../../src/graph/runtime/react/`.

That layer should own:

- `useComputedValue(...)`
- any snapshot-stabilization helper mirroring `usePredicateValue(...)`
- host-neutral React glue only

It should not own dependency tracking or the base computed runtime itself.

### Packages that should remain unchanged in v1

For the first cut, none of these packages need feature ownership beyond
possibly consuming the result later:

- `../../lib/graph-kernel/src/`
- `../../lib/graph-bootstrap/src/`
- `../../lib/graph-sync/src/`
- `../../lib/graph-authority/src/`
- `../../lib/graph-projection/src/`

That keeps the durable engine contracts stable while the computed layer proves
itself as a client-side read abstraction.

## Recommended First Increment

The smallest useful implementation would be:

1. introduce definition-time helpers on `@io/core/graph/def` such as
   `computed(...)` and `defineComputed(...)`
2. introduce a `ComputedRef<T>` runtime contract with `get()` and
   `subscribe(...)` in `@io/graph-client`
3. add a small dependency collector runtime in `@io/graph-client`
4. track predicate reads and nested computed reads
5. attach computed refs to entity refs under `entity.computed`
6. add `useComputedValue(...)` in the React layer
7. document that `list()` and `query()` are not reactive dependencies yet

That would already unlock a large class of application logic without forcing a
query planner or a new persistence model.

## Open Design Questions

- Assuming the canonical import stays `@io/core/graph/def`, should computed
  definitions live entirely beside `defineType(...)`, or should type authoring
  eventually grow a `computed` section?
- Should the first cut allow custom equality for expensive or unordered derived
  values, or should it always use the shared logical equality helper?
- Should there be a separate notion of parameterized computed families, such as
  `task.computed.blockedBy(userId)`, or should v1 stay with zero-argument
  per-entity computed values only?
- Should authorities be able to invoke the same computed definitions during
  validation or command handling, or should that stay consumer-owned until the
  client shape settles?

## Future Work Suggestions

1. Prototype one small computed runtime against the existing `PredicateRef`
   contract before changing schema authoring.
2. Add one end-to-end example with React usage once a minimal runtime exists.
3. Decide whether type membership needs its own reactive root before promising
   reactive query-backed computed values.
4. Define a separate materialization story for derived values that need durable
   graph semantics.
