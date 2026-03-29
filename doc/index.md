# IO Overview

## Purpose

`io` is a Bun workspaces repository coordinated by Turborepo. The repo root
owns shared project configuration, entrypoints, and docs, while the workspace
packages under `lib/*` carry the operator runtime, graph engine, web surfaces,
shared browser primitives, and shared utilities.

The operator/runtime implementation now lives in `@op/cli`. `@io/app` stays
focused on the curated graph helper surface plus app-specific web and Worker
composition. `@io/web` owns reusable browser primitives, and `@io/utils` owns
shared env/log/process helpers.

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
- `./integration.md`
- `./graph/computed.md`
- `./graph/mcp.md`
- `./graph/storage.md`
- `./graph/retained-records.md`
- `./tui/index.md`
- `./README.md`
- `./branch/README.md`
- `./web/index.md`

## Layout

- `../package.json`: Bun workspaces, the pinned package manager version, and
  root auth-migration scripts
- `../turbo.json`: repo task graph for `build`, `check`, and `clean`
- `../.oxlintrc.json`, `../.oxfmtrc.json`: repo-wide lint and formatting config
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
- `./integration.md`: plan for consolidating graph integration coverage into a
  dedicated downstream `@io/graph-integration` package
- `./graph/computed.md`: proposed computed-value layer for lazy, memoized, read-only graph derivations
- `./graph/mcp.md`: current graph MCP read surface, opt-in writes, and the remaining command roadmap
- `./graph/storage.md`: current SQLite-backed Durable Object authority storage shape, raw-SQL decision,
  retained-history model, and secret side-storage split
- `./graph/retained-records.md`: proposed retained-record boundary for data
  that should survive graph refactors, recovery, and live-graph rebuilds
- `./tui/index.md`: terminal workflow product surface and the boundary against legacy agent TUI
- `./README.md`: architecture and vision doc map for the numbered architecture
  and branch docs
- `./branch/README.md`: platform branches as parallel workstreams with canonical specs where available
- `./index.md`: repo map and context entrypoint
- `../lib/app/`: `@io/app`, the app package for graph helper exports plus the
  browser Worker, routes, and app-owned web composition
- `../lib/cli/`: `@op/cli`, the operator shell package for command dispatch,
  task execution, agent/browser-agent runtimes, MCP, TUI, and runtime config
- `../lib/web/`: `@io/web`, the shared browser primitive package for reusable
  controls, markdown, Monaco, and source-preview chrome
- `../lib/utils/`: `@io/utils`, the shared runtime helper package for env,
  logging, and process helpers
- `../lib/cli/src/agent/`: scheduler, context assembly, tracker integration, retained runtime,
  and the operator TUI
- `../lib/cli/src/tui/`: graph-backed terminal workflow product surface
- `../lib/cli/src/lib/config.ts`: runtime config loading, normalization, and typed config surface
- `../lib/utils/src/`: extracted generic process, env, and logging helpers
- `../lib/app/src/graph/`: root `@io/app/graph` wrappers, local schema and module
  authoring, graph adapters, and graph-owned icon helpers
- `../lib/graph-*/`: extracted graph kernel, bootstrap, client, authority,
  sync, and projection packages
- `../lib/app/src/web/`: worker-backed browser surfaces and the SQLite Durable Object
  authority path that backs the web shell
- `../lib/web/src/`: shared browser primitives, editor shells, and styling
- `../lib/cli/src/cli/`: operator command surface
