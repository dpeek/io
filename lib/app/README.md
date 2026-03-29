# App

`@io/app` now owns the remaining application surfaces after the operator runtime
was extracted into `@op/cli`.

## What It Owns

- the curated `@io/app/graph` helper surface and local graph fixtures
- browser Worker, routes, and web UI/runtime helpers
- generic app-local helper utilities under `@io/app/lib`

## What Moved Out

- CLI entrypoints and task dispatch now live in `@op/cli`
- agent runtime, browser-agent runtime, MCP entrypoints, workflow TUI, and
  runtime config now live in `@op/cli`

## What Stays At The Root

- workspace orchestration and shared tool configuration
- top-level config files such as `io.ts`, `auth.ts`, `vite.config.ts`, and
  `wrangler.jsonc`
- repo docs, migrations, and other global assets

## Validation

Run `bun check lib/app` for the package-local lint/type/test pass, or
`turbo check` for the repo-wide validation pass.
