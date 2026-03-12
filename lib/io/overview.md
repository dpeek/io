# Lib Overview

## Purpose

`lib` owns the shared config language, loader behavior, env helpers, and small runtime utilities used across workspace packages.

## Docs

- `../../io/overview.md`

## Layout

- `../src/config.ts`: typed config helpers and loader
- `../src/env.ts`: env-backed config helpers
- `../src/log.ts`, `../src/process.ts`: shared runtime utilities
- `../src/index.ts`: package exports
- `../src/*.test.ts`: contract tests
