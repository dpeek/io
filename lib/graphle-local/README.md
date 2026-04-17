# Graphle Local

`@dpeek/graphle-local` owns the local `graphle dev` runtime for the
personal-site product path.

## Package Docs

- [`./doc/local-dev.md`](./doc/local-dev.md): project layout, local auth, local
  site authority startup, server routes, browser opening, and current
  boundaries.

## What It Owns

- idempotent project-local `.env` creation
- generated `GRAPHLE_AUTH_SECRET` and `GRAPHLE_PROJECT_ID` values
- local `graphle.sqlite` opening through `@dpeek/graphle-sqlite`
- opening the persisted local site authority over `minimalCore`, `core:tag`,
  `core:color`, and `site` definitions
- first-run seed content for public and private `site:item` records
- the Bun HTTP request handler for `/api/health`, `/api/session`, `/api/init`,
  authenticated generic graph transport at `/api/sync` and `/api/tx`,
  transitional item-based `/api/site/*` read-write routes including blank
  create, delete, and batch ordering, unknown `/api/*` JSON 404s,
  package-owned browser assets, and the site host document with graph-backed
  fallback HTML
- public route resolution for exact `site:item.path` values
- signed local admin cookies and process-local init-token redemption
- `graphle dev` CLI option parsing and browser opening

## What It Does Not Own

- packaged browser source or Vite dev-server ownership
- Better Auth or `AUTH_DB` migrations
- site item schema ownership, browser editor UI, deploy, or remote graph sync
- the existing operator CLI package

## Validation

Run `turbo check --filter=@dpeek/graphle-local` from the repo root, or
`bun run check` in this package.
