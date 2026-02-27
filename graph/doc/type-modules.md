# Typed Type Modules

## Purpose

This document specifies Phase 2 of the schema-driven UI architecture:

- typed type-module authoring
- separation of schema, abstract metadata, and platform adapters
- how renderers, editors, and filters remain type-safe
- how field-level overrides compose with type-level defaults

This builds on `doc/typed-refs.md`. The ref model defines how runtime values are addressed and observed. This document defines how type families attach typed behavior to those values.

## Why This Phase Exists

If refs are the runtime cursor model, type modules are the authoring model.

We want type authors to be able to define:

- schema
- display semantics
- editing semantics
- filter/query capabilities
- platform-specific adapters

without losing compile-time guarantees.

Registries are still useful, but they should only dispatch already-typed module capabilities at runtime. They should not be the place where typing is invented.

## Scope

This phase should define:

- the conceptual shape of a type module
- the role of `type.ts`, `meta.ts`, `filter.ts`, `web.tsx`, `tui.tsx`
- the typing relationship between schema, refs, renderers, editors, and filters
- how field-level overrides compose with type defaults

This phase should not yet define:

- the exact React hook API
- the TUI interaction model
- the final runtime registry implementation
- the full query AST or planner

## Design Principles

- The type module is the primary authoring unit.
- Schema remains the source of truth for value meaning.
- Type defaults should be strongly typed and composable.
- Field-level overrides should narrow or specialize, not erase.
- Platform adapters should depend on abstract semantics, not the reverse.
- Runtime lookup is dynamic; authoring should still be statically checked.

## Type Module Layout

Recommended directory shape for a type family:

- `type.ts`
- `meta.ts`
- `filter.ts`
- `web.tsx`
- `tui.tsx`
- `index.ts`

Not every type needs every file from day one, but the structure should support growth without forcing unrelated concerns into one file.

## File Responsibilities

### `type.ts`

Owns the schema-facing definition.

Examples of responsibilities:

- `defineScalar(...)`
- `defineType(...)`
- `defineEnum(...)`
- codecs
- low-level validation primitives
- canonical type identity

This file must remain runtime-safe and framework-agnostic.

### `meta.ts`

Owns abstract semantics that platform adapters can consume.

Examples:

- default control kind
- default display kind
- formatting/parsing policies
- searchability hints
- grouping hints
- summary behavior
- field capability descriptors

This file should remain framework-agnostic.

### `filter.ts`

Owns typed filter/query semantics.

Examples:

- supported operators
- operand parsing
- operand formatting
- query-facing labels
- filter UI hints

This file should describe value semantics, not renderer implementation details.

### `web.tsx`

Owns web-specific adapters and components.

Examples:

- React field renderer
- React field editor
- specialized web control implementations

This file may depend on React and web UI libraries.

### `tui.tsx`

Owns TUI-specific adapters and components.

This file should come later and remain isolated from web concerns.

### `index.ts`

Owns the public surface for the type family.

It may re-export:

- the schema type
- abstract metadata
- filter capabilities
- optional platform adapters

## Authoring Layers

The architecture should distinguish four layers of authored behavior.

### Type-level defaults

Owned by the type module.

Examples:

- strings default to text input
- dates default to date-oriented display and range filters
- enums default to option selection and exact-match filtering

### Enum-level defaults

Owned by the enum type family.

Examples:

- option labels
- grouping
- search tokens
- selected-value summaries

### Field-level overrides

Owned where the predicate is declared.

Examples:

- placeholder text
- label override
- display priority
- multiline vs single-line behavior
- restricted filter operators
- relationship-specific editor behavior

### Entity-level layout and composition

Owned by the entity type or its adjacent metadata.

Examples:

- section grouping
- summary fields
- display order
- embedded editor vs linked reference policy

## Type-Safe Contracts

The core goal is to preserve one value model across all attached capabilities.

For a given type or field, the system should statically align:

- schema definition
- decoded runtime value
- `PredicateRef` value access
- renderer/editor contracts
- filter operator operand types

This means the same declared type information should flow through all adjacent behavior instead of being re-declared ad hoc.

## Scalar Type Modules

Scalar type modules should define the canonical decoded value semantics.

Examples:

- string scalar maps to decoded `string`
- number scalar maps to decoded `number`
- date scalar maps to decoded `Date`
- url scalar maps to decoded `URL`

All downstream capabilities should be parameterized by that decoded type.

### What should be statically enforced

- a string renderer handles string values, not number values
- a date filter operator accepts date-like operands, not arbitrary strings
- a number editor cannot accidentally expose boolean mutation semantics

## Enum Type Modules

Enum modules are slightly different from scalars because the stored value behaves like a constrained reference.

They should define:

- option metadata
- selection semantics
- display of selected options
- search/filter behavior over available options

Type safety here should ensure:

- selected values correspond to valid enum members
- filter operators work on enum member identity semantics
- renderers/editors know whether they are handling single or many selection

