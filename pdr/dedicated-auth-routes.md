Status: Proposed
Last Updated: 2026-04-08

# Dedicated auth routes

## Must Read

- `../lib/app/src/web/routes/__root.tsx`
- `../lib/app/src/web/router.tsx`
- `../lib/app/src/web/main.tsx`
- `../lib/app/src/web/components/auth-shell.tsx`
- `../lib/app/src/web/components/app-shell.tsx`
- `../lib/app/src/web/components/home-page.tsx`
- `../lib/app/src/web/components/query-page.tsx`
- `../lib/app/src/web/components/workflow-page.tsx`
- `../lib/app/src/web/lib/auth-client.ts`
- `../lib/app/src/web/lib/better-auth.ts`
- `../lib/app/src/web/worker/index.ts`
- `../lib/app/doc/web-overview.md`
- `../lib/app/doc/auth-store.md`
- <https://tanstack.com/router/v1/docs/framework/react/guide/authenticated-routes>
- <https://tanstack.com/router/latest/docs/guide/router-context>
- <https://better-auth.com/docs/basic-usage>
- <https://better-auth.com/docs/concepts/session-management>
- <https://better-auth.com/docs/reference/security>

## Goal

Move the current inline sign-in and sign-up UI into dedicated `/sign-in` and
`/sign-up` routes with a full-screen centered-panel layout, while aligning the
web app with TanStack Router's route-level auth patterns and Better Auth's
reactive session model.

The new structure should:

- keep Better Auth as the browser session authority
- keep `GET /api/bootstrap` as the app's graph-aware identity boundary
- redirect unauthenticated users at the route layer instead of rendering inline
  auth cards inside protected screens
- treat `/` as a protected entry that redirects to `/sign-in` when no session is
  available
- preserve the localhost instant-onboarding path inside the same auth boundary
- keep graph access activation separate from session authentication

## Approach

Treat the app's auth state as one router-owned dependency injected from
React-land, not as ad hoc component-local hooks.

Recommended shape:

- add a typed router context with an `auth` object created before
  `RouterProvider` renders
- have that `auth` object compose:
  - Better Auth's reactive browser session signal via `authClient.useSession()`
  - the existing graph-aware bootstrap contract via `resolveWebPrincipalBootstrap`
  - imperative actions such as `refresh`, `signOut`, and post-auth redirect
    helpers
- call `router.invalidate()` whenever the auth context changes so `beforeLoad`
  guards re-run with current state

Route structure:

- keep the root route focused on context and shared not-found behavior
- move `AppShell` out of the root route and into a pathless authenticated
  layout route
- add a pathless auth layout route for `/sign-in` and `/sign-up` so those pages
  render full-screen without the app sidebar/header
- guard protected app routes with `beforeLoad`, redirecting signed-out or
  expired sessions to `/sign-in?redirect=<location.href>`
- guard `/` with the same route-level auth redirect instead of leaving it as a
  public signed-out landing page
- redirect authenticated users away from `/sign-in` and `/sign-up` to the
  validated redirect target or a default landing route

UI structure:

- split the current `AuthSessionEntryCard` into reusable pieces:
  - auth panel layout
  - localhost onboarding panel
  - sign-in form
  - sign-up form
- keep the forms centered in a full-screen layout and reuse the current card
  primitives and feedback handling
- replace inline signed-out forms on `/` with a route-level redirect to
  `/sign-in`

Graph/runtime structure:

- keep session auth and graph access activation as separate concerns
- narrow the current `GraphAccessGate` so it only handles access activation and
  activation failures for already-authenticated users
- remove inline auth rendering from protected feature routes such as `/query`
  and `/workflow`

Redirect handling:

- use TanStack Router's documented pattern of storing `location.href` in a
  `redirect` search param from protected-route `beforeLoad`
- restore the destination with router history after successful auth so the full
  original URL comes back without reconstructing it manually
- only allow same-origin relative redirect destinations when turning the search
  param back into navigation input
