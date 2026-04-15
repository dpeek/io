# Graphle SQLite

`@dpeek/graphle-sqlite` owns the local SQLite file bootstrap used by the new
personal-site product path.

## Package Docs

- [`./doc/sqlite-bootstrap.md`](./doc/sqlite-bootstrap.md): current SQLite file
  ownership, schema bootstrap, and health contract.

## What It Owns

- opening or creating a project-local `graphle.sqlite` file from an absolute path
- creating the `graphle_meta` table
- recording the current local schema version
- returning a small health summary for local server checks

## What It Does Not Own

- graph schema rows or persisted authority transactions
- HTTP routes, auth cookies, browser startup, or project `.env` files
- Cloudflare D1 or Durable Object storage

## Validation

Run `turbo check --filter=@dpeek/graphle-sqlite` from the repo root, or
`bun run check` in this package.
