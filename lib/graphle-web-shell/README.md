# Graphle Web Shell

`@dpeek/graphle-web-shell` owns the generic React shell used by browser product
packages.

## Package Docs

- [`./doc/web-shell.md`](./doc/web-shell.md): feature registration, host status,
  shell slots, and current boundaries.

## What It Owns

- shell frame composition for navigation, content, status, and command slots
- host status context for auth, graph, sync, deploy, and runtime summaries
- browser feature registration contracts for navigation, pages, and commands
- empty, loading, and error states that don't mention a product area

## What It Does Not Own

- `site:` schema, page/post editors, or public website routing
- local SQLite details, local server routes, or Cloudflare resource state
- Better Auth, `@dpeek/graphle-app`, or app-owned route composition

## Validation

Run `turbo check --filter=@dpeek/graphle-web-shell` from the repo root, or
`bun run check` in this package.
