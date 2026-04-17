Status: Proposed
Last Updated: 2026-04-17

# Phase 4 graph surface reset

## Must Read

- `../spec.md`
- `../site-item-prd.md`
- `../phase-4-site-web.md`
- `../site-layout-ux.md`
- `../../../AGENTS.md`
- `../../../doc/index.md`
- `../../../doc/vision.md`
- `../../../lib/graphle-local/README.md`
- `../../../lib/graphle-local/src/server.ts`
- `../../../lib/graphle-local/src/site-authority.ts`
- `../../../lib/graphle-client/src/http.ts`
- `../../../lib/graphle-authority/src/persisted-authority.ts`
- `../../../lib/graphle-react/src/runtime.tsx`
- `../../../lib/graphle-react/src/entity-draft.ts`
- `../../../lib/graphle-surface/doc/ui-stack.md`
- `../../../lib/graphle-surface/doc/react-dom.md`
- `../../../lib/graphle-module-core/doc/react-dom.md`
- `../../../lib/graphle-module-core/src/react-dom/resolver.tsx`
- `../../../lib/graphle-module-core/src/react-dom/field-registry.tsx`
- `../../../lib/graphle-module-site/src/index.ts`
- `../../../lib/graphle-site-web/src/site-feature.tsx`
- `../../../lib/graphle-site-web/src/status.ts`
- `../../../lib/graphle-web-shell/doc/web-shell.md`
- `../../../lib/graphle-app/doc/entity-surface.md`
- `../../../lib/graphle-app/src/web/components/entity-surface.tsx`
- `../../../lib/graphle-app/src/web/components/create-entity-surface.tsx`
- `../../../lib/graphle-app/src/web/components/field-editor-row.tsx`
- `../../../lib/graphle-app/src/web/components/entity-surface-plan.ts`

## Requirements

Correct the Phase 4 implementation before Phase 5 deploy and Phase 6 sync build
on the wrong authoring substrate.

The primary goal is deletion and formalization:

- delete custom site content DTO authoring paths
- delete bespoke predicate field editors in `@dpeek/graphle-site-web`
- productize the reusable graph/runtime/surface integration that still lives in
  `@dpeek/graphle-app`
- make `site-web` author content through generic graph transactions
- make entity rendering and editing come from schema and surface metadata
- keep product-specific site routing and public preview logic in the site
  product path

The end state should prove the original Graphle product claim: a product package
can define schemas and surfaces, add them to an app, and get browser
view/edit/create behavior without custom REST CRUD endpoints or per-product
field renderers.

This reset is not a redesign of the surface model. It is a cleanup pass that
moves existing concepts into the packages that should own them, then deletes
the duplicate site implementation.

## Architecture

### Package ownership

`@dpeek/graphle-local` owns local host APIs, local auth, project state, and
generic graph transport for the packaged browser app.

It should expose graph sync and transaction endpoints over the persisted local
authority that already exists. Site content writes should use generic graph
transactions. Runtime endpoints such as `/api/health`, `/api/session`, and
`/api/init` remain local host APIs.

`@dpeek/graphle-client` owns the HTTP graph client and typed graph interaction.
No site-specific DTO client should be added beside it for authoring.

`@dpeek/graphle-react` owns host-neutral runtime providers, predicate hooks,
metadata readers, resolver primitives, validation issue mapping, and draft
controllers.

It should not own browser DOM widgets, shell composition, route registration, or
site-specific item behavior.

`@dpeek/graphle-module-core/react-dom` owns browser-default field behavior for
core graph predicates.

It should own things like markdown editors, URL/date/number/boolean controls,
entity-reference controls, field labels, descriptions, and validation chrome. It
should not own entity pages, sidebars, product routes, shell status, deploy
status, or site item layout.

`@dpeek/graphle-surface/react-dom` is the preferred home for route-neutral
entity surface composition.

It should be extended from readonly record mounts into the shared browser layer
that can mount view, edit, and create surfaces for an entity using authored
surface metadata and the core field resolver. Create a new package only if a
dependency boundary makes this impossible; do not create a second surface model.

`@dpeek/graphle-web-shell` owns browser shell composition only: feature
registration, navigation slots, command slots, host status summaries, and shared
shell loading/error/empty states.

It must not own predicate widgets, entity editors, site routing, or content
authoring semantics.

`@dpeek/graphle-module-site` owns site schema, site validation rules, route/read
contracts, and authored `site:item` surface metadata.

It should not own React components, HTTP routes, local server state, deploy
runtime, or SQLite behavior.

`@dpeek/graphle-site-web` owns the assembled personal-site browser experience.

It should choose the active site item, render the public site frame and sidebar,
show inline authoring controls for authenticated admins, and delegate entity
view/edit/create fields to the shared surface stack.

### Authoring transport

Authoring writes must flow through graph transactions:

```text
site-web -> graphle-client HTTP transport -> graphle-local graph endpoint
  -> persisted local authority -> graphle.sqlite
```

Custom JSON APIs are acceptable for host/runtime concerns, not for site content
CRUD:

- keep `/api/health`
- keep `/api/session`
- keep `/api/init`
- keep deploy/sync/status APIs when those phases need them
- remove content authoring APIs such as `/api/site/items` once graph
  transactions cover the behavior

Public site route reads may remain product-specific because the site package
must decide how `site:item.path`, `visibility`, URL-only items, and sidebar
ordering become a website. Those reads should still come from the graph, not
from a parallel content DTO model.

### Surface flow

The intended browser authoring path is:

```text
module schema + surface metadata
  -> typed entity refs and predicate refs
  -> graphle-react draft/runtime helpers
  -> graphle-surface entity view/edit/create composition
  -> graphle-module-core/react-dom field controls
  -> site-web product frame
```

