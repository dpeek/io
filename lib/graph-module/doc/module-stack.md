---
name: Graph module stack
description: "Cross-package ownership for type-module authoring, built-in modules, manifests, and installed-module lifecycle centered on @io/graph-module."
last_updated: 2026-04-03
---

# Graph module stack

## Read this when

- the question spans `@io/graph-module`, `@io/graph-module-core`,
  `@io/graph-module-workflow`, or `@io/graph-authority`
- you need the shared boundary before changing type modules, built-in module
  ownership, or manifest-to-installed-module lifecycle
- you want the owning package doc before editing a module-related area

## Main source anchors

- `../src/type.ts`: type-module contracts, field composition, and shared
  authoring helpers
- `../src/manifest.ts`: authored manifest contract and runtime contribution
  vocabulary
- `../../graph-module-core/src/index.ts`: built-in `core:` package root and
  `coreManifest`
- `../../graph-module-workflow/src/index.ts`: built-in `workflow:` package root
  and `workflowManifest`
- `../../graph-authority/src/contracts.ts`: installed-module records,
  compatibility checks, and lifecycle plans
- `../../graph-integration/src/module-installation-contract.test.ts`:
  cross-package proof for authored-manifest to installed-ledger behavior

## What this doc owns

- the cross-package ownership map for the shipped module stack
- stable seams between shared definition-time authoring, concrete built-in
  modules, and authority-owned install lifecycle
- redirects to the package-local docs that own current runtime behavior

It does not own app-specific installer UX, bundle discovery, or host runtime
registry composition.

## Current ownership

- `@io/graph-module` owns shared definition-time authoring contracts:
  `TypeModule`, reference and secret field helpers, pure surface descriptors,
  and `GraphModuleManifest`
- `@io/graph-module-core` owns the concrete built-in `core:` namespace,
  durable core-owned product records, and the core query-surface catalog
- `@io/graph-module-workflow` owns the concrete built-in `workflow:`
  namespace, workflow query-surface catalogs, projections, env-var and
  document slices, and the browser-first v1 workflow model
- `@io/graph-authority` owns installed-module lifecycle planning, approval
  records, compatibility checks, and activation-facing runtime state

## Stable contracts

### Naming and layering

The naming split stays explicit:

- `@io/graph-module` is the shared authoring package
- "graph modules" are concrete namespace slices such as `core` and `workflow`
- "type modules" are the reusable `{ type, meta, filter, field(...) }`
  authoring objects returned by helpers such as `defineScalarModule(...)`,
  `defineEnumModule(...)`, and the packaged defaults

That split is the compatibility seam. Shared authoring belongs in
`@io/graph-module`; concrete built-in contracts belong in the consuming module
packages.

### Manifests stay definition-time only

`defineGraphModuleManifest(...)` is the shared authored manifest seam for both
built-in and local modules.

The manifest owns:

- `moduleId`
- `version`
- `source`
- `compatibility`
- `runtime`

It validates and freezes authored data fail closed, but it does not own
installation, activation, or registry composition.

### Manifest to installed-module lifecycle

The shipped install contract has one explicit path from authored manifest data
to authority-owned installed-module state:

1. `@io/graph-module` validates and freezes the authored manifest
2. installers derive one concrete `InstalledModuleTarget` from that manifest
   plus a `bundleDigest`
3. `@io/graph-authority` persists `InstalledModuleRecord` with install state,
   activation state, granted permissions, and timestamps
4. `validateInstalledModuleCompatibility(...)` compares one authored target,
   runtime expectation, and existing row fail closed
5. `planInstalledModuleLifecycle(...)` emits explicit `install`, `activate`,
   `deactivate`, or `update` plans only when those inputs line up

That planner seam belongs in `@io/graph-authority`, not in the authoring
package.

### Built-in module split

The built-in package split is intentional:

- `@io/graph-module-core` owns core graph-wide contracts and durable
  graph-native records such as saved queries, views, icons, secret handles, and
  identity or admission records
- `@io/graph-module-workflow` owns workflow-specific schema, commands,
  projections, reads, env vars, and documents

If a contract is generic across modules, it probably belongs in
`@io/graph-module`. If it is one shipped built-in namespace slice, it belongs
in the built-in owning package.

### Built-in query catalog split

The current built-in query-catalog proof is also split by owner:

- `@io/graph-module-core` owns the durable `core:savedQuery`,
  `core:savedQueryParameter`, and `core:savedView` records plus the
  `coreQuerySurfaceCatalog`
- `@io/graph-module-workflow` owns the workflow query-surface catalog and the
  `workflow:review` scope surface
- saved queries bind to module-owned surfaces by storing module, catalog, and
  surface ids plus versions on the core-owned durable saved-query records

That keeps durable saved-query identity in core while letting module packages
own their own installed surfaces.

## Where current details live

- `./type-modules.md`: type-module metadata, filter contracts, field overrides,
  and packaged defaults
- `./module-manifests.md`: authored manifest contract and contribution
  vocabulary
- `./authored-contracts.md`: pure object-view, record-surface, workflow, and
  command descriptors
- `./reference-and-secret-fields.md`: reference-field and secret-field authoring
- `../../graph-module-core/doc/core-namespace.md`: built-in `core:` package
  ownership
- `../../graph-module-core/doc/saved-queries-and-catalogs.md`: durable
  saved-query records and core catalog ownership
- `../../graph-module-workflow/doc/workflow-stack.md`: browser-first workflow
  contract and authority boundary
- `../../graph-module-workflow/doc/projections-and-query-surfaces.md`:
  workflow surfaces, projections, and scope registrations
- `../../graph-authority/doc/installed-modules.md`: installed-module ledger
  validation and lifecycle planning

## Related docs

- `./secret-stack.md`: secret-handle contract and authority-owned write or
  storage split
- `../../graph-query/doc/query-stack.md`: query runtime ownership above module
  catalogs
- `../../graph-authority/doc/authority-stack.md`: command-lowering,
  authorization, and install-state boundaries
- `../../graph-surface/doc/roadmap.md`: higher-level product direction above
  authored surface contracts

Keep this doc narrow. Current-state package behavior belongs in the package docs
listed above.
