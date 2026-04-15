Status: Proposed
Last Updated: 2026-04-15

# Phase 3: Lightweight shell

## Must Read

- `./spec.md`
- `./phase-1-local-dev.md`
- `./phase-2-site-graph.md`
- `../../AGENTS.md`
- `../../package.json`
- `../../turbo.json`
- `../../doc/index.md`
- `../../lib/graphle-web/package.json`
- `../../lib/graphle-web/README.md`
- `../../lib/graphle-local/README.md`
- `../../lib/graphle-local/doc/local-dev.md`
- `../../lib/graphle-local/src/cli.ts`
- `../../lib/graphle-local/src/server.ts`
- `../../lib/graphle-local/src/site-authority.ts`
- `../../lib/graphle-module-site/README.md`
- `../../lib/graphle-module-site/doc/site-schema.md`
- `../../lib/graphle-app/doc/web-overview.md`
- `../../lib/graphle-app/src/web/worker/index.ts`

## Goal

Create the lightweight browser shell layer for the personal-site MVP without
adding page/post authoring yet.

After this phase, `graphle dev` should still create only:

```text
.env
graphle.sqlite
```

but the local server should be able to serve a packaged browser app from
workspace/package assets instead of only inline placeholder HTML. The app should
mount a generic shell that can host site authoring in Phase 4 and other Graphle
feature areas later.

This phase proves the package and runtime boundaries:

- `@dpeek/graphle-web-ui` owns browser primitives only.
- `@dpeek/graphle-web-shell` owns generic shell composition and feature slots.
- `@dpeek/graphle-site-web` owns the assembled personal-site browser app and
  site feature registration.
- `@dpeek/graphle-local` serves the packaged site app assets and keeps local
  API route ownership.

The phase does not implement the page/post editor, graph write endpoints for
authoring, public post routing polish, Cloudflare deploy, or local/remote sync.

## Approach

Build the smallest shell stack that can be executed and tested now, while
staying strict about future ownership boundaries.

### Web UI boundary

Introduce `@dpeek/graphle-web-ui` as the canonical browser primitive package.

The current `@dpeek/graphle-web` package already contains shared browser
primitives and no graph-runtime ownership. This phase should either:

1. rename/narrow that package to `@dpeek/graphle-web-ui`, updating imports that
   must continue to build, or
2. create `@dpeek/graphle-web-ui` as the new canonical package and mark
   `@dpeek/graphle-web` as a temporary legacy/proof boundary in docs.

Prefer the first option if the import update is contained enough for
`turbo build` and `turbo check`. Use the second only if renaming would pull
current-app proof complexity into this phase.

`@dpeek/graphle-web-ui` should own:

- layout primitives
- buttons, badges, tabs, menus, inputs, dialogs, sheets, sidebars, and status
  components
- browser-safe markdown and form primitives when they are not graph-specific
- global CSS/theme primitives needed by the shell and site app

It must not import graph runtime packages, `@dpeek/graphle-local`,
`@dpeek/graphle-module-site`, deploy packages, or shell-specific feature
registries.

### Web shell boundary

Add `@dpeek/graphle-web-shell` as a generic React/browser shell library.

It should define:

- a shell frame with stable slots for navigation, primary content, status, and
  commands
- a host context for auth, graph, sync, deploy, and runtime status summaries
- feature registration contracts for navigation items and route/page
  contributions
- empty, loading, and error states in shell terms
- package-local tests for registration ordering and shell rendering without any
  feature installed

The shell may know that an auth status or graph status exists, but it must not
know about `site:page`, `site:post`, local SQLite, Cloudflare resource details,
or the local server implementation.

### Site browser app boundary

Add `@dpeek/graphle-site-web` as the assembled personal-site browser app.

For this phase, it should stay thin:

- import `@dpeek/graphle-web-shell`
- import browser primitives from `@dpeek/graphle-web-ui`
- register a site feature with enough navigation/page metadata to prove shell
  composition
- fetch existing local status endpoints such as `/api/health` and
  `/api/session`
- build static browser assets into a package-owned output directory

This package may import site-specific presentation code and site feature
metadata. It should not own the `site:` schema itself; schema remains in
`@dpeek/graphle-module-site`.

Do not add page/post mutation endpoints in this phase. If the shell needs data
for status surfaces, use the existing `/api/health` and `/api/session` routes.

### Local runtime integration

Update `@dpeek/graphle-local` to serve package-owned browser assets from
`@dpeek/graphle-site-web`.

The local server should:

1. keep `/api/*` as the only API namespace
2. serve static browser assets from a package-owned build output
3. return JSON 404 for unknown `/api/*`
4. keep the graph-backed placeholder/public HTML as a no-JS fallback or shell
   host document until Phase 4 replaces it with the real public renderer
5. avoid Vite, TanStack route generation, or source scaffolding in the user's
   current working directory

Contributor development may add package-local dev scripts, but the default
`graphle dev` path must consume built assets, not start a user-project dev
server.

### Current-app complexity to bypass

Do not carry forward:

- `@dpeek/graphle-app` route composition
- Better Auth session context
- app-owned Worker/Durable Object wiring
- installed-module lifecycle UI
- workflow UI
- generic saved-query/view surfaces
- current app graph/authority boot complexity

