Status: Implemented
Last Updated: 2026-04-15

# Phase 1: Local dev bootstrap

## Must Read

- `./spec.md`
- `../../package.json`
- `../../turbo.json`
- `../../lib/graphle/package.json`
- `../../lib/graphle/README.md`
- `../../lib/graphle-cli/src/cli/index.ts`
- `../../lib/graphle-cli/doc/command-surfaces.md`
- `../../lib/graphle-authority/doc/persistence.md`
- `../../lib/graphle-authority/src/server.ts`
- `../../lib/graphle-authority/src/json-storage.ts`
- `../../lib/graphle-kernel/doc/runtime-stack.md`
- `../../lib/graphle-app/doc/auth-store.md`
- `../../lib/graphle-app/src/web/worker/index.ts`

## Goal

Create the runnable product spine for the personal-site MVP.

From a clean directory, this command must work:

```sh
bunx @dpeek/graphle dev
```

It should:

- create or reuse `.env`
- create or reuse `graphle.sqlite`
- start a local Bun HTTP server
- open the browser through `/api/init` when no valid admin cookie exists
- set a signed local admin cookie
- redirect to `/`
- render a placeholder public site page with visible inline logged-in state
- expose a minimal `/api/*` surface for health and session checks

This phase intentionally does not implement real site schema, page/post editing,
Cloudflare deploy, or local/remote sync.

## Approach

Add three package boundaries and keep them narrow:

- `@dpeek/graphle`: public package and `graphle` binary entrypoint.
- `@dpeek/graphle-local`: local `dev` runtime, project bootstrap, local auth,
  Bun server, browser opening, and placeholder site rendering.
- `@dpeek/graphle-sqlite`: local SQLite open/bootstrap helper for
  `graphle.sqlite`.

Use the existing `@dpeek/graphle-cli` dispatcher only as reference material.
Do not make the new public `graphle dev` path depend on the existing
agent/workflow CLI package unless there is a concrete reason during
implementation.

The first local server can return a small static HTML document from
`@dpeek/graphle-local`. It does not need the Vite/TanStack packaged browser app
yet. Phase 3 and Phase 4 will replace the placeholder with the real web UI
packages.

### Project layout

The default cwd state is:

```text
.env
graphle.sqlite
```

`.env` should be append-safe and idempotent. On first run, write generated
values only when missing:

- `GRAPHLE_AUTH_SECRET`
- `GRAPHLE_PROJECT_ID`

Do not log secret values. It is acceptable to log file paths and whether values
were created or reused.

### SQLite bootstrap

`@dpeek/graphle-sqlite` should use Bun's local SQLite support and provide a
small server-only API such as:

- open or create a database at an absolute path
- initialize a `graphle_meta` table with a schema version
- read a health/status summary
- close the database

This phase only needs file creation and health. The full persisted authority
adapter can land in Phase 2 when the site graph has real schema and writes.

### Local server routes

Reserve `/api/*` as the only API namespace.

Minimum routes:

- `GET /api/health`: JSON health payload including service status and whether
  the SQLite database opened successfully
- `GET /api/session`: JSON payload indicating whether the request has a valid
  local admin session
- `GET /api/init?token=<token>`: verifies the process-local one-time token,
  sets an HttpOnly admin cookie, and redirects to `/`

All non-API routes should return the placeholder site shell in this phase.

Unknown `/api/*` routes should return JSON 404 responses. Non-API paths should
not collide with `/api/*`.

### Local auth

Generate a process-local init token on server start when the browser does not
already have a valid local admin cookie.

The cookie contract:

- HttpOnly
- SameSite=Lax
- Path=/
- signed with `GRAPHLE_AUTH_SECRET`
- local dev may use a non-secure cookie for `http://127.0.0.1`
- remote/deploy behavior is out of scope

`GET /api/init` should be one-time or idempotently safe. Reusing a consumed
token without a valid cookie must fail with a clear JSON or text error. Reusing
it while already authenticated may redirect to `/`.

### Browser open

Default host should be loopback only. Use `127.0.0.1` unless the user passes a
supported host option later.

Recommended CLI options for Phase 1:

- `--host <host>`
- `--port <port>`
- `--no-open`

