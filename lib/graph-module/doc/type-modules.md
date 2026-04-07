---
name: Graph module type modules
description: "Type-module metadata, filter contracts, field overrides, and packaged defaults in @io/graph-module."
last_updated: 2026-04-03
---

# Graph module type modules

## Read this when

- you are changing `TypeModule`, `TypeModuleMeta`, or `TypeModuleFilter`
- you need to understand how scalar or enum authoring becomes a reusable field helper
- you are debugging field-level metadata or filter overrides

## Main source anchors

- `../src/type.ts`: `TypeModule` contracts, field composition, and scalar or enum module helpers
- `../src/string.ts`: packaged validated-string helper
- `../src/enum.ts`: packaged default enum helper
- `../src/index.test.ts`: runtime-facing authoring coverage
- `../src/index.typecheck.ts`: boundary and narrowing coverage
- `./module-stack.md`: cross-package ownership and built-in module consumers

## What this layer owns

- reusable scalar and enum authoring helpers layered above `@io/graph-kernel`
- host-neutral type metadata for summary, display, and editor defaults
- filter operator contracts and field-local narrowing
- generic packaged defaults for common enum and validated-string cases

It does not own built-in `core:` or `workflow:` type definitions. Those live in the module packages that consume this authoring surface.

## Type-module model

A `TypeModule` bundles three things:

- one canonical scalar or enum type definition
- normalized metadata defaults
- normalized filter defaults

`TypeModule.field(...)` freezes one field against those defaults. It does not create a second runtime abstraction.

## Metadata contract

`TypeModuleMeta` carries host-neutral authoring data:

- top-level metadata such as `label`, `description`, `group`, `priority`, and `searchable`
- optional collection semantics
- optional summary formatting
- `display` metadata with one chosen `kind` plus the allowed display-kind set
- `editor` metadata with one chosen `kind` plus the allowed editor-kind set

Field overrides merge shallowly into the module defaults:

- top-level metadata is overridden field by field
- `display` overrides merge into the default `display` block
- `editor` overrides merge into the default `editor` block

## Filter contract

`TypeModuleFilter` defines:

- one `defaultOperator`
- a named operator map

Each operator owns:

- a label
- a declarative operand shape
- parse and format helpers
- a pure `test(...)` function

Field-level filter overrides can narrow the available operator set. `composeFilter(...)` preserves the module default operator when it is still allowed and otherwise falls back to the first narrowed operator.

## Field-freezing semantics

`TypeModule.field(...)` returns an ordinary field definition with:

- `range` fixed to the module-owned type
- merged metadata
- narrowed filter metadata
- passthrough authoring fields such as `key`, `icon`, `onCreate`, `onUpdate`, `validate`, `authority`, and `createOptional`

This layer stays definition-time only. It freezes authored contracts; it does not add client or authority runtime behavior.

## Packaged defaults

`defineDefaultEnumTypeModule(...)` gives enum types a shared default shape:

- searchable metadata
- display kinds `text` and `badge`
- editor kinds `select` and `segmented-control`
- filter operators `is` and `oneOf`

`defineValidatedStringTypeModule(...)` gives validated strings a shared shape:

- one scalar whose encode and decode both use the provided parser
- searchable metadata by default
- text display and text editor defaults
- optional placeholder, input type, input mode, and autocomplete hints

## Practical rules

- Use packaged defaults when they fit. Only drop to `defineScalarModule(...)` or `defineEnumModule(...)` when the metadata or filter contract actually differs.
- Keep field overrides narrow. If every field redefines the same defaults, the module defaults are wrong.
- Keep type modules host-neutral. Browser widgets and runtime mutation behavior belong in later packages.