Copy UI primitives only when they reduce cleanly into `@dpeek/graphle-web-ui`.
Do not copy app-specific route, auth, workflow, or authority wiring.

## Rules

- Run `turbo build` before edits and `turbo check` after edits.
- Do not import or boot `@dpeek/graphle-app`.
- Do not use Better Auth.
- Do not apply or create `AUTH_DB` migrations.
- Keep default local project state to `.env` and `graphle.sqlite`.
- Do not run Vite in the user's cwd.
- Do not scaffold source files in the user's cwd.
- Reserve `/api/*` as the only API namespace.
- Do not introduce `/_graphle`, `/_graphle/api/*`, or another product
  namespace.
- Keep authoring inline on site routes later; do not create a separate
  authoring route namespace in this phase.
- Keep browser UI primitives in `@dpeek/graphle-web-ui`.
- Keep shell runtime and feature composition in `@dpeek/graphle-web-shell`.
- Keep site schema in `@dpeek/graphle-module-site` and site browser assembly in
  `@dpeek/graphle-site-web`.
- Keep Cloudflare deploy code out of this phase.
- Keep SQLite storage as an authority storage adapter; do not add route-local
  state for shell status.
- Keep package docs current for every package touched or added.
- Websites and browser apps must be visually checked. Use existing package
  tests plus a browser/screenshot smoke check for the served shell.
- Avoid one-note palettes and app marketing pages. The first screen should be
  the usable local site/shell host, not a landing page.

## Open Questions

None.

## Success Criteria

- `@dpeek/graphle-web-ui` exists as the canonical browser primitive package, or
  `@dpeek/graphle-web` is explicitly documented as a temporary legacy/proof
  boundary while `@dpeek/graphle-web-ui` becomes canonical.
- `@dpeek/graphle-web-ui` has package metadata, TypeScript config, README,
  package-local docs, and focused tests for any new primitives or exports.
- `@dpeek/graphle-web-shell` exists with package metadata, TypeScript config,
  README, package-local docs, shell exports, feature registration contracts,
  and tests.
- The shell renders without any site feature installed.
- The shell can render a registered site feature without importing
  `@dpeek/graphle-module-site` or `@dpeek/graphle-local`.
- `@dpeek/graphle-site-web` exists with package metadata, TypeScript config,
  README, package-local docs, source entrypoint, and package-owned build output
  for static browser assets.
- `@dpeek/graphle-site-web` registers a minimal site feature with the shell and
  can show local auth/graph status from existing `/api/health` and
  `/api/session` data.
- `@dpeek/graphle-local` serves the packaged site browser assets without
  running Vite or generating routes in the user's cwd.
- `GET /api/health`, `GET /api/session`, `GET /api/init`, and unknown
  `/api/*` behavior remain narrow and compatible with Phase 2 tests.
- Non-API routes still return a usable local site/shell host document, with the
  graph-backed home-page fallback preserved until Phase 4 public rendering
  replaces it.
- A browser/screenshot smoke check verifies the shell host renders nonblank on
  desktop and mobile viewport sizes.
- The phase path does not import `@dpeek/graphle-app`, `better-auth`, or
  `AUTH_DB` wiring.
- New and changed package docs describe ownership boundaries and what remains
  out of scope.
- `turbo build` passes.
- `turbo check` passes.

## Tasks

- Create or rename to `@dpeek/graphle-web-ui` with package metadata,
  TypeScript config, README, package docs, and the browser primitive export
  surface needed by the shell.
- Update imports affected by the web UI package decision so the repo still
  builds, without pulling current-app proof code into the MVP path.
- Add `@dpeek/graphle-web-shell` with shell frame components, host status
  types, feature registration contracts, package docs, and render/registration
  tests.
- Add `@dpeek/graphle-site-web` with a minimal browser app entrypoint,
  package-owned static asset build, package docs, and a site feature
  registration that uses the generic shell.
- Add client-side status loading in `@dpeek/graphle-site-web` using existing
  `/api/health` and `/api/session` routes only.
- Update `@dpeek/graphle-local` to locate and serve the packaged
  `@dpeek/graphle-site-web` assets.
- Keep the existing graph-backed placeholder HTML as the no-JS fallback or host
  document for non-API routes.
- Add local-server tests for static asset serving, unknown asset 404s, and
  unchanged `/api/*` behavior.
- Add package tests for shell feature registration, shell render without
  features, and site app composition.
- Add a browser/screenshot smoke check for the served shell host at desktop and
  mobile sizes.
- Update package docs, `doc/index.md`, and `pdr/README.md` for the new web UI,
  web shell, site web, and local static-asset path.

## Non-Goals

- page/post editing UI
- graph mutation endpoints for authoring
- public post routing from graph content
- markdown editor behavior beyond minimal browser-safe rendering primitives
- Cloudflare deploy
- local/remote sync
- remote auth
- generic plugin marketplace or installed-module lifecycle UI
- Better Auth migration or removal from `@dpeek/graphle-app`
- default user-project source scaffolding
- running Vite or route generation in the user's cwd
- granular SQLite graph-table redesign
