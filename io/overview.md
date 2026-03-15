# IO Overview

## Purpose

`io` is the repo-level package. It owns the shared project map: agent runtime,
context and config resolution, the stream/feature/task workflow contract, and
the graph-first application direction the rest of the workspace is proving.

## Docs

- `../io.md`
- `./modularity.md`
- `./workflow.md`
- `./backlog.md`
- `../agent/io/overview.md`
- `../graph/io/overview.md`
- `../tui/io/overview.md`

## Layout

- `../io.ts`: repo config, context registry, profiles, modules, routing
- `../io.md`: repo-local execution guidance included in prompt context
- `./modularity.md`: package-boundary proposal for `graph`, React adapters, taxonomies, and `app`
- `./workflow.md`: primary user-facing workflow contract for stream, feature,
  task ownership and release/finalization behavior
- `./backlog.md`: interactive stream backlog prompt and issue-structure contract
- `./overview.md`: repo map and context entrypoint
- `../agent/`: scheduler, context assembly, tracker integration, TUI runtime
- `../config/`, `../lib/`: shared config loading and typed config surface
- `../graph/`, `../app/`: graph runtime, schema-driven UI proofs, application surfaces
- `../cli/`, `../tui/`: operator command and terminal surfaces
