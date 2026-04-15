# Graphle Local

`@dpeek/graphle-local` owns the local `graphle dev` runtime for the
personal-site product path.

## Package Docs

- [`./doc/local-dev.md`](./doc/local-dev.md): project layout, local auth, server
  routes, browser opening, and the current phase-1 boundaries.

## What It Owns

- idempotent project-local `.env` creation
- generated `GRAPHLE_AUTH_SECRET` and `GRAPHLE_PROJECT_ID` values
- local `graphle.sqlite` opening through `@dpeek/graphle-sqlite`
- the Bun HTTP request handler for `/api/health`, `/api/session`, `/api/init`,
  unknown `/api/*` JSON 404s, and placeholder public-site HTML
- signed local admin cookies and process-local init-token redemption
- `graphle dev` CLI option parsing and browser opening

## What It Does Not Own

- packaged Vite or TanStack browser assets
- Better Auth or `AUTH_DB` migrations
- site page/post schema, editors, deploy, or sync
- the existing operator CLI package

## Validation

Run `turbo check --filter=@dpeek/graphle-local` from the repo root, or
`bun run check` in this package.
