# IO Overview

## Purpose

`io` is the repo-level package. It owns the shared project map: agent runtime,
context and config resolution, package-stream planning, and the graph-first
application direction the rest of the workspace is proving.

## Docs

- `../io.md`
- `../agent/io/overview.md`
- `../agent/io/managed-stream-contract.md`
- `../graph/io/overview.md`
- `../tui/io/overview.md`

## Layout

- `../io.ts`: repo config, context registry, profiles, modules, routing
- `../io.md`: repo-local execution guidance included in prompt context
- `./overview.md`: repo map and context entrypoint
- `../agent/`: scheduler, context assembly, tracker integration, TUI runtime
- `../config/`, `../lib/`: shared config loading and typed config surface
- `../graph/`, `../app/`: graph runtime, schema-driven UI proofs, application surfaces
- `../cli/`, `../tui/`: operator command and terminal surfaces
