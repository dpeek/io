---
name: Graph UI stack
description: "Cross-package ownership for typed refs, host-neutral React runtime, route-neutral surface runtime, and browser adapters centered on @io/graph-surface."
last_updated: 2026-04-07
---

# Graph UI stack

## Read this when

- the question spans `@io/graph-client`, `@io/graph-module`,
  `@io/graph-react`, `@io/graph-surface`, `@io/graph-module-core/react-dom`,
  or app-owned route shells
- you need the owning package before changing typed refs, metadata readers,
  record or collection surfaces, or browser adapter behavior
- you are tracing how authored graph metadata becomes a host-neutral hook,
  route-neutral surface binding, and finally a browser mount

## Main source anchors

- `../../graph-client/src/graph.ts`: typed client and entity-ref caching
- `../../graph-client/src/refs.ts`: `EntityRef`, `PredicateRef`, and
  field-group traversal
- `../../graph-client/src/sync.ts`: synced-client ref wrapping
- `../../graph-module/src/contracts.ts`: pure object-view, record-surface,
  collection-surface, workflow, and command-surface contracts
- `../../graph-module/src/reference.ts`: existing-entity reference-policy
  authoring helpers
- `../../graph-react/src/predicate.ts`: host-neutral predicate hooks and
  metadata readers
- `../../graph-react/src/entity.tsx`: entity traversal helpers
- `../src/collection-surface.ts`: route-neutral collection runtime
- `../src/record-surface.ts`: route-neutral readonly record runtime
- `../src/react-dom/index.ts`: browser mounts for collection and record
  surfaces
- `../../graph-module-core/src/react-dom/index.ts`: current default browser
  field, filter, icon, and query-adapter layer

## What this doc owns

- the cross-package ownership map for the shipped graph UI stack
- stable seams between typed refs, authored metadata, host-neutral React
  helpers, route-neutral surface runtime, and browser adapters
- redirects to the package-local docs that own current runtime behavior

It does not own app route registration, shell chrome, transport wiring, or
authoritative command execution.

## Current ownership

- `@io/graph-client` owns typed refs, predicate-slot subscriptions, nested
  field-group traversal, and synced-client ref ergonomics
- `@io/graph-module` owns pure authored metadata: field and filter contracts,
  reference-policy helpers, `ObjectViewSpec`, `RecordSurfaceSpec`,
  `CollectionSurfaceSpec`, `WorkflowSpec`, `GraphCommandSurfaceSpec`, and
  `GraphCommandSpec`
- `@io/graph-react` owns the host-neutral React layer: predicate and entity
  hooks, metadata readers, edit-session contracts, validation issue mapping,
  resolver primitives, and draft helpers
- `@io/graph-surface` owns route-neutral collection-surface, collection-command,
  and record-surface runtime plus the browser mounts on `react-dom`
- `@io/graph-module-core/react-dom` owns the current default browser adapter
  that composes host-neutral contracts into concrete field, filter, icon, SVG,
  and preview behavior
- app-owned code owns routes, shell composition, query pages, browser
  experiments, transport, and authoritative command implementations

## Stable contracts

### Ref semantics stay in `@io/graph-client`

Ref rules that stay stable across the UI stack:

- refs are stable handles over one store plus one resolved namespace
- predicate subscriptions are keyed to `(subjectId, predicateId)`
- cardinality widens the mutation surface
- nested field groups preserve traversal shape without becoming their own
  reactive unit
- synced clients wrap the same typed handles instead of inventing a second
  graph API

If the question is about how a value is read, subscribed to, or mutated through
typed handles, it belongs in `@io/graph-client`.

### Authored metadata stays pure

The UI-adjacent authored contracts remain pure data:

- `ObjectViewSpec`
- `RecordSurfaceSpec`
- `CollectionSurfaceSpec`
- `WorkflowSpec`
- `GraphCommandSurfaceSpec`
- `GraphCommandSpec`
- field metadata and filter contracts from type modules
- existing-entity reference policy metadata

These contracts belong in `@io/graph-module`. They do not own React hooks, DOM
widgets, route registration, or authoritative execution.

### React layer versus surface runtime

The split between `@io/graph-react` and `@io/graph-surface` is deliberate:

- `@io/graph-react` reads authored metadata and typed refs into host-neutral
  hooks, resolver primitives, validation issue helpers, and draft controllers
- `@io/graph-surface` resolves authored record and collection surfaces into
  route-neutral runtime bindings and browser mounts

Do not move route-neutral surface binding down into `@io/graph-react`.
Do not move generic metadata readers or draft helpers up into
`@io/graph-surface`.

### Browser adapters stay above host-neutral layers

The current browser split is:

- `@io/graph-react`: no DOM tags or browser-only widgets
- `@io/graph-surface/react-dom`: collection and record mounts plus shared shell
  chrome for those surfaces
- `@io/graph-module-core/react-dom`: current default field, filter, icon, SVG,
  and query-editor behavior tied to built-in core contracts
- app code: route registration, shell chrome, explorer or create flows, and
  transport-aware composition

That keeps reusable browser defaults above the host-neutral layers without
turning `app` into the owner of every adapter decision.

### Reference-policy flow

The current reference-policy path stays intentionally small:

- `existingEntityReferenceField(...)` and
  `existingEntityReferenceFieldMeta(...)` author host-neutral policy metadata
- `@io/graph-react` reads that metadata through
  `getPredicateEntityReferencePolicy(...)`
- browser adapters choose concrete picker, display, and create-and-link
  behavior on top of that host-neutral policy read

This keeps reference-selection semantics in the graph authoring layer while
leaving widgets and async search UX in adapter or app code.

## Where current details live

- `../../graph-client/doc/refs.md`: typed refs, field-group traversal, and
  mutation ergonomics
- `../../graph-client/doc/synced-client.md`: synced-client ref wrapping and
  pending-write behavior
- `../../graph-react/doc/predicate-and-entity-hooks.md`: predicate hooks,
  metadata readers, and entity traversal helpers
- `../../graph-react/doc/edit-sessions-and-validation.md`: edit-session and
  validation issue contracts
- `../../graph-react/doc/resolvers-and-filters.md`: host-neutral field and
  filter resolvers
- `./collection-surfaces.md`: collection binding and query-container runtime
- `./collection-commands.md`: collection command subject binding
- `./record-surfaces.md`: readonly record binding and `ObjectViewSpec`
  adaptation
- `./react-dom.md`: browser mounts and override seams for record and collection
  surfaces
- `../../graph-module-core/doc/react-dom.md`: current default browser adapter
  behavior
- `../../graph-module/doc/reference-and-secret-fields.md`: authored
  reference-policy semantics
- `../../graph-module/doc/authored-contracts.md`: surface and command metadata
  ownership

## Related docs

- `../../graph-query/doc/query-stack.md`: query runtime below route-local UI
  shells
- `./roadmap.md`: higher-level product direction above the current runtime
  stack
- `../../graph-react/doc/resolvers-and-filters.md`: host-neutral adapter and
  resolver primitives
- `../../graph-module-core/doc/react-dom.md`: current default browser adapter

Keep this doc narrow. Current-state package behavior belongs in the package docs
listed above.
