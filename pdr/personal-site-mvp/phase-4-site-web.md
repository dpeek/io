Status: Implemented
Last Updated: 2026-04-16

# Phase 4: Inline site authoring and preview

## Must Read

- `./spec.md`
- `./site-item-prd.md`
- `./phase-1-local-dev.md`
- `./phase-2-site-graph.md`
- `./phase-3-shell.md`
- `../../AGENTS.md`
- `../../package.json`
- `../../turbo.json`
- `../../doc/index.md`
- `../../lib/graphle-local/README.md`
- `../../lib/graphle-local/doc/local-dev.md`
- `../../lib/graphle-local/src/server.ts`
- `../../lib/graphle-local/src/site-authority.ts`
- `../../lib/graphle-site-web/README.md`
- `../../lib/graphle-site-web/doc/site-web.md`
- `../../lib/graphle-site-web/src/site-app.tsx`
- `../../lib/graphle-site-web/src/site-feature.tsx`
- `../../lib/graphle-site-web/src/status.ts`
- `../../lib/graphle-module-site/README.md`
- `../../lib/graphle-module-site/doc/site-schema.md`
- `../../lib/graphle-module-site/src/index.ts`
- `../../lib/graphle-module-core/doc/core-namespace.md`
- `../../lib/graphle-module-core/src/core/tag.ts`
- `../../lib/graphle-module-core/src/core/minimal.ts`
- `../../lib/graphle-web-shell/README.md`
- `../../lib/graphle-web-shell/doc/web-shell.md`
- `../../lib/graphle-web-ui/README.md`
- `../../lib/graphle-web-ui/doc/browser-primitives.md`
- `../../lib/graphle-client/src/graph.ts`

## Goal

Turn the Phase 3 shell proof into the first usable personal-site product using
the flat `site:item` model from `./site-item-prd.md`.

After this phase, `graphle dev` should still create only:

```text
.env
graphle.sqlite
```

but the local server should render website routes from persisted `site:item`
records, and the packaged browser app should reveal inline authoring controls
when the request has a valid local admin session.

The user should be able to:

- view the home item at `/`
- edit the home item inline when logged in
- create and edit one unified item type
- give an item a path, URL, markdown body, tags, icon, and private/public
  visibility
- create URL-only links and bookmarks that appear in the item sidebar but do
  not get internal pages
- create path-backed notes, pages, and posts without a stored kind
- preview private routed items locally when logged in
- restart `graphle dev` and see the same items from `graphle.sqlite`

This phase does not deploy to Cloudflare, sync remote graphs, add remote auth,
add tag routes, scrape link previews, or create a separate admin application.

## Approach

Build one item authoring path that proves public rendering, authenticated
editing, local search, tag references, and durable graph writes without
importing the old app stack.

### Site schema boundary

Update `@dpeek/graphle-module-site` so the MVP schema is `site:item`.

Remove the page/post/status split from the MVP path:

- no `site:page`
- no `site:post`
- no `site:status`
- no stored item `kind`

Add the item fields from the PRD:

- title
- optional path
- optional absolute URL
- optional markdown body
- visibility: private or public
- optional named icon preset
- tags: many references to `core:tag`
- optional sort order
- created-at timestamp
- updated-at timestamp

`@dpeek/graphle-module-site` should own item validation and browser-safe
helpers for paths, URLs, visibility, icon presets, route parsing, and item sort
ordering. It should still own schema/read contracts only, not HTTP handlers,
React UI, SQLite, deploy, or sync.

Use `core:tag`. Do not create `site:tag`. The current minimal core boot path
does not include `core:tag`, so this phase should widen the local site boot set
just enough to support tags and the scalar fields tags need. Do not pull in
saved queries, workflow, identity, admission, share, capability, or
installed-module records.

### Site read and write boundary

Deepen `@dpeek/graphle-local` so it exposes items through the persisted local
site authority instead of route-local state.

Add local site helpers that can:

- list items for the local admin
- list public items for public route/sidebar rendering
- search and sort item summaries using the PRD ordering rules
- resolve a public route by exact item path
- create an item
- update item fields
- change visibility between private and public
- create or reuse `core:tag` records from inline tag creation

Those helpers should use the typed graph client over the persisted authority.
They must not create SQLite tables for item content, keep an in-memory content
mirror, or bypass the authority storage adapter.

Validation rules:

- title is required
- path is optional, but unique when present
- URL is optional, but must be absolute when present
- a public item should have at least path, URL, or body
- URL-only items do not get internal pages
- private items are hidden from unauthenticated public route reads

### Local API surface

Keep `/api/*` as the only API namespace.

Add the narrow site API needed by the browser app:

- `GET /api/site/route?path=<path>` resolves the current route and returns the
  public sidebar/list data visible to that request
