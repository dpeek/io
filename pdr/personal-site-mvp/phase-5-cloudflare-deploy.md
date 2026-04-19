Status: Implemented
Last Updated: 2026-04-19

# Phase 5: Cloudflare deploy

## Must Read

- `./spec.md`
- `./site-item-prd.md`
- `./phase-1-local-dev.md`
- `./phase-2-site-graph.md`
- `./phase-3-shell.md`
- `./phase-4-site-web.md`
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
- `../../lib/graphle-deploy-cloudflare/README.md`
- `../../lib/graphle-deploy-cloudflare/doc/cloudflare-public-rendering.md`
- `../../lib/graphle-web-shell/README.md`
- `../../lib/graphle-web-shell/doc/web-shell.md`
- `../../lib/graphle-web-ui/README.md`
- `../../lib/graphle-web-ui/doc/browser-primitives.md`
- `../../lib/graphle-module-site/README.md`
- `../../lib/graphle-module-site/doc/site-schema.md`
- `../../lib/graphle-module-site/src/index.ts`
- `../../lib/graphle-module-core/src/core/tag.ts`
- `../../lib/graphle-authority/doc/persistence.md`
- `../../lib/graphle-authority/src/persisted-authority.ts`
- `../../lib/graphle-sqlite/doc/sqlite-bootstrap.md`
- `../../lib/graphle-app/doc/web-overview.md`
- `../../lib/graphle-app/doc/authority-storage.md`
- `../../lib/graphle-app/wrangler.jsonc`
- `../../lib/graphle-app/src/web/worker/index.ts`

## Goal

Let a local personal-site owner deploy the public `site:item` graph projection
to Cloudflare from the web shell.

After this phase, `graphle dev` should still create only:

```text
.env
graphle.sqlite
```

but an authenticated local admin should be able to provide Cloudflare
deployment settings, deploy the public site graph, and receive a public Worker
URL. The deployed Worker should serve the same public website route shape as
the local runtime:

- `/` renders the public home item
- exact paths render public items with `path`
- URL-only public items appear in the public sidebar/list
- private items and private-only tags are absent from the deployed public graph
- missing routes return a useful 404 document

This phase publishes a public baseline to Cloudflare. It does not implement
continuous local/remote sync, remote authoring, remote login, custom domains,
source scaffolding, tag pages, link preview scraping, or a separate admin
application.

## Approach

Finish the Cloudflare deployment package and connect it to the existing local
runtime through a narrow authenticated API. Keep the remote runtime focused on
public rendering from a durable item graph baseline.

`./cloud-public-rendering.md` is now implemented. Phase 5 should build on that
package instead of re-planning or re-implementing the remote public renderer.
The remaining ship work is Cloudflare provisioning, local deploy APIs,
nonsecret metadata persistence, browser deploy controls, and end-to-end deploy
verification.

### Package boundary

Use `@dpeek/graphle-deploy-cloudflare` as the package that owns Cloudflare
deployment behavior. The package already owns the public Worker renderer,
Durable Object baseline storage, baseline replacement endpoint, cache policy,
and publish verification handoff. Phase 5 should add the remaining local deploy
API, Cloudflare API provisioning, metadata persistence, and browser controls
around that package instead of introducing a second route DTO or Worker runtime.

The package should own:

- Cloudflare API input validation and client calls
- deterministic Worker and Durable Object naming
- Worker script or deploy bundle generation for the existing
  `fetchCloudflarePublicSite` runtime
- Durable Object binding and migration config for
  `GraphlePublicSiteBaselineDurableObject`
- public baseline publish through `publishPublicSiteBaseline(...)`
- remote metadata types and validation
- deploy result, status, and error contracts consumed by the local runtime
- package README and docs

The package already owns:

- public Worker fetch routing
- Durable Object baseline storage
- protected baseline replacement at `/api/baseline`
- `GET /api/health`
- server-rendered public routes through `@dpeek/graphle-site-web`
- CDN cache headers and optional asset tag injection
- remote rejection of incompatible baselines, private `site:item` records, and
  unreferenced or private-only `core:tag` records
- path-purge handoff plus health and `/` verification in
  `publishPublicSiteBaseline(...)`

`@dpeek/graphle-local` should only expose local HTTP handlers and call the
deploy package. It must not contain Cloudflare API wiring, Worker source
templates, Durable Object SQL planning, or remote graph bootstrap internals.

