# Project Overview

`io` is the reference workspace for the current IO agent model.

It combines five surfaces that need to stay aligned:

- `agent`: entrypoint loading, issue routing, context resolution, workspace/session orchestration, and TUI support
- `cli`: end-user commands that consume the shared config model
- `lib` and `config`: shared config helpers/loaders plus the repo-root config re-export
- `graph`: the reusable graph runtime, schema, sync, and type-module surface
- `app`: the example schemas plus web proof surfaces built on top of `graph`

When changing this repo:

- keep runtime behavior, repo docs, and tests in sync
- prefer the smallest change that still proves the contract end to end
- update prompt/context examples when loader behavior or repo defaults change

Primary proof surfaces:

- `agent/src/workflow.ts`
- `agent/src/context.ts`
- `agent/src/service.ts`
- `lib/src/config.ts`
- `agent/doc/context.md`
- `agent/doc/context-defaults.md`
- `io/context/workflow-migration.md`

Validation:

- `bun check`
- focused tests for touched packages, especially `agent/src/*.test.ts` and `config/src/index.test.ts`
