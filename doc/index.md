# IO Overview

## Purpose

`io` is the repo-level package. It owns the shared project map: agent runtime,
context and config resolution, the stream/feature/task workflow contract, and
the graph-first application direction the rest of the workspace is proving.

## Docs

- `../io.md`
- `../vision.md`
- `./agent/index.md`
- `./agent/workflow.md`
- `./agent/backlog.md`
- `./agent/review.md`
- `./agent/cli.md`
- `./agent/tui.md`
- `./graph/index.md`
- `./graph/computed.md`
- `./graph/mcp.md`
- `./graph/storage.md`
- `./graph/retained-records.md`
- `./tui/index.md`
- `./README.md`
- `./branch/README.md`
- `./web/index.md`

## Layout

- `../io.ts`: repo config, context registry, profiles, modules, routing
- `../io.md`: repo-local execution guidance included in prompt context
- `./agent/workflow.md`: workflow loading, issue routing, context assembly, and module-scoped doc selection
- `./agent/backlog.md`: stream, feature, and task planning plus backlog-editing contract
- `./agent/review.md`: post-execution review contract and follow-up issue creation rules
- `./agent/cli.md`: current `io agent ...` and `io mcp ...` command surface
- `./agent/index.md`: agent runtime overview, scheduler layout, and operator surfaces
- `./agent/tui.md`: operator-facing TUI layout and retained runtime display
- `./graph/index.md`: graph workspace layout including the root `@io/app/graph`
  surface, extracted `lib/graph-*` packages, adapters, taxonomies, and
  focused subdocs
- `./graph/computed.md`: proposed computed-value layer for lazy, memoized, read-only graph derivations
- `./graph/mcp.md`: current graph MCP read surface, opt-in writes, and the remaining command roadmap
- `./graph/storage.md`: current SQLite-backed Durable Object authority storage shape, raw-SQL decision,
  retained-history model, and secret side-storage split
- `./graph/retained-records.md`: proposed retained-record boundary for data
  that should survive graph refactors, recovery, and live-graph rebuilds
- `./tui/index.md`: terminal workflow product surface and the boundary against legacy agent TUI
- `./README.md`: architecture and vision doc map for the numbered roadmap and branch docs
- `./branch/README.md`: platform branches as parallel workstreams with canonical specs where available
- `./index.md`: repo map and context entrypoint
- `../lib/app/src/agent/`: scheduler, context assembly, tracker integration, retained runtime,
  and the operator TUI
- `../lib/app/src/tui/`: graph-backed terminal workflow product surface
- `../lib/app/src/lib/`: shared config loading and typed config surface
- `../lib/app/src/graph/`: root `@io/app/graph` wrappers, local schema and module
  authoring, graph adapters, and graph-owned icon helpers
- `../lib/graph-*/`: extracted graph kernel, bootstrap, client, authority,
  sync, and projection packages
- `../lib/app/src/web/`: worker-backed browser surfaces and the SQLite Durable Object
  authority path that backs the web shell
- `../lib/app/src/cli/`: operator command surface
