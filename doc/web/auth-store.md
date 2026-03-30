# Auth Store

## Purpose

This doc defines the runtime and migration foundation for Better Auth in the
`web` package. The Worker now mounts Better Auth at `/api/auth/*`, while graph
API requests now verify Better Auth session state server-side, reduce it into
the repo's stable `AuthenticatedSession` contract, and only forward anonymous
or successfully projected request authorization state to the graph authority.
The localhost instant-onboarding path also stays inside that same Better Auth
boundary: it redeems a short-lived local bootstrap credential into a
normal Better Auth user/session pair instead of introducing a second auth
database or long-lived local token model.

The key boundary is:

- Better Auth state lives in the dedicated `AUTH_DB` D1 database.
- Graph state remains in the SQLite-backed `GRAPH_AUTHORITY` Durable Object.
- Better Auth schema changes are applied through D1 migrations, not through the
  Durable Object migration block in `lib/app/wrangler.jsonc`.

## Runtime Surface

- [`../../lib/app/wrangler.jsonc`](../../lib/app/wrangler.jsonc) declares the
  `AUTH_DB` D1 binding and points it at `./migrations/auth-store` with its own
  `better_auth_migrations` table.
- [`../../lib/app/auth.ts`](../../lib/app/auth.ts) exports a Better Auth config
  entrypoint for
  the CLI. It uses in-memory SQLite only to let the Better Auth generator
  produce SQL; it is not the Worker runtime database.
- [`../../lib/app/src/web/lib/better-auth.ts`](../../lib/app/src/web/lib/better-auth.ts)
  exports the shared Better Auth Worker config shape:
  - `AUTH_DB`
  - `BETTER_AUTH_SECRET`
  - optional `BETTER_AUTH_TRUSTED_ORIGINS`
  - `BETTER_AUTH_URL`
  - the stable `/api/auth` base path
  - the Worker passes the Cloudflare `AUTH_DB` D1 binding straight through to
    Better Auth, which requires a runtime with native D1 adapter support
- [`../../lib/app/src/web/worker/index.ts`](../../lib/app/src/web/worker/index.ts) mounts that
  shared Better Auth instance before the graph API and SPA asset routes so the
  auth handler is part of the real Worker surface. The same Worker now also owns
  `POST /api/local-bootstrap/issue` and `POST /api/local-bootstrap/redeem`,
  which stay local-only and terminate in normal Better Auth session cookies.
- [`../../lib/app/src/web/lib/local-bootstrap.ts`](../../lib/app/src/web/lib/local-bootstrap.ts)
  defines the localhost-only bootstrap credential and deterministic synthetic
  local identity contract that the Worker issue/redeem path uses to bridge into
  normal Better Auth state.

## Migration Workflow

The committed initial auth-store schema lives at
[`../../lib/app/migrations/auth-store/0001_better_auth.sql`](../../lib/app/migrations/auth-store/0001_better_auth.sql).

Use these repo scripts:

- `bun run auth:migrations:create -- <message>`
- `bun run auth:migrations:generate -- --output lib/app/migrations/auth-store/<NNNN_name>.sql --yes`
- `bun run auth:migrations:apply:local`
- `bun run auth:migrations:apply:remote`

Local development now also applies pending auth-store migrations automatically
when `io start` runs. That uses the same `lib/app/out/wrangler` persistence
directory as the Vite Cloudflare plugin so the Worker and the migration
command point at the same local D1 database.

Expected flow for future Better Auth schema changes:

1. Create the next numbered D1 migration file with `auth:migrations:create`.
2. Regenerate the Better Auth SQL into that file with `auth:migrations:generate`.
3. Apply it to the local D1 database with `auth:migrations:apply:local`.
4. Apply it to the remote D1 database with `auth:migrations:apply:remote`.

## Provisioning Notes

The committed Wrangler config names the database `io-better-auth` and wires the
binding name `AUTH_DB`, but the environment-specific `database_id` values still
need to be filled in after running `wrangler d1 create`.

That keeps the binding and migration path committed in-repo while leaving the
actual Cloudflare database ids environment-specific.
