# App

`@io/app` owns the monorepo's application surfaces that used to live in the
root `src/` tree.

## What It Owns

- CLI entrypoints and task dispatch
- agent runtime and retained TUI monitor
- graph helper package surface and local test fixtures
- MCP server bootstrap
- graph-backed workflow TUI
- browser Worker, routes, and web UI/runtime helpers
- shared app-local config and process utilities

## What Stays At The Root

- workspace orchestration and shared tool configuration
- top-level config files such as `io.ts`, `auth.ts`, `vite.config.ts`, and
  `wrangler.jsonc`
- repo docs, migrations, and other global assets

## Validation

Run `bun check` for the repo static check plus cached workspace tests, or
`turbo run test --filter=@io/app` for the cached `@io/app` suite.