- `GET /api/site/items` lists all items for authenticated authoring
- `POST /api/site/items` creates an item
- `PATCH /api/site/items/:id` updates an item

Read behavior:

- unauthenticated route reads return public routed items and public sidebar
  items only
- authenticated route reads may return private routed items for local preview
- `GET /api/site/items` requires a valid local admin session because it returns
  private items

Write behavior:

- all create/update/visibility operations require a valid local admin session
- invalid input returns JSON validation errors with 400 status
- unauthenticated writes return JSON 401
- unknown `/api/*` routes keep the existing JSON 404 behavior

Do not add `/_graphle`, `/admin`, `/authoring`, `/posts` as a special API
surface, or another product namespace.

### Public route rendering

Replace the Phase 3 status-only host with graph-backed website rendering.

The local server should resolve non-API routes from `site:item` before
returning the host document:

- `/` renders the public item with path `/`
- any other path renders by exact `site:item.path`
- URL-only items appear in sidebar/list data but do not resolve as pages
- private routed items render only when the request has a valid admin cookie
- missing routes return a useful 404 document while still loading the browser
  app

The HTML fallback should contain the resolved title, body, outbound URL, tags,
and public sidebar/list summaries so the page is useful before JavaScript
mounts. The browser app can then hydrate into the inline editing experience.

### Browser app

Update `@dpeek/graphle-site-web` so the first screen is the website preview
with a flat searchable item sidebar.

The browser app should:

- load the current route through `/api/site/route`
- continue loading `/api/session` and `/api/health` for shell status
- load `/api/site/items` only when the local admin session is authenticated
- render markdown content with browser-safe primitives from
  `@dpeek/graphle-web-ui`
- show inline edit controls only when `session.authenticated` is true
- provide one editor for every item
- support creation presets as UI-only defaults for page, post, link, bookmark,
  and social link
- search all visible items by title, path, URL host/path, body text, tag key,
  and tag name
- keep the sidebar flat for the MVP
- show compact private/public indicators
- let URL-only items open their external URL instead of navigating to a local
  route
- preserve the generic shell boundary by registering site feature pages and
  commands from `@dpeek/graphle-site-web`

For the first editor, use existing browser-safe primitives: inputs, textareas,
native selects or comboboxes, and checkboxes/toggles. Do not copy Monaco, query
workbench, Better Auth session context, app route composition, or
installed-module UI from `@dpeek/graphle-app`.

### Content seed

Keep the seed path small, but make it useful for authoring.

Seed deterministic item records through the local site authority seed callback:

- a public home item at `/`
- at least one path-backed markdown item
- at least one public URL-only item
- at least one private bookmark item
- at least one tagged item

Do not scaffold markdown files, source files, or a user-project Vite app into
the user's current working directory.

### Current-app complexity to bypass

Do not carry forward:

- `@dpeek/graphle-app` route composition
- Better Auth session providers
- app-owned graph runtime bootstrap
- query editor, saved-query, or saved-view surfaces
- workflow UI
- installed-module lifecycle UI
- Worker/Durable Object deploy wiring

This phase should make the MVP site path real without making it depend on the
current app proof.

## Rules

- Run `turbo build` before edits and `turbo check` after edits.
- Treat `./site-item-prd.md` as the product source of truth.
- Do not import or boot `@dpeek/graphle-app`.
- Do not use Better Auth.
- Do not apply or create `AUTH_DB` migrations.
- Keep default local project state to `.env` and `graphle.sqlite`.
- Do not run Vite in the user's cwd.
- Do not scaffold source files in the user's cwd.
- Reserve `/api/*` as the only API namespace.
- Do not introduce `/_graphle`, `/_graphle/api/*`, `/admin`, `/authoring`, or
  another product namespace.
- Keep authoring inline on site routes when an admin session is present.
- Keep browser UI primitives in `@dpeek/graphle-web-ui`.
- Keep shell runtime and feature composition in `@dpeek/graphle-web-shell`.
- Keep site schema in `@dpeek/graphle-module-site` and site browser assembly in
  `@dpeek/graphle-site-web`.
- Keep local API route ownership in `@dpeek/graphle-local`.
- Keep Cloudflare deploy code out of this phase.
- Keep SQLite storage as an authority storage adapter; do not add route-local
  state for item records.
- Do not add separate page, post, bookmark, social-link, or tag record types in
  the site module.
- Do not add stored item kind.
- Do not add draft/published status.
- Keep tags backed by `core:tag`.
- Keep package docs current for every package touched.
- Websites and browser apps must be visually checked with desktop and mobile
  screenshots.
- The first screen should be the usable website preview with a flat item
  sidebar, not a marketing page or status dashboard.

## Open Questions

None.

## Follow-Up Notes

The layout UX follow-up in [`./site-layout-ux.md`](./site-layout-ux.md) replaced
the Phase 4 three-column authoring preview with the minimalist site frame:

