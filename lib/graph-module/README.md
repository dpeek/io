# Graph Module Package

`@io/graph-module` is the extracted definition-time authoring package for graph
schemas.

## Read This First

- Start with `./out/index.d.ts` for the compact public contract.
- Start with `./src/index.ts` for the curated public entrypoint.
- Read `./src/type.ts` for the `TypeModule` contract and the scalar/enum
  field-authoring helpers.
- Read `./src/reference.ts` for existing-entity relationship helpers.
- Read `./src/contracts.ts` for pure command, command-surface, object-view,
  record-surface, collection-surface, and workflow descriptors.
- Read `./src/manifest.ts` for the shared built-in/local module manifest
  contract, source metadata, and declared runtime contribution vocabulary.

## Package Docs

These are the canonical agent docs for package-specific behavior in
`@io/graph-module`.

- [`./doc/module-stack.md`](./doc/module-stack.md): cross-package ownership for type-module authoring, built-in modules, manifests, and installed-module lifecycle
- [`./doc/secret-stack.md`](./doc/secret-stack.md): cross-package ownership for secret handles, secret-field authoring, authority writes, and web-side storage
- [`./doc/type-modules.md`](./doc/type-modules.md): type-module metadata, filter contracts, field overrides, and packaged defaults
- [`./doc/reference-and-secret-fields.md`](./doc/reference-and-secret-fields.md): reference-field helpers, existing-entity metadata, and shared secret-field authoring
- [`./doc/authored-contracts.md`](./doc/authored-contracts.md): object-view, record-surface, collection-surface, command-surface, workflow, and command descriptors
- [`./doc/module-manifests.md`](./doc/module-manifests.md): shared built-in or local module manifest contract and fail-closed runtime contribution validation

Cross-package architecture now lives in `./doc/module-stack.md`,
`./doc/secret-stack.md`, and `../graph-surface/doc/roadmap.md`. Start here
when the question is local to this package. Jump to the broader package docs
when the question crosses package or runtime boundaries.

## Naming

- `@io/graph-module` is the package.
- "graph modules" are concrete authored namespace slices such as `core` and
  `workflow`.
- "type modules" are the reusable `{ type, meta, filter, field(...) }`
  authoring objects returned by helpers such as
  `defineScalarModule(...)`, `defineEnumModule(...)`,
  `defineDefaultEnumTypeModule(...)`, and
  `defineValidatedStringTypeModule(...)`.

## Surface Contract Guidance

- `ObjectViewSpec` remains the compatibility-oriented current record-view
  descriptor for callers that already key authored layouts by object view.
- `RecordSurfaceSpec` is the preferred authored record-surface name for new
  work. Its field and section shapes intentionally stay aligned with
  `ObjectViewSpec` so existing authored layout data can migrate without
  reshaping.
- `CollectionSurfaceSpec` is the authored collection contract. Use that export
  for reusable list, table, board, or card-grid metadata rather than inventing
  a parallel `CollectionView` root type.
- `WorkflowSpec` remains the stable authored flow contract. It still references
  `ObjectViewSpec` and `GraphCommandSpec` keys as the current compatibility
  seam while record-surface and command-surface composition settles.
- `GraphCommandSpec` owns execution mode, policy, and I/O shape only. Human
  invocation metadata such as dialog or sheet presentation belongs on
  `GraphCommandSurfaceSpec`.

## Important Semantics

- This package is definition-time only. It authors data contracts and helpers;
  it does not own runtime installation, execution, or host composition.
- `TypeModule.field(...)` composes field-local metadata overrides with the
  module defaults and narrows filter operators against the module filter
  contract.
- `defineReferenceField(...)` is a freeze-only authoring helper. It does not
  add runtime behavior.
- `defineSecretField(...)` always produces a concrete `authority.secret`
  payload and defaults to `visibility: "replicated"` plus
  `write: "server-command"` unless the caller narrows those values.
- `GraphCommandSpec` owns execution and policy. UI invocation semantics belong
  on `GraphCommandSurfaceSpec`.
- `defineGraphModuleManifest(...)` fails closed on blank metadata, duplicate
  contribution identities, empty runtime blocks, and module-id drift across
  query-surface catalogs or read scopes.

## What It Owns

- schema-authoring primitives re-exported from `@io/graph-kernel`
- type-module helpers layered above those kernel primitives
- reference-field authoring policy helpers
- secret-field authoring helpers
- pure authored contracts such as `GraphCommandSpec`,
  `GraphCommandSurfaceSpec`, `ObjectViewSpec`, `RecordSurfaceSpec`,
  `CollectionSurfaceSpec`, `WorkflowSpec`, and `GraphModuleManifest`
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
- attach pure object-view, record-surface, collection-surface, command-surface,
  workflow, command, and module-manifest descriptors beside authored module
  slices

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
- pure authored contracts: `GraphCommandSpec`, `GraphCommandSurfaceSpec`,
  `ObjectViewSpec`, `RecordSurfaceSpec`, `CollectionSurfaceSpec`,
  `WorkflowSpec`, `GraphModuleManifest`, and `defineGraphModuleManifest`

## Module Manifests

Use `GraphModuleManifest` and `defineGraphModuleManifest(...)` for the first
shared authored manifest contract across built-in and local modules.

Current manifest identity and compatibility fields:

- `moduleId`
- `version`
- `source.kind`, where the first source kinds are `built-in` and `local`
- `source.specifier`
- `source.exportName`
- `compatibility.graph`
- `compatibility.runtime`

Current declared runtime contribution vocabulary:

- `schemas`
- `querySurfaceCatalogs`
- `commands`
- `commandSurfaces`
- `objectViews`
- `recordSurfaces`
- `collectionSurfaces`
- `workflows`
- `readScopes`
- `projections`
- `activationHooks`

The manifest helper validates these declarations fail closed. Empty runtime
blocks, duplicate contribution identities, blank source metadata, and module-id
mismatches between the manifest and declared query catalogs or read scopes all
throw at definition time.

This package intentionally stops at definition-time authoring. Runtime module
management, including the authoritative installed-module ledger and activation
state contract, lives in `@io/graph-authority`.

## Build Output

Run `turbo build --filter=@io/graph-module` from the repo root, or `bun run build`
in this package, to emit `./out`.
Run `turbo check --filter=@io/graph-module` from the repo root, or
`bun run check` in this package, to lint, format, type-check, and execute the
package-local Bun tests.

The intended first-read contract artifact for agents is `./out/index.d.ts`.
