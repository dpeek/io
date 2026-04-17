Status: Implemented
Last Updated: 2026-04-17

# 01: Generic local graph transport

## Must Read

- `./spec.md`
- `../spec.md`
- `../phase-4-site-web.md`
- `../../../AGENTS.md`
- `../../../lib/graphle-local/README.md`
- `../../../lib/graphle-local/doc/local-dev.md`
- `../../../lib/graphle-local/src/server.ts`
- `../../../lib/graphle-local/src/server.test.ts`
- `../../../lib/graphle-local/src/site-authority.ts`
- `../../../lib/graphle-local/package.json`
- `../../../lib/graphle-client/src/http.ts`
- `../../../lib/graphle-client/src/http-sync-request.ts`
- `../../../lib/graphle-client/src/sync.ts`
- `../../../lib/graphle-authority/src/persisted-authority.ts`
- `../../../lib/graphle-sqlite/src/index.ts`
- `../../../lib/graphle-site-web/src/status.ts`
- `../../../lib/graphle-module-site/src/index.ts`
- `../../../lib/graphle-module-core/src/core/minimal.ts`
- `../../../lib/graphle-module-core/src/core/tag.ts`

## Goal

Expose the existing persisted local authority through the generic graph HTTP
transport expected by `createHttpGraphClient`.

After this PDR, the packaged browser app should have an authenticated graph
transport available at the standard endpoints:

```text
GET  /api/sync
POST /api/tx
```

The goal is not to migrate the whole site editor yet. The goal is to make the
correct substrate available and tested so later PDRs can delete the custom site
DTO authoring path.

## Approach

### Widen the local authority contract

`openLocalSiteAuthority(...)` already returns the shared persisted authority
created by `createGraphleSqlitePersistedAuthoritativeGraph(...)`, but
`LocalSiteAuthority` narrows that return value to custom `graph.item`,
`graph.tag`, and `persist()` helpers.

Replace the hand-written narrowed interface with a type that preserves the
generic persisted-authority surface:

- `store`
- `graph`
- `startupDiagnostics`
- `createTotalSyncPayload(...)`
- `getIncrementalSyncResult(...)`
- `applyTransaction(...)`
- `persist()`

The existing site route helpers may keep accepting `LocalSiteAuthority`, but
that type should no longer hide the generic graph authority methods.

If a direct type import is needed, add an explicit
`@dpeek/graphle-authority` dependency to `@dpeek/graphle-local`; do not rely on
transitive package types through `@dpeek/graphle-sqlite`.

### Add local graph HTTP handlers

Add local server handling before the unknown `/api/*` fallback:

- `GET /api/sync`
- `POST /api/tx`

Both endpoints require a valid local admin session for this reset. The local MVP
does not yet have a public graph read policy, so unauthenticated users should
continue using public route rendering and `/api/site/route`.

Endpoint behavior:

- unauthenticated requests return JSON `401` with `code: "auth.required"`
- unavailable site authority returns JSON `503`
- wrong methods return `405` with the correct `allow` header
- sync responses use `readHttpSyncRequest(...)`
- sync without `after` returns `siteAuthority.createTotalSyncPayload(...)`
- sync with `after` returns `siteAuthority.getIncrementalSyncResult(...)`
- transactions parse a `GraphWriteTransaction` JSON body
- transactions call `siteAuthority.applyTransaction(transaction)`
- malformed JSON returns `400`
- graph validation errors return `400` with useful validation detail
- all graph transport responses use `cache-control: no-store`

Do not copy the app authorization-context protocol from
`@dpeek/graphle-app`. The local admin cookie is the authorization boundary for
this MVP path.

### Prove the browser client path

Add a small browser-safe graph client seam for the site app without mounting it
into the production UI yet.

The site browser package should be able to assemble the local site graph
namespace from existing module packages:

- `site` from `@dpeek/graphle-module-site`
- `tag`, minimal core definitions, and required scalar definitions from
  `@dpeek/graphle-module-core`

Then prove `createHttpGraphClient(...)` can:

- sync the seeded local site graph through `/api/sync`
- push a graph transaction through `/api/tx`
- observe the accepted write after a follow-up sync

