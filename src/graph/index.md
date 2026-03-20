# Graph Overview

## Purpose

`graph` owns the reusable graph engine: schema authoring, stable ids, bootstrap, the append-only store, typed refs, validation, sync, persisted authoritative runtimes, and type-module contracts.

## Entry Points

- `../storage.md`: current SQLite-backed Durable Object authority adapter, persistence boundary,
  retained-history model, and secret side-storage split
- `./spec/architecture.md`: durable engine model, current persistence ownership, and longer-range platform shape
- `./icon.md`: graph-owned SVG/icon types, opt-in icon predicates, sanitization rules, and generic source/preview field editing
- `./graph/authority.md`: authority boundaries, predicate visibility, typed business methods, and secrets
- `./spec/runtime.md`: schema authoring, id maps, core schema, bootstrap, store behavior, and persisted authority helpers
- `./spec/validation.md`: local and authoritative validation lifecycle plus result surfaces
- `./graph/sync.md`: total snapshot bootstrap, retained history recovery, incremental write reconciliation, and sync state
- `./graph/type-module.md`: scalar/enum modules, field metadata/filter contracts, and reference-field helpers
- `./spec/refs-and-ui.md`: typed refs, predicate-slot subscriptions, and the current UI-adjacent surface

## Current Package Layout

- `../../src/graph/graph/`: runtime kernel, schema, ids, bootstrap, client, sync, the
  persisted-authority contract, and the file-backed JSON adapter used outside the web Durable
  Object path
- `../../src/graph/react/`, `../../src/graph/react-dom/`, `../../src/graph/react-opentui/`: reserved adapter entry surfaces kept separate from the root-safe package export, with DOM predicate editors split into `../../src/graph/react-dom/editor/*`
- `../../src/graph/schema/`: canonical namespace-shaped schema tree for core modules and graph-owned app slices
- `../../src/graph/test-graph.ts`: shared graph test fixtures used by engine proof coverage
- `../../src/graph/*.test.ts`, `../../src/graph/*.typecheck.ts`: root-level graph proof coverage for typed refs, validation, sync, subscriptions, icons, and schema-facing client contracts
- `../../src/graph/type/`: built-in scalar and helper modules, with thin compatibility exports preserved during schema migration
- `../../src/graph/index.ts`: public package exports

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
