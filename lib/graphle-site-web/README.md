# Graphle Site Web

`@dpeek/graphle-site-web` assembles the personal-site browser app from the
generic shell and browser primitives.

## Package Docs

- [`./doc/site-web.md`](./doc/site-web.md): app assembly, route loading, inline
  authoring, built assets, and current non-goals.

## What It Owns

- the package-built browser entrypoint served by `@dpeek/graphle-local`
- personal-site feature registration for the generic shell
- local status loading from `/api/health` and `/api/session`
- route loading from `/api/site/route`
- inline page and post authoring controls that appear only for authenticated
  local admin sessions
- site-specific public preview presentation for the current local host route

## What It Does Not Own

- `site:` schema definitions, local API route handling, SQLite storage, deploy,
  or sync
- Better Auth, `@dpeek/graphle-app`, or user-project source scaffolding

## Validation

Run `turbo check --filter=@dpeek/graphle-site-web` from the repo root, or
`bun run check` in this package.