`site-web` should not switch on `site:item` field names to decide whether a
field is a textarea, markdown editor, tag selector, date input, or URL input.
That decision belongs to predicate metadata and the shared field resolver.

## Rules

- Run `turbo build` before edits and `turbo check` after edits.
- Do not import or boot `@dpeek/graphle-app` from the MVP product path.
- Reuse app-proven concepts only by extracting them into package-owned
  boundaries.
- Do not invent a new surface system.
- Do not add product-specific field renderers when predicate metadata and the
  shared resolver can handle the field.
- Do not add custom JSON DTO content writes for `site:item`.
- Keep browser UI primitives in `@dpeek/graphle-web-ui`.
- Keep field widgets in `@dpeek/graphle-module-core/react-dom`.
- Keep entity surface composition route-neutral.
- Keep shell composition in `@dpeek/graphle-web-shell`.
- Keep site schema and authored site surfaces in
  `@dpeek/graphle-module-site`.
- Keep site-specific public route selection in `@dpeek/graphle-site-web` or
  local site read helpers.
- Keep package docs current for every boundary that changes.
- Backwards compatibility with the current app proof is not required.
- Every implementation PDR must identify code it deletes, bypasses, or refuses
  to carry forward.

## Phases

Implementation PDRs are created one at a time under this directory.

### 1. Generic local graph transport

Expected PDR:

- `./01-generic-local-graph-transport.md`

Goal: expose the existing persisted local authority through generic graph
transport so browser authoring can use graph sync and graph transactions instead
of site DTO CRUD.

Primary packages:

- `@dpeek/graphle-local`
- `@dpeek/graphle-client`
- `@dpeek/graphle-authority`
- `@dpeek/graphle-site-web`

Expected outcomes:

- local server exposes generic graph sync and transaction endpoints
- local auth still gates authoring writes
- `site-web` can bootstrap a graph runtime against the local graph endpoint
- existing host APIs remain intact
- content write DTO endpoints are marked for deletion once migration completes

### 2. Productize entity surfaces

Expected PDR:

- `./02-productize-entity-surfaces.md`

Goal: move reusable entity view/edit/create integration out of
`@dpeek/graphle-app` and into the package-owned surface stack.

Primary packages:

- `@dpeek/graphle-surface`
- `@dpeek/graphle-react`
- `@dpeek/graphle-module-core`
- `@dpeek/graphle-app`

Expected outcomes:

- route-neutral entity view/edit/create surfaces are available outside
  `@dpeek/graphle-app`
- predicate rows delegate to `@dpeek/graphle-module-core/react-dom`
- create/edit draft planning uses existing `@dpeek/graphle-react` helpers
- app-only namespace, explorer, workflow, and Better Auth assumptions are not
  extracted into the reusable package
- app code can either consume the extracted package or remain as a proof path
  until later cleanup

### 3. Site-web migration and deletion

Expected PDR:

- `./03-site-web-migration-and-deletion.md`

Goal: migrate personal-site authoring to graph transport and shared entity
surfaces, then delete the duplicate DTO/editor implementation.

Primary packages:

- `@dpeek/graphle-module-site`
- `@dpeek/graphle-site-web`
- `@dpeek/graphle-local`
- `@dpeek/graphle-surface`
- `@dpeek/graphle-module-core`

Expected outcomes:

- `site:item` has authored surface metadata
- `site-web` renders/edit items through the shared entity surface
- markdown, tags, dates, URLs, booleans, numbers, and selects use shared
  predicate controls
- site content writes use graph transactions
- site-specific public route rendering still works from graph state
- obsolete content DTO types, fetch helpers, and route handlers are deleted

## Success Criteria

- The MVP product path does not import `@dpeek/graphle-app`.
- `@dpeek/graphle-site-web` does not own a custom field-control switch for
  `site:item` predicates.
- `site:item.body` renders and edits through the shared markdown field path.
- `site:item.tags` renders and edits through the shared entity-reference/tag
  field path.
- `site:item` date, URL, boolean, number, enum/select, and text fields render
  through the shared field resolver.
- Local site content create, update, delete, and reorder behavior is backed by
  graph transactions.
- Custom site content DTO write endpoints are deleted or no longer used by the
  browser authoring path.
- Public route rendering still works for public `site:item.path` records.
- Private route preview still works for authenticated local admins.
- URL-only public items still appear in the sidebar/list without getting public
  routes.
- The site browser app remains packaged and served by `@dpeek/graphle-local`.
- Package docs describe the final ownership boundary between
  `graphle-module-core/react-dom`, `graphle-surface/react-dom`,
  `graphle-web-shell`, `graphle-module-site`, and `graphle-site-web`.
- `turbo build` passes.
- `turbo check` passes.

## Non-Goals

- Do not redesign the graph client, transaction model, or persisted authority.
- Do not introduce a new query engine for site route rendering.
- Do not add Better Auth to the MVP product path.
- Do not bring workflow, saved-query, installed-module, admission, share, or
  capability surfaces into the personal-site boot path.
- Do not build Cloudflare deploy in this reset.
- Do not build local/remote sync in this reset.
- Do not create a separate admin app or authoring route namespace.
- Do not preserve custom site DTO APIs for backwards compatibility.

## Learnings

Phase 4 correctly avoided importing `@dpeek/graphle-app`, but it over-applied
that rule by rebuilding reusable graph/surface integration in the site package.

The missing instruction was:

> Do not import `@dpeek/graphle-app`; extract reusable graph runtime and entity
> surface concepts into package-owned boundaries, then consume those packages
> from `site-web`.

The reset exists to repair that package boundary before deployment and sync make
the custom DTO path harder to remove.
