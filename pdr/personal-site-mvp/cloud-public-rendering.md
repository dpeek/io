Status: Proposed
Last Updated: 2026-04-18

# Cloud public rendering

## Must Read

- `./spec.md`
- `./site-item-prd.md`
- `./public-graph-projection.md`
- `./phase-5-cloudflare-deploy.md`
- `../../AGENTS.md`
- `../../lib/graphle-local/README.md`
- `../../lib/graphle-local/src/server.ts`
- `../../lib/graphle-local/src/site-authority.ts`
- `../../lib/graphle-site-web/README.md`
- `../../lib/graphle-site-web/doc/site-web.md`
- `../../lib/graphle-site-web/src/site-feature.tsx`
- `../../lib/graphle-module-site/README.md`
- `../../lib/graphle-module-site/doc/site-schema.md`
- `../../lib/graphle-module-site/src/index.ts`
- `../../lib/graphle-projection/README.md`
- `../../lib/graphle-projection/doc/projections-and-retained-state.md`
- `../../lib/graphle-projection/src/index.ts`
- `../../lib/graphle-surface/README.md`
- `../../lib/graphle-surface/doc/react-dom.md`
- `../../lib/graphle-authority/doc/persistence.md`
- `../../lib/graphle-authority/src/persisted-authority.ts`
- `../../lib/graphle-app/wrangler.jsonc`
- `../../lib/graphle-app/src/web/lib/branch3-registrations.ts`
- `../../lib/graphle-app/src/web/lib/authority.ts`
- `../../lib/graphle-app/src/web/lib/graph-authority-sql-workflow-projection.ts`
- `../../lib/graphle-app/src/web/worker/index.ts`

## Goal

Serve deployed public `site:item` routes from a public graph baseline on
Cloudflare, using server rendering and CDN caching.

After this PDR, the Cloudflare Worker should render the same public website
shape as local public rendering:

```text
remote public graph runtime -> route item ref -> siteItemViewSurface -> HTML
```

The Worker should be a public-site runtime. It should not be a hosted copy of
the Graphle app, and it should not expose local admin authoring behavior.

## Approach

### Build on the public graph projection

This PDR depends on `./public-graph-projection.md`.

Deploy should upload the sanitized public graph baseline, not route DTOs and
not the full local graph. The remote runtime should persist that baseline and
create a read-only public graph runtime from it when serving requests.

The baseline should carry the projection metadata defined by
`@dpeek/graphle-projection`: `projectionId`, `definitionHash`, and source
cursor, plus a public baseline hash for cache keys or publish verification. Do
not introduce a Worker-only baseline version that bypasses projection
compatibility. If the Worker sees an unknown projection id or incompatible
definition hash, it should reject or replace the baseline rather than trying to
reinterpret it.

The baseline contains:

- public `site:item` records
- `core:tag` records referenced by public items
- required bootstrap/schema facts for the public graph runtime

The baseline does not contain:

- private `site:item` records
- private-only `core:tag` records
- local admin/session data
- Cloudflare API tokens
- local deploy form state

### Server-render public routes in the Worker

The Worker should handle non-API requests by reading the remote public graph and
rendering HTML on the server.

Request flow:

```text
GET /notes/example
  -> Worker
  -> read public graph baseline
  -> create public site graph runtime
  -> resolve exact site:item.path
  -> render siteItemViewSurface
  -> return HTML with cache headers
```

The renderer should be shared with local public rendering where possible. The
Cloudflare package can own the Worker wrapper and persistence, but it should not
fork the route rendering rules.

Use the formalized projection provider/recovery host from
`./public-graph-projection.md` for baseline validation and replacement. The app
Worker retained-projection code is reference material for that host shape, not a
package dependency for the public site Worker.

### Cache rendered pages at the CDN

Use Cloudflare's edge cache for public HTML.

Initial cache policy:

