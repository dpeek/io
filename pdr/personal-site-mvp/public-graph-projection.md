Status: Proposed
Last Updated: 2026-04-18

# Public graph projection

## Must Read

- `./spec.md`
- `./site-item-prd.md`
- `./phase-4-site-web.md`
- `./phase-4-graph-surface-reset/spec.md`
- `./phase-4-graph-surface-reset/03-site-web-migration-and-deletion.md`
- `../../AGENTS.md`
- `../../lib/graphle-local/README.md`
- `../../lib/graphle-local/doc/local-dev.md`
- `../../lib/graphle-local/src/site-authority.ts`
- `../../lib/graphle-local/src/server.ts`
- `../../lib/graphle-site-web/README.md`
- `../../lib/graphle-site-web/doc/site-web.md`
- `../../lib/graphle-site-web/src/graph.ts`
- `../../lib/graphle-site-web/src/site-feature.tsx`
- `../../lib/graphle-site-web/src/site-items.ts`
- `../../lib/graphle-site-web/src/status.ts`
- `../../lib/graphle-module-site/README.md`
- `../../lib/graphle-module-site/doc/site-schema.md`
- `../../lib/graphle-module-site/src/index.ts`
- `../../lib/graphle-projection/README.md`
- `../../lib/graphle-projection/doc/projections-and-retained-state.md`
- `../../lib/graphle-projection/src/index.ts`
- `../../lib/graphle-module-workflow/src/projection.ts`
- `../../lib/graphle-module-workflow/src/query.ts`
- `../../lib/graphle-app/src/web/lib/branch3-registrations.ts`
- `../../lib/graphle-app/src/web/lib/authority.ts`
- `../../lib/graphle-app/src/web/lib/graph-authority-sql-workflow-projection.ts`
- `../../lib/graphle-surface/doc/react-dom.md`
- `../../lib/graphle-surface/src/react-dom/entity-surface.tsx`
- `../../lib/graphle-client/src/graph.ts`
- `../../lib/graphle-kernel/src/store.ts`

## Goal

Replace the public `site:item` DTO route projection with a sanitized public
graph projection before Cloudflare deploy or local/remote sync build on it.

After this PDR, local public rendering should use the same shape as authenticated
graph-backed preview:

```text
public projected graph runtime -> route item ref -> siteItemViewSurface
```

The public graph must contain only public website content. It must not expose
the local authoring graph, local admin records, private items, private-only tags,
or deploy/sync secrets.

## Approach

### Reuse the existing projection contracts

Do not invent a second projection model for public sites.

`@dpeek/graphle-projection` already owns the shared projection vocabulary:

- `ProjectionSpec`
- `definitionHash` compatibility
- projection dependency keys
- visibility modes
- retained provider registrations and registries
- invalidation events

The site public graph should be declared through those contracts. The likely
module-owned shape is a `site:item` public projection spec in
`@dpeek/graphle-module-site`, with a stable `projectionId`, `definitionHash`,
dependency keys, `rebuildStrategy: "full"`, and `visibilityMode:
"share-surface"`. The current projection package already has an
`"outbound-share"` projection kind, which is a closer fit for a sanitized public
baseline than a workflow-style collection index.

The public artifact can still be a sanitized `GraphStoreSnapshot`, not retained
rows. That is fine. The point is that the artifact is described and invalidated
by the same projection metadata:

```ts
type PublicSiteGraphBaseline = {
  projectionId: string;
  definitionHash: string;
  sourceCursor: string;
  baselineHash: string;
  generatedAt: string;
  snapshot: GraphStoreSnapshot;
};
```

If the projection's included facts, public filtering, or route-visible
semantics change, bump `definitionHash` and rebuild the baseline. Do not add a
parallel version field with separate compatibility rules.

### Formalize the app-local retained projection host

`graphle-app` already has the closest implementation pattern:

- `WebAppRetainedProjectionProvider` in
  `graphle-app/src/web/lib/branch3-registrations.ts`
- retained provider registry lookup through `@dpeek/graphle-projection`
- build/hydrate/invalidation functions for workflow retained state
- missing/incompatible/stale recovery in
  `graphle-app/src/web/lib/authority.ts`
