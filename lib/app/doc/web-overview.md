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

## What this doc owns

- the current app-owned web and Worker runtime map
- the shipped browser identity bootstrap contract
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
- `../src/web/lib/query-surface-registry.ts`
- `../src/web/lib/local-bootstrap.ts`

## Related docs

- [`./workflow-web.md`](./workflow-web.md): current browser workflow surface
  and browser-agent boundary
- [`./auth-store.md`](./auth-store.md): Better Auth store and migration path
- [`./local-bootstrap.md`](./local-bootstrap.md): localhost-only instant
  onboarding contract
- [`./authority-storage.md`](./authority-storage.md): current SQLite-backed
  Durable Object authority storage adapter
- [`./roadmap.md`](./roadmap.md): future Better Auth integration direction
- [`../../web/README.md`](../../web/README.md): shared browser primitives owned
  by `@io/web`