`@dpeek/graphle-site-web` may render deploy controls and status summaries, but
it should talk only to local `/api/deploy/*` endpoints. It must not import the
Cloudflare SDK, own credentials, mutate graph state directly, or know Durable
Object details.

### Credential input

Support the smallest explicit Cloudflare input set:

- account ID
- API token
- optional Worker name override

For this phase, deploy to the default Worker URL first. Custom domain and zone
routing can be added later because they add DNS ownership, route conflicts, and
certificate edge cases that are not needed to prove the MVP.

Credential rules:

- read credentials from optional `.env` keys or a one-time authenticated form
  submit
- never log the API token
- never store the API token in graph facts, deploy metadata, or shell status
- store only nonsecret remote endpoint metadata locally
- return validation errors that name the missing setting without echoing secret
  values

The `.env` file remains append-safe and optional. A user who never deploys
should still have only the Phase 4 local state.

### Local deploy API

Keep `/api/*` as the only API namespace.

Add the narrow deploy API needed by the browser app:

- `GET /api/deploy/status`: authenticated deploy readiness and last remote
  metadata
- `POST /api/deploy`: authenticated deploy request with optional credentials
  and Worker name

Behavior:

- unauthenticated deploy reads and writes return JSON 401
- invalid settings return JSON 400 with field-level diagnostics
- Cloudflare API failures return JSON 502 or 503 with sanitized details
- unknown `/api/*` keeps the existing JSON 404 behavior
- requests should serialize or reject concurrent deploy attempts for the same
  local project instead of racing resource updates

The shell host status should expose deploy state as `idle`, `checking`,
`deploying`, `ready`, or `error` without leaking credentials.

### Remote metadata

Persist nonsecret deployment metadata in `graphle.sqlite` through graph-backed
state, not a new sidecar file.

The deploy package may define a small deploy metadata namespace for:

- Cloudflare account ID
- Worker name
- Worker URL
- Durable Object binding/resource identity
- last deployed public baseline cursor or hash
- last deploy time
- last deploy status and sanitized error summary

Boot the local authority with this deploy metadata only as needed for Phase 5.
Do not add workflow, identity, installed-module, saved-query, or app-owned
schema to support deploy metadata.

### Public baseline export and publish

Do not upload the full local graph to Cloudflare.

The deploy package should build a public deploy baseline from the local
persisted authority. That baseline should contain:

- public `site:item` records
- `core:tag` records referenced by public items
- schema/bootstrap records required for the remote authority to interpret those
  items and tags
- deploy metadata needed by the remote runtime

It should not contain:

- private items
- tags referenced only by private items
- local admin auth data
- Cloudflare API tokens
- local-only deploy form state

The current public baseline projection lives in `@dpeek/graphle-local` as
`buildPublicSiteGraphBaseline(...)`. Phase 5 should either move that builder to
`@dpeek/graphle-deploy-cloudflare` or call it through a narrow local boundary.
Do not duplicate the filtering rules.

The deploy operation should:

1. validate Cloudflare inputs
2. derive deterministic resource names from `GRAPHLE_PROJECT_ID` and any
   explicit Worker name override
3. create or update the Worker script from the deploy package runtime
4. provision or update the Durable Object binding and migration state
5. build the projected public graph baseline from the local authority
6. publish the baseline through `publishPublicSiteBaseline(...)`
7. verify the remote health endpoint
8. verify at least `/` from the public Worker URL
9. verify that a known URL-only public item appears in the public list when one
   exists locally
10. persist nonsecret remote metadata locally

Re-running deploy should update the same resources. It must not create duplicate
Workers or Durable Object classes for the same project.

### Remote Worker runtime

The remote Worker runtime already exists in `@dpeek/graphle-deploy-cloudflare`.
Phase 5 should package and deploy that runtime, not create a second one. The
remote Worker remains a small public-site runtime, not the current app runtime.

It already:

- boots minimal core plus `core:tag` plus the `site:item` schema needed to
  render public items
- persists the remote public graph baseline in a Durable Object
- accepts baseline replacement only through a deploy-only endpoint protected by
  a per-deploy secret
- serves public website routes by exact item path
- includes URL-only public items in the public sidebar/list
- renders item tags for public items
- returns JSON health/status for deploy verification under `/api/health`
- returns JSON 404 for unknown `/api/*`

