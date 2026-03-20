# Graph Type Modules

## Purpose

This document is the entry point for agents working on scalar or enum families,
field metadata and filter contracts, or the root-safe object-view, workflow,
and command contracts that live beside graph-owned types.

## Current Contract

`../../src/graph/runtime/type-module.ts` already defines a real type-module authoring
surface for scalar and enum families.

Current exported building blocks:

- `defineScalarModule(...)`
- `defineEnumModule(...)`
- `defineReferenceField(...)`
- `TypeModuleMeta`
- `TypeModuleFilter`
- `ObjectViewSpec`
- `WorkflowSpec`
- `GraphCommandSpec`
- field-level metadata and filter override types

The host-independent object-view, workflow, and command contracts live in
`../../src/graph/runtime/contracts.ts` and are exported from the root `@io/core/graph`
surface.

## Root-Safe Authoring Contracts

The newer contract symbols are current package surface, not proposal text.
`../../src/graph/runtime/contracts.typecheck.ts` shows the intended usage in real code.

### `ObjectViewSpec`

Use `ObjectViewSpec` for reusable, host-independent object presentation
metadata that belongs with one type or a very small slice of related types.

Current fields:

- `key` and `entity` identify the view and its subject type
- `titleField` and `subtitleField` point at summary predicates when helpful
- `sections` groups reusable field layout metadata
- `related` lists reusable related-entity presentations such as `list`,
  `table`, or `board`
- `commands` advertises command keys the view can surface

This contract stays pure data. React composition, DOM layout, route ownership,
and browser event handling stay out of it.

### `WorkflowSpec`

Use `WorkflowSpec` for reusable, declarative multi-step flows that reference
object-view keys and command keys without turning the graph root into a route
layer.

Current fields:

- `key`, `label`, and `description`
- `subjects` for the type keys the workflow applies to
- `steps`, where each step may reference an `objectView` key or a `command`
  key
- `commands` for any workflow-level command affordances

Type-local workflows can live beside a type. Cross-type workflows can live in a
small graph-owned workflow module, but the contract itself stays root-safe.

### `GraphCommandSpec`

Use `GraphCommandSpec<Input, Output>` for a durable command descriptor that
captures execution mode, I/O shape, and policy without embedding the
authoritative implementation.

Current fields:

- `key`, `label`, and optional `subject`
- `execution`: `localOnly`, `optimisticVerify`, or `serverOnly`
- `input` and `output`
- optional `policy.capabilities`
- optional `policy.touchesPredicates`

The descriptor belongs in `@io/core/graph`. The authoritative implementation,
transport wiring, and route ownership still belong in `app`.

## Current Authoring Shape

Canonical built-in scalar families now live under
`../../src/graph/modules/core/*`. The co-located per-type pattern stays the same:

- `type.ts`: codec and scalar definition
- `meta.ts`: display/editor metadata
- `filter.ts`: typed filter operators
- `index.ts`: assembled module export

Examples:

- `../../src/graph/modules/core/date/`
- `../../src/graph/modules/core/url/`
- `../../src/graph/modules/core/email/`
- `../../src/graph/modules/core/string/`
- `../../src/graph/modules/core/number/`
- `../../src/graph/modules/core/boolean/`

Enum families already have a default module path via `../../src/graph/modules/core/enum-module.ts`.

## Default Directory Contract

One directory per type is the default authoring unit for graph-owned schema
modules.

The current canonical tree is:

- `../../src/graph/modules/core/` for `core:` types
- `../../src/graph/modules/app/<slice>/` for `app:` types

`../../src/graph/schema/` remains as the compatibility entry surface for existing
package imports. Ownership now lives in `../../src/graph/modules/`, which keeps
namespace ownership explicit while preserving the existing co-located scalar
pattern as the starting point for richer modules.

## Per-Type Module Shape

The current scalar layout remains the baseline shape:

- `type.ts`: canonical type definition or codec
- `meta.ts`: host-neutral metadata
- `filter.ts`: typed filter operators when needed
- `index.ts`: root-safe export surface for the type

Richer entity-like types can add neighbors such as:

- `views.ts`: host-neutral object or workflow specs
- `commands.ts`: host-neutral command descriptors
- `fixtures.ts`: reusable sample builders that are safe to ship from `graph`
- `react.tsx`: host-neutral React composition
- `react-dom.tsx`: DOM-specific rendering or editing
- `react-opentui.tsx`: OpenTUI-specific rendering or editing

Not every type directory needs every file. The rule is to keep the type as the
main authoring boundary rather than splitting canonical ownership across
taxonomy files or app routes.

## Root-Safe Export Rule

Physical colocation and package export ownership are separate concerns.

- A type-local `index.ts` must stay root-safe for `@io/core/graph`.
- Root-safe exports may include canonical schema, metadata, filters, pure view
  specs, pure command descriptors, and reusable fixtures.
- A type-local `index.ts` must not import or re-export `react.tsx`,
  `react-dom.tsx`, `react-opentui.tsx`, browser APIs, OpenTUI code, or route
  registration helpers.
- Adapter entrypoints such as `@io/core/graph/react*` should import colocated
  adapter files directly instead of reaching through the root export.

Taxonomy modules follow the same rule: they aggregate only the root-safe parts
of their type directories.

## Current Semantics

Type modules already provide:

- typed decoded value alignment across schema, metadata, and filter operators
- default display and editor kinds
- field-level metadata overrides
- field-level filter narrowing and default-operator overrides
- collection metadata hooks such as ordered vs unordered semantics

This is real engine code, not just a design sketch.

## Current Limits

- there is no required per-type `react.tsx`, `react-dom.tsx`, or
  `react-opentui.tsx` contract in `graph` today
- renderer and editor resolution do not live on the root `@io/core/graph` surface;
  current resolver primitives ship on `@io/core/graph/react` from
  `src/graph/runtime/react/*`, and default DOM capabilities ship on
  `@io/core/graph/react-dom` from `src/graph/adapters/react-dom/*`
- entity-reference fields still use `defineReferenceField(...)` plus
  reference-policy helpers rather than a richer module family
- richer entity-level layout and composition beyond pure specs is still mostly
  roadmap

## Reference-Policy Helpers

`@io/core/graph` already exports a small helper surface for relationship authoring:

- `existingEntityReferenceField(...)`
- `existingEntityReferenceFieldMeta(...)`

Today those helpers encode the existing-entity-only selection policy plus the
most common UI hints that travel with it, such as collection semantics and an
explicit collection editor kind like the shared entity-reference combobox.
They also carry simple picker rules such as excluding the current subject from
self-referential single-value selections.
Entity-reference fields now resolve to the shared combobox across both
single-value and collection cardinalities. These helpers are still thin
field-authoring conveniences, not route code, DOM widgets, or a full
relationship-search layer.

## Roadmap

- expand the current metadata, view, workflow, and command contracts into fuller
  adapter resolution
- add stronger conventions for richer domain modules such as address-like structures
- decide how much entity-level layout metadata belongs beside schema definitions
- keep runtime-safe authoring code separate from platform adapters if those land later

## Future Work Suggestions

1. Add one “how to author a new scalar family” example that walks through `type.ts`, `meta.ts`, and `filter.ts`.
2. Document which metadata keys are already relied on by the web explorer and other UI surfaces.
3. Decide whether reference fields should gain their own first-class module abstraction or stay helper-based.
4. Add a small contract test suite that proves override composition across representative families.
5. Capture when `web.tsx` or `tui.tsx` belongs in this package versus an adapter package.
