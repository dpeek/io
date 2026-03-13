# App Overview

## Purpose

`app` is the proof surface for IO's graph-native application model: example schema, runtime bootstrap, and web UI proofs built on top of `graph`, with the app consuming graph-owned authoritative persistence rather than owning it.

## Docs

- `../../graph/io/architecture.md`
- `../../graph/io/runtime.md`
- `../../graph/io/sync.md`
- `../../graph/io/overview.md`
- `../../graph/io/type-modules.md`
- `../../graph/io/refs-and-ui.md`

## Layout

- `../src/graph/`: app-specific schema, runtime bootstrap, example data, client proofs
- `../src/authority.ts`: app proof composition around `@io/graph` persisted authority helpers, including bootstrap, seed data, and snapshot-path resolution
- `../src/server-app.ts`, `../src/server.ts`: thin HTTP proof transport over graph-owned sync and persistence surfaces
- `../src/web/`: resolver, bindings, explorer, proof screens, browser runtime
- `../src/**/*.test.ts*`: proof and regression coverage