If the requested port is unavailable, either fail clearly or choose the next
available port and log the actual URL. The implementation should not depend on
the current app's `portless` command.

Opening the browser should use a small cross-platform helper:

- macOS: `open`
- Windows: `cmd /c start`
- Linux: `xdg-open`

Unit tests should exercise URL selection and route behavior without actually
opening a browser.

## Rules

- Do not import or boot `@dpeek/graphle-app`.
- Do not use Better Auth.
- Do not apply or create `AUTH_DB` migrations.
- Do not run Vite in the user's cwd.
- Do not scaffold a source project.
- Do not create site schema or page/post editors in this phase.
- Do not introduce a `/_graphle` namespace.
- Reserve `/api/*` as the only API namespace.
- Do not log generated secret values.
- Keep package docs current for every new package.
- Keep implementation testable without launching a real browser.

## Open Questions

None.

## Success Criteria

- `@dpeek/graphle` exposes a `graphle` bin with a `dev` command.
- Running the dev command against a temporary empty directory creates `.env`.
- Running the dev command creates `graphle.sqlite`.
- Re-running the command reuses existing `.env` values and does not duplicate
  keys.
- The local server binds to loopback and reports its actual URL.
- `GET /api/health` returns JSON and confirms the SQLite file opened.
- `GET /api/init?token=<valid>` sets a signed admin cookie and redirects to `/`.
- `GET /api/session` reports authenticated state when the signed cookie is
  present and unauthenticated state without it.
- `GET /` returns a placeholder public site page.
- The placeholder page can show that inline authoring would be available when
  logged in.
- Unknown `/api/*` routes return JSON 404.
- The phase path does not import `@dpeek/graphle-app`, `better-auth`, or
  `AUTH_DB` wiring.
- New package READMEs and package-local docs describe ownership and boundaries.
- `turbo build` passes.
- `turbo check` passes.

## Implementation Notes

- `@dpeek/graphle` now owns the public `graphle` bin and dispatches `graphle dev`
  to `@dpeek/graphle-local`.
- `@dpeek/graphle-local` owns cwd `.env` bootstrap, signed local admin cookies,
  `/api/*` routes, placeholder site rendering, browser opening, and the dev CLI
  options.
- `@dpeek/graphle-sqlite` owns local `graphle.sqlite` opening, the
  `graphle_meta` table, schema-version metadata, and database health summaries.
- This phase still intentionally avoids `@dpeek/graphle-app`, Better Auth,
  `AUTH_DB`, Vite, site schema, editors, deploy, and sync.

## Tasks

- Scaffold `lib/graphle-sqlite` with package metadata, TypeScript config,
  README, package docs, and a small SQLite open/bootstrap/health API.
- Scaffold `lib/graphle-local` with package metadata, TypeScript config,
  README, package docs, and local runtime modules for project layout, env
  management, auth cookies, server routing, browser opening, and `dev` startup.
- Update `lib/graphle` so it becomes the public executable package with a
  `graphle` bin and `dev` command dispatch to `@dpeek/graphle-local`.
- Implement idempotent `.env` creation in `@dpeek/graphle-local`, including
  generated `GRAPHLE_AUTH_SECRET` and `GRAPHLE_PROJECT_ID`.
- Implement `graphle.sqlite` creation through `@dpeek/graphle-sqlite`.
- Implement the minimum local server route set:
  `GET /api/health`, `GET /api/session`, `GET /api/init`, JSON 404 for unknown
  `/api/*`, and placeholder HTML for non-API routes.
- Implement signed local admin cookies and process-local init-token handling.
- Implement browser URL selection and the `--no-open`, `--host`, and `--port`
  options.
- Add focused tests for env idempotency, SQLite file creation, route behavior,
  cookie signing, init-token handling, unknown API 404s, and CLI argument
  parsing.
- Update root docs and package docs so `doc/index.md`, `pdr/README.md`, and new
  package READMEs point at the new local-dev product path.

## Non-Goals

- real `site:page` or `site:post` schema
- typed graph writes
- full persisted authority adapter
- packaged Vite/TanStack browser app
- web UI kit or web shell extraction
- inline markdown editor
- Cloudflare deploy
- local/remote sync
- multi-user auth
- Better Auth migration or removal from `@dpeek/graphle-app`
- source scaffolding or `graphle eject`
