Status: Proposed
Last Updated: 2026-04-15

# Phase 4: Inline site authoring and preview

## Must Read

- `./spec.md`
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
- `../../lib/graphle-web-shell/README.md`
- `../../lib/graphle-web-shell/doc/web-shell.md`
- `../../lib/graphle-web-ui/README.md`
- `../../lib/graphle-web-ui/doc/browser-primitives.md`
- `../../lib/graphle-client/src/graph.ts`

## Goal

Turn the Phase 3 shell proof into the first usable personal-site product.

After this phase, `graphle dev` should still create only:

```text
.env
graphle.sqlite
```

but the local server should render website routes from the persisted `site:`
graph, and the packaged browser app should reveal inline authoring controls on
those same routes when the request has a valid local admin session.

The user should be able to:

- view the home page at `/`
- edit the home page inline when logged in
- create and edit markdown pages
- create, edit, and publish markdown posts
- view published posts at `/posts/:slug`
- restart `graphle dev` and see the same content from `graphle.sqlite`

This phase does not deploy to Cloudflare, sync remote graphs, add remote auth,
or create a separate admin application.

## Approach

Build the smallest authoring path that proves public rendering, authenticated
editing, and durable graph writes without importing the old app stack.

### Site read and write boundary

Deepen `@dpeek/graphle-local` so it exposes site content through the existing
local site authority instead of route-local state.

Add local site helpers that can:

- list pages and posts
- resolve a public route from a request path
- create a page or post
- update page or post fields
- publish or unpublish records by changing `site:status` and `publishedAt`

Those helpers should use the typed graph client over the persisted authority.
They must not create SQLite tables for site content, keep an in-memory mirror,
or bypass the authority storage adapter.

`@dpeek/graphle-module-site` may grow browser-safe validation and routing helpers
for paths, slugs, status values, and route result types. It should still own
schema/read contracts only, not HTTP handlers or React UI.

### Local API surface

Keep `/api/*` as the only API namespace.

Add the narrow site API needed by the browser app:

- `GET /api/site/route?path=<path>` resolves the current route
- `GET /api/site/pages` lists pages for authenticated authoring
- `POST /api/site/pages` creates a page
- `PATCH /api/site/pages/:id` updates a page
- `GET /api/site/posts` lists posts for authenticated authoring
- `POST /api/site/posts` creates a post
- `PATCH /api/site/posts/:id` updates a post

Read behavior:

- unauthenticated route reads return published pages and posts only
- authenticated route reads may return drafts so local admins can preview them
- page/post list endpoints require a valid local admin session

Write behavior:

- all create/update/publish operations require a valid local admin session
- invalid input returns JSON validation errors with 400 status
- unauthenticated writes return JSON 401
- unknown `/api/*` routes keep the existing JSON 404 behavior

Do not add `/_graphle`, `/admin`, `/authoring`, or another product namespace.
Do not add page/post mutation endpoints outside `/api/*`.

### Public route rendering

Replace the Phase 3 status-only host with graph-backed website rendering.

The local server should resolve non-API routes from the graph before returning
the host document:

- `/` renders the published `site:page` with path `/`
- other page paths render by exact `site:page.path`
- `/posts/:slug` renders the published `site:post` with that slug
- draft content renders only when the request has a valid admin cookie
- missing routes return a useful 404 document while still loading the browser
  app

The HTML fallback should contain the resolved title/body/excerpt so the page is
usable before JavaScript mounts. The browser app can then hydrate into the
inline editing experience.

### Browser app

Update `@dpeek/graphle-site-web` so the first screen is the website preview, not
a status dashboard.

The browser app should:

- load the current route through `/api/site/route`
- continue loading `/api/session` and `/api/health` for shell status
- render markdown content with browser-safe primitives from
  `@dpeek/graphle-web-ui`
- show inline edit controls only when `session.authenticated` is true
- provide create/edit/publish controls without moving the user to a separate
  admin URL
- include page and post lists as shell commands, sheets, dialogs, or inline
  panels rather than a separate authoring route namespace
