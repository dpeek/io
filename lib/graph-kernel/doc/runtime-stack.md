---
name: Graph runtime stack
description: "Cross-package ownership for kernel storage, module authoring, bootstrap, authority seams, and React/runtime layering centered on @io/graph-kernel."
last_updated: 2026-04-07
---

# Graph runtime stack

## Read this when

- the question spans `@io/graph-kernel`, `@io/graph-module`,
  `@io/graph-module-core`, `@io/graph-bootstrap`, `@io/graph-authority`,
  `@io/graph-react`, or the small root `@io/app/graph` helper layer
- you need the owning package before changing schema authoring, id
  reconciliation, bootstrap, or low-level runtime composition
- you are tracing how authored definitions become a bootstrapped store and then
  a host-neutral or browser runtime

## Main source anchors

- `../src/index.ts`: package-root kernel surface
- `../src/schema.ts`: schema authoring, field metadata, and fallback-policy
  descriptors
- `../src/identity.ts`: stable-id reconciliation and namespace resolution
- `../src/store.ts`: append-oriented fact storage and snapshot lookups
- `../../graph-module/src/index.ts`: definition-time authoring helpers and
  pure authored runtime contracts
- `../../graph-module-core/src/index.ts`: built-in `core:` namespace assembly,
  core bootstrap inputs, and colocated core-owned defaults
- `../../graph-bootstrap/src/index.ts`: additive bootstrap and convergent
  snapshot materialization
- `../../graph-authority/src/index.ts`: authoritative write sessions and
  persisted-authority contracts above kernel and sync contracts
- `../../graph-react/src/index.ts`: host-neutral React runtime and edit-session
  layer
- `../../app/src/graph/index.ts`: the small root helper surface that still
  re-exports selected graph-owned helpers

## What this doc owns

- the cross-package ownership map for the shipped low-level runtime stack
- stable seams between schema authoring, id resolution, bootstrap,
  authoritative execution, and host-neutral runtime layers
- redirects to the package-local docs that own current runtime behavior

It does not own browser-only shell composition, Worker routes, or app-local
adapter policy.

## Current ownership

- `@io/graph-kernel` owns ids, append-oriented store primitives, schema
  authoring helpers, stable-id mapping, field-authority metadata, fallback
  policy descriptors, and authoritative write-envelope contracts.
- `@io/graph-module` owns the definition-time authoring layer above kernel:
  type modules, reference and secret field helpers, pure command and surface
  descriptors, and the shared module-manifest contract.
- `@io/graph-module-core` owns the built-in `core:` namespace assembly, core
  bootstrap inputs, durable core query objects, colocated icon seeds, shared
  structured-value families, and the current browser `react-dom` defaults for
  the core module.
- `@io/graph-bootstrap` owns additive bootstrap into a live store, convergent
  bootstrapped snapshots, bootstrap-facing core-schema requirements, and icon
  seed or resolver contracts.
- `@io/graph-authority` owns authoritative write sessions, persisted-authority
  contracts, replication filtering, and authority-side validation above the
  kernel and sync boundaries.
- `@io/graph-react` owns the host-neutral React runtime, edit-session
  contracts, validation issue mapping, resolver primitives, and synced runtime
  hooks.
- `@io/graph-module-core/react-dom` owns the current default browser and DOM
  layer above `@io/graph-react`.
- `@io/app/graph` owns only a small curated helper layer plus private
  inspection helpers. It is no longer the canonical runtime surface.

## Stable contracts

### Kernel below bootstrap

The kernel stays intentionally low level:

- storage is opaque and string-based
- scalar decode or encode lives above the store
- field trees preserve authoring shape while resolved ids drive runtime linking
- store indexes are internal implementation details; the public surface remains
  pattern lookups

When runtime code needs a new semantic rule, first decide whether it belongs in
kernel storage contracts, module authoring, bootstrap, or a higher layer. Do
not smuggle higher-level meaning into `@io/graph-kernel`.

### One authoring flow, several owners

The shipped runtime path is layered on purpose:

