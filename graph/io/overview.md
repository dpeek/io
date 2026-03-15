# Graph Overview

## Purpose

`graph` owns the reusable graph engine: schema authoring, stable ids, bootstrap, the append-only store, typed refs, validation, sync, persisted authoritative runtimes, and type-module contracts.

## Entry Points

- `./architecture.md`: durable engine model, current persistence ownership, and longer-range platform shape
- `./authority.md`: authority boundaries, predicate visibility, typed business methods, and secrets
- `./runtime.md`: schema authoring, id maps, core schema, bootstrap, store behavior, and persisted authority helpers
- `./validation.md`: local and authoritative validation lifecycle plus result surfaces
- `./sync.md`: total snapshot bootstrap, retained history recovery, incremental write reconciliation, and sync state
- `./type-modules.md`: scalar/enum modules, field metadata/filter contracts, and reference-field helpers
- `./refs-and-ui.md`: typed refs, predicate-slot subscriptions, and the current UI-adjacent surface

## Current Package Layout

- `../src/graph/`: runtime kernel, schema, ids, bootstrap, client, sync, and helper APIs
- `../src/react/`, `../src/react-dom/`, `../src/react-opentui/`: reserved adapter entry surfaces kept separate from the root-safe package export
- `../src/schema/`: canonical namespace-shaped schema tree for core modules and graph-owned app slices
- `../src/taxonomy/`: root-safe slice aggregators over canonical schema modules
- `../src/type/`: built-in scalar and helper modules, with thin compatibility exports preserved during schema migration
- `../src/index.ts`: public package exports

## Current vs Roadmap

Current code already ships JSON-backed authoritative persistence, typed entity/predicate refs, predicate-slot subscriptions, type-module metadata/filter contracts, and incremental authoritative sync primitives. The remaining roadmap is mostly around additional persistence backends, richer query semantics, policy/secrets, transport, and fully realized web/TUI tooling.

## Future Work Suggestions

1. Add a short “start here by task” matrix so agents can jump from goals like “sync bug” or “field authoring” to the right doc and source files.
2. Add a compact API index for the top exported symbols from `src/graph/index.ts`.
3. Document which behaviors are public contract versus internal helper surface.
4. Add references to the most important app proof surfaces once those stay stable.
5. Keep this page limited to navigation and move topic detail into the focused docs linked above.
