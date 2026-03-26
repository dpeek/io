# Graph Overview

## Purpose

`graph` owns the reusable graph engine: schema authoring, stable ids,
bootstrap, the append-only store, persisted authoritative runtimes, type-module
contracts, graph-owned icon helpers, and the graph-aware adapter layer that
binds shared `@io/web` primitives to graph predicates. The extracted
`@io/graph-client` workspace package owns typed refs, local validation, synced
client composition, and client-facing HTTP/query helpers on top of the graph
kernel and sync packages.

## Browser Editor Boundary

`graph` owns browser editor behavior when the code depends on graph contracts
rather than generic browser chrome.

- keep generic browser primitives in `@io/web`, including Monaco bootstrapping,
  source/preview shells, markdown rendering, and reusable controls
- keep graph-aware, host-neutral React helpers in
  `../../src/graph/runtime/react/`
- keep DOM capability registries and default browser composition in
  `../../src/graph/adapters/react-dom/`
- keep validation, predicate mutation wiring, field metadata, typed
  entity-reference behavior, and SVG sanitization in `graph`

If a component can render without graph runtime imports, it belongs in
`@io/web`. If it needs `PredicateRef`, compiled schema metadata, graph
validation, or graph-specific sanitization, it belongs in `graph` and should
compose shared `@io/web` primitives rather than duplicate browser chrome.

## Start Here

- [`storage.md`](./storage.md): SQLite-backed Durable Object authority storage
  and persistence boundaries
- [`retained-records.md`](./retained-records.md): proposal for migration-stable
  retained records above the live graph authority storage
- [`modules.md`](./modules.md): built-in namespace ownership and module package
  subpaths
- [`adapters.md`](./adapters.md): host-neutral React versus host-specific
  adapter ownership
- [`architecture.md`](./architecture.md): durable engine model and package
  boundaries
- [`icon.md`](./icon.md): graph-owned SVG/icon types, sanitization, and field
  behavior
- [`authority.md`](./authority.md): authority boundaries, predicate
  visibility, typed business methods, and secrets
- [`computed.md`](./computed.md): proposed computed-value layer for lazy,
  memoized derived reads over predicate-slot subscriptions
- [`runtime.md`](./runtime.md): schema authoring, id maps, bootstrap, store
  behavior, and persisted authority helpers
- [`validation.md`](./validation.md): local and authoritative validation
  lifecycle plus result surfaces
- [`sync.md`](./sync.md): total snapshot bootstrap, retained history recovery,
  incremental write reconciliation, and sync state
- [`type-modules.md`](./type-modules.md): scalar and enum module contracts,
  field metadata/filter contracts, and root-safe UI-adjacent specs
- [`refs-and-ui.md`](./refs-and-ui.md): typed refs, predicate-slot
  subscriptions, reference policies, and the React/adapter split
- [`env-vars.md`](./env-vars.md): env-var schema, secret-handle usage, and the
  current secret-write command seam
- [`workflow.md`](./workflow.md): workflow schema, command envelope, and
  repository-backed execution modeling
- [`mcp.md`](./mcp.md): stdio MCP surface, opt-in CRUD writes, and the
  command-oriented roadmap

## Canonical Package Exports

The graph package publishes these subpaths from `../../package.json`:

- `@io/core/graph`: `../../src/graph/index.ts`; re-exports
  `../../src/graph/runtime/index.ts` plus graph-owned icon helpers from
  `../../src/graph/icon.ts`
- `@io/core/graph/runtime`: `../../src/graph/runtime/index.ts`; runtime,
  persisted-authority, authorization, store, sync, schema, HTTP client,
  type-module, and reference-policy surface
- `@io/core/graph/runtime/react`: `../../src/graph/runtime/react/index.ts`;
  host-neutral React hooks and resolver primitives
- `@io/core/graph/authority`: `../../src/graph/runtime/authority.ts`;
  persisted authority helpers and the JSON file adapter
- `@io/core/graph/def`: `../../src/graph/runtime/def.ts`; focused schema and
  type-module authoring exports
- `@io/core/graph/modules`: `../../src/graph/modules/index.ts`; canonical
  namespace root plus representative built-ins
- `@io/core/graph/modules/core`, `@io/core/graph/modules/ops`,
  `@io/core/graph/modules/pkm`: namespace assembly entrypoints
- `@io/core/graph/modules/ops/env-var`,
  `@io/core/graph/modules/ops/workflow`,
  `@io/core/graph/modules/pkm/document`: exported slice entrypoints
- `@io/core/graph/adapters/react-dom`,
  `@io/core/graph/adapters/react-opentui`: host-specific adapter package roots

The workspace also publishes:

- `@io/graph-client`: `../../lib/graph-client/src/index.ts`; typed client
  construction, refs, local validation, synced-client composition, HTTP sync
  transport helpers, and serialized-query request/response contracts

The root `@io/core/graph` surface stays focused on runtime, schema, authority,
and icon contracts. Client APIs now live on `@io/graph-client`. Module
namespaces, slice exports, and host adapters stay on their dedicated subpaths.

## Source Layout

- `../../src/graph/runtime/`: runtime kernel, schema authoring contracts, ids,
  additive bootstrap, authorization, persisted-authority contracts,
  reference-policy helpers, and the file-backed JSON adapter used outside the
  web Durable Object path
- `../../lib/graph-client/src/`: typed client layers, local validation,
  synced-client composition, client-facing HTTP/query transport helpers, and
  bootstrap-snapshot helpers
- `../../src/graph/runtime/react/`: host-neutral React helpers for entity and
  predicate access, mutation validation, persisted mutation state, and resolver
  primitives
- `../../src/graph/modules/`: built-in namespace assembly and slice authoring;
  `core.ts`, `ops.ts`, and `pkm.ts` assemble namespaces from `core.json`,
  `ops.json`, and `pkm.json`
- `../../src/graph/modules/core/`: built-in scalar, enum, and helper modules
- `../../src/graph/modules/ops/env-var/schema.ts`,
  `../../src/graph/modules/ops/workflow/schema.ts`,
  `../../src/graph/modules/pkm/document/schema.ts`: slice entrypoints that back
  the exported `ops/env-var`, `ops/workflow`, and `pkm/document` subpaths
- `../../src/graph/adapters/react-dom/`: DOM capability registries, default
  field views/editors, filter resolvers, icon rendering, and field-family
  modules
- `../../src/graph/adapters/react-opentui/index.ts`: terminal adapter package
  root with the OpenTUI graph runtime provider, sync-state hooks, and reusable
  graph query helpers
- `../../src/graph/icon.ts`: graph-owned icon helpers
- `../../src/graph/testing/kitchen-sink/`: private test fixtures used by graph
  proof coverage
- `../../src/graph/*.test.ts`,
  `../../src/graph/adapters/react-dom/*.test.tsx`,
  `../../src/graph/runtime/react/*.test.ts`: focused package-surface proof
  coverage
