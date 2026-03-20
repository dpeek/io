# IO Overview

## Purpose

`io` is the repo-level package. It owns the shared project map: agent runtime,
context and config resolution, the stream/feature/task workflow contract, and
the graph-first application direction the rest of the workspace is proving.

## Docs

- `../io.md`
- `../vision.md`
- `./agent/skill/backlog.md`
- `./agent/index.md`
- `./agent/tui/index.md`
- `./graph/index.md`
- `./mcp.md`
- `./structure.md`
- `./structure-plan.md`
- `./storage.md`
- `./web/index.md`

## Layout

- `../io.ts`: repo config, context registry, profiles, modules, routing
- `../io.md`: repo-local execution guidance included in prompt context
- `./agent/skill/backlog.md`: stream, feature, and task planning plus backlog-editing contract
- `./agent/index.md`: agent runtime overview, scheduler layout, and operator surfaces
- `./agent/tui/index.md`: operator-facing TUI layout and retained runtime display
- `./graph/index.md`: graph package layout including engine, adapters, taxonomies, and focused subdocs
- `./mcp.md`: current graph MCP read surface, opt-in writes, and the remaining command roadmap
- `./structure.md`: repo-level structure direction, naming rules, phased migration, and execution model
- `./structure-plan.md`: phased structure rollout, dependencies, exit criteria, and suggested Linear feature/task breakdown
- `./storage.md`: current SQLite-backed Durable Object authority storage shape, raw-SQL decision,
  retained-history model, and secret side-storage split
- `./index.md`: repo map and context entrypoint
- `../src/agent/`: scheduler, context assembly, tracker integration, retained runtime,
  and the operator TUI
- `../src/config/`, `../src/lib/`: shared config loading and typed config surface
- `../src/graph/`, `../src/web/`: graph runtime, canonical schema, the persisted-authority
  contract, worker-backed browser surfaces, and the SQLite Durable Object authority path that
  backs the web shell
- `../src/cli/`: operator command surface
