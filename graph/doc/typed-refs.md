# Typed Entity And Predicate Refs

## Purpose

This document specifies Phase 1 of the schema-driven UI architecture:

- typed `EntityRef`
- typed `PredicateRef`
- predicate-slot subscriptions
- mutation notification boundaries
- React-facing glue expectations

This is intentionally narrower than `doc/schema-driven-ui.md`. It focuses on the core runtime and binding model that later web, TUI, and filter systems will depend on.

## Why This Phase Comes First

The highest-risk part of the architecture is not folder layout or renderer registration. It is whether the system can provide:

- strong typing from schema to UI bindings
- stable reference identities
- predicate-local rerender behavior
- ergonomic mutation APIs

If this layer feels wrong, every later renderer/editor/filter abstraction will feel wrong too.

## Scope

This phase should define:

- the conceptual contract for `EntityRef`
- the conceptual contract for `PredicateRef`
- how refs preserve schema typing
- what the subscription unit is
- how mutations notify subscribers
- how React should consume refs

This phase should not yet define:

- the full type-module authoring contract
- the full renderer/editor API surface
- the TUI adapter
- the complete filter/query UI story

## Design Principles

- Refs are typed addresses, not snapshots.
- Subscription is explicit and field-local.
- Mutation should be authored at the predicate level where possible.
- Reference objects should be stable and cheap to retain.
- Parent components should not accidentally subscribe to whole-entity state.
- Runtime dispatch may be dynamic, but authoring should remain strongly typed.

## Core Abstractions

### EntityRef

An `EntityRef<TType>` is a stable reference to a concrete entity node of schema type `TType`.

It should carry:

- the runtime/store context
- the entity id
- the schema type definition
- typed access to predicates and nested field groups

It should not:

- eagerly project the whole entity into a plain object
- subscribe to all fields automatically
- force React consumers into entity-level rerenders

### PredicateRef

A `PredicateRef<TField>` is a stable reference to one predicate slot on one entity.

It should carry:

- the subject entity id
- the predicate id/key
- the field schema definition
- the decoded value type
- the field cardinality semantics
- the runtime context needed for read, subscribe, and mutate

It should be the primary unit used by generated field components.

### Nested field group ref

For nested schema trees, the system may expose an intermediate typed group reference.

This exists only to preserve schema shape and typed traversal. It should not itself imply a subscription boundary.

## Typing Model

The typing model should preserve the declared schema shape all the way through the ref surface.

Examples of desired outcomes:

- `EntityRef<typeof app.company>` exposes typed refs for `name`, `status`, `website`
- nested fields remain nested in the ref tree
- a `one` string field is not mistaken for a `many` string field
- an entity-reference field is not mistaken for an embedded structured object

The ref surface should derive its type information from the same schema definitions already used by the typed client.

## Identity And Stability

### EntityRef identity

For a given runtime, schema type, and entity id, the system should return the same stable conceptual reference.

Stable identity matters because:

- React components may memoize refs
- renderer resolution may cache by ref or schema key
- repeated reallocation of logically identical refs will create avoidable churn

The exact implementation may use caching or lightweight wrappers, but the public model should treat refs as stable identities.

### PredicateRef identity

For a given entity ref and predicate slot, the system should return the same stable conceptual reference.

The important point is that calling code should be able to treat a predicate ref as a long-lived cursor into one field.

## Subscription Model

### Subscription unit

The primary subscription unit is:

- `(subject id, predicate id)`

This is the minimal useful invalidation slot for schema-driven field rendering.

### Why this unit

It matches:

- how facts are stored
- how updates are expressed
- how field editors naturally think
- how React leaf components should rerender

Entity-level subscriptions may still exist later for broader inspectors or projections, but they should not be the default surface used by generated UI.

### Subscription behavior

A predicate subscription should fire when the logical decoded value for that predicate slot changes.

That means the system should compare or version logical slot state, not just raw edge append activity.

Examples:

- replacing a single-value field triggers one predicate-slot update
- replacing a `many` field triggers one update for that predicate slot, not one rerender per edge
- touching `updatedAt` should not rerender unrelated field views unless they also subscribe to that predicate

## Mutation Model

### Predicate-local mutation

Where practical, field editors should mutate through `PredicateRef` methods rather than assembling entity patch objects manually.

Benefits:

- the field already knows subject and predicate identity
- the value type is already known
- cardinality-specific operations can be modeled clearly

### Cardinality-aware operations

Different predicate shapes need different mutation semantics:

- `one`: set/replace
- `one?`: set/replace/clear
- `many`: replace/add/remove/reorder, depending on field semantics

