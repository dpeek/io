# CLI

`@op/cli` owns the operator/runtime shell for the workspace repo.

## What It Owns

- the `io` binary entrypoint and top-level command dispatch
- task modules and operator-facing runtime entrypoints
- agent runtime, retained TUI monitor, and browser-agent runtime
- MCP stdio entrypoints
- workflow TUI bootstrap and rendering
- runtime config loading and normalization via `@op/cli/config`

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
