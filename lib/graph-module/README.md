# Graph Module Package

`@io/graph-module` is the extracted definition-time authoring package for graph
schemas.

## Read This First

- Start with `./src/index.ts` for the curated public entrypoint.
- Read `./src/type-module.ts` for the `TypeModule` contract and the scalar/enum
  field-authoring helpers.
- Read `./src/reference-policy.ts` for existing-entity relationship helpers.
- Read `./src/definition-contracts.ts` for pure command, object-view, and
  workflow descriptors.

## Naming

- `@io/graph-module` is the package.
- "graph modules" are concrete authored namespace slices such as `core` and
  `workflow`.
- "type modules" are the reusable `{ type, meta, filter, field(...) }`
  authoring objects returned by helpers such as
  `defineScalarModule(...)`, `defineEnumModule(...)`,
  `defineDefaultEnumTypeModule(...)`, and
  `defineValidatedStringTypeModule(...)`.

## What It Owns

- schema-authoring primitives re-exported from `@io/graph-kernel`
- type-module helpers layered above those kernel primitives
- reference-field authoring policy helpers
- secret-field authoring helpers
- pure authored contracts such as `GraphCommandSpec`, `ObjectViewSpec`, and
  `WorkflowSpec`
- generic packaged defaults such as `defineDefaultEnumTypeModule(...)` and
  `defineValidatedStringTypeModule(...)`

## What It Does Not Own

- graph ids, store primitives, or schema storage as the source of truth
- bootstrap, client, sync, authority runtime, or projection execution
- built-in `core` or `workflow` module definitions
- module activation, installation, registry, or permission runtime
- web, TUI, React, or other host composition layers

## Common Workflows

- define a schema type with `defineType(...)`, `defineScalar(...)`, or
  `defineEnum(...)`
- wrap a scalar or enum definition in a `TypeModule` with
  `defineScalarModule(...)` or `defineEnumModule(...)`
- freeze reference or secret-backed fields with `defineReferenceField(...)`,
  `existingEntityReferenceField(...)`, or `defineSecretField(...)`
- attach pure object-view, workflow, and command descriptors beside authored
  module slices

## Layering

- `@io/graph-kernel`: schema primitives such as `defineType(...)`,
  `defineScalar(...)`, and `defineEnum(...)`
- `@io/graph-module`: module-definition helpers and pure authored contracts
- built-in or future module packages: concrete authored modules such as `core`
  and `workflow`

## Public API

`@io/graph-module` exposes a single public entrypoint from `./src/index.ts`.
Everything intended for consumers is re-exported from the package root.

- kernel schema primitives: `defineType`, `defineScalar`, `defineEnum`
- type-module contracts: `TypeModule`, `TypeModuleMeta`, `TypeModuleFilter`,
  `TypeFilterOperator`, and the value/override helper types
- type-module builders: `defineScalarModule`, `defineEnumModule`,
  `defineDefaultEnumTypeModule`, and `defineValidatedStringTypeModule`
- reference helpers: `defineReferenceField`, `existingEntityReferenceField`,
  `existingEntityReferenceFieldMeta`, and `defineSecretField`
- pure authored contracts: `GraphCommandSpec`, `ObjectViewSpec`, and
  `WorkflowSpec`

This package intentionally stops at definition-time authoring. Runtime module
management belongs to later layers.

## Build Output

Run `turbo build --filter=@io/graph-module` from the repo root, or `bun run build`
in this package, to emit `./out`.
Run `turbo check --filter=@io/graph-module` from the repo root, or
`bun run check` in this package, to lint, format, type-check, and execute the
package-local Bun tests.
