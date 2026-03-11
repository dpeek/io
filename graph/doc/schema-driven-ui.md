# Schema-Driven UI Architecture

## Problem

Today, `graph` schema definitions capture storage and runtime semantics well:

- value range
- cardinality
- scalar codecs
- enum options
- lifecycle hooks

But rendering, editing, and future query/filter behavior are still separate concerns. That creates duplicated logic and makes it hard to build generic tooling, generated forms, or efficient predicate-level UI bindings.

We want a model where schema-adjacent type definitions can also describe how values should be viewed, edited, filtered, and queried, while preserving strong TypeScript guarantees and keeping the core graph runtime independent from any specific UI framework.

## Goals

- Co-locate schema and UI/query semantics with each type definition.
- Preserve strong TypeScript typing when authoring schema, editors, renderers, and filters.
- Support both web and TUI renderers without coupling core graph code to either.
- Introduce typed entity and predicate references suitable for fine-grained subscriptions.
- Make predicate-level React rendering rerender only when the specific predicate value changes.
- Allow generic generated UIs with per-type and per-predicate overrides.

## Non-Goals

- Build the full TUI implementation in the first phase.
- Force all UI metadata to become graph-bootstrap data immediately.
- Replace bespoke, workflow-heavy UIs such as the outliner right away.
- Fully solve bootstrap/self-description typing limits.
- Lock in every platform adapter detail before testing the typed ref model in real React code.

## Core Concepts

### Type module

A directory that owns the schema definition and adjacent behavior for a type family.

Examples:

- `src/type/string/type.ts`
- `src/type/string/meta.ts`
- `src/type/string/filter.ts`
- `src/type/string/web.tsx`
- `src/type/string/tui.tsx`

### EntityRef

A stable, typed reference to one entity node. It is a typed address, not a projected snapshot.

An `EntityRef<T>` should expose typed access to its predicates and nested field tree while avoiding whole-entity subscriptions by default.

### PredicateRef

A stable, typed reference to one predicate slot on one entity. It owns:

- schema metadata
- access to the current decoded value
- typed mutation methods
- subscription identity

### Platform adapter

A web or TUI-specific layer that converts abstract type-module capabilities into concrete components.

### Registry

A runtime lookup mechanism used to resolve implementations by type key, predicate metadata, or control kind. Registries are runtime dispatch only, not the primary source of typing.

## Architectural Boundaries

### `src/graph/*`

Owns:

- schema model
- runtime/store
- typed refs
- subscriptions
- introspection
- mutation batching/transactions

Must not import:

- `web.tsx`
- `tui.tsx`

### `src/type/*`

Owns:

- type definitions
- abstract metadata
- type-safe renderer/editor/filter capability declarations
- optional platform-specific adapters

### `app/src/web/*`

Owns:

- React integration
- predicate-level subscription hooks
- renderer/editor resolution
- generic field and form primitives

### `src/tui/*`

Owns:

- terminal adapters and interaction model

This should come later, after the abstract contracts are stable.

## Type Module Shape

Recommended shape for a type family:

- `type.ts`: schema definition, codec, validation primitives
- `meta.ts`: abstract editing/display/query metadata
- `filter.ts`: filter operators, operand parsing, query-facing semantics
- `web.tsx`: React adapters
- `tui.tsx`: terminal adapters
- `index.ts`: public export surface

Not every type needs every file immediately, but the structure should support growth.

## Type Safety Principles

- Authoring-time typing matters more than registry-time typing.
- Registries are runtime dispatch, not the primary place where correctness is enforced.
- Renderer, editor, and filter contracts should be parameterized by decoded value type and cardinality.
- Field overrides should specialize type defaults without erasing the underlying value model.
- Entity-reference fields must stay distinct from embedded structured values.
- Bootstrap/self-description edges may require carefully bounded escape hatches.

## Reactive Model

The intended reactive model is predicate-slot based rather than entity-snapshot based.

### Subscription unit

The natural invalidation slot is:

- `(subject id, predicate id)`

