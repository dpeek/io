# Graph Overview

## Purpose

`graph` owns the reusable graph engine: schema authoring, stable ids,
bootstrap, the append-only store, typed refs, validation, sync, persisted
authoritative runtimes, type-module contracts, and the graph-aware browser
adapter layer that binds shared `@io/web` primitives to graph predicates.

## Browser Editor Boundary

`graph` still owns browser editor behavior whenever the code needs graph
contracts rather than generic browser chrome.

- keep generic browser primitives in `@io/web`, including Monaco bootstrapping,
  source/preview shells, markdown rendering, and reusable controls
- keep host-neutral React graph bindings in `../../src/graph/runtime/react/*`
- keep DOM capability registries and browser composition in
  `../../src/graph/adapters/react-dom/*`
- keep graph validation, predicate mutation wiring, field-kind capability
  lists, typed entity-reference behavior, and SVG sanitization/preview in
  `graph`

The current rule of thumb is simple: if the component can render and be reused
without graph runtime imports, it probably belongs in `@io/web`. If it needs
`PredicateRef`, compiled schema metadata, graph validation, or graph-specific
sanitization to do useful work, it remains graph-owned and should compose the
shared `@io/web` primitive rather than reintroducing browser chrome locally.

## Entry Points

- `../storage.md`: current SQLite-backed Durable Object authority adapter, persistence boundary,
  retained-history model, and secret side-storage split
- `./modules/index.md`: canonical built-in module ownership and package subpaths after the reshape
- `./adapters/index.md`: adapter ownership and the stable shim relationship for host-specific entrypoints
- `./spec/architecture.md`: durable engine model, current persistence ownership, and longer-range platform shape
- `./icon.md`: graph-owned SVG/icon types, opt-in icon predicates,
  sanitization rules, and graph-side SVG field behavior layered on the shared
  `@io/web` source/preview shell
- `./runtime/authority.md`: authority boundaries, predicate visibility, typed business methods, and secrets
- `./spec/runtime.md`: schema authoring, id maps, core schema, bootstrap, store behavior, and persisted authority helpers
- `./spec/validation.md`: local and authoritative validation lifecycle plus result surfaces
- `./runtime/sync.md`: total snapshot bootstrap, retained history recovery, incremental write reconciliation, and sync state
- `./runtime/type-module.md`: scalar/enum modules, field metadata/filter contracts, and reference-field helpers
- `./spec/refs-and-ui.md`: typed refs, predicate-slot subscriptions, and the current UI-adjacent surface

## Package Entry Surfaces

- `@io/core/graph`: root-safe package entry surface from `../../src/graph/index.ts`; re-exports
  runtime contracts plus canonical built-in modules from `../../src/graph/modules/`
- `@io/core/graph/runtime`, `@io/core/graph/authority`, `@io/core/graph/def`: stable runtime,
  authoritative persistence, and schema-authoring contracts
- `@io/core/graph/modules`, `@io/core/graph/modules/core`,
  `@io/core/graph/modules/ops`, `@io/core/graph/modules/pkm`,
  `@io/core/graph/modules/pkm/topic`,
  `@io/core/graph/modules/ops/env-var`: ownership-first module entry surfaces that match the
  moved tree
- `@io/core/graph/adapters/react`, `@io/core/graph/adapters/react-dom`,
  `@io/core/graph/adapters/react-opentui`: ownership-first adapter entry surfaces that match
  `../../src/graph/adapters/`
- `@io/core/graph/schema*` and `@io/core/graph/react*`: compatibility shims preserved while
  imports drain away from the superseded layout

## Current Package Layout

- `../../src/graph/runtime/`: runtime kernel, schema authoring contracts, ids,
  bootstrap, the typed client split across `client.ts`, `client-validation.ts`,
  `client-store.ts`, `client-refs.ts`, and `client-query.ts`, sync, the
  persisted-authority contract, and the file-backed JSON adapter used outside
  the web Durable Object path
- `../../src/graph/runtime/react/`: host-neutral React ownership for predicate hooks,
  traversal helpers, mutation helpers, and resolver primitives that still depend on graph refs
- `../../src/graph/modules/`: canonical home for built-in graph module authoring, including the
  `core:`, `ops:`, and `pkm:` schema families plus their namespace id maps
- `../../src/graph/adapters/`: host-specific adapter ownership for React entry composition,
  DOM capability registries, and the OpenTUI placeholder boundary
- `../../src/graph/adapters/react-dom/editor/markdown.tsx`,
  `../../src/graph/adapters/react-dom/editor/svg.tsx`: graph-owned markdown and SVG
  mutation/preview wiring layered on the shared `@io/web/markdown` renderer,
  `@io/web/monaco` wrapper plus shared source-editor preset, and the
  `@io/web/source-preview` shell
- `../../src/graph/adapters/react-dom/editor/svg-preview.tsx`: graph-owned SVG preview
  wiring on top of the shared `@io/web/source-preview` shell and style surface
- `../../src/graph/adapters/react-dom/resolver.tsx`,
  `../../src/graph/adapters/react-dom/fields.tsx`,
  `../../src/graph/adapters/react-dom/editor/shared.tsx`: graph-owned field capability
  registries, resolver composition, typed predicate mutation helpers, and
  other browser-editor behavior that still depends on graph contracts
- `../../src/graph/test-graph.ts`: shared graph test fixtures used by engine proof coverage
- `../../src/graph/*.test.ts`, `../../src/graph/*.typecheck.ts`: root-level graph proof coverage for typed refs, validation, sync, subscriptions, icons, and schema-facing client contracts
- `../../src/graph/modules/core/`: built-in scalar and helper modules, with the root-safe
  authoring surface preserved through `@io/core/graph/def`

## Compatibility Surfaces

- `../../src/graph/index.ts`: root-safe package root that now re-exports canonical modules while
  preserving the existing symbol set
- `../../src/graph/schema/`: compatibility entry surfaces that preserve the existing
  `@io/core/graph/schema*` import contract while built-in ownership lives under
  `../../src/graph/modules/`
- `../../src/graph/react/`, `../../src/graph/react-dom/`, `../../src/graph/react-opentui/`:
  stable public adapter shims that mirror the ownership-first `@io/core/graph/adapters/*`
  package subpaths
- `../../src/graph/graph/`: compatibility re-exports preserved while legacy runtime import paths
  drain toward `../../src/graph/runtime/`

## Current vs Roadmap

Current code already ships typed entity/predicate refs, predicate-slot subscriptions, type-module
metadata/filter contracts, incremental authoritative sync primitives, the shared
persisted-authority storage contract, and the file-backed JSON adapter that non-DO runtimes can
use. The web package now consumes that contract with a raw-SQL SQLite Durable Object adapter for
authoritative graph persistence. The remaining roadmap is mostly around additional storage
backends, richer query semantics, policy/secrets, transport, and fully realized web/TUI tooling.

## Future Work Suggestions

1. Add a short “start here by task” matrix so agents can jump from goals like “sync bug” or “field authoring” to the right doc and source files.
2. Add a compact API index for the top exported symbols from `src/graph/index.ts`.
3. Document which behaviors are public contract versus internal helper surface.
4. Add references to the most important web authority and explorer surfaces once those stay stable.
5. Keep this page limited to navigation and move topic detail into the focused docs linked above.
