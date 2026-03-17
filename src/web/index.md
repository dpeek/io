# Web Overview

## Purpose

`web` owns the TanStack Router SPA that runs on the Worker shell. It provides
operator-facing browser surfaces on top of the synced graph runtime, including
the graph explorer, the dedicated sync monitor, and the topic browser/editor.
The current explorer now uses the canonical type-first `/graph` route and
search-param selection model described in `./explorer.md`, plus a shared
inspector shell, draft-backed generic create flow for supported entity types,
and opt-in debug disclosures for raw ids and keys.

## Docs

- `../index.md`
- `./explorer.md`
- `../graph/spec/refs-and-ui.md`

## Layout

- `../../src/web/router.tsx`, `../../src/web/routeTree.gen.ts`: router assembly
  and generated route tree for the canonical `/graph` explorer route
- `../../src/web/routes/`: top-level pages including `topics`, `sync`, and the
  graph explorer routes
- `../../src/web/components/graph-runtime-bootstrap.tsx`: shared synced graph
  runtime bootstrap for browser pages
- `../../src/web/components/explorer/index.ts`: explorer entrypoint for the
  graph and sync pages
- `../../src/web/components/explorer/`: graph explorer modules split by
  responsibility, including shared catalog/navigation helpers, the unified
  inspector shell, draft-backed generic create bindings, field editors, and the
  sync inspector
- `../../src/web/components/sync-page.tsx`: top-level sync monitor for
  authority cursor, pending writes, and recent authoritative activity
- `../../src/web/components/topic-browser-page.tsx`: topic browsing, metadata
  editing, shared Base UI entity-reference combobox editing with inline chips
  and icon-aware option rows, tag create-on-enter flows on top of that shared
  combobox, shared Base UI combobox-backed predicate pickers for enum and other
  closed-option fields, markdown authoring UI, and shared `ColorInput`-backed
  color predicate editing with an inline swatch trigger in the input chrome
- `../../src/web/components/app-shell.tsx`: shared shell and navigation
- `../../src/web/lib/`: worker-backed graph authority, generic secret-field
  mutation contracts, seeded example data/runtime fixtures, and HTTP route
  helpers
- `../../src/web/lib/example-runtime.test.ts`: sync proof coverage for the
  web-owned example runtime fixture
- `../../src/web/worker/index.ts`: Worker entrypoint for SPA assets and graph
  APIs
