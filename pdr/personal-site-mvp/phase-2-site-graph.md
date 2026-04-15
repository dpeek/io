Status: Proposed
Last Updated: 2026-04-15

# Phase 2: Minimal core and site graph

## Must Read

- `./spec.md`
- `./phase-1-local-dev.md`
- `../../AGENTS.md`
- `../../package.json`
- `../../turbo.json`
- `../../lib/graphle-local/README.md`
- `../../lib/graphle-local/doc/local-dev.md`
- `../../lib/graphle-local/src/cli.ts`
- `../../lib/graphle-local/src/server.ts`
- `../../lib/graphle-sqlite/README.md`
- `../../lib/graphle-sqlite/doc/sqlite-bootstrap.md`
- `../../lib/graphle-sqlite/src/index.ts`
- `../../lib/graphle-bootstrap/doc/core-schema-requirements.md`
- `../../lib/graphle-bootstrap/src/bootstrap.ts`
- `../../lib/graphle-bootstrap/src/core-schema.ts`
- `../../lib/graphle-authority/doc/persistence.md`
- `../../lib/graphle-authority/src/persisted-authority.ts`
- `../../lib/graphle-client/src/graph.ts`
- `../../lib/graphle-kernel/doc/runtime-stack.md`
- `../../lib/graphle-kernel/src/identity.ts`
- `../../lib/graphle-module-core/src/core.ts`
- `../../lib/graphle-module-core/doc/core-namespace.md`

## Goal

Replace the phase-1 placeholder-only runtime with a durable local graph baseline
for the personal-site MVP.

After this phase, a fresh `graphle dev` project should still create only:

```text
.env
graphle.sqlite
```

but `graphle.sqlite` should contain a persisted authority baseline made from:

- the minimal core schema needed by the MVP boot path
- the `site` module definitions
- one seeded home page
- one seeded example post

The phase does not build the browser shell, editor, deploy, sync, or final public
renderer. It only establishes the durable graph substrate those phases will use.

## Approach

Add one new package and deepen two phase-1 packages:

- `@dpeek/graphle-module-site`: owns the `site:` schema and stable id map.
- `@dpeek/graphle-sqlite`: grows from file bootstrap into the SQLite-backed
  persisted-authority storage adapter for `graphle.sqlite`.
- `@dpeek/graphle-local`: opens the persisted site authority at startup, seeds
  content when storage is empty, and exposes graph bootstrap status through
  existing local runtime wiring.

Keep the runtime on the existing graph stack:

1. Define a minimal core namespace for the MVP boot path.
2. Define the site schema in `@dpeek/graphle-module-site`.
3. Bootstrap minimal core plus site definitions into an authority store.
4. Persist authority snapshots and retained write history through
   `PersistedAuthoritativeGraphStorage`.
5. Seed site content through the typed graph client during first baseline
   creation.
6. Reopen the same SQLite file and verify the typed graph client can read the
   same site records.

### Minimal core

The MVP boot path needs only:

- schema anchors: `node`, `type`, `predicate`, `enum`, `cardinality`
- scalar types: `string`, `number`, `boolean`, `date`, `json`, `markdown`,
  `slug`, `url`
- node metadata fields required for typed records: `name`, `description`,
  `type`, and optional managed timestamps

`@dpeek/graphle-bootstrap` currently treats icon contracts as required. This
phase should make icon-related core contracts optional for bootstrap so the MVP
path can boot without icon or SVG graph records. Do not remove the existing
icon-capable package behavior in unrelated callers unless the implementation
fully updates those tests and docs.

### Site schema

`@dpeek/graphle-module-site` should define:

- `site:status`
  - `draft`
  - `published`
- `site:path`
  - scalar for absolute site paths such as `/`, `/about`, and `/work`
- `site:page`
  - `title`: `core:string`
  - `path`: `site:path`
  - `body`: `core:markdown`
  - `status`: `site:status`
  - `updatedAt`: `core:date`
- `site:post`
  - `title`: `core:string`
  - `slug`: `core:slug`
  - `body`: `core:markdown`
  - `excerpt`: `core:string`
  - `publishedAt`: `core:date`, optional
  - `status`: `site:status`
  - `updatedAt`: `core:date`

Use stable ids for every site type, predicate, enum option, and field-tree node.
Add a package-local id-map check so schema key drift is caught intentionally.

### SQLite authority storage

The storage adapter should implement the existing
`PersistedAuthoritativeGraphStorage` contract from `@dpeek/graphle-authority`.
It may start with a conservative SQL layout that stores the shared state shape as
JSON in SQLite rows, as long as the adapter boundary remains the authority
storage contract and not route-local state.

The adapter should own:

- durable baseline snapshot load/persist
- durable commit of accepted authoritative transactions
- retained write-history storage
- retained-record pass-through, even if unused by the site MVP
- startup recovery classifications already expected by the shared authority
  runtime