- the product path now renders one left item sidebar and centered route content
  without Graphle shell status chrome
- creation presets were removed in favor of one blank-create `+` action
- URL-only edit state is client-side authenticated authoring state, not a
  public permalink
- item delete and batch reorder APIs were added under `/api/site/*`
- manual ordering now normalizes visible sidebar items to consecutive
  `site:item.sortOrder` values
- theme selection is local browser state applied through existing
  `light`/`dark` CSS token classes

## Success Criteria

- The MVP site schema uses `site:item` for all site content.
- The MVP site schema does not expose `site:page`, `site:post`, `site:status`,
  or stored item `kind`.
- `core:tag` is available to the local site boot path without pulling in
  non-MVP core records.
- `GET /` returns a graph-backed home item from `site:item.path === "/"`.
- Exact item paths render from `site:item.path`.
- URL-only items appear in the sidebar/list but do not get internal pages.
- An item with both path and URL renders an internal page with an outbound
  link.
- Missing public routes return a useful 404 host document without widening the
  API namespace.
- Unauthenticated route reads expose only public items.
- Authenticated route reads can preview private routed items.
- Local admins can create, edit, tag, pin, sort, and make an item public or
  private from the browser UI.
- Local admins can create a URL-only private bookmark.
- Local admins can create a public URL-only link and open it from the sidebar.
- Private items are not visible to unauthenticated visitors.
- Item edits survive server restart because they persist through
  `graphle.sqlite`.
- `GET /api/health`, `GET /api/session`, `GET /api/init`, and unknown `/api/*`
  behavior remain compatible with Phase 3 tests.
- The browser app keeps using package-built assets served by
  `@dpeek/graphle-local`; `graphle dev` does not run Vite in the user's cwd.
- The phase path does not import `@dpeek/graphle-app`, `better-auth`, or
  `AUTH_DB` wiring.
- New and changed package docs describe ownership boundaries and what remains
  out of scope.
- Desktop and mobile browser screenshots show a nonblank site preview,
  searchable item sidebar, and authenticated inline item editor.
- `turbo build` passes.
- `turbo check` passes.

## Tasks

- Replace the page/post/status site schema with `site:item`,
  `site:visibility`, named icon presets, tag references, and item timestamps.
- Update the site module stable id map and package tests for intentional schema
  key changes.
- Add browser-safe site helpers for path validation, URL validation, visibility
  parsing, icon preset parsing, item route parsing, item search matching, and
  item sort ordering.
- Widen the minimal local site boot path to include `core:tag` and required
  scalar support without importing non-MVP core records.
- Add local site authority helpers for item list, public item list, search,
  route resolution, create, update, visibility changes, and inline tag
  creation through the typed graph client.
- Add focused tests for item helper validation, path uniqueness, persistence
  across reopen, private/public filtering, URL-only item behavior, tag
  references, and exact route resolution.
- Add `/api/site/route`, `/api/site/items`, and `/api/site/items/:id` handlers
  in `@dpeek/graphle-local`.
- Add local-server tests for authenticated writes, unauthenticated write 401s,
  validation failures, public reads, private privacy, URL-only links, tag
  creation, and unchanged unknown `/api/*` JSON 404s.
- Replace the non-API placeholder renderer with graph-backed item fallback HTML
  and useful 404 fallback HTML.
- Update `@dpeek/graphle-site-web` status loading so it also loads current
  route content and visible sidebar/list data from `/api/site/route`.
- Load `/api/site/items` for authenticated authoring.
- Add the site preview surface, searchable item sidebar, item editor state,
  markdown editor, save/cancel controls, visibility controls, tag controls, and
  icon preset controls.
- Add UI-only creation presets for page, post, link, bookmark, and social link
  without persisting kind.
- Add package tests for item route rendering, sidebar search, editor state,
  validation display, URL-only item selection, private/public visibility, and
  authenticated/visitor UI differences.
- Add browser smoke checks against `graphle dev` for desktop and mobile:
  unauthenticated public view, authenticated item editor, private item preview,
  URL-only public link, and searchable sidebar.
- Update package docs, `doc/index.md`, and `pdr/README.md` for item-based site
  rendering and inline authoring.

## Non-Goals

- Cloudflare deploy
- local/remote sync
- remote auth
- Better Auth migration or removal from `@dpeek/graphle-app`
- standalone admin routes or a separate authoring app
- source scaffolding, markdown files, or a user-project Vite app in the cwd
- rich markdown editor behavior beyond basic edit and preview
- tag landing pages
- custom icon upload or arbitrary SVG icons
- automatic link preview scraping
- folders, nested navigation, collections, or multiple sidebars
- media uploads
- comments, RSS, sitemap, full-text indexing, analytics, forms, or newsletter
  capture
- collaborative editing or multi-user identity
- granular SQLite site-content tables outside the authority storage adapter