This can be tested in `@dpeek/graphle-local` with a local server fetch wrapper
that adds the admin cookie. The first implementation does not need to replace
`@dpeek/graphle-site-web/src/status.ts` yet; that deletion belongs to
`03-site-web-migration-and-deletion.md`.

### Keep legacy site DTO APIs temporarily

Keep the current custom site endpoints during this PDR:

- `GET /api/site/route`
- `GET /api/site/items`
- `POST /api/site/items`
- `PATCH /api/site/items/:id`
- `PATCH /api/site/items/order`
- `DELETE /api/site/items/:id`

They remain only so the current Phase 4 UI and route tests keep passing while
the generic graph transport is introduced. Do not add new custom content DTO
routes. The deletion happens after `site-web` migrates to graph transport and
shared entity surfaces.

## Rules

- Run `turbo build` before edits and `turbo check` after edits.
- Do not import or boot `@dpeek/graphle-app`.
- Do not copy the app auth-context header or capability-policy stack.
- Do not add Better Auth.
- Do not add a new REST content API.
- Keep `/api/sync` and `/api/tx` as the graph transport endpoints expected by
  `@dpeek/graphle-client`.
- Keep public website rendering available without admin auth.
- Require local admin auth for full-graph sync and transactions.
- Keep existing site DTO routes working until the site browser migration PDR
  deletes them.
- Keep package docs current.

## Open Questions

None.

## Success Criteria

- `GET /api/sync` without a local admin cookie returns `401`.
- `POST /api/tx` without a local admin cookie returns `401`.
- `GET /api/sync` with a local admin cookie returns a total sync payload for
  the local site graph.
- `GET /api/sync?after=<cursor>` with a local admin cookie returns incremental
  sync output or the existing retained-history reset fallback.
- `POST /api/tx` with a local admin cookie accepts a valid
  `GraphWriteTransaction` and durably commits it through the persisted local
  authority.
- Invalid transaction JSON returns `400`.
- Graph validation failures return `400` with useful validation details.
- A test using `createHttpGraphClient(...)` can sync seeded `site:item` records
  from the local server.
- A test using `createHttpGraphClient(...)` can write a `site:item` change
  through `/api/tx` and observe the change after sync.
- Existing `/api/health`, `/api/session`, `/api/init`, public route rendering,
  and legacy `/api/site/*` tests still pass.
- `@dpeek/graphle-local` docs explain that content authoring is moving to
  generic graph transport and legacy site DTO APIs are transitional.
- `turbo build` passes.
- `turbo check` passes.

## Tasks

- Update `LocalSiteAuthority` in `@dpeek/graphle-local` so it exposes the
  shared persisted-authority methods instead of hiding them behind a narrowed
  interface.
- Add any explicit package dependencies needed for the widened local authority
  type and graph transport helpers.
- Add authenticated `/api/sync` handling in `createGraphleLocalServer(...)`.
- Add authenticated `/api/tx` handling in `createGraphleLocalServer(...)`.
- Add focused response helpers for sync/transaction parse, auth, unavailable
  authority, and graph validation errors.
- Add local server tests for unauthenticated graph transport rejection.
- Add local server tests for authenticated total sync and incremental sync.
- Add a local server test that uses `createHttpGraphClient(...)` against the
  in-memory server fetch wrapper.
- Add a local server test that commits a graph transaction through `/api/tx` and
  verifies durability through the existing route read path after authority
  reopen.
- Add or update docs in `@dpeek/graphle-local` describing `/api/sync` and
  `/api/tx` as the authoring substrate.
- Do not delete existing `/api/site/*` route handlers in this PDR; add comments
  or docs marking them transitional if helpful.

## Non-Goals

- Do not migrate the visible site editor in this PDR.
- Do not delete `@dpeek/graphle-site-web/src/status.ts` yet.
- Do not delete `/api/site/*` content endpoints yet.
- Do not add public graph read scopes.
- Do not add remote sync behavior.
- Do not add deploy behavior.
- Do not create a separate admin app.
- Do not introduce a new graph transport protocol.