Do not add site-specific tables in this phase unless the adapter still presents
the shared authority storage contract as the only public persistence boundary.

### Local runtime integration

`@dpeek/graphle-local` should create a local site authority during startup.

Startup should:

1. prepare `.env`
2. open `graphle.sqlite`
3. open or create the persisted site authority
4. seed home/post records only when no durable authority state exists
5. start the HTTP server

The placeholder HTML may continue to render in this phase, but it should read
the seeded home page from the graph when possible. Keep `/api/*` narrow:

- `GET /api/health` may add graph bootstrap and startup recovery details.
- `GET /api/session` remains auth-only.
- `GET /api/init` remains auth-only.
- unknown `/api/*` stays JSON 404.

Avoid adding authoring endpoints before Phase 4 unless needed for focused
package tests.

## Rules

- Run `turbo build` before edits and `turbo check` after edits.
- Do not import or boot `@dpeek/graphle-app`.
- Do not use Better Auth.
- Do not apply or create `AUTH_DB` migrations.
- Keep default local project state to `.env` and `graphle.sqlite`.
- Do not run Vite in the user's cwd.
- Do not scaffold source files in the user's cwd.
- Reserve `/api/*` as the only API namespace.
- Do not introduce `/_graphle` or another product namespace.
- Keep Cloudflare deploy code out of this phase.
- Keep the SQLite layer as an authority storage adapter, not ad hoc route state.
- Keep the site schema package separate from the local runtime package.
- Keep the browser shell and authoring UI out of this phase.
- Keep package docs current for every package touched or added.
- Identify and bypass current-app complexity instead of carrying it forward:
  Better Auth, identity/admission/share/capability records, workflow records,
  saved queries/views, installed-module records, and app-owned Durable Object
  storage are not on the MVP boot path.

## Open Questions

None.

## Success Criteria

- `@dpeek/graphle-module-site` exists with package metadata, TypeScript config,
  README, package-local docs, site schema exports, and stable id-map checks.
- The MVP boot definitions contain only minimal core plus site definitions; they
  do not require workflow, identity, admission, share, capability, saved-query,
  saved-view, installed-module, icon, or SVG records.
- `@dpeek/graphle-sqlite` exposes a persisted-authority storage adapter backed
  by `graphle.sqlite`.
- A fresh temporary project seeds one home page and one example post into the
  persisted authority baseline.
- Reopening the same `graphle.sqlite` reads the seeded records through the typed
  graph client without reseeding duplicates.
- A write made through the typed site graph client can be persisted, closed,
  reopened, and read back.
- `GET /api/health` reports SQLite health and graph bootstrap or startup
  recovery status.
- `GET /` still returns placeholder HTML, and when graph state is available it
  can display the seeded home page title/body instead of hard-coded placeholder
  content.
- The phase path does not import `@dpeek/graphle-app`, `better-auth`, or
  `AUTH_DB` wiring.
- New and changed package docs describe ownership boundaries and what remains
  out of scope.
- `turbo build` passes.
- `turbo check` passes.

## Tasks

- Add `@dpeek/graphle-module-site` package metadata, TypeScript config, README,
  docs, source exports, and tests.
- Define the `site:path`, `site:status`, `site:page`, and `site:post`
  contracts with stable ids and a package-local id-map drift test.
- Add or expose an MVP minimal-core namespace and document how it differs from
  the current full `core` namespace.
- Update `@dpeek/graphle-bootstrap` so icon/SVG contracts are optional for the
  MVP boot path while preserving explicit icon seeding behavior when icon
  contracts are provided.
- Add a SQLite persisted-authority storage adapter in `@dpeek/graphle-sqlite`,
  including load, commit, persist, health, and recovery-focused tests.
- Add a local site authority composition module in `@dpeek/graphle-local` that
  combines minimal core, site definitions, SQLite storage, and seed content.
- Seed one default home page and one example post only on first durable baseline
  creation.
- Update `@dpeek/graphle-local` startup to open the site authority before
  serving requests and close it cleanly with the SQLite handle.
- Extend `/api/health` with graph startup status without widening the API
  namespace.
- Let the placeholder page read seeded home-page content when available.
- Add focused tests for minimal-core boot, site schema key stability, SQLite
  persistence across reopen, seed idempotency, local startup health, and
  placeholder rendering from graph content.
- Update package docs, `doc/index.md`, and `pdr/README.md` for the new site
  module and persisted local graph path.

## Non-Goals

- page/post editing UI
- packaged Vite or TanStack browser app
- generic web shell or UI-kit split
- markdown renderer polish
- public post routing from graph content
- Cloudflare deploy
- local/remote sync
- multi-user auth
- Better Auth migration or removal from `@dpeek/graphle-app`
- default user-project source scaffolding
- source eject flows
