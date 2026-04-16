---
name: App roadmap
description: "Future auth and workflow-web direction for @dpeek/graphle-app."
last_updated: 2026-04-07
---

# App roadmap

## Read this when

- you are designing future Better Auth integration or browser auth UX work in
  `@dpeek/graphle-app`
- you are deciding future browser workflow direction in the app-owned web
  shell
- you need the split between current app/web behavior and still-provisional
  rollout decisions
- you want the package-owned roadmap after retiring `doc/web/*`

## Current state

The app package already ships:

- Better Auth mounted at `/api/auth/*`
- server-side session verification for graph API requests
- request-time reduction into the repo's stable `AuthenticatedSession`
  contract
- Worker principal bootstrap through `GET /api/bootstrap`
- localhost-only instant onboarding that redeems into a normal Better Auth
  session
- a dedicated `AUTH_DB` D1 store kept separate from the graph authority's
  Durable Object storage

Those are current shipped behaviors. Details live in:

- [`./web-overview.md`](./web-overview.md)
- [`./auth-store.md`](./auth-store.md)
- [`./local-bootstrap.md`](./local-bootstrap.md)
- [`./authority-storage.md`](./authority-storage.md)

## Main future direction

The remaining Better Auth work is not about replacing the repo's auth and
authorization contracts. It is about using Better Auth as the concrete
implementation for the web-side authentication boundary while preserving the
existing split:

- Better Auth owns authentication state, cookies, and provider login flows
- the graph owns durable principals, roles, grants, and policy
- the Worker auth bridge owns session verification and reduction into
  `AuthorizationContext`
- the authority runtime owns final read, write, and command enforcement

## Provisional areas

- long-term account-management UX beyond the current local demo create-account
  surface
- browser workflow polish beyond the shipped scoped review route
- repository finalization and richer retained session UX for `/workflow`
- future principal bootstrap refinements above the current `signed-out`,
  `ready`, and `expired` state machine
- fuller capability and grant materialization once the graph-owned identity
  model grows beyond the current proof
- production-hardening around provider flows, account linking, and broader
  session management UX

## Workflow browser direction

The browser should stay the primary operator surface for workflow work.

Current direction:

- keep `/workflow` on workflow-specific scoped reads instead of widening back
  to a generic entity browser
- keep retained workflow history graph-backed so reload, reconnect, and restart
  can recover the same session story
- keep filesystem-backed launch, attach, git, and worktree behavior in the
  local browser-agent runtime instead of pushing those concerns into the Worker
- keep the browser route commit-first around the implicit main branch until the
  broader workflow model earns more visible surface area

Follow-on app-owned work includes:

- browser-native retained session chrome beyond the current feed contract
- workflow finalization UX after browser-owned sessions complete
- route-level polish around review gates, stale selections, and failure states

## Recommended direction

- keep a dedicated Better Auth store separate from graph storage
- keep Better Auth session verification in the Worker auth bridge, not inside
  the graph packages
- keep graph principal lookup and authorization decisions in the authority
  runtime
- keep localhost instant onboarding as a short bridge into the same Better Auth
  session model instead of introducing a second long-lived local auth model
- keep app-owned browser and Worker composition in `@dpeek/graphle-app`, while leaving
  shared browser primitives in `@dpeek/graphle-web-ui`

## Source anchors

- `../src/web/lib/better-auth.ts`
- `../src/web/lib/auth-bridge.ts`
- `../src/web/lib/auth-client.ts`
- `../src/web/worker/index.ts`
- `../src/web/lib/authority.ts`
- `../wrangler.jsonc`
- `../auth.ts`

## Related docs

- [`./workflow-web.md`](./workflow-web.md): current browser workflow surface
- [`./web-overview.md`](./web-overview.md): current browser and Worker runtime
- [`./auth-store.md`](./auth-store.md): current Better Auth store and migration
  path
- [`../../graph-authority/doc/authority-stack.md`](../../graph-authority/doc/authority-stack.md):
  shared graph-owned authorization boundary
