# Graph Overview

## Purpose

The graph engine now spans the root `@io/core/graph` package plus the extracted
`@io/graph-kernel`, `@io/graph-bootstrap`, `@io/graph-client`,
`@io/graph-authority`, `@io/graph-sync`, and `@io/graph-projection` workspace
packages.

The root `@io/core/graph` surface owns a small curated graph helper layer:
selected kernel aliases, local definition authoring contracts on
`@io/core/graph/def`, built-in namespace assembly, graph-owned icon helpers,
and the graph-aware adapter layer that binds shared `@io/web` primitives to
graph predicates. The extracted packages own the layered engine boundaries:
kernel storage and write envelopes, schema bootstrap, typed client behavior,
authoritative runtime behavior, sync contracts, and projection metadata.

## Browser Editor Boundary

`graph` owns browser editor behavior when the code depends on graph contracts
rather than generic browser chrome.

- keep generic browser primitives in `@io/web`, including Monaco bootstrapping,
  source/preview shells, markdown rendering, and reusable controls
- keep graph-aware, host-neutral React helpers in
  `../../lib/graph-react/src/`
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
  workspace records above the live graph authority storage
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

The root `@io/core` package publishes these graph subpaths from
`../../package.json`:

- `@io/core/graph`: `../../src/graph/index.ts`; re-exports
  curated kernel aliases plus graph-owned icon and reference helpers
- `@io/core/graph/def`: `../../src/graph/def.ts`; focused schema and
  type-module authoring exports plus root-owned definition contracts
- `@io/core/graph/modules`: `../../src/graph/modules/index.ts`; canonical
  namespace root plus representative built-ins
- `@io/core/graph/modules/core`, `@io/core/graph/modules/workflow`:
  namespace assembly entrypoints
- `@io/core/graph/adapters/react-dom`: host-specific adapter package root

The workspace also publishes:

- `@io/graph-kernel`: `../../lib/graph-kernel/src/index.ts`; opaque ids,
  append-oriented store primitives, schema helpers, stable-id utilities, and
  authoritative write-envelope contracts
- `@io/graph-bootstrap`: `../../lib/graph-bootstrap/src/index.ts`; additive
  schema bootstrap and convergent bootstrapped snapshots
- `@io/graph-authority`: `../../lib/graph-authority/src/index.ts`; persisted
  authority runtime, authoritative write sessions, total-sync payload
  creation, authority validation, replication read filtering, and graph-owned
  authorization and policy contracts
- `@io/graph-client`: `../../lib/graph-client/src/index.ts`; typed client
  construction, refs, local validation, synced-client composition, HTTP sync
  transport helpers, and serialized-query request/response contracts
- `@io/graph-react`: `../../lib/graph-react/src/index.ts`; host-neutral React
  graph runtime hooks and mutation helpers
- `@io/graph-sync`: `../../lib/graph-sync/src/index.ts`; sync scopes,
  total/incremental payload contracts, cursor helpers, validation, and total
  sync sessions
- `@io/graph-projection`: `../../lib/graph-projection/src/index.ts`; module
  read-scope definitions, projection metadata, dependency keys, invalidation
  contracts, and retained projection compatibility helpers

The root `@io/core/graph` surface stays focused on a small helper layer,
definition-time exports, modules, adapters, and icon contracts. Bootstrap,
client, authority, sync, and projection APIs now live on their extracted
packages. Module namespaces, slice exports, and host adapters stay on their
dedicated root-package subpaths.

## Source Layout

- `../../lib/graph-kernel/src/`: canonical ids, store primitives, schema
  helpers, stable-id reconciliation, and authoritative write envelopes
- `../../src/graph/def.ts`, `../../src/graph/type-module.ts`,
  `../../src/graph/reference-policy.ts`, and
  `../../src/graph/definition-contracts.ts`: root-owned definition-authoring
  helpers that do not belong in an extracted package
- `../../src/graph/inspect.ts`: internal graph inspection helpers; not part of
  the published package surface
- `../../lib/graph-bootstrap/src/`: additive bootstrap runtime and convergent
  bootstrapped snapshots
- `../../lib/graph-authority/src/`: authoritative write sessions, persisted
  authority contracts, authority validation, replication filtering, graph-owned
  policy/share/admission contracts, and the file-backed JSON adapter used
  outside the web Durable Object path
- `../../lib/graph-client/src/`: typed client layers, local validation,
  synced-client composition, client-facing HTTP/query transport helpers, and
  typed query helpers
- `../../lib/graph-sync/src/`: sync scopes, payload/session contracts, cursor
  helpers, validation, and total sync sessions
- `../../lib/graph-projection/src/`: projection contracts, module read scopes,
  dependency keys, and retained projection compatibility helpers
- `../../src/graph/modules/`: built-in namespace assembly and slice authoring;
  `core.ts` and `workflow.ts` assemble namespaces from `core.json` and
  `workflow.json`
- `../../src/graph/modules/core/`: built-in scalar, enum, and helper modules
- `../../src/graph/modules/workflow/schema.ts`,
  `../../src/graph/modules/workflow/env-var/schema.ts`, and
  `../../src/graph/modules/workflow/document/schema.ts`: the workflow module
  and its internal slice entrypoints
- `../../src/graph/adapters/react-dom/`: DOM capability registries, default
  field views/editors, filter resolvers, icon rendering, and field-family
  modules
- `../../src/graph/icon.ts`: graph-owned icon helpers
- `../../src/graph/testing/kitchen-sink/`: private test fixtures used by graph
  proof coverage
- `../../src/graph/*.test.ts`,
  `../../src/graph/adapters/react-dom/*.test.tsx`,
  `../../lib/graph-react/src/*.test.tsx`: focused package-surface proof coverage