The API surface should make those distinctions explicit rather than collapsing everything into a single weakly typed setter.

### Batching

The runtime should support batched or transactional mutation semantics so that:

- multiple field changes can commit together
- subscribers are notified after commit
- slot notifications can be coalesced

The transaction API itself does not need to be fully specified in this phase, but the ref model should assume batched notifications are possible.

## Reading Model

### Refs are not values

An `EntityRef` or `PredicateRef` should not itself be the current value. It is a handle.

This distinction is important because it preserves:

- stable identity
- explicit subscriptions
- lazy reading
- platform-neutral runtime behavior

### Predicate reads

Predicate reads should decode values using the same scalar and enum semantics already used by the typed client.

The reading contract should align with cardinality:

- `one` returns a required decoded value
- `one?` returns an optional decoded value
- `many` returns a decoded collection

## React Integration Contract

### High-level expectation

React components should consume refs in a way that preserves narrow rerender boundaries.

Recommended shape:

- a parent receives an `EntityRef`
- it selects one or more `PredicateRef`s
- leaf field components subscribe through predicate-level hooks

### Anti-pattern to avoid

Do not make the common path:

- project entity to plain object
- pass projected values through props
- rerender the whole subtree on any field change

That would defeat the main point of the architecture.

### Hook shape

The exact hook names are still open, but the model should support:

- subscribe to one predicate ref
- read its current decoded value
- perform typed mutations on that same ref

The hook should not require callers to manually specify `subjectId` and `predicateId` again once they already hold a typed predicate ref.

## Renderer Resolution Contract

Renderer resolution should operate on typed predicate refs or on their schema metadata, not on ad hoc projected values.

That separation is important:

- renderer lookup decides which component or capability applies
- subscription reads current value
- mutation methods remain on the predicate ref

This keeps the data plane and the rendering plane cleanly separated.

## Nested Fields

Nested field groups should preserve schema traversal shape.

Example goal:

- an address-like nested structure should be traversable through a typed nested path
- each leaf field still resolves to its own predicate ref

The nested group should be a traversal convenience, not an eagerly materialized nested snapshot object.

Current decision:

- a nested traversal node is a stable field-group ref keyed by the schema field tree
- the group carries traversal metadata such as field-tree identity and path
- the group does not expose its own subscription API
- each leaf under the group remains a `PredicateRef`

## Concrete Milestone 4 Proof Surfaces

The next ref-heavy backlog items already have concrete schema targets in the repo:

- `company.tags` for the first `many string` semantics
- `person.worksAt` for the first entity-reference field semantics
- `address` in `graph/src/type/address/index.ts` for an address-like nested group once it is wired into the app schema

Those surfaces should drive the next ref decisions rather than abstract examples with no path to a real UI proof.

## Staging Rules For Remaining Ref Work

To keep the backlog slices coherent:

- `OPE-49` should define nested traversal and leaf ref identity, not the full nested editor UX
- `OPE-50` should define collection operations and change semantics for `many` fields
- `OPE-51` should define explicit reference-field policies for entity relationships

That separation prevents one issue from quietly re-solving the others and keeps the architecture easier to evaluate.

## Entity References vs Embedded Values

This phase must preserve the distinction between:

- a predicate whose value is another entity id
- a predicate whose value is a structured embedded value

The current graph model is fundamentally reference-oriented. Any embedded editing experience must be an explicit higher-level policy, not an accidental consequence of nested typing.

For the current backlog this means:

- `person.worksAt` should behave like a typed relationship field
- an address-like nested editor, if introduced, must be explicit about whether it is a structured local group or a reference to another entity
- the first relationship UI should not reuse an embedded-value editor by accident just because both can look visually nested

## Equality And Change Detection

The runtime should define slot change in terms of the logical field value that consumers observe.

Open implementation choices include:

- revision counters per slot
- structural equality for decoded collections
- identity-preserving decoded snapshots where possible

This phase should not over-specify the exact algorithm, but it should insist that subscription invalidation match observed field semantics.

## Open Questions

- Should `EntityRef` creation be cached globally per runtime or memoized lazily per consumer path?
- How should `many` fields expose order-sensitive vs order-insensitive operations?
- How should field refs expose errors or invalid states if later validation becomes asynchronous?
- Should there also be a coarser entity-level subscription API for inspectors and devtools?

## Success Criteria

- A typed entity ref can expose typed predicate refs derived from schema.
- Predicate refs preserve decoded value and cardinality semantics.
- The reactive unit is predicate-slot local.
- React consumers can subscribe to one predicate without subscribing to the whole entity.
- The design leaves room for later renderer/editor/filter adapters without changing the core ref model.