- hashed static assets: long immutable cache
- public item routes: CDN cache with a deploy/sync-controlled version or purge
- missing routes: short CDN cache
- API routes: no-store unless explicitly documented otherwise

There are two acceptable invalidation strategies for the MVP:

- purge the known public paths after a deploy or sync publish, or
- include a public baseline hash/version in the cache key

Path purge is simpler and probably enough for the first deployed personal site.
The public graph contains the list of path-backed items, so deploy can know
which paths to purge. If later sync becomes frequent, move to versioned cache
keys or Cloudflare cache tags.

When using versioned cache keys, derive the version from the public baseline
metadata, for example the baseline hash. Keep `definitionHash` for
compatibility, not cache freshness.

### Keep APIs narrow

The remote Worker should expose only the public and deploy-time APIs it needs:

- public website routes
- `GET /api/health` for deploy verification
- a protected baseline replacement endpoint, or an equivalent Cloudflare
  API-mediated upload path
- JSON 404 for unknown `/api/*`

It should not expose:

- public full-graph sync
- public graph transactions
- local admin auth
- remote authoring
- Better Auth
- app query/workflow routes

### Choose one HTML shape

The Worker should return complete HTML documents for public routes. The first
version does not need client hydration to prove deploy. It can still include the
packaged site assets if we want theme behavior, sidebar navigation, or later
client-side navigation.

Recommended first version:

- server-render the sidebar and active route content
- include static CSS/assets needed for the public frame
- use normal links for path-backed items
- use external links for URL-only items
- do not depend on client-side route DTO loading

Then, if client navigation is worth it, add a route-scoped or full public graph
bootstrap script later. That should hydrate from graph data, not DTOs.

### Keep the Worker runtime small

Phase 5 already calls out the app Worker as reference material only. Keep that
rule.

The remote public Worker should boot only:

- minimal core
- `core:color`
- `core:tag`
- `site:item`
- the persistence needed for the public baseline
- the public route renderer

Do not import `@dpeek/graphle-app`, Better Auth, D1 auth migrations, workflow,
saved-query, installed-module, or generic app shell routing.

### Sync handoff

This PDR should leave a clean handoff for Phase 6.

Deploy can replace the full public baseline. Later sync can either:

- replace the public baseline after local edits, or
- push incremental public graph transactions after projection

For the first cloud renderer, baseline replacement is easier. The cache
invalidation interface should not assume one publish mechanism. It should accept
"the public graph changed; these paths or this version are now current."

That handoff should use the same projection invalidation vocabulary where it
fits: dependency keys identify what changed, and the public baseline source
cursor tells the remote runtime whether it is current. Do not create a separate
sync-only freshness model for public sites.

## Rendering Options Considered

### Runtime SSR with CDN caching

This is the recommended path.

Pros:

- public pages are useful without JavaScript
- route rendering reads the public graph directly
- CDN caching keeps request cost low
- deploy and later sync share one rendering model
- private data never has to reach the browser

Cost:

- requires a Worker-safe server renderer
- requires cache invalidation on publish

### Static HTML generated at deploy time

This is simpler at runtime but weaker for sync.

Pros:

- very fast public serving
- simple CDN behavior
- little remote graph runtime code

Cost:

- every content change requires regeneration
- URL-only/sidebar changes can require many page rewrites
- Phase 6 sync would have to become a static rebuild pipeline or introduce a
  second renderer later

Do not choose this as the main path unless deploy-only publishing becomes the
product decision.

### Public graph API with client rendering

This removes DTOs but gives worse public pages.

Pros:

- reuses browser graph rendering
- easier to prototype than SSR in some areas

Cost:

- slower first paint
- weaker SEO/no-JS behavior
- less useful page-level CDN caching
- exposes public graph structure as a client API

This can be an enhancement for client navigation, not the primary cloud
rendering model.

## Rules

- Run `turbo build` before edits and `turbo check` after edits.
- Render public cloud pages from the public graph baseline, not DTO route
  payloads.