- app-specific SQL rows in
  `graphle-app/src/web/lib/graph-authority-sql-workflow-projection.ts`

Before implementing the site public projection, extract or formalize the
generic host pieces so the site work can reuse them. The reusable contract is
roughly:

- a provider registration
- a function that builds a projection artifact from a `GraphStoreSnapshot` and
  source cursor
- a function that hydrates or validates the artifact
- a function that creates invalidation events from touched type ids
- a recovery classifier for missing, incompatible, and stale artifacts
- a small storage boundary for loading and replacing the current artifact

The SQL table shape in `graphle-app` is workflow-specific and should not be
copied into the site path. Keep storage adapters host-owned. Reuse the provider
and recovery shape.

### Define the public projection boundary

Add a site-owned projection spec and a host-owned builder that reads the local
site authority and materializes a public graph store or snapshot.

The projection should include:

- graph bootstrap/schema facts needed for `minimalCore`, `core:color`,
  `core:tag`, and `site:item`
- `site:item` records whose visibility is public
- fields required by public route rendering, sidebar ordering, and public
  display
- `core:tag` records referenced by public items

The projection should exclude:

- private `site:item` records
- `core:tag` records referenced only by private items
- local admin/session/auth records
- Cloudflare API tokens
- deploy form state
- local-only sync or diagnostics state

The first implementation can live in `@dpeek/graphle-local` if that is the
shortest route to deleting the DTO fallback. If Phase 5 needs to consume the
same code from a deploy package, move the projection into the deploy package or
a small site-public package in that follow-up. Do not duplicate the filtering
logic. The projection spec and compatibility metadata should stay with the site
module so local rendering, deploy, and sync all agree on identity.

### Create a public site graph runtime

Add a browser/server-safe runtime factory for public site graph snapshots. It
should assemble the same namespace used by the browser graph client:

- `site`
- `core:tag`
- `core:color`
- `minimalCore`

The runtime does not need mutation support. It only needs typed graph reads and
entity refs for route selection and entity-surface rendering.

Expected API shape:

```ts
createGraphlePublicSiteRuntime(snapshotOrStore)
```

The exact name can change, but the boundary should be clear: this is a public
read runtime over sanitized graph data, not the local admin sync client.
Hydration should validate the baseline metadata against the installed
`ProjectionSpec` before creating the runtime.

### Move route selection to graph refs

Keep route selection product-specific. Public website routes are still:

- `/` resolves to the public item with `site:item.path === "/"`
- any other valid path resolves by exact `site:item.path`
- URL-only items appear in the public sidebar/list but do not resolve as pages
- missing paths render the useful not-found document

Change the route result shape used by rendering so it can carry an item id or
entity ref from the public graph runtime, not a serialized item object.

`site-web` can keep helper functions such as `resolveGraphleSiteRoute(...)`,
but public rendering should resolve the active item back to a graph ref and then
render `siteItemViewSurface` through the shared entity-surface view path.

### Replace the DTO fallback in site-web

The browser currently keeps `GraphleSiteRoutePayload` and `GraphleSiteRouteItem`
for unauthenticated public hydration because `/api/sync` is admin-only. Remove
that as a rendering dependency.

The new local public path should be one of these:

- server-render the public route from the public graph projection and hydrate
  only shell behavior in the browser, or
- expose a public graph bootstrap endpoint that returns the sanitized graph
  snapshot and let the browser create a public graph runtime from it

Prefer server rendering as the default because it matches the Cloudflare target.
A public graph bootstrap can be added later for client-side navigation if it is
still useful.

### Keep public graph reads separate from admin sync

Do not make unauthenticated `/api/sync` public. The public graph projection is a
separate read model with a narrower data set.

Admin editing continues to use:

```text
GET  /api/sync
POST /api/tx
```

Public rendering uses the sanitized projection. That keeps the authorization
boundary easy to reason about before remote deploy and sync exist.

### Share one public renderer entrypoint

Add a route renderer that takes a public graph runtime and path:

```ts
renderPublicSiteRoute({
  runtime,
  path,
  assets,
})
```

It should own:

- exact route lookup
- public sidebar item list
- not-found route content
- entity-surface view rendering with `siteItemViewSurface`
- markdown rendering through the shared markdown view renderer