This supports extremely small rerender boundaries and matches the graph mutation model well.

### Desired behavior

- `EntityRef` is stable and cheap.
- `PredicateRef` is stable and cheap.
- Reading a predicate value happens through a subscription-aware API.
- Mutating one predicate should notify only listeners for affected predicate slots.
- Batch updates should coalesce notifications after commit.

## Web Glue Model

React components should receive typed refs, not projected entity snapshots.

Recommended shape:

- a parent receives `EntityRef<T>`
- it selects typed `PredicateRef`s from that entity
- each field component subscribes to exactly one predicate slot
- mutation methods live on the predicate ref, not in hand-written patch objects

This is the key to building generated UIs without broad invalidation.

## Renderer And Editor Resolution

Renderer lookup should be separate from subscription.

Recommended flow:

1. Obtain a typed `PredicateRef`.
2. Resolve web or TUI capability for that predicate.
3. Let the resolved component use the predicate ref directly.

This avoids accidental parent subscriptions and preserves precise typing through the rendering pipeline.

## Filters And Query Capabilities

Filters should be co-located with types and predicates in the same way that renderers and editors are.

Examples:

- string fields may support `equals`, `contains`, `prefix`
- number and date fields may support `lt`, `gt`, `between`
- enums may support exact and set membership
- entity references may support relationship-aware filters

These operators should be typed against decoded value semantics, not just raw string payloads.

## What Belongs Where

### Primitive or scalar level

- codecs
- default display semantics
- default editor semantics
- default filter operator families

### Enum level

- option labeling
- searchability
- grouping
- display of selected values

### Field or predicate level

- labels
- placeholders
- override control kind
- relationship behavior
- filter restrictions or additions

### Entity or type level

- layout
- grouping
- summaries
- embedded vs reference editing policy

## Known Hard Problems

### Entity-valued predicates

An entity-valued predicate may mean:

- select an existing related entity
- create and link a new related entity
- edit an embedded structured object view
- show a summary and drill into a dedicated editor

These cases should not be conflated.

### Bootstrap limits

Some parts of the schema system cannot be perfectly self-typed because the system bootstraps itself. Those limitations are acceptable if they stay isolated and explicit.

### Registry erasure

Runtime lookup often erases type information. The design should keep the strongly typed authoring unit in the type module, then use registries as a final dispatch layer only.

## Phased Plan

### Phase 0: Vision doc

Write down the target architecture, vocabulary, boundaries, and rollout plan.

### Phase 1: Typed refs and subscriptions

Design and implement:

- `EntityRef`
- `PredicateRef`
- slot-level subscriptions
- mutation notification boundaries

This is the most important technical foundation.

### Phase 2: Type module contracts

Define the strongly typed authoring contracts for:

- schema
- metadata
- renderers/editors
- filter/query capabilities

### Phase 3: Web proof of concept

Build a narrow vertical slice in `app/src/web`:

- a few scalar types
- one enum
- generated field rendering from typed refs
- predicate-local rerender behavior

### Phase 4: Field overrides and relationships

Add:

- nested field trees
- entity references
- per-predicate overrides
- collection-aware editing

### Phase 5: Filters and query surfaces

Add typed filter operator families and query-facing UI building blocks.

### Phase 6: TUI adapter

Once abstract contracts are stable, add the TUI-specific adapter layer.

## Open Questions

- What is the exact shape of field-level override syntax?
- How should embedded editing vs reference editing be expressed for entity-valued predicates?
- Which metadata should eventually be bootstrapped into the graph itself?
- How much of renderer/editor resolution should be generic vs type-specific?
- What transaction and batching API is best for field-level mutation performance?

## Success Criteria

- A type module can define typed schema plus adjacent display, editor, and filter semantics.
- A React component can receive a typed `EntityRef`, derive a typed `PredicateRef`, and render it without subscribing to the whole entity.
- A predicate mutation rerenders only the components that depend on that predicate slot.
- Core graph runtime code remains independent from React and TUI implementations.
- The system supports generic schema-driven UI generation while still allowing bespoke overrides where needed.
