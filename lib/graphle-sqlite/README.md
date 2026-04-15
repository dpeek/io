# Graphle SQLite

`@dpeek/graphle-sqlite` owns local `graphle.sqlite` bootstrap and the
SQLite-backed persisted-authority storage adapter used by the personal-site
product path.

## Package Docs

- [`./doc/sqlite-bootstrap.md`](./doc/sqlite-bootstrap.md): SQLite file
  ownership, schema bootstrap, authority persistence rows, and health contract.

## What It Owns

- opening or creating a project-local `graphle.sqlite` file from an absolute path
- creating the `graphle_meta` table
- recording the current local schema version
- creating shared persisted-authority tables
- loading and persisting versioned authority snapshots, retained write history,
  retained records, and accepted transaction rows
- returning a small health summary for local server checks

## What It Does Not Own

- site-specific tables or route-local state
- HTTP routes, auth cookies, browser startup, or project `.env` files
- Cloudflare D1 or Durable Object storage

## Validation

Run `turbo check --filter=@dpeek/graphle-sqlite` from the repo root, or
`bun run check` in this package.
