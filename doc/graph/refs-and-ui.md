# Graph Refs And UI Boundaries

## Purpose

This document is the entry point for typed refs, predicate-slot subscriptions,
reference policies, and the split between the root runtime surface, the
host-neutral React layer, and host-specific adapters.

## Engine Surface

`../../src/graph/runtime/client.ts` exports:

- typed `EntityRef`
- typed `PredicateRef`
- nested field-group refs
- predicate-slot subscriptions
- cardinality-aware predicate mutation methods
- `resolveEntity(...)` and `listEntities()` for relationship-aware predicate
  refs

## Ref Semantics

- refs are stable handles over one store plus one schema namespace
- predicate subscriptions are keyed to `(subjectId, predicateId)`
- `many`, `one`, and `one?` cardinality already produce different mutation APIs
- nested field groups preserve traversal shape without becoming their own
  reactive unit
- synced clients preserve ref ergonomics by proxy-wrapping the same typed
  handles rather than inventing a second graph API

Relevant source:

- `../../src/graph/runtime/client.ts`
- `../../src/graph/runtime/store.ts`
- `../../src/graph/runtime/sync.ts`

## UI-Adjacent Contracts

The engine exposes enough surface for higher-level UI work:

- field metadata and filter contracts from type modules
- predicate-local subscriptions
- structured validation results suitable for inline field errors
- host-independent `ObjectViewSpec`, `WorkflowSpec`, and `GraphCommandSpec`
  contracts for schema-adjacent layout, workflow, and command metadata
- root-exported reference-policy helpers such as
  `existingEntityReferenceField(...)` and
  `existingEntityReferenceFieldMeta(...)`

What the root engine entry does not ship:

- React hooks or components
- host capability registries or default DOM widgets
- generated forms or object/workflow screens
- route registration or shell composition
- authoritative command implementations
- async option loading or relationship search infrastructure

## React And Adapter Split

React package subpaths split between the canonical host-neutral surface at
`@io/core/graph/runtime/react` and the host-specific entries
`@io/core/graph/adapters/react-dom` and
`@io/core/graph/adapters/react-opentui`.

`@io/core/graph/runtime/react` ships the host-neutral layer from
`../../src/graph/runtime/react/`:

- predicate hooks and field metadata helpers
- entity-level traversal helpers such as
  `useEntityPredicateEntries(...)` and `EntityPredicates`
- selected relationship traversal helpers such as
  `usePredicateRelatedEntities(...)` and `PredicateRelatedEntities`
- mutation validation helpers
- reference-policy readers such as `getPredicateEntityReferencePolicy(...)`
- field and filter resolver primitives that still require host-supplied
  capabilities

`@io/core/graph/adapters/react-dom` ships DOM defaults from
`../../src/graph/adapters/react-dom/`:

- default field view and editor capabilities
- field-family modules under `../../src/graph/adapters/react-dom/fields/`
- default filter operand editors and filter resolvers
- browser fallback rendering around `PredicateFieldView` and
  `PredicateFieldEditor`

`@io/core/graph/adapters/react-opentui` maps to
`../../src/graph/adapters/react-opentui/index.ts`. It is the terminal adapter
package root and currently exports an empty surface.

## Boundary Rules

- `ObjectViewSpec`, `WorkflowSpec`, and `GraphCommandSpec` stay on the root
  `@io/core/graph` surface as pure data contracts
- `@io/core/graph/runtime/react` may read those root-safe contracts and
  type-module metadata, but it should not introduce DOM tags, route
  registration, or authoritative command execution
- `@io/core/graph/adapters/react-dom` may provide HTML widgets, browser
  fallbacks, and DOM capability registries on top of the host-neutral React
  layer
- `app` owns route registration, shell chrome, experiment selection, transport,
  and the authoritative implementations behind `GraphCommandSpec`

## Reference-Policy Flow

The current reference-policy helpers are intentionally small:

- `existingEntityReferenceField(...)` builds a reference field with
  `meta.reference` and optional relationship UI hints
- `existingEntityReferenceFieldMeta(...)` encodes the existing-entity-only
  selection policy, including whether the UI may create-and-link new entities,
  whether the current subject should be excluded from its own picker,
  collection semantics, and an explicit editor kind when needed

`@io/core/graph/runtime/react` reads that policy through
`getPredicateEntityReferencePolicy(...)` and uses it to infer the default
entity-reference display and editor kinds.
`@io/core/graph/adapters/react-dom` then supplies the default list view plus a
shared Base UI entity-reference combobox editor for both single-value and
collection relationships. That editor lives in its own module, uses the
standard clear affordance for optional single-value edges, renders inline chips
for `many` fields, and includes target icons wherever the referenced entities
expose them. Shared combobox option rows must expose visible hover,
highlight, and selected states so pointer and keyboard navigation are both
legible. Tag fields currently add the extra create-on-Enter behavior on top of
that shared combobox. Enum-backed and other closed-option pickers use the same
shared Base UI combobox mechanics with a lighter-weight item renderer.

That keeps reference-selection semantics in the graph authoring layer while
leaving host widgets and route-level relationship search UX in adapter or app
code.

## Delineation

### In Engine

- typed refs
- field-group traversal
- predicate-local invalidation
- cardinality-aware field mutation
- metadata/filter authoring primitives
- root-safe object-view, workflow, and command contracts
- narrow reference-policy helpers for entity-reference fields

### In Adapters Or App

- generic object or workflow renderers over `ObjectViewSpec` and `WorkflowSpec`
- schema-driven form composition
- richer relationship policies beyond existing-only selection
- full collection UX conventions for every `many` field shape
- OpenTUI widget capabilities
