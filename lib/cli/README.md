# CLI

`@op/cli` owns the operator/runtime shell for the monorepo.

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
- local copies of the current env/log/process helpers until a dedicated utility
  package exists

## What It Does Not Own

- graph helper/runtime umbrella exports under `@io/app/graph`
- web routes, components, or browser app runtime code under `lib/app/src/web`
- generic helper utilities like `env`, `log`, and `process`

## Validation

Run `bun check lib/cli` for the package-local lint/type/test pass, or
`turbo check` for the repo-wide validation pass.