## Entity And Reference Fields

Entity-valued fields need special treatment.

The current graph model is reference-oriented, so a field whose range is another entity type should be modeled as a typed reference field, not silently as an embedded structured object.

This distinction should remain explicit in the type-module contracts.

Examples of behaviors that may later vary by policy:

- picker for existing related entity
- create-and-link workflow
- inline summary
- drill-in editor

Those are higher-level editing modes built on top of a typed reference field, not alternate interpretations of the stored value.

## Renderer Contracts

Renderers should be typed to the predicate or type capability they handle, not just to loose `unknown` values.

This matters because renderers need access to:

- typed current value
- mutation methods
- schema metadata
- cardinality semantics
- field-level overrides

The renderer contract should preserve all of that without requiring per-call-site casting.

## Editor Contracts

Editors should be typed similarly to renderers, but with stronger emphasis on mutation semantics.

Editors should not be forced into a generic `(value, onChange)` shape if that loses:

- cardinality distinctions
- clear vs replace semantics
- add/remove operations for collections
- reference-specific actions

The type-module contract should allow editors to operate directly on typed predicate refs or on a typed editor capability derived from those refs.

## Filter Contracts

Filters should be typed against the same decoded value model as editors and renderers.

Examples:

- text filters should understand string semantics
- date filters should understand date or date-range semantics
- enum filters should understand valid enum identities
- entity-reference filters should understand relationship identity semantics

The important principle is that filter operands and display labels should be defined once in the type family, then reused by query UIs.

## Field-Level Overrides

Field-level overrides must compose with type defaults safely.

### Good override behavior

- narrow available operators
- choose a different display style
- choose a different editor mode
- add labels, help text, grouping hints

### Bad override behavior

- pretending a `many` field is a `one` field
- changing a decoded value type
- treating an entity reference as an embedded scalar

Overrides should refine behavior, not rewrite fundamental schema semantics.

## Composition Model

The system should compose capabilities in layers:

1. type-family defaults
2. enum or scalar-specific metadata
3. predicate-level overrides
4. entity-level layout/composition rules
5. platform adapter resolution

This ordering keeps responsibilities clear and makes it easier to explain where a behavior came from.

## Platform Adapter Boundary

Platform adapters should consume abstract metadata and typed refs. They should not define the semantic truth of the type.

That means:

- web adapters choose React components for known control/display/filter kinds
- TUI adapters choose terminal-specific interactions
- both consume the same abstract semantics where possible

This prevents the web implementation from accidentally becoming the source of truth for all behavior.

## Registries

Registries are still useful, but their role should stay narrow.

### Good registry responsibilities

- runtime lookup by type key
- dispatch to web/TUI adapter implementations
- dynamic assembly across package boundaries

### Bad registry responsibilities

- inventing value types at runtime
- being the only place where capability contracts are validated
- serving as a substitute for typed authoring

The type module should remain the strongly typed unit. The registry should simply point at it.

## Dependency Rules

To avoid circular imports and accidental coupling, the following one-way dependency rules are recommended.

### Allowed

- `type.ts` imports graph core only
- `meta.ts` imports `type.ts`
- `filter.ts` imports `type.ts` and `meta.ts`
- `web.tsx` imports `type.ts`, `meta.ts`, and `filter.ts`
- `tui.tsx` imports `type.ts`, `meta.ts`, and `filter.ts`

### Avoid

- `type.ts` importing `web.tsx`
- `type.ts` importing `tui.tsx`
- cross-type web component imports when a registry-based lookup would be cleaner

This keeps schema/runtime-safe code isolated from platform-specific code.

## Cross-Type Composition

Some type families will naturally refer to other type families.

Examples:

- `locale` referring to `language` and `country`
- `address` referring to `country`

The type-module system should allow schema references naturally, but platform-level rendering should prefer registry-based composition over direct cross-imports between concrete adapters.

That reduces import mesh complexity and keeps platform composition dynamic.

## Bootstrap Limits

The system will not be able to make every self-describing schema path perfectly typed at bootstrap time.

That is acceptable if:

- those escape hatches are localized
- ordinary type-family authoring remains strongly typed
- runtime dispatch does not leak too much `unknown` into application code

## Open Questions

- What should the exact abstract metadata shape be for display and editing semantics?
- Should field overrides live directly in predicate definitions or adjacent metadata objects?
- How should entity-level layout metadata be expressed without bloating `defineType(...)` input?
- How much capability composition should happen eagerly vs lazily?
- When should custom domain types get their own module families instead of relying on primitive overrides?

## Success Criteria

- A type family can define schema, abstract semantics, and optional platform adapters in one co-located directory.
- Renderer, editor, and filter capabilities are statically aligned with decoded value types and cardinality.
- Field-level overrides refine type defaults without breaking schema truth.
- Core graph runtime remains independent from web and TUI concerns.
- Runtime registries dispatch already-typed capabilities rather than acting as the primary source of correctness.
