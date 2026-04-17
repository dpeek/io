# Graphle Site Web

`@dpeek/graphle-site-web` assembles the personal-site browser app from
browser primitives and the MVP site item contracts.

## Package Docs

- [`./doc/site-web.md`](./doc/site-web.md): app assembly, route loading, inline
  authoring, built assets, and current non-goals.

## What It Owns

- the package-built browser entrypoint served by `@dpeek/graphle-local`
- the browser-safe local site graph namespace and `createHttpGraphClient`
  assembly seam for the generic graph transport migration
- the site-owned sidebar and centered content frame for the personal-site path
- personal-site feature registration for future generic-shell composition
- local status loading from `/api/health` and `/api/session`
- route loading from `/api/site/route`
- a flat item sidebar with path navigation, URL-only external links, action
  menus, delete confirmation, drag reorder, and a theme toggle
- one inline predicate-backed `site:item` editor that appears only for
  authenticated local admin sessions
- site-specific public preview presentation for the current local host route

## What It Does Not Own

- `site:` schema definitions, local API route handling, SQLite storage, deploy,
  or sync
- Better Auth, `@dpeek/graphle-app`, or user-project source scaffolding

## Validation

Run `turbo check --filter=@dpeek/graphle-site-web` from the repo root, or
`bun run check` in this package.
