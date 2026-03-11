# Web Bindings And Predicate-Local React Rendering

## Purpose

This document specifies the web-facing layer that sits on top of:

- `doc/typed-refs.md`
- `doc/type-modules.md`

It focuses on how `app/src/web` should:

- consume typed `EntityRef` and `PredicateRef` objects
- resolve renderers and editors for those refs
- subscribe to predicate-local value changes
- preserve narrow React rerender boundaries

This document is about the web integration model, not the core runtime or the full type-module authoring contract.

## Why This Phase Matters

The architecture aims to make schema-driven UI not just generic, but fast.

That means the web layer cannot simply:

- materialize entity snapshots
- pass plain values through props
- rerender whole subtrees when one field changes

The web layer needs to preserve the granularity and typing established by typed refs.

## Scope

This phase should define:

- the React-facing expectations for `EntityRef` and `PredicateRef`
- renderer and editor resolution in `app/src/web`
- subscription behavior and invalidation goals
- the relationship between generic field components and type-specific adapters

This phase should not yet define:

- the TUI adapter
- the final runtime subscription implementation details
- the complete filter builder UI
- every possible generated form layout API

## Design Principles

- React components should receive refs, not projected entity snapshots.
- The common path should subscribe at predicate level, not entity level.
- Renderer resolution should preserve typing as far as possible.
- Mutation should stay close to the predicate ref.
- Generic components should be able to render most fields.
- Custom type-specific renderers should be easy to plug in without changing the core flow.

## Core Web Concepts

### Entity-bound component

A component that receives an `EntityRef<T>` and decides which fields to show.

This component should usually remain non-subscribing or lightly subscribing. Its job is composition, not data projection.

### Field component

A component that receives a single `PredicateRef<TField>` and renders or edits that field.

This is the natural subscription boundary for generated UI.

### Renderer capability

A typed web-facing capability that can render a predicate ref in a read-only or editable mode.

The capability may be generic or type-specific, but it should work from the ref rather than from ad hoc projected values.

### Resolver

A runtime mechanism in `app/src/web` that selects the appropriate renderer or editor for a predicate ref based on:

- field override metadata
- type-family defaults
- cardinality
- platform-specific adapter availability

## React Data Flow

The recommended data flow is:

1. obtain a typed `EntityRef`
2. derive typed `PredicateRef`s from it
3. pass each `PredicateRef` to a field component
4. let that field component subscribe to the predicate value
5. let that field component mutate through the same ref

This should be the standard path for generated forms, inspectors, and display surfaces.

## Anti-Pattern To Avoid

The following should not become the default architecture:

1. project entity ref into a plain JS object
2. pass values deeply through props
3. attach mutation callbacks at the form root
4. rerender the full entity view when one predicate changes

That would throw away the main benefit of the graph-native field model.

## Hook Expectations

The exact API names are open, but the web layer should support hooks with behavior like:

- subscribe to one predicate ref
- read its current decoded value
- expose value state aligned with the predicate's cardinality
- provide stable access to typed mutation methods

The hook should not require callers to restate `subjectId`, `predicateId`, or value type information that is already contained in the predicate ref.

## Read-Only Rendering

Read-only rendering should operate on predicate refs the same way editing does.

Benefits:

- consistent typing
- consistent subscription boundaries
- easy switching between display and edit modes
- shared formatter and metadata resolution

The read-only path should not require a separate object model from the editable path.

## Editing Model

Editors should operate through predicate refs or typed editor capabilities derived from them.

That lets the editor preserve:

- cardinality-specific mutation behavior
- field metadata
- validation hooks
- reference-specific workflows

This is more future-proof than a generic `value` plus `onChange` API, especially once `many` fields and entity references are involved.

## Renderer Resolution

Renderer resolution should be a separate step from value subscription.

Recommended conceptual flow:

1. start with a `PredicateRef`
2. inspect its effective field metadata
3. resolve a web renderer/editor capability
4. render a component that internally subscribes to the predicate ref

This separation helps prevent accidental parent subscriptions and keeps renderer selection composable.

## Resolver Inputs

The resolver will likely need access to:

- predicate schema definition
- decoded value family
- field-level overrides
- cardinality
- edit vs display mode
- optional layout or context hints

Examples of context hints:

- compact vs full display
- inline vs form mode
- summary vs detail mode
- filter operand editor vs stored-value editor

## Resolver Outputs

The resolver should return a typed capability, not a fully materialized value.

Examples of useful outputs:

- a field view component
- a field editor component
- an unsupported or fallback state

The important property is that the output still expects a predicate ref, so it can subscribe locally.

## Generic And Custom Components

The web layer should support two levels of rendering.

### Generic renderers

Used when the system can render from default semantics alone.

