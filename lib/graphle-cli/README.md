# CLI

`@dpeek/graphle-cli` owns the operator/runtime shell for the workspace repo.
The public personal-site product command lives in `@dpeek/graphle`; `graphle dev`
does not depend on this package.

## Docs

- `./doc/agent-runtime.md`: current issue-driven automation runtime
- `./doc/agent-workflow.md`: workflow loading, routing, and context assembly
- `./doc/command-surfaces.md`: current `graphle agent ...`, `graphle browser-agent ...`,
  `graphle mcp ...`, and `graphle tui ...` command groups
- `./doc/tui.md`: current graph-backed workflow TUI surface, startup contract,
  and the boundary against the legacy agent TUI
- `./doc/legacy-agent-tui.md`: current retained-session monitor for
  `graphle agent tui ...`
- `./doc/graph-mcp.md`: current graph MCP stdio surface and write gate
- `./doc/roadmap.md`: future CLI direction

## What It Owns

- legacy operator command dispatch for the current agent, browser-agent, MCP,
  graph, setup, and TUI command groups
- task modules and operator-facing runtime entrypoints
- agent runtime, retained agent TUI monitor, and browser-agent runtime
- MCP stdio entrypoints
- workflow TUI bootstrap, startup hydration, and rendering
- runtime config loading and normalization via `@dpeek/graphle-cli/config`

## Product Surfaces

- `lib/cli/src/tui/*` owns the graph-backed workflow TUI shown by `graphle tui`
- `lib/cli/src/agent/tui/*` owns the legacy retained session monitor shown by
  `graphle agent tui ...`

Keep those surfaces separate. Do not grow new workflow product-shell panels in
the legacy agent TUI.

## What It Depends On

- extracted graph packages such as `@dpeek/graphle-client`, `@dpeek/graphle-kernel`, and
  `@dpeek/graphle-module-workflow`
- `@dpeek/utils` for generic env/log/process helpers

## What It Does Not Own

- graph helper/runtime umbrella exports under `@dpeek/graphle-app/graph`
- the public `@dpeek/graphle` package or the `graphle dev` product path
- web routes, components, or browser app runtime code under `lib/graphle-app/src/web`
- generic helper utilities like `env`, `log`, and `process`

## Validation

Run `turbo check --filter=@dpeek/graphle-cli` from the repo root, or `bun run check` in
this package, for the package-local lint/format/type/test pass. Run
`turbo check` from the repo root before landing repo-wide changes.
