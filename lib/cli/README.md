# CLI

`@op/cli` owns the operator/runtime shell for the workspace repo.

## Docs

- `./doc/agent-runtime.md`: current issue-driven automation runtime
- `./doc/agent-workflow.md`: workflow loading, routing, and context assembly
- `./doc/command-surfaces.md`: current `io agent ...`, `io browser-agent ...`,
  `io mcp ...`, and `io tui ...` command groups
- `./doc/tui.md`: current graph-backed workflow TUI surface, startup contract,
  and the boundary against the legacy agent TUI
- `./doc/legacy-agent-tui.md`: current retained-session monitor for
  `io agent tui ...`
- `./doc/graph-mcp.md`: current graph MCP stdio surface and write gate
- `./doc/roadmap.md`: future CLI direction

## What It Owns

- the `io` binary entrypoint and top-level command dispatch
- task modules and operator-facing runtime entrypoints
- agent runtime, retained agent TUI monitor, and browser-agent runtime
- MCP stdio entrypoints
- workflow TUI bootstrap, startup hydration, and rendering
- runtime config loading and normalization via `@op/cli/config`

## Product Surfaces

- `lib/cli/src/tui/*` owns the graph-backed workflow TUI shown by `io tui`
- `lib/cli/src/agent/tui/*` owns the legacy retained session monitor shown by
  `io agent tui ...`

Keep those surfaces separate. Do not grow new workflow product-shell panels in
the legacy agent TUI.

## What It Depends On

- extracted graph packages such as `@io/graph-client`, `@io/graph-kernel`, and
  `@io/graph-module-workflow`
- `@io/utils` for generic env/log/process helpers

## What It Does Not Own

- graph helper/runtime umbrella exports under `@io/app/graph`
- web routes, components, or browser app runtime code under `lib/app/src/web`
- generic helper utilities like `env`, `log`, and `process`

## Validation

Run `turbo check --filter=@op/cli` from the repo root, or `bun run check` in
this package, for the package-local lint/format/type/test pass. Run
`turbo check` from the repo root before landing repo-wide changes.
