---
name: App web overview
description: "Current app-owned browser and Worker runtime map for @io/app."
last_updated: 2026-04-07
---

# App web overview

## Read this when

- the question is about the current browser or Worker runtime in `@io/app`
- you need the ownership split between `@io/app`, `@io/web`, and the graph
  packages
- you are tracing how the browser shell boots auth, graph runtime, and the
  current query or workflow surfaces
- you need the current installed-module activation proof in app/web

## What this doc owns

- the current app-owned web and Worker runtime map
- the shipped browser identity bootstrap contract
- the current installed-module activation proof for authority bootstrap and
  query-surface composition
- the app-owned entity-surface boundary for interactive record screens
- the package boundary between app/web composition, shared browser primitives,
  and graph-owned runtime layers

It does not own shared graph contracts or future Better Auth rollout work.
Those live in the owning graph package docs and in [`./roadmap.md`](./roadmap.md).

Current `/workflow` details live in [`./workflow-web.md`](./workflow-web.md).

## Current surface

`@io/app` owns the TanStack Router SPA and Worker shell that run the current
browser product surfaces:

- the signed-in or signed-out home shell
- the canonical type-first `/graph` explorer path
- the generic query-authoring and query-container routes
- the workflow review and sync-monitor proofs
- the Worker auth bridge and authority routing layer

## Principal bootstrap contract

`GET /api/bootstrap` is the stable browser identity bootstrap seam.

Current payload states:

- `signed-out`: no active verified session
- `ready`: verified session plus resolved principal summary
- `expired`: browser cookies exist, but the Worker could not verify them

Important failure rules:

- bootstrap fetch failure stays outside graph runtime bootstrap
- authenticated principal lookup failure fails closed; it does not downgrade to
  anonymous
- retry keeps the last resolved shell state visible until the next fetch
  settles

## Localhost bootstrap

The shipped localhost onboarding proof stays inside the same Better Auth
boundary as every other browser session.

Current path:

1. issue one short-lived localhost bootstrap credential
2. redeem it into a normal Better Auth session
3. re-read `GET /api/bootstrap`
4. continue through the existing access-activation path until the session
   becomes writable or fails explicitly

Current details live in [`./local-bootstrap.md`](./local-bootstrap.md).

## Installed-module activation proof

The current app/web host now proves one activation-driven path from
installed-module rows to runtime composition.

Current flow:

1. `installed-module-manifest-loader.ts` resolves built-in manifest sources
   directly and resolves local sources only from repo-local `./...` specifiers
   under `installedModuleLocalSourceRoot`.
2. Local exports are imported dynamically and revalidated with
   `defineGraphModuleManifest(...)`.
3. `createWebAppAuthority(...)` accepts `installedModuleRecords`,
   `installedModuleLocalSourceRoot`, and `installedModuleRuntime` instead of a
   preassembled graph.
4. When those options are present, authority bootstrap composes built-in and
   active installed-module schemas, then derives the installed query-surface
   registry and query-editor catalog from that same activation data through the
   server-only `installed-module-query-surface-loader.ts` seam.
5. Saved-query writes validate against that activation-composed editor
   catalog, and saved-query surface lookups resolve against that same registry.

Important boundary:

- `query-surface-registry.ts` stays browser-safe and only exposes built-in
  composition helpers used by client components.
- `installed-module-manifest-loader.ts` and
  `installed-module-query-surface-loader.ts` stay on the authority or test side
  because they depend on repo-local path resolution and dynamic module loading.

The first shipped proof stays intentionally small:

- `local-module-proof.ts` contributes one repo-local schema namespace and one
  query-surface catalog
- active local rows add that catalog beside the built-in `workflow` and
  `core` catalogs
- restarting with the same active rows reproduces the same schema and catalog
  set deterministically
- deactivating the row removes that local catalog, and saved queries against
  the removed surface fail closed

Current limits:

- only repo-local `./...` local sources are supported
- the activation proof currently rebuilds schema/bootstrap state plus
  query-surface catalogs; other runtime registries still stay out of scope
- activation changes are row-driven authority rebuilds, not hot toggles or
  installer UX

## Entity-surface boundary

Interactive entity screens stay in `@io/app`, even when they reuse shared
section chrome from `@io/graph-surface`.

Current landing:

- `EntityInspector` and `GenericCreateInspector` are the active hosts
- `entity-surface-plan.ts` owns row roles and chrome policy
- `PredicateRow` owns mode-aware row rendering and validation placement

Current details and the intended `EntitySurface` / `CreateEntitySurface`
adapter path live in [`./entity-surface.md`](./entity-surface.md).

## Ownership boundary

- keep reusable browser primitives in `@io/web`
- keep graph-aware field, query, and runtime contracts in the owning graph
  packages
- keep route composition, Worker routes, auth-shell behavior, query route
  mounting, and authority wiring in `@io/app`

If a browser component can be reused without importing graph runtime types, it
belongs in `@io/web`. If it decides graph validation, mutation, typed previews,
or authority routing, it stays in app/web or the owning graph package.

## Source anchors

- `../src/web/router.tsx`
- `../src/web/routeTree.gen.ts`
- `../src/web/components/auth-shell.tsx`
- `../src/web/components/graph-runtime-bootstrap.tsx`
- `../src/web/components/query-page.tsx`
- `../src/web/components/views-page.tsx`
- `../src/web/components/workflow-page.tsx`
- `../src/web/worker/index.ts`
- `../src/web/lib/auth-client.ts`
- `../src/web/lib/authority.ts`
- `../src/web/lib/installed-module-manifest-loader.ts`
- `../src/web/lib/installed-module-query-surface-loader.ts`
- `../src/web/lib/local-module-proof.ts`
- `../src/web/lib/query-surface-registry.ts`
- `../src/web/lib/local-bootstrap.ts`

## Related docs

- [`./workflow-web.md`](./workflow-web.md): current browser workflow surface
  and browser-agent boundary
- [`./entity-surface.md`](./entity-surface.md): app-owned interactive
  entity-surface family above readonly record surfaces
- [`./auth-store.md`](./auth-store.md): Better Auth store and migration path
- [`./local-bootstrap.md`](./local-bootstrap.md): localhost-only instant
  onboarding contract
- [`./authority-storage.md`](./authority-storage.md): current SQLite-backed
  Durable Object authority storage adapter
- [`./roadmap.md`](./roadmap.md): future Better Auth integration direction
- [`../../graph-authority/doc/installed-modules.md`](../../graph-authority/doc/installed-modules.md):
  installed-module lifecycle and host-proof boundary
- [`../../graph-query/doc/installed-surfaces.md`](../../graph-query/doc/installed-surfaces.md):
  installed query-surface registry and activation-fed editor-catalog
  composition
- [`../../web/README.md`](../../web/README.md): shared browser primitives owned
  by `@io/web`
