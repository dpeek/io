# App

`@io/app` now owns the remaining application surfaces after the operator runtime
was extracted into `@op/cli`.

## Docs

- `./doc/web-overview.md`: current app-owned browser and Worker runtime map
- `./doc/workflow-web.md`: current browser workflow surface and browser-agent
  boundary
- `./doc/auth-store.md`: Better Auth store, Worker runtime, and migration path
- `./doc/local-bootstrap.md`: localhost-only instant onboarding contract
- `./doc/authority-storage.md`: SQLite-backed Durable Object authority storage,
  retained rows, and secret side-storage
- `./doc/roadmap.md`: future auth and web-runtime direction

## What It Owns

- the curated `@io/app/graph` helper surface and local graph fixtures
- browser Worker, routes, and app-owned web composition on top of `@io/web`
- app-owned web exports such as `@io/app/web/better-auth` and
  `@io/app/web/query-container`
- app-local web runtime config via `auth.ts`, `vite.config.ts`,
  `wrangler.jsonc`, and `index.html`
- Better Auth D1 migrations under `migrations/auth-store`

## What Moved Out

- CLI entrypoints and task dispatch now live in `@op/cli`
- agent runtime, browser-agent runtime, MCP entrypoints, workflow TUI, and
  runtime config now live in `@op/cli`
- reusable browser primitives and editor chrome now live in `@io/web`
- generic env/log/process helpers now live in `@io/utils`

## What Stays At The Root

- workspace orchestration and shared tool configuration via `package.json`,
  `turbo.json`, `.oxlintrc.json`, and `.oxfmtrc.json`
- top-level repo config such as `io.ts`
- repo docs and other global assets

## Dev

Run `turbo dev` from the repo root, or `bun run dev` in this package, to apply
local auth-store migrations and then start the app-local Vite runtime through
`portless io vite dev`.

Run `turbo dev:clean --filter=@io/app`, or `bun run dev:clean` in this package,
to delete `lib/app/out`, recreate the local persisted Worker state, and then
start the same dev runtime.

## Validation

Run `turbo check --filter=@io/app` from the repo root, or `bun run check` in
this package, for the package-local lint/format/type/test pass. Run
`turbo check` from the repo root before landing repo-wide changes.
