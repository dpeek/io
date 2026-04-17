Status: Proposed
Last Updated: 2026-04-17

# 03: Site-web migration and deletion

## Must Read

- `./spec.md`
- `./01-generic-local-graph-transport.md`
- `./02-productize-entity-surfaces.md`
- `../spec.md`
- `../phase-4-site-web.md`
- `../site-layout-ux.md`
- `../site-item-prd.md`
- `../../../AGENTS.md`
- `../../../lib/graphle-module-site/README.md`
- `../../../lib/graphle-module-site/doc/site-schema.md`
- `../../../lib/graphle-module-site/src/index.ts`
- `../../../lib/graphle-local/README.md`
- `../../../lib/graphle-local/doc/local-dev.md`
- `../../../lib/graphle-local/src/server.ts`
- `../../../lib/graphle-local/src/server.test.ts`
- `../../../lib/graphle-local/src/site-authority.ts`
- `../../../lib/graphle-site-web/README.md`
- `../../../lib/graphle-site-web/doc/site-web.md`
- `../../../lib/graphle-site-web/src/site-app.tsx`
- `../../../lib/graphle-site-web/src/site-feature.tsx`
- `../../../lib/graphle-site-web/src/status.ts`
- `../../../lib/graphle-site-web/src/main.tsx`
- `../../../lib/graphle-client/src/http.ts`
- `../../../lib/graphle-react/src/runtime.tsx`
- `../../../lib/graphle-surface/doc/react-dom.md`
- `../../../lib/graphle-surface/src/react-dom/index.ts`
- `../../../lib/graphle-module-core/doc/react-dom.md`
- `../../../lib/graphle-module-core/src/react-dom/resolver.tsx`

## Goal

Migrate the personal-site browser app from custom site DTO authoring to generic
graph transport and shared entity surfaces, then delete the duplicate
implementation.

After this PDR, `@dpeek/graphle-site-web` should be a thin product assembly:

- bootstrap the site graph runtime
- choose the active `site:item`
- render the public site frame and sidebar
- mount shared entity view/edit/create surfaces for admin authoring
- keep product-specific route, visibility, search, and ordering behavior

It should not own a custom content CRUD client, a custom `site:item` field
editor switch, or custom JSON write DTOs.

## Approach

### Add authored `site:item` surface metadata

Add a `RecordSurfaceSpec` for `site:item` in `@dpeek/graphle-module-site`.

The site module should own the authored structure for the item editor:

- title field: `title`
- primary body fields: `excerpt`, `body`, `url`, `tags`
- route/publishing fields: `path`, `visibility`, `publishedAt`
- sidebar fields: `icon`, `pinned`, `sortOrder`
- metadata fields: `createdAt`, `updatedAt`

Use existing surface contracts from `@dpeek/graphle-module`; do not define a
site-specific surface model.

Expose the surface through the site manifest runtime metadata so a host can add
the site module and discover the item surface alongside the schema.

### Bootstrap the site graph in the browser

Use the generic graph transport from `01-generic-local-graph-transport.md`.

`@dpeek/graphle-site-web` should create a browser graph client with
`createHttpGraphClient(...)` against the local endpoints:

- sync path: `/api/sync`
- transaction path: `/api/tx`

The browser namespace should be assembled from the same modules used by the
local site authority:

- `site`
- `core:tag`
- the minimal core definitions and scalar definitions needed by `site:item`

Wrap the browser app with the runtime providers from `@dpeek/graphle-react` so
shared field controls can read predicate refs, write graph transactions, and
flush mutations through the generic sync controller.

Keep `/api/health` and `/api/session` as host/runtime status APIs. They are not
content authoring APIs.

### Replace DTO-backed site state

Remove the authoring dependency on `@dpeek/graphle-site-web/src/status.ts`
content DTOs:

- `GraphleSiteItem`
- `GraphleSiteTag`
- `GraphleSiteItemInput`
- `GraphleSiteItemOrderInput`
- custom site item fetch/update/delete helpers

If `status.ts` remains, narrow it to host status only:

- health
- session
- maybe public route bootstrap state if still needed for unauthenticated public
  hydration

Admin authoring state should come from the graph client store and typed refs,
not from `/api/site/items`.

Site-specific selectors may remain in `site-web` or `module-site` when they are
pure graph reads:

- list all `site:item` ids for admin
- list public items for public navigation
- resolve an item by exact `path`
- identify URL-only items
- apply `compareSiteItems(...)`
- search items with `siteItemMatchesSearch(...)`

Those selectors should operate over graph refs or graph snapshots. They should
not introduce another DTO write layer.

### Replace the custom editor with shared entity surfaces

Delete the bespoke `site:item` editor path in `site-feature.tsx`:

- custom `SiteItemFieldKey`
- custom row role planner
- `DraftControl` switch by field key
- comma-separated tag input
- native select/textarea/date/url duplication when shared predicate controls
  can render the field

Use the productized entity surface from
`@dpeek/graphle-surface/react-dom` instead.

Expected behavior:

- `body` uses the shared markdown editor/view path
- `tags` uses the shared entity-reference/tag editor/view path
- `path`, `url`, `excerpt`, and `title` use shared text/url controls
- `visibility` uses the shared enum/select control
- `pinned` uses the shared boolean control
- `sortOrder` uses the shared number control
- `publishedAt`, `createdAt`, and `updatedAt` use shared date view/control
  behavior according to writability

Site-specific chrome may remain in `site-web`: the sidebar, route preview,
edit toggle placement, item actions, dark mode, and public document frame.

### Move writes to graph transactions