Examples:

- text display
- text input
- checkbox
- enum picker
- date display
- URL link display

### Custom renderers

Used when a type family or specific field has bespoke needs.

Examples:

- country picker with search
- rich address summary
- tokenized tag editor
- relationship browser for entity references

Both paths should still fit into the same predicate-ref-based architecture.

## Form Composition

Generated forms should be built by composing field components around typed refs, not by building one giant state object.

The form layer should:

- discover field refs from schema shape
- resolve field components
- render them independently
- optionally group them using entity-level layout metadata

This keeps large forms tractable and preserves narrow invalidation.

## Nested Field Trees

Nested field trees should remain nested in composition, but subscriptions should still live at leaf predicate refs.

That means a nested form section may group fields structurally without introducing a new reactive unit.

The tree shape is for composition and DX. The reactive leaf remains the predicate slot.

## Many-Valued Fields

Many-valued fields need special handling in the web layer.

The renderer and editor system should distinguish:

- unordered multi-select semantics
- ordered list semantics
- token-list semantics
- collection of references

The hook and editor capability should expose operations that reflect the actual field behavior rather than pretending every many-valued field is the same.

## Entity Reference Fields

Entity-reference fields should remain explicit in the web layer.

Possible UI strategies:

- autocomplete or picker
- create-and-link action
- summary chip
- drill-in link
- inline nested section by explicit policy

These should all operate on a typed reference field contract rather than assuming the related entity is embedded.

## React Invalidation Goals

The intended invalidation behavior is:

- changing one predicate rerenders only components subscribed to that predicate slot
- changing unrelated predicates does not rerender neighboring field components
- entity-composition components remain stable unless their own subscribed data changes
- renderer resolution does not force unnecessary resubscription or remounting

This is the primary performance promise of the architecture.

## Stable Identities

To make the invalidation model practical, the web layer should preserve stable identities for:

- entity refs
- predicate refs
- resolved renderer capabilities where possible

Identity churn at these boundaries will reduce the value of narrow subscriptions and make React memoization less effective.

## Error And Fallback States

The resolver and field components should support graceful handling of:

- unsupported field types
- missing adapter implementations
- invalid value decoding
- temporarily unavailable metadata

These should fail locally at the field level when possible rather than breaking the entire entity rendering surface.

## Context Propagation

The web layer may eventually need contextual rendering hints such as:

- compact vs expanded mode
- read-only vs editable mode
- density
- theme
- query-builder context vs entity-editor context

These should be modeled as rendering context inputs, not as schema truth. The same predicate ref may be rendered differently depending on UI context without changing its underlying semantic contract.

## Suggested Initial Proof Of Concept

The first web proof of concept should stay narrow.

Suggested scope:

- a couple of scalar fields
- one enum field
- one generated entity view
- one editable generated form section
- measurement of predicate-local rerender behavior

This is enough to validate the shape of the architecture without prematurely optimizing every edge case.

## Concrete Phase 3 Proof Surface

The remaining Phase 3 backlog should use the existing schema surface in `app/src/graph/app.ts`.

Preferred field set:

- `company.name`
- `company.foundedYear`
- `company.website`
- `company.status`

Why this set:

- it exercises text, optional number, URL, and enum behavior
- it avoids nested, collection, and relationship concerns while the base resolver path is still being proven
- it maps directly to the current `OPE-47` and `OPE-48` issue split

`company.tags` and `person.worksAt` should remain out of the Phase 3 common path. They belong to Milestone 4 once the generic scalar and enum path is working.

## Phase 3 Backlog Split

The current backlog should be interpreted as:

- `OPE-47`: generic renderer and editor capabilities for the initial field kinds
- `OPE-48`: one small company proof surface composed from those generic capabilities

That split matters because the team should avoid:

- hiding resolver gaps inside a company-specific demo component
- back-solving `many` or relationship editing inside the first generic renderer pass
- turning the proof of concept into a general form-builder project

## Open Questions

- How much resolver logic should be purely metadata-driven vs custom per type family?
- Should read-only and editable resolution share the same capability object or remain separate?
- What is the best shape for form-level coordination when multiple fields commit in one interaction?
- How should async option loading fit into the same predicate-ref-based model later?
- When should a field component subscribe directly vs delegate to a deeper leaf component?

## Success Criteria

- A React component can receive a typed `EntityRef`, derive typed `PredicateRef`s, and render them without projecting a full entity snapshot.
- Generic field components subscribe at predicate level and rerender only when their own predicate slot changes.
- Web renderers and editors can be resolved from typed field metadata without erasing the value model.
- Custom type-family components can plug into the same resolver flow as generic ones.
- The resulting architecture supports schema-driven UI generation without giving up React performance.
