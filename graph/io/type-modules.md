# Graph Type Modules

## Purpose

This document is the entry point for agents working on scalar or enum families, field metadata, or filter contracts.

## Current Contract

`../src/graph/type-module.ts` already defines a real type-module authoring surface for scalar and enum families.

Current exported building blocks:

- `defineScalarModule(...)`
- `defineEnumModule(...)`
- `defineReferenceField(...)`
- `TypeModuleMeta`
- `TypeModuleFilter`
- field-level metadata and filter override types

## Current Authoring Shape

Canonical built-in scalar families belong under `../src/schema/core/*`, with
`../src/type/*` preserved as thin compatibility re-exports while the migration
finishes. The co-located per-type pattern is the same in both places:

- `type.ts`: codec and scalar definition
- `meta.ts`: display/editor metadata
- `filter.ts`: typed filter operators
- `index.ts`: assembled module export

Examples:

- migrated core modules:
  - `../src/schema/core/date/`
  - `../src/schema/core/url/`
  - `../src/schema/core/email/`
- remaining compatibility-backed scalar modules:
  - `../src/type/string/`
  - `../src/type/number/`
  - `../src/type/boolean/`

Enum families already have a default module path via `../src/type/enum-module.ts`.

## Default Directory Contract

One directory per type is the default authoring unit for graph-owned schema
modules.

The target canonical tree is:

- `../src/schema/core/` for `core:` types
- `../src/schema/app/<slice>/` for `app:` types

That layout keeps namespace ownership explicit while preserving the existing
co-located scalar pattern as the starting point for richer modules.

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

- A type-local `index.ts` must stay root-safe for `@io/graph`.
- Root-safe exports may include canonical schema, metadata, filters, pure view
  specs, pure command descriptors, and reusable fixtures.
- A type-local `index.ts` must not import or re-export `react.tsx`,
  `react-dom.tsx`, `react-opentui.tsx`, browser APIs, OpenTUI code, or route
  registration helpers.
- Adapter entrypoints such as `@io/graph/react*` should import colocated
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

- there is no `web.tsx` or `tui.tsx` module contract in `graph` today
- renderer/editor resolution is not implemented in this package
- entity-reference fields use `defineReferenceField(...)` and helper policies, not a richer module family yet
- richer entity-level layout and composition metadata is still mostly roadmap

## Reference-Field Helpers

`../src/graph/web-policy.ts` already provides a narrow current helper for relationship authoring:

- `existingEntityReferenceField(...)`
- `existingEntityReferenceFieldMeta(...)`

Today that helper only encodes an existing-entity-only selection policy. It is a thin field-authoring convenience, not a full UI adapter layer.

## Roadmap

- expand the current metadata/filter contract into fuller renderer/editor adapter resolution
- add stronger conventions for richer domain modules such as address-like structures
- decide how much entity-level layout metadata belongs beside schema definitions
- keep runtime-safe authoring code separate from platform adapters if those land later

## Future Work Suggestions

1. Add one “how to author a new scalar family” example that walks through `type.ts`, `meta.ts`, and `filter.ts`.
2. Document which metadata keys are already relied on by app proof surfaces.
3. Decide whether reference fields should gain their own first-class module abstraction or stay helper-based.
4. Add a small contract test suite that proves override composition across representative families.
5. Capture when `web.tsx` or `tui.tsx` belongs in this package versus an adapter package.
