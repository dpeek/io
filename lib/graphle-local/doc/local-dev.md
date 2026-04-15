---
name: Graphle local dev runtime
description: "Local dev runtime, project bootstrap, persisted site authority, auth, routes, and browser opening owned by @dpeek/graphle-local."
last_updated: 2026-04-15
---

# Graphle Local Dev Runtime

## Read This When

- you are changing `graphle dev`
- you are touching `.env` or `graphle.sqlite` bootstrap
- you are changing local site authority startup or seed content
- you are changing local admin cookie behavior
- you are adding or changing local `/api/*` routes

## Runtime Flow

`graphle dev` prepares the current working directory, opens the SQLite file,
opens the persisted local site authority, starts a loopback Bun HTTP server, and
opens the browser through `/api/init`.

The current project layout is intentionally small:

```text
.env
graphle.sqlite
```

The `.env` file is append-safe and idempotent. Missing `GRAPHLE_AUTH_SECRET` and
`GRAPHLE_PROJECT_ID` values are generated, while existing values are reused.
Generated secret values are never logged.

## Local Site Authority

Startup opens a persisted authority in `graphle.sqlite` before serving
requests. The authority boots `minimalCore` from `@dpeek/graphle-module-core`
plus the `site` namespace from `@dpeek/graphle-module-site`, then uses the
SQLite persisted-authority adapter from `@dpeek/graphle-sqlite`.

When storage is empty, the seed callback creates:

- one published home page at `/`
- one published example post with slug `example-post`

Reopening the same SQLite file loads the persisted authority state and does not
seed duplicate records.

## HTTP Surface

`/api/*` is the only API namespace.

- `GET /api/health`: service status plus SQLite health and graph startup
  diagnostics
- `GET /api/session`: local admin session status
- `GET /api/init?token=<token>`: one-time local admin cookie bootstrap
- unknown `/api/*`: JSON 404

All non-API routes return the placeholder public-site HTML. When the graph is
available, `/` reads the seeded home page title and body from the local site
authority.

## Local Auth

Local auth uses an HttpOnly, `SameSite=Lax`, path-root cookie signed with
`GRAPHLE_AUTH_SECRET`. The init token is process-local and consumed on first
successful redemption. A request that already has a valid cookie may reuse the
same init URL and will be redirected to `/`.

This package does not import Better Auth and does not use `AUTH_DB`.

## Browser Opening

The browser helper is intentionally small and injectable for tests:

- macOS: `open`
- Windows: `cmd /c start`
- Linux: `xdg-open`

`--no-open` skips the helper and logs the init URL.
