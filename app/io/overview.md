# App Overview

## Purpose

`app` is the proof surface for IO's graph-native application model: example schema, runtime bootstrap, and web UI proofs built on top of `graph`.

## Docs

- `../../graph/io/overview.md`
- `../../graph/io/type-modules.md`
- `../../graph/io/refs-and-ui.md`

## Layout

- `../src/graph/`: app-specific schema, runtime bootstrap, example data, client proofs
- `../src/web/`: resolver, bindings, explorer, proof screens, browser runtime
- `../src/authority.ts`, `../src/config.ts`, `../src/server*.ts`: app runtime and server entrypoints
- `../src/**/*.test.ts*`: proof and regression coverage