- use Better Auth callback URLs only where Better Auth itself needs to own the
  redirect; for email/password SPA flows prefer client success callbacks plus
  router invalidation/history updates

## Rules

- Keep `GET /api/bootstrap` as the canonical app-level auth state. Do not
  replace it with a raw Better Auth session check inside feature routes.
- Keep Better Auth session verification in the Worker and graph-principal
  lookup in the existing auth bridge.
- Do not mount `AppShell` on `/sign-in` or `/sign-up`.
- Do not keep inline sign-in or sign-up UI inside protected pages once the
  dedicated auth routes land.
- Keep localhost onboarding on the sign-in surface instead of inventing a
  parallel local-auth route family.
- Treat redirect targets as untrusted input until normalized to a same-origin
  path.
- Fail closed on bootstrap errors. Do not silently downgrade a broken verified
  session to anonymous.
- Assume route names `/sign-in` and `/sign-up` unless product direction changes.

## Open Questions

None.

## Success Criteria

- `/sign-in` and `/sign-up` exist and render in a full-screen layout with a
  centered auth panel.
- Signed-out or expired access to protected routes redirects through TanStack
  Router `beforeLoad` instead of rendering inline auth forms.
- Signed-out or expired access to `/` redirects to `/sign-in` instead of
  rendering a public signed-out home surface.
- Auth routes redirect authenticated users to the validated requested location
  or a default landing route.
- Router context owns the settled auth state and revalidates route guards when
  Better Auth session state changes.
- `/query`, `/workflow`, and other protected routes keep graph activation
  gating but no longer own sign-in/sign-up rendering.
- Home-page signed-out behavior is explicit and documented.
- Relevant unit coverage is updated for route redirects, auth-route rendering,
  and the narrowed graph-access boundary.
- Manual browser verification covers:
  - direct navigation to a protected route while signed out
  - redirect back after sign-in
  - authenticated navigation to `/sign-in` or `/sign-up`
  - desktop and narrow/mobile layout for the centered auth panel
- `turbo check` passes.

## Tasks

- Create a router-auth state module in `lib/app/src/web/lib/` that composes
  Better Auth session reactivity with the existing bootstrap fetch and exposes
  one typed `auth` dependency for TanStack Router.
- Refactor `lib/app/src/web/routes/__root.tsx`,
  `lib/app/src/web/router.tsx`, and `lib/app/src/web/main.tsx` to use
  `createRootRouteWithContext(...)`, pass the auth dependency through
  `RouterProvider`, and invalidate router context when auth state changes.
- Introduce pathless route layouts for:
  - auth-only full-screen pages
  - authenticated app-shell pages
  - protected graph-backed pages when they need route-level auth redirects
- Extract reusable auth form primitives from
  `lib/app/src/web/components/auth-shell.tsx` and add dedicated sign-in/sign-up
  page components and file routes under `lib/app/src/web/routes/`.
- Narrow `GraphAccessGate` so it assumes an authenticated session and only
  handles graph access activation/loading/error for ready sessions.
- Update `lib/app/src/web/components/home-page.tsx`,
  `lib/app/src/web/components/app-shell.tsx`, and any auth status affordances
  to point to the new dedicated routes, remove inline auth-entry behavior, and
  make `/` a protected post-sign-in landing route.
- Add or update tests around:
  - route-level redirect behavior
  - auth-route redirect-away behavior for authenticated users
  - sign-in/sign-up page rendering
  - the reduced graph-access gate states
- Update app docs that describe current auth-shell ownership and bootstrap flow,
  starting with `lib/app/doc/web-overview.md`, `lib/app/doc/auth-store.md`,
  and `lib/app/README.md`.

## Non-Goals

- changing the Worker auth bridge contract or replacing Better Auth
- broad account-management UX beyond dedicated sign-in/sign-up routes
- adding new auth providers, password-reset flows, or account-linking features
- redesigning graph access activation or authority lookup beyond the routing
  and surface split needed here