1. `@io/graph-kernel` authors raw schema primitives and ids
2. `@io/graph-module` adds definition-time type, field, command, surface, and
   manifest contracts
3. built-in module packages such as `@io/graph-module-core` publish concrete
   authored slices
4. `@io/graph-bootstrap` materializes those authored definitions into a live
   store or convergent snapshot
5. client, authority, React, and surface packages compose runtime behavior on
   top

That split is the main compatibility seam. Keep authored metadata and runtime
execution in their owning layers.

### Bootstrap boundary

Bootstrap stays additive:

- `bootstrap(...)` fills in missing bootstrap-owned facts without retracting or
  rewriting existing state
- `createBootstrappedSnapshot(...)` creates a convergent schema snapshot for
  local and synced runtime consumers
- icon catalogs stay domain-owned; bootstrap only consumes the icon contracts
  passed into it

If the question is "how does this definition become graph state," it belongs in
`@io/graph-bootstrap`. If the question is "what is the definition contract," it
belongs lower, with the owning module package.

### Runtime layering

There is no longer one catch-all non-React runtime package.

Current layering is:

- `@io/graph-react` for host-neutral React runtime and edit-session behavior
- `@io/graph-module-core/react-dom` for the current default browser or DOM
  adapter layer
- host runtime code for route shells, Worker composition, browser chrome, and
  other consumer-owned wiring

The root `@io/app/graph` surface stays intentionally small. New stable runtime
contracts should land on owning packages, not on the umbrella package.

## Documentation rule

- current-state docs live in the owning package README and topic docs
- cross-package shipped behavior lives in the owning package's stack doc
- future-state and proposal work lives in the owning package's `doc/roadmap.md`
- `doc/graph/*` is retired and should not grow back as a second source of
  truth

### Authority stays above the runtime core

Authority, sync transport, and storage adapters are higher-layer concerns:

- kernel owns write envelopes and write-scope literals
- authority owns authoritative execution on top of those contracts
- sync owns payload and session contracts above them
- host code owns routes, storage adapters, and transport policy

Do not move generic command dispatch or transport-specific behavior into this
runtime stack.

## Where current details live

- `./schema.md`: kernel schema authoring, authority metadata, and fallback
  policy lowering
- `./identity.md`: ids, key extraction, and stable-id application
- `./store.md`: append-oriented facts, snapshots, and predicate-slot lookups
- `./write-transactions.md`: canonical write envelopes and snapshot diffs
- `../../graph-module/doc/type-modules.md`: type-module metadata and filter
  contracts
- `../../graph-module/doc/reference-and-secret-fields.md`: reference-field and
  secret-field authoring
- `../../graph-module/doc/authored-contracts.md`: command, record-surface, and
  workflow descriptors
- `../../graph-module/doc/module-manifests.md`: shared built-in or local module
  manifest contract
- `../../graph-module-core/doc/core-namespace.md`: canonical `core:` namespace
  assembly
- `../../graph-module-core/doc/icons-and-svg.md`: icon ownership and SVG
  sanitization
- `../../graph-bootstrap/doc/additive-bootstrap.md`: additive bootstrap rules
- `../../graph-bootstrap/doc/snapshots-and-cache.md`: convergent snapshots and
  cache behavior
- `../../graph-bootstrap/doc/core-schema-requirements.md`: minimal core schema
  contract bootstrap depends on
- `../../graph-react/doc/runtime-and-persisted-mutations.md`: host-neutral
  synced runtime behavior
- `../../graph-react/doc/edit-sessions-and-validation.md`: edit-session and
  validation issue contracts
- `../../graph-authority/doc/authority-stack.md`: authority, permissions, and
  command-lowering boundaries above the runtime core

## Related docs

- `../../graph-sync/doc/sync-stack.md`: sync payloads and authoritative replay
  above kernel write contracts
- `./roadmap.md`: broader graph-engine direction and the package-owned roadmap
  map
- `../../graph-module/doc/module-stack.md`: built-in module ownership
- `../../graph-module-core/doc/icons-and-svg.md`: graph-owned icon and SVG
  contracts

Keep this doc narrow. Current-state package behavior belongs in the package docs
listed above.
