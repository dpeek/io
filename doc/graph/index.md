# Graph Overview

## Purpose

The graph engine now spans the root `@io/app/graph` package plus the extracted
`@io/graph-kernel`, `@io/graph-bootstrap`, `@io/graph-client`,
`@io/graph-module`, `@io/graph-module-core`,
`@io/graph-module-workflow`, `@io/graph-authority`, `@io/graph-sync`, and
`@io/graph-projection` workspace packages.

The root `@io/app/graph` surface owns a small curated graph helper layer:
selected kernel aliases and graph-owned icon helpers. The extracted packages
own the layered engine boundaries: kernel storage and write envelopes,
module-definition authorship, the built-in `core:` namespace, schema
bootstrap, typed client behavior, authoritative runtime behavior, sync
contracts, projection metadata, the host-neutral React layer, and the default
DOM/browser layer.

Naming note: `@io/graph-module` is the extracted authoring package.
`@io/graph-module-core` is the extracted built-in `core:` package.
`@io/graph-module-workflow` is the extracted built-in `workflow:` package.

## Browser Editor Boundary

`graph` owns browser editor behavior when the code depends on graph contracts
rather than generic browser chrome.

- keep generic browser primitives in `@io/web`, including Monaco bootstrapping,
  source/preview shells, markdown rendering, and reusable controls
- keep graph-aware, host-neutral React helpers in
  `../../lib/graph-react/src/`
- keep the current default DOM capability registries, browser composition, and
  core-coupled DOM defaults in `../../lib/graph-module-core/src/react-dom/`
- keep validation, predicate mutation wiring, field metadata, typed
  entity-reference behavior, and SVG sanitization in `graph`

If a component can render without graph runtime imports, it belongs in
`@io/web`. If it needs `PredicateRef`, compiled schema metadata, graph
validation, or graph-specific sanitization, it belongs in `graph` and should
compose shared `@io/web` primitives rather than duplicate browser chrome.

## Start Here

- [`storage.md`](./storage.md): SQLite-backed Durable Object authority storage
  and persistence boundaries
- [`../integration.md`](../integration.md): migration plan for moving
  cross-package graph integration coverage into `@io/graph-integration`
- [`retained-records.md`](./retained-records.md): Branch 6 restore-semantics
  contract for migration-stable workspace records above the live graph
  authority storage
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

The root `@io/app` package publishes these graph subpaths from
`../../lib/app/package.json`:

- `@io/app/graph`: `../../lib/app/src/graph/index.ts`; re-exports
  curated kernel aliases plus graph-owned icon helpers

There is no longer a root `@io/app/graph/adapters/react-dom` export. Browser
callers import `@io/graph-module-core/react-dom` directly.

The workspace also publishes:

- `@io/graph-kernel`: `../../lib/graph-kernel/src/index.ts`; opaque ids,
  append-oriented store primitives, schema helpers, stable-id utilities, and
  authoritative write-envelope contracts
- `@io/graph-module`: `../../lib/graph-module/src/index.ts`; module-definition
  authoring helpers, reference-policy helpers, pure authored contracts, and a
  curated re-export of kernel schema-authoring primitives
- `@io/graph-module-core`: `../../lib/graph-module-core/src/index.ts`;
  canonical `core:` namespace assembly, built-in core scalars/entities/enums,
  bootstrap inputs, graph-owned saved-query contracts, the built-in core
  query-surface catalog metadata, colocated icon seeds, structured-value
  helpers, locale/currency datasets, and other core-owned contracts
- `@io/graph-module-workflow`: `../../lib/graph-module-workflow/src/index.ts`;
  canonical `workflow:` namespace assembly, built-in workflow/env-var/document
  slices, plus workflow-owned query-surface and projection contracts
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
- `@io/graph-module-core/react-dom`:
  `../../lib/graph-module-core/src/react-dom/index.ts`; the canonical browser
  field/filter adapter layer plus core-owned defaults such as `GraphIcon`,
  structured-value editors, and tag-aware reference behavior
- `@io/graph-sync`: `../../lib/graph-sync/src/index.ts`; sync scopes,
  total/incremental payload contracts, cursor helpers, validation, and total
  sync sessions
- `@io/graph-projection`: `../../lib/graph-projection/src/index.ts`; module
  read-scope definitions, projection metadata, dependency keys, invalidation
  contracts, and retained projection compatibility helpers

The root `@io/app/graph` surface stays focused on a small helper layer and
icon contracts. Definition-time authorship now lives on `@io/graph-module`.
The built-in `core:` namespace now lives on `@io/graph-module-core`.
Bootstrap, client, authority, sync, projection, the host-neutral React layer,
and the default DOM/browser layer live on their extracted packages.
Workflow-owned contracts now live on `@io/graph-module-workflow`.

## Source Layout

- `../../lib/graph-kernel/src/`: canonical ids, store primitives, schema
  helpers, stable-id reconciliation, and authoritative write envelopes
- `../../lib/graph-module/src/`: module-definition authoring helpers,
  reference-field policy, secret-field helpers, and pure authored
  command/view/workflow contracts
- `../../lib/graph-module-core/src/`: canonical `core:` namespace assembly,
  built-in scalar/entity/enum families, bootstrap inputs, colocated icon
  seeds, and structured-value helpers
- `../../lib/app/src/graph/inspect.ts`: internal graph inspection helpers; not part of
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
- `../../lib/graph-module-workflow/src/schema.ts`,
  `../../lib/graph-module-workflow/src/env-var/schema.ts`, and
  `../../lib/graph-module-workflow/src/document/schema.ts`: the workflow
  module package and its internal slice entrypoints
- `../../lib/graph-react/src/`: host-neutral React runtime, resolver
  primitives, and predicate/entity hooks
- `../../lib/graph-module-core/src/react-dom/`: the canonical DOM capability
  registries, field/filter adapters, `GraphIcon`, structured-value editors,
  and tag-aware reference behavior
- `../../lib/app/src/graph/icon.ts`: graph-owned icon helpers
- `../../lib/app/src/graph/testing/kitchen-sink/`: private test fixtures used by graph
  proof coverage
- `../../lib/app/src/graph/*.test.ts`,
  `../../lib/graph-react/src/*.test.tsx`,
  `../../lib/graph-module-core/src/react-dom/*.test.tsx`: focused package-surface proof
  coverage