- Use the public projection metadata from `@dpeek/graphle-projection`; do not
  add a separate cloud-only projection compatibility model.
- Use `siteItemViewSurface` for item content.
- Server-render public pages by default.
- Cache public HTML at Cloudflare's CDN.
- Keep unknown remote `/api/*` routes as JSON 404s.
- Do not expose public full-graph sync or graph transactions.
- Do not expose private items, private-only tags, or local admin state.
- Do not import `@dpeek/graphle-app` or Better Auth.
- Do not copy `graphle-app`'s retained workflow SQL tables for site public
  baseline storage.
- Do not implement remote authoring in this PDR.
- Keep deploy credentials out of graph facts, logs, and public HTML.
- Keep docs current for every package touched or added.
- Websites and browser apps must be visually checked with desktop and mobile
  screenshots before closing implementation.

## Open Questions

None for the first implementation. Use runtime SSR with CDN caching. Use path
purge for the first cache invalidation implementation unless the deploy package
already has a cleaner baseline-version cache key.

## Success Criteria

- The Cloudflare Worker stores or can read the deployed public graph baseline.
- The Worker validates public baseline `projectionId` and `definitionHash`
  against the installed projection spec.
- The Worker creates a public site graph runtime from the baseline.
- The Worker renders `/` from the public graph.
- The Worker renders exact public item paths from the public graph.
- The Worker includes URL-only public items in the rendered sidebar/list.
- The Worker returns a useful not-found HTML document for missing public paths.
- The Worker returns JSON 404 for unknown `/api/*`.
- Private items are not present in the remote public graph.
- Private-only tags are not present in the remote public graph.
- Public route HTML includes the surface-rendered heading, formatted created
  date, tag chips/default reference display, and markdown body.
- Public route HTML is cacheable at the CDN with a documented invalidation path.
- Deploy or publish verifies remote health and at least `/`.
- Re-running deploy updates the same remote runtime and invalidates or versions
  cached public pages.
- Missing, incompatible, or stale public baselines have one documented recovery
  path: replace from the projected public graph.
- The cloud renderer does not import `@dpeek/graphle-app`, Better Auth, workflow,
  saved-query, installed-module, or app shell routes.
- Desktop and mobile screenshots show nonblank public pages and sidebar.
- `turbo build` passes.
- `turbo check` passes.

## Tasks

- Add or update the Cloudflare deploy package so it can bundle a small public
  Worker runtime.
- Reuse the formalized projection provider/recovery host from the public graph
  projection PDR.
- Add remote public graph baseline storage in the Worker or Durable Object.
- Store projection metadata with the baseline and reject incompatible
  `definitionHash` values.
- Add a protected baseline replacement path or equivalent deploy-mediated upload
  path.
- Wire the shared public route renderer into the Worker.
- Add Worker tests for health, unknown `/api/*`, baseline install, home route,
  exact item path, URL-only sidebar item, missing route, private item absence,
  and private-only tag absence.
- Add HTML assertions for heading, formatted created date, tag chips/default
  reference display, and markdown body.
- Add CDN cache headers for public HTML, missing routes, APIs, and static
  assets.
- Add deploy publish behavior that invalidates known public paths or advances a
  public baseline cache version.
- Add deploy verification for remote health and `/`.
- Update Phase 5 docs to reference server-rendered public graph pages instead
  of DTO route payloads.
- Add browser smoke checks for desktop and mobile public routes once the Worker
  can be run locally or in a preview deployment.
- Run focused deploy/local/site renderer tests.
- Run `turbo check`, `turbo build`, and `git diff --check`.

## Non-Goals

- Static-only deploy as the primary rendering model.
- Public client-rendered pages as the primary rendering model.
- Remote authoring.
- Remote login.
- Continuous local/remote sync.
- Custom domains.
- Tag pages.
- Link preview scraping.
- A hosted copy of the Graphle app.
