---
name: App auth store
description: "Current Better Auth store, Worker runtime, and migration path for @io/app."
last_updated: 2026-04-07
---

# App auth store

## Read this when

- you are changing Better Auth runtime wiring in the Worker
- you need the auth-store versus graph-authority storage split
- you are generating or applying Better Auth migrations

## Current boundary

- Better Auth state lives in the dedicated `AUTH_DB` D1 database
- graph state stays in the SQLite-backed `GRAPH_AUTHORITY` Durable Object
- Better Auth schema changes are applied through D1 migrations, not through
  Durable Object schema bootstrap

The localhost instant-onboarding path stays inside that same Better Auth
boundary. It redeems a short-lived local bootstrap credential into a normal
Better Auth user or session instead of introducing a second long-lived local
auth model.

## Runtime surface

- `../auth.ts`: Better Auth CLI config entrypoint used for migration
  generation
- `../src/web/lib/better-auth.ts`: shared Better Auth Worker factory and env
  parsing
- `../src/web/worker/index.ts`: mounts `/api/auth/*` before graph routes and
  also hosts the localhost bootstrap issue or redeem routes
- `../src/web/lib/auth-client.ts`: shared browser Better Auth client wrapper
- `../src/web/components/auth-shell.tsx`: sign-in, sign-out, and provisional
  create-account shell behavior
- `../wrangler.jsonc`: `AUTH_DB` binding plus the dedicated auth-store
  migration path

## Migration workflow

Committed auth-store schema lives under `../migrations/auth-store/`.

Use:

- `bun run auth:migrations:create -- <message>`
- `bun run auth:migrations:generate -- --output lib/app/migrations/auth-store/<NNNN_name>.sql --yes`
- `bun run auth:migrations:apply:local`
- `bun run auth:migrations:apply:remote`

Local development also applies pending auth-store migrations automatically when
`turbo dev` runs `@io/app`.

## Provisioning notes

The committed Wrangler config names the database `io-better-auth` and uses the
binding `AUTH_DB`, but environment-specific `database_id` values still need to
be filled in after `wrangler d1 create`.

## Related docs

- [`./web-overview.md`](./web-overview.md): app-owned browser and Worker map
- [`./local-bootstrap.md`](./local-bootstrap.md): localhost-only bootstrap
  credential flow
- [`./roadmap.md`](./roadmap.md): future Better Auth integration direction
