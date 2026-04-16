# App

`@dpeek/graphle-app` now owns the remaining application surfaces after the operator runtime
was extracted into `@dpeek/graphle-cli`.

## Docs

- `./doc/web-overview.md`: current app-owned browser and Worker runtime map, including installed-module activation-driven authority bootstrap
- `./doc/workflow-web.md`: current browser workflow surface, selected-commit
  launch contract, and browser-agent boundary
- `./doc/auth-store.md`: Better Auth store, Worker runtime, and migration path
- `./doc/local-bootstrap.md`: localhost-only instant onboarding contract
- `./doc/authority-storage.md`: SQLite-backed Durable Object authority storage,
  retained rows, and secret side-storage
- `./doc/roadmap.md`: future auth and web-runtime direction

## What It Owns

- the curated `@dpeek/graphle-app/graph` helper surface and local graph fixtures
- browser Worker, routes, and app-owned web composition on top of `@dpeek/graphle-web-ui`
- app-owned web exports such as `@dpeek/graphle-app/web/better-auth` and
  `@dpeek/graphle-app/web/query-container`
- app-owned installed-module manifest loading plus activation-driven authority
  bootstrap and query-surface composition for built-in and repo-local local
  modules
- app-local web runtime config via `auth.ts`, `vite.config.ts`,
  `wrangler.jsonc`, and `index.html`
- Better Auth D1 migrations under `migrations/auth-store`

## What Moved Out

- CLI entrypoints and task dispatch now live in `@dpeek/graphle-cli`
- agent runtime, browser-agent runtime, MCP entrypoints, workflow TUI, and
  runtime config now live in `@dpeek/graphle-cli`
- reusable browser primitives and editor chrome now live in `@dpeek/graphle-web-ui`
- generic env/log/process helpers now live in `@dpeek/utils`

## What Stays At The Root

- workspace orchestration and shared tool configuration via `package.json`,
  `turbo.json`, `.oxlintrc.json`, and `.oxfmtrc.json`
- top-level repo config such as `graphle.ts`
- repo docs and other global assets

## Dev

Run `turbo dev` from the repo root, or `bun run dev` in this package, to apply
local auth-store migrations and then start the app-local Vite runtime through
`portless graphle vite dev`.

Run `turbo dev:clean --filter=@dpeek/graphle-app`, or `bun run dev:clean` in this package,
to delete `lib/app/out`, recreate the local persisted Worker state, and then
start the same dev runtime.

## Validation

Run `turbo check --filter=@dpeek/graphle-app` from the repo root, or `bun run check` in
this package, for the package-local lint/format/type/test pass. Run
`turbo check` from the repo root before landing repo-wide changes.
