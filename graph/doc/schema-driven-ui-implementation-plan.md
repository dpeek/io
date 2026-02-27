# Schema-Driven UI Implementation Plan

## Purpose

This document translates the schema-driven UI architecture into an execution plan.

Primary references:

- `doc/schema-driven-ui.md`
- `doc/typed-refs.md`
- `doc/type-modules.md`
- `doc/web-bindings.md`

This plan is intentionally practical. It focuses on milestone order, proof points, risks, and delivery boundaries rather than restating the full architecture.

## Execution Strategy

Use a phased approach with narrow vertical slices.

Reasons:

- the highest-risk ideas are runtime refs and predicate-local subscriptions
- the type-module contracts should be proven in one or two concrete type families before broad migration
- the web layer should validate performance and ergonomics before TUI or query-builder work expands scope

The general rule is:

1. prove the runtime shape
2. prove the typing shape
3. prove the web rendering shape
4. expand to richer field kinds
5. add filters
6. add TUI

## Ground Rules

- Keep `src/graph/*` framework-agnostic.
- Do not move all existing types at once.
- Start with a small number of scalar and enum families.
- Prefer additive changes and compatibility shims over big-bang rewrites.
- Measure rerender behavior during the web proof of concept.
- Preserve current typed client ergonomics while new ref-based APIs are introduced.

## Milestone 0: Prep And Alignment

### Goal

Lock the initial architecture and execution boundaries.

### Deliverables

- architecture docs in `graph/doc/`
- implementation plan
- explicit first-slice scope

### Decisions to lock

- refs are the runtime cursor model
- subscriptions are predicate-slot based
- type families become the primary authoring unit
- registries are runtime dispatch only
- web comes before TUI

### Exit criteria

- enough clarity exists to start API design work without reopening the whole architecture

## Milestone 1: Ref Core

### Goal

Introduce the first ref-oriented runtime layer without changing the whole package structure yet.

### Scope

- add stable typed `EntityRef`
- add stable typed `PredicateRef`
- preserve schema-derived typing from current type definitions
- define the first slot subscription primitive

### Work items

- design the runtime object model for refs
- decide where refs live in `src/graph/*`
- add slot-level subscribe/unsubscribe support in the runtime/store layer
- define how current logical field value is read from a predicate ref
- define cardinality-aware mutation methods on predicate refs
- add batching or transaction-aware notification semantics

### Suggested implementation boundary

Do not solve generated rendering yet. This milestone is complete when refs can be created, read, subscribed to, and mutated programmatically.

### Risks

- unstable identities causing React churn later
- overfitting subscription semantics to current store shape
- conflating entity snapshots with refs

### Exit criteria

- one entity type can be addressed through typed refs
- one predicate can be read and mutated through a predicate ref
- subscriptions can target one `(subject, predicate)` slot
- unrelated predicate mutations do not trigger that slot's subscribers

## Milestone 2: Type-Module Foundations

### Goal

Define and prove the typed authoring contract for a small set of type families.

### Scope

- establish type-family directory layout
- define the first authoring pattern for `type.ts`, `meta.ts`, and optional `web.tsx`
- keep the runtime independent from those platform adapters

### Suggested initial types

- `string`
- `number`
- `boolean`
- one enum such as `country` or `status`

### Work items

- choose the exact type-family export shape
- decide what abstract metadata belongs in `meta.ts`
- define the first typed filter-capability placeholder, even if filters are not implemented yet
- prove field-level override composition in one example type
- define dependency rules and import patterns

### Migration advice

Do not immediately move every current file under `src/type/*` into the new structure. Start with a few representative families and allow old and new layouts to coexist temporarily.

### Risks

- making metadata too abstract to be useful
- making metadata too concrete and web-specific
- introducing circular imports between type families and platform adapters

### Exit criteria

- a small set of type families can be authored in the new structure
- the compiler enforces alignment between value semantics and attached capabilities
- old schema authoring still works while the new model is introduced

## Milestone 3: Web Ref Binding Proof Of Concept

### Goal

Validate the React integration model with minimal but real UI.

### Scope

- build the first web resolver
- add predicate-level React hooks
- render and edit a small schema-driven form surface

### Suggested proof surface

- use an existing simple type such as `app.company`
- render a few fields only:
  - one string
  - one number or URL
  - one enum

### Work items

- define the first React hook shape for predicate refs
- define resolver inputs and outputs
- implement generic renderers for a few scalar kinds
- implement one enum selector
- wire edits through predicate refs, not projected entity patches
- observe rerender boundaries in practice

### What to measure

- whether parent composition components stay stable
- whether only changed field components rerender
- whether the ref API feels ergonomic in real React code

### Risks

- resolver becomes too dynamic and loses type clarity
- field components accidentally subscribe too broadly
- current runtime shape makes narrow invalidation awkward

### Exit criteria

- a generated web field can render from a typed predicate ref
- a field edit mutates through that same predicate ref
- changing one field rerenders only the affected field component

## Milestone 4: Nested Fields And Relationship Semantics

### Goal

Handle the first non-trivial schema structures.

### Scope