Replace content writes with typed graph mutations:

- create item
- update item predicates
- reorder items by updating `sortOrder`
- delete item
- create or reuse tags through the reference/tag field path

Writes must flush through the graph client sync controller and `/api/tx`.

The old `/api/site/items` write handlers should be deleted once the browser no
longer calls them. Keep route rendering helpers that read from the authority for
server-side public HTML. Do not keep custom REST writes for compatibility.

### Keep public route rendering product-specific

The website route contract remains product-specific:

- `/` renders the public item at path `/`
- exact public paths render matching public items
- private routed items render only for local admins
- URL-only items appear in public lists without getting routes

This logic may stay in `@dpeek/graphle-local` and/or
`@dpeek/graphle-module-site` as graph read helpers. It should not depend on the
custom browser authoring DTO API.

For unauthenticated browser hydration, prefer one of these approaches:

- embed the server-resolved public route payload in the host document, or
- keep a read-only public route projection endpoint that is explicitly not used
  for authoring

Do not use `/api/site/route` as the admin content model if the graph runtime is
available.

## Rules

- Run `turbo build` before edits and `turbo check` after edits unless the
  current execution explicitly defers checks.
- Do not import `@dpeek/graphle-app`.
- Do not use custom JSON content writes for `site:item`.
- Do not add product-specific field controls when the shared predicate resolver
  can render the field.
- Do not invent a new site-specific surface contract.
- Keep `RecordSurfaceSpec` as the authored surface metadata.
- Keep field widgets in `@dpeek/graphle-module-core/react-dom`.
- Keep entity surface composition in `@dpeek/graphle-surface/react-dom`.
- Keep shell composition in `@dpeek/graphle-web-shell`.
- Keep site route, visibility, ordering, and public navigation behavior
  product-specific.
- Keep public route rendering available without admin auth.
- Keep package docs current.
- Backwards compatibility with the Phase 4 DTO API is not required.

## Open Questions

None.

## Success Criteria

- `@dpeek/graphle-module-site` exposes authored `site:item`
  `RecordSurfaceSpec` metadata.
- `@dpeek/graphle-site-web` bootstraps a graph client through `/api/sync` and
  `/api/tx` for authenticated authoring.
- `@dpeek/graphle-site-web` renders the selected item editor through the shared
  entity surface.
- `site-feature.tsx` no longer has a field-key switch that maps `site:item`
  predicates to custom controls.
- Markdown, tags, dates, URLs, booleans, numbers, enum/selects, and text fields
  render through shared predicate controls.
- Site content create, update, reorder, delete, and tag changes write through
  graph transactions.
- Browser authoring no longer calls `/api/site/items`,
  `/api/site/items/order`, or `/api/site/items/:id`.
- Obsolete site content DTO types and fetch helpers are deleted.
- Local server custom site content write endpoints are deleted after the browser
  migration.
- Public server-rendered route fallback still works for public visitors.
- Authenticated local admins can still preview private routed items.
- URL-only public items still appear in the sidebar/list and open externally.
- Item edits survive server restart through `graphle.sqlite`.
- The MVP product path still does not import `@dpeek/graphle-app`.
- Relevant package docs describe graph transport and shared entity-surface
  ownership.
- Desktop and mobile browser checks show a nonblank public route, sidebar, and
  authenticated editor after implementation.
- `turbo build` passes.
- `turbo check` passes.

## Tasks

- Add `site:item` record surface metadata to `@dpeek/graphle-module-site`.
- Export the site item surface through the site module manifest runtime
  metadata.
- Add tests for the site item surface structure and exported manifest metadata.
- Add a browser graph runtime bootstrap in `@dpeek/graphle-site-web` using
  `createHttpGraphClient(...)`.
- Wrap the site app in the relevant `@dpeek/graphle-react` runtime and mutation
  providers.
- Replace DTO-backed item loading with graph-backed item selectors.
- Replace DTO-backed route selection for admin authoring with graph-backed item
  refs.
- Preserve public route fallback rendering from local graph reads.
- Replace the custom item editor in `site-feature.tsx` with the shared entity
  surface from `@dpeek/graphle-surface/react-dom`.
- Replace create/update/reorder/delete calls with typed graph mutations and
  sync flushes.
- Verify tag creation and reference editing through the shared
  entity-reference/tag field path.
- Delete obsolete content DTO types and fetch helpers from `status.ts`.
- Delete browser calls to `/api/site/items`, `/api/site/items/order`, and
  `/api/site/items/:id`.
- Delete local server write routes for custom site content after browser calls
  are removed.
- Keep or replace `/api/site/route` only as a public read projection; document
  whichever route is chosen.
- Update `@dpeek/graphle-site-web` docs to explain that authoring uses graph
  transport and shared entity surfaces.
- Update `@dpeek/graphle-local` docs to remove the custom content write API.
- Update tests that previously asserted custom DTO write routes.
- Add tests that prove graph-backed browser authoring behavior through local
  graph transport.
- Run focused browser checks for public route rendering, private admin preview,
  shared editor rendering, and mobile sidebar/editor layout.

## Non-Goals

- Do not build Cloudflare deploy in this PDR.
- Do not build local/remote sync in this PDR beyond local authoring flushes.
- Do not add public full-graph sync for unauthenticated visitors.
- Do not add Better Auth.
- Do not add workflow, saved-query, installed-module, admission, share, or
  capability records to the MVP boot path.
- Do not create a separate admin app or route namespace.
- Do not preserve custom site DTO write APIs for compatibility.
- Do not redesign the public site layout beyond what is required to mount the
  shared editor cleanly.
