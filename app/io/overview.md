# App Overview

## Purpose

`app` is the proof surface for IO's graph-native application model: example
schema, runtime bootstrap, and web UI proofs built on top of `graph`.
`@io/app` stays limited to app-owned schema/runtime contracts, with the app
consuming graph-owned authoritative persistence rather than owning reusable
engine and type-module APIs. The first operator-facing env-var route also lives
here.

## Docs

- `./package-surface.md`
- `./experiments.md`
- `./env-vars.md`
- `../../graph/io/overview.md`
- `../../graph/io/architecture.md`
- `../../graph/io/runtime.md`
- `../../graph/io/sync.md`
- `../../graph/io/type-modules.md`
- `../../graph/io/refs-and-ui.md`

## Layout

- `../src/index.ts`: app-owned package exports
- `../src/experiments/`: experiment-local graph registration, seed, and route registration,
  with promoted reusable schema imported from `../../graph/src/schema/`
- `../src/graph/`: app namespace composition over the canonical graph schema tree, runtime
  bootstrap, example data, client proofs
- `../src/authority.ts`: app proof composition around `@io/graph` persisted authority helpers, including bootstrap, seed data, and snapshot-path resolution
- `../src/server-app.ts`, `../src/server.ts`: thin HTTP proof transport over graph-owned sync and persistence surfaces
- `../src/web/`: shared shell/runtime, resolver, bindings, explorer, proof screens, operator settings,
  browser runtime
- `../src/config.ts`: app runtime configuration
- `../src/**/*.test.ts*`: proof and regression coverage