- preserve the generic shell boundary by registering site feature pages and
  commands from `@dpeek/graphle-site-web`

For the first editor, use a plain textarea or existing browser-safe primitive
plus markdown preview. Do not copy Monaco, query workbench, Better Auth session
context, app route composition, or installed-module UI from `@dpeek/graphle-app`.

### Content seed

Keep the current seed path small, but make it useful for authoring.

The existing seeded home page and example post may remain. If matching the
current `dpeek.com` shape needs more content, add deterministic seed records
through the local site authority seed callback, not a user-project source tree.
Do not scaffold markdown files into the user's current working directory.

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
  state for page or post records.
- Keep package docs current for every package touched.
- Websites and browser apps must be visually checked with desktop and mobile
  screenshots.
- The first screen should be the usable website preview with inline controls
  when authenticated, not a marketing page or status dashboard.

## Open Questions

None.

## Success Criteria

- `GET /` returns a graph-backed home page from `site:page.path === "/"`.
- `GET /posts/:slug` returns a graph-backed published post when one exists.
- Exact page paths render from `site:page.path`.
- Missing public routes return a useful 404 host document without widening the
  API namespace.
- Unauthenticated route reads expose only published content.
- Authenticated route reads can preview draft content.
- Local admins can create, edit, and publish a page from the browser UI.
- Local admins can create, edit, and publish a post from the browser UI.
- A published post is visible to unauthenticated visitors at `/posts/:slug`.
- Draft records are not visible to unauthenticated visitors.
- Page and post edits survive server restart because they persist through
  `graphle.sqlite`.
- `GET /api/health`, `GET /api/session`, `GET /api/init`, and unknown `/api/*`
  behavior remain compatible with Phase 3 tests.
- The browser app keeps using package-built assets served by
  `@dpeek/graphle-local`; `graphle dev` does not run Vite in the user's cwd.
- The phase path does not import `@dpeek/graphle-app`, `better-auth`, or
  `AUTH_DB` wiring.
- New and changed package docs describe ownership boundaries and what remains
  out of scope.
- Desktop and mobile browser screenshots show a nonblank site preview and
  authenticated inline authoring controls.
- `turbo build` passes.
- `turbo check` passes.

## Tasks

- Add route resolution helpers for pages and posts, including published/draft
  filtering rules and 404 results.
- Add local site authority helpers for page/post list, create, update, publish,
  and unpublish operations through the typed graph client.
- Add focused tests for local site helper validation, persistence across reopen,
  draft filtering, and published route resolution.
- Add `/api/site/route`, `/api/site/pages`, and `/api/site/posts` handlers in
  `@dpeek/graphle-local`.
- Add local-server tests for authenticated writes, unauthenticated write 401s,
  validation failures, published public reads, draft privacy, and unchanged
  unknown `/api/*` JSON 404s.
- Replace the non-API placeholder renderer with graph-backed page/post fallback
  HTML and useful 404 fallback HTML.
- Update `@dpeek/graphle-site-web` status loading so it also loads current route
  content from `/api/site/route`.
- Add the site preview surface, inline edit state, markdown textarea, markdown
  preview, save/cancel controls, and publish/unpublish controls.
- Add page and post creation flows using shell commands, dialogs, sheets, or
  inline panels without introducing an authoring route namespace.
- Add package tests for site app route rendering, editor state, validation
  display, and authenticated/visitor UI differences.
- Add browser smoke checks against `graphle dev` for desktop and mobile:
  unauthenticated public view, authenticated inline edit controls, and a
  created/published post route.
- Update package docs, `doc/index.md`, and `pdr/README.md` for the real site
  rendering and inline authoring path.

## Non-Goals

- Cloudflare deploy
- local/remote sync
- remote auth
- Better Auth migration or removal from `@dpeek/graphle-app`
- standalone admin routes or a separate authoring app
- source scaffolding, markdown files, or a user-project Vite app in the cwd
- rich markdown editor behavior beyond basic edit and preview
- media uploads
- comments, tags, search, RSS, sitemap, or analytics
- collaborative editing or multi-user identity
- granular SQLite site-content tables outside the authority storage adapter