- nested field trees
- `many` cardinality
- entity-reference fields
- one richer domain type such as `address`

### Work items

- define nested traversal behavior for entity refs
- define collection editing semantics for `many`
- define the first relationship editing policies
- prove that nested structures remain leaf-subscribed
- decide how explicit embedded editing policies should be represented

### Suggested proof surface

- `address`
- a tags-like `many string` field
- a relationship field such as `worksAt`

### Risks

- confusing reference editing with embedded editing
- making `many` fields too generic to support real UX
- growing the resolver API too early

### Exit criteria

- nested leaf fields can be rendered and edited through predicate refs
- many-valued fields support a first coherent editing model
- entity-reference fields have an explicit, typed UI strategy

## Milestone 5: Filter And Query Capabilities

### Goal

Extend the same type-family model to filter authoring and query-facing UI.

### Scope

- define typed filter operator families
- add operand semantics per type family
- build the first query/filter UI slice in web

### Work items

- implement `filter.ts` for initial scalar and enum families
- define field-level operator narrowing
- define how filter operand editors are resolved
- ensure operand typing matches decoded value semantics
- choose how filters lower into runtime query structures

### Suggested proof surface

- text filter on a string field
- exact filter on an enum field
- range filter on number or date

### Risks

- query UI introducing a second incompatible editor system
- overcoupling filter syntax to one query backend
- losing type information at registry boundaries

### Exit criteria

- one query builder surface can resolve typed filter capabilities from schema
- operand editing is type-safe and co-located with type families

## Milestone 6: Broader Type Migration

### Goal

Move more of `src/type/*` into the new family-based layout after the core model is proven.

### Scope

- migrate more primitives and enums
- migrate selected richer types
- reduce compatibility shims over time

### Migration order suggestion

1. core scalar families
2. common enums
3. richer domain types
4. less common or more specialized families

### Work items

- migrate one family at a time
- keep exports stable where possible
- document conventions for new families
- identify shared helpers that belong in core vs shared type utilities

### Risks

- trying to migrate everything before patterns settle
- introducing too many temporary aliases
- letting old and new structures diverge semantically

### Exit criteria

- the new structure is the default authoring pattern for new work
- most actively used families live under the new layout

## Milestone 7: TUI Adapter

### Goal

Add terminal rendering and editing on top of the same abstract contracts.

### Scope

- TUI resolver
- TUI field components
- terminal interaction patterns for a small set of field kinds

### Work items

- choose the TUI framework or rendering strategy
- map abstract control semantics to terminal interactions
- prove one form-like flow and one read-only inspector flow

### Risks

- forcing web assumptions into the TUI design
- discovering missing abstractions too late

### Exit criteria

- a small set of type families can render and edit in both web and TUI through the same abstract contracts

## Cross-Cutting Workstreams

### Documentation

- keep architecture docs updated as interfaces solidify
- add conventions for new type-family authoring
- document escape hatches and intentional weak points

### Testing

- type-level tests for authoring contracts
- runtime tests for slot subscriptions
- React-level tests for rerender boundaries
- migration tests to keep old APIs functioning during the transition

### Performance

- add simple rerender instrumentation in the web proof of concept
- benchmark predicate-local updates against snapshot-based rendering
- watch for identity churn in refs and resolver outputs

### Compatibility

- keep current `createTypeClient(...)` flows usable while refs are introduced
- prefer additive APIs first
- delay removals until the new model has proven itself

## First Build Sequence

The first concrete coding sequence should be:

1. add slot subscription support in the runtime/store layer
2. add typed `EntityRef` and `PredicateRef`
3. expose a minimal ref API alongside the current client API
4. move one scalar family into the new type-module layout
5. add one enum family in the new layout
6. build the first web predicate hook
7. build one generic scalar renderer and one enum renderer
8. render one real entity form surface from refs
9. validate rerender behavior

This sequence is small enough to learn quickly and large enough to prove the architecture.

## Suggested First Real Demo

Use one small real entity from the existing app namespace.

Good candidate:

- `company`

Suggested fields:

- `name`
- `status`
- `website`
- optionally `foundedYear`

This covers:

- string
- enum
- URL
- optional scalar

without immediately introducing nested structures or relationship-heavy complexity.

## Suggested Doc And PR Structure

Keep implementation incremental and reviewable.

Recommended sequence:

1. PR: runtime subscription groundwork and ref API
2. PR: first type-family layout and typed contracts
3. PR: web proof of concept with a few field kinds
4. PR: nested and relationship support
5. PR: filter capabilities

If a milestone needs a non-obvious interface decision, add a short ADR before coding.

## What Not To Do

- do not migrate every type family before proving the runtime and web model
- do not start with TUI
- do not build filters before field rendering is proven
- do not make React components consume whole projected entities by default
- do not let registries become the primary place where typing is enforced

## Success Criteria

The implementation plan is succeeding if:

- the ref model becomes the stable runtime foundation
- the type-family contract remains strongly typed and ergonomic
- the first web proof of concept demonstrates predicate-local rerender behavior
- migration can happen gradually without destabilizing the current package
- later features such as filters and TUI can build on the same foundation instead of inventing parallel abstractions