It should not own:

- local admin preview
- local graph sync
- deploy credentials
- Cloudflare API calls
- private item rendering

The local server can use this renderer immediately. The Cloudflare Worker can
use the same renderer in the next PDR.

## Rules

- Run `turbo build` before edits and `turbo check` after edits.
- Do not expose unauthenticated full-graph sync.
- Do not keep `GraphleSiteRouteItem` as the public rendering model.
- Do not add a bespoke public projection/versioning vocabulary beside
  `@dpeek/graphle-projection`.
- Do not copy `graphle-app`'s retained projection host type into site or deploy
  packages. Formalize the reusable part first.
- Keep route selection product-specific and rendering surface-driven.
- Use `siteItemViewSurface` for public item content.
- Keep `site:item.sortOrder` available for sidebar ordering, but do not expose
  it in the public item view surface.
- Do not upload or expose private items or private-only tags.
- Do not add deploy or remote sync behavior in this PDR.
- Keep docs current in `graphle-local`, `graphle-site-web`,
  `graphle-module-site`, and `graphle-surface` if their boundaries change.

## Open Questions

One placement decision remains: the generic host provider/recovery type can live
in `@dpeek/graphle-projection` if it stays storage-agnostic, or
`@dpeek/graphle-authority` if it needs authority storage types. Prefer
`@dpeek/graphle-projection` unless implementation forces the authority
dependency.

Default to server rendering locally, with a public graph bootstrap endpoint
left as an optional follow-up.

## Success Criteria

- A public graph projection can be built from the local persisted site
  authority.
- The public projection is declared with `@dpeek/graphle-projection`
  `ProjectionSpec` metadata and compatibility checks.
- The implementation reuses a formalized provider/recovery host contract rather
  than a site-local copy of `WebAppRetainedProjectionProvider`.
- The public projection includes public path-backed items.
- The public projection includes public URL-only items for the sidebar/list.
- The public projection excludes private items.
- The public projection excludes tags referenced only by private items.
- Local public route rendering resolves the active item from the public graph
  runtime, not from a DTO item object.
- Local public route rendering uses `siteItemViewSurface` for title,
  `createdAt`, tags, and markdown body.
- The unauthenticated browser path no longer depends on
  `GraphleSiteRoutePayload` or `GraphleSiteRouteItem` for rendering.
- Authenticated editing still uses the private local graph runtime and
  `siteItemSurface`.
- Public route tests cover home, exact path, URL-only sidebar item, missing
  route, private exclusion, private-only tag exclusion, formatted date, tag
  chips, and markdown body.
- `turbo build` passes.
- `turbo check` passes.

## Tasks

- Add a `site:item` public projection spec in `@dpeek/graphle-module-site`,
  with projection metadata exported through the module runtime manifest.
- Extract or formalize the storage-agnostic projection provider/recovery host
  contract currently implied by `graphle-app`'s retained projection code.
- Add a public graph projection helper over the local site authority.
- Add projection tests for public item inclusion, URL-only public item
  inclusion, private item exclusion, referenced tag inclusion, and private-only
  tag exclusion.
- Add compatibility tests for matching and mismatched public projection
  `definitionHash` values.
- Add a public site graph runtime factory over a sanitized snapshot or store.
- Move route selection helpers to support item ids or refs instead of DTO item
  objects.
- Add a shared public route renderer that renders `siteItemViewSurface` from a
  public graph entity ref.
- Update `graphle-local` non-API route rendering to call the public graph
  renderer.
- Remove `site-web` rendering dependence on `GraphleSiteRoutePayload` and
  `GraphleSiteRouteItem`.
- Keep any remaining `/api/site/route` endpoint explicitly documented as
  transitional or delete it if no code path uses it.
- Update package docs and `pdr/README.md`.
- Run focused local, site-web, module-site, and surface tests.
- Run `turbo check`, `turbo build`, and `git diff --check`.

## Non-Goals

- Cloudflare deployment.
- Local/remote sync.
- Public unauthenticated graph mutation.
- Remote authoring.
- Remote login.
- Tag pages.
- Custom domains.
- Replacing authenticated local graph transport.