The public renderer shares browser-safe route helpers and markdown rendering
policy with the local site path. It must not expose local admin preview rules or
private item data.

### Browser app

Add a small deploy surface to the existing inline site shell.

The browser app should:

- load `GET /api/deploy/status` only for authenticated local admins
- show the current remote URL and last deploy status when present
- provide account ID, token, and Worker name controls when settings are missing
- start deploy through `POST /api/deploy`
- show progress and sanitized errors in the shell status area or an inline panel
- explain whether the last deploy included the current public item baseline
- keep the current route preview and flat item sidebar as the primary first
  screen

Do not add `/admin`, `/deploy`, or a separate product route namespace. Deploy is
a local admin command inside the existing site shell.

### Current-app complexity to bypass

The existing `@dpeek/graphle-app` Worker is useful reference material for
Cloudflare bindings and Durable Object lessons, but Phase 5 should not copy the
app runtime.

Do not carry forward:

- Better Auth
- `AUTH_DB` or D1 auth migrations
- app-owned session bootstrap
- app-owned graph API routes
- query, saved-view, workflow, or installed-module surfaces
- bearer-share access policy
- the app SPA route tree
- app-specific Durable Object projections

The remote Worker should be a personal-site deploy target, not a hosted copy of
the current Graphle app.

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
- Keep deploy controls inside the authenticated local site shell.
- Keep Cloudflare deployment code in `@dpeek/graphle-deploy-cloudflare`.
- Keep local API route ownership in `@dpeek/graphle-local`.
- Keep site schema in `@dpeek/graphle-module-site`.
- Keep site browser assembly in `@dpeek/graphle-site-web`.
- Keep shell runtime and feature composition in `@dpeek/graphle-web-shell`.
- Do not store Cloudflare API tokens in graph facts or deploy metadata.
- Do not log secret values.
- Do not upload private items or private-only tags to the remote public graph.
- Keep remote rendering public-item only in this phase.
- Do not implement continuous sync in this phase.
- Keep package docs current for every package touched or added.
- Websites and browser apps must be visually checked with desktop and mobile
  screenshots.

## Open Questions

None. This plan assumes Worker URL deployment only, credentials supplied by
`.env` or a one-time local form, and baseline publish without ongoing sync.

## Success Criteria

- `@dpeek/graphle-deploy-cloudflare` continues to own the existing public
  Worker runtime, Durable Object baseline storage, protected baseline
  replacement, route SSR, cache policy, and publish handoff.
- The deploy package owns Cloudflare API calls, Worker bundle generation,
  Durable Object binding/migration config, remote metadata contracts, and
  sanitized deploy errors.
- `@dpeek/graphle-local` exposes authenticated `GET /api/deploy/status` and
  `POST /api/deploy` handlers under `/api/*`.
- Unauthenticated deploy requests return JSON 401.
- Invalid deploy settings return JSON 400 without leaking token values.
- Cloudflare API failures return sanitized JSON errors.
- A valid deploy creates or updates a deterministic Worker and Durable Object
  target.
- Re-running deploy updates the same remote resources without duplicate Workers
  or Durable Object classes.
- The deployed baseline contains public `site:item` records.
- The deployed baseline contains only `core:tag` records referenced by public
  items.
- Private items and private-only tags are absent from the deployed public graph.
- The deployed Worker serves `/` and exact item paths from remote graph state.
- The deployed Worker includes URL-only public items in the public sidebar/list.
- Unknown remote `/api/*` routes return JSON 404.
- Remote baseline replacement rejects incompatible projection metadata, private
  `site:item` records, and unreferenced or private-only `core:tag` records.
- Local nonsecret remote metadata survives `graphle dev` restart through
  `graphle.sqlite`.
- The browser shell shows deploy status, remote URL, progress, and sanitized
  errors only for authenticated local admins.
- The first screen remains the usable site preview with flat item sidebar, not
  a deploy dashboard.
- The phase path does not import `@dpeek/graphle-app`, `better-auth`, or
  `AUTH_DB` wiring.
- New and changed docs describe deploy ownership, credential handling, remote
  runtime limits, public baseline filtering, and Phase 6 sync handoff.
- Desktop and mobile browser screenshots show a nonblank site preview, item
  sidebar, and authenticated deploy controls.
