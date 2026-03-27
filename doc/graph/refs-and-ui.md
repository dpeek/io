# Graph Refs And UI Boundaries

## Purpose

This document is the entry point for typed refs, predicate-slot subscriptions,
reference policies, and the split between the root runtime surface, the
host-neutral React layer, and host-specific adapters.

## Engine Surface

Typed refs and synced-client ergonomics now live in `@io/graph-client`,
primarily through `../../lib/graph-client/src/graph.ts`,
`../../lib/graph-client/src/app.ts`, and `../../lib/graph-client/src/refs.ts`.
That surface exports:

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

- `../../lib/graph-client/src/graph.ts`
- `../../lib/graph-client/src/app.ts`
- `../../lib/graph-client/src/refs.ts`
- `../../lib/app/src/graph/runtime/store.ts`
- `../../lib/graph-client/src/sync.ts`
- `../../lib/graph-sync/src/index.ts`

## UI-Adjacent Contracts

Across `@io/graph-client` and the root `@io/app/graph` surface, the engine
exposes enough surface for higher-level UI work:

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

React package boundaries now split between the canonical host-neutral surface at
`@io/graph-react` and the canonical browser entry at
`@io/graph-module-core/react-dom`.

`@io/graph-react` ships the host-neutral layer from `../../lib/graph-react/src/`:

- predicate hooks and field metadata helpers
- entity-level traversal helpers such as
  `useEntityPredicateEntries(...)` and `EntityPredicates`
- selected relationship traversal helpers such as
  `usePredicateRelatedEntities(...)` and `PredicateRelatedEntities`
- mutation validation helpers
- reference-policy readers such as `getPredicateEntityReferencePolicy(...)`
- field and filter resolver primitives that still require host-supplied
  capabilities
- generic synced-runtime provider, sync-state, and query hooks

`@io/graph-module-core/react-dom` ships the current default DOM/browser layer
from `../../lib/graph-module-core/src/react-dom/`:

- default field view and editor capabilities
- default filter operand editors and filter resolvers
- browser fallback rendering around `PredicateFieldView`,
  `PredicateFieldEditor`, and `FilterOperandEditor`
- `SvgMarkup` and `SvgPreview`
- `GraphIcon`
- structured-value editors and helpers for duration, money, quantity, range,
  rate, and related value families
- tag-aware entity-reference create-and-attach behavior
- the built-in default field resolver bundle for the current `core:` module

There is no dedicated `react-opentui` adapter anymore. The workflow TUI reads
the same host-neutral runtime provider and query hooks directly from
`@io/graph-react`, while workflow projection hooks still live in
`../../lib/app/src/tui/projection.ts`.

## Boundary Rules

- `ObjectViewSpec`, `WorkflowSpec`, and `GraphCommandSpec` stay on the root
  `@io/app/graph` surface as pure data contracts
- `@io/graph-react` may read those root-safe contracts and
  type-module metadata, but it should not introduce DOM tags, route
  registration, or authoritative command execution
- `@io/graph-module-core/react-dom` may provide the current default browser
  fallbacks, capability registries, and DOM widgets that sit on top of the
  host-neutral React layer, including behavior that depends on built-in
  `core:` value contracts or entity shapes
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

`@io/graph-react` reads that policy through
`getPredicateEntityReferencePolicy(...)` and uses it to infer the default
entity-reference display and editor kinds.
`@io/graph-module-core/react-dom` now supplies the shared generic list view
plus a shared Base UI entity-reference combobox editor for both single-value
and collection relationships. That editor lives in its own module, uses the
standard clear affordance for optional single-value edges, renders inline chips
for `many` fields, and includes target icons wherever the referenced entities
expose them. Shared combobox option rows must expose visible hover,
highlight, and selected states so pointer and keyboard navigation are both
legible. The same package layers the extra tag create-on-Enter behavior on top
of that shared combobox for built-in `core:tag` fields. Enum-backed and other
closed-option pickers use the same shared Base UI combobox mechanics with a
lighter-weight item renderer.

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