- `turbo build` passes.
- `turbo check` passes.

## Implementation Notes

- Deploy now uploads packaged `@dpeek/graphle-site-web` `/assets/*` files
  through Cloudflare's static asset upload flow, binds them as `ASSETS`, and
  injects stylesheet paths from the Vite manifest into the remote public HTML.
  The deployed public Worker does not inject the current site-web JavaScript
  entry because that entry boots the local authoring shell rather than a public
  hydration runtime.
- Baseline publish retries include a longer workers.dev propagation window.
  A previous Worker version can briefly answer `/api/baseline` after a
  successful script upload and return errors like
  `Validation failed for "type": Field "type" must reference an existing "Type" entity.`;
  deploy treats those transient 400 responses as retryable before reporting a
  sanitized final failure.

## Tasks

Already completed by `./cloud-public-rendering.md`:

- Add `@dpeek/graphle-deploy-cloudflare` with package metadata, exports,
  TypeScript config, README, and package docs.
- Implement the remote Worker runtime owned by the deploy package.
- Implement Durable Object storage for the remote public site baseline.
- Add remote Worker tests for health, unknown `/api/*`, baseline install, exact
  item-path rendering, URL-only public item list rendering, private item
  absence, private-only tag absence, missing-route HTML, cache headers, static
  assets, and publish handoff.
- Add protected baseline replacement with projection compatibility validation
  and remote sanitization checks.
- Add publish handoff for baseline replacement, known path purge, remote health
  verification, and `/` verification.

Remaining Phase 5 tasks:

- Define Cloudflare deploy input, status, result, metadata, and sanitized error
  types.
- Add tests for deploy input validation, secret redaction, deterministic naming,
  and metadata parsing.
- Define the minimal graph-backed deploy metadata namespace and boot it in the
  local authority without importing app-owned schema.
- Add tests that deploy metadata persists in `graphle.sqlite` across local
  authority reopen.
- Implement public baseline projection from the local persisted authority:
  public items, referenced tags, and required schema/bootstrap records only.
  Move the current local builder into the deploy package if that is the cleanest
  ownership split; otherwise keep one shared implementation and call it from the
  local deploy API.
- Add tests for public baseline projection: private item exclusion, private-only
  tag exclusion, URL-only public item inclusion, routed public item inclusion,
  and path/URL item inclusion.
- Implement Cloudflare API client boundaries for Worker create/update, Durable
  Object migration/binding updates, and remote verification.
- Add tests for API request construction with mocked Cloudflare responses.
- Implement deploy orchestration: validate inputs, provision/update resources,
  build and publish the public baseline through `publishPublicSiteBaseline(...)`,
  verify the remote health and `/`, then persist metadata.
- Add local API handlers for `GET /api/deploy/status` and `POST /api/deploy`.
- Add local-server tests for authenticated deploy, unauthenticated 401s,
  validation failures, sanitized Cloudflare failures, successful metadata
  persistence, and unchanged unknown `/api/*` JSON 404s.
- Update `@dpeek/graphle-site-web` to load deploy status for authenticated
  sessions.
- Add deploy controls, progress display, remote URL display, public-baseline
  status, and sanitized error rendering inside the existing site shell.
- Add site-web tests for authenticated deploy UI visibility, visitor hiding,
  missing-settings flow, success state, public-baseline status, and error state.
- Add browser smoke checks against `graphle dev` for desktop and mobile:
  authenticated deploy controls, progress/error state, item sidebar, and remote
  URL display.
- Update package docs, `doc/index.md`, and `pdr/README.md` for the
  item-focused Cloudflare deployment path and the Phase 6 sync handoff.

## Non-Goals

- continuous local/remote sync
- remote authoring or remote admin login
- Better Auth migration or removal from `@dpeek/graphle-app`
- custom domains, zone routes, DNS management, or certificate management
- source scaffolding, markdown files, or a user-project Vite app in the cwd
- standalone admin routes or a separate deploy dashboard
- arbitrary module deployment beyond the personal-site MVP graph
- previews, staging environments, rollbacks, or deploy history UI
- tag landing pages
- custom icon upload or arbitrary SVG icons
- automatic link preview scraping
- media uploads
- comments, RSS, sitemap, full-text indexing, analytics, forms, or newsletter
  capture
